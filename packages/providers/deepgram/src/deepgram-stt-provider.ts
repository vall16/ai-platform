// DeepgramSTTProvider — adapter for Deepgram's speech-to-text API.

import type {
  STTProvider,
  AudioInput,
  TranscriptionResult,
  STTStream,
  ProviderContext,
  ProviderResult,
  HealthStatus,
  Capabilities,
} from '@ai-platform/contracts';

export interface DeepgramConfig {
  /** Deepgram API key. */
  apiKey: string;
  /** Base URL (default: https://api.deepgram.com). */
  baseUrl?: string;
  /** WebSocket URL for streaming (default: wss://listen.deepgram.com). */
  wsUrl?: string;
  /** Cost per audio minute in microdollars. */
  costPerMinuteMicroUsd?: number;
}

const DEFAULT_BASE_URL = 'https://api.deepgram.com';
const DEFAULT_WS_URL = 'wss://listen.deepgram.com/v1/listen';
const DEFAULT_COST_PER_MINUTE = 1_200_000; // $1.20/min

export class DeepgramSTTProvider implements STTProvider {
  readonly id: string;
  readonly name = 'deepgram';

  private readonly baseUrl: string;
  private readonly wsUrl: string;
  private readonly apiKey: string;
  private readonly costPerMinute: number;
  private lastLatencyMs = 0;

  constructor(config: DeepgramConfig, id?: string) {
    this.id = id ?? `deepgram-${config.apiKey.slice(0, 8)}`;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.wsUrl = config.wsUrl ?? DEFAULT_WS_URL;
    this.apiKey = config.apiKey;
    this.costPerMinute = config.costPerMinuteMicroUsd ?? DEFAULT_COST_PER_MINUTE;
  }

  async getHealth(_ctx: ProviderContext): Promise<HealthStatus> {
    const start = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/v1/projects`, {
        headers: { 'Authorization': `Token ${this.apiKey}` },
      });
      this.lastLatencyMs = Date.now() - start;

      if (!res.ok) {
        return {
          status: 'degraded',
          latencyMs: this.lastLatencyMs,
          checkedAt: new Date().toISOString(),
          detail: `HTTP ${res.status}`,
        };
      }

      return {
        status: 'healthy',
        latencyMs: this.lastLatencyMs,
        checkedAt: new Date().toISOString(),
      };
    } catch (err) {
      this.lastLatencyMs = Date.now() - start;
      return {
        status: 'unhealthy',
        latencyMs: this.lastLatencyMs,
        checkedAt: new Date().toISOString(),
        detail: err instanceof Error ? err.message : 'unknown error',
      };
    }
  }

  async getCapabilities(): Promise<Capabilities> {
    return {
      streaming: true,
      languages: ['en', 'it', 'es', 'fr', 'de', 'pt', 'nl', 'sv'],
      audioFormats: ['audio/webm', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac'],
      features: { 'word-timestamps': true, 'punctuation': true, 'filler-words': true },
    };
  }

  async shutdown(): Promise<void> {}

  async transcribe(ctx: ProviderContext, audio: AudioInput): Promise<ProviderResult<TranscriptionResult>> {
    const start = Date.now();

    const params = new URLSearchParams({
      model: 'nova-2',
      smart_format: 'true',
      punctuate: 'true',
      word_timestamps: 'true',
    });
    if (audio.language) {
      params.set('language', audio.language);
    }

    const res = await fetch(`${this.baseUrl}/v1/listen?${params}`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${this.apiKey}`,
        'Content-Type': audio.mimeType,
      },
      body: audio.audio as unknown as BodyInit,
    });

    if (!res.ok) {
      throw new DeepgramError(`Transcription failed: HTTP ${res.status}`, res.status);
    }

    const data = await res.json() as {
      result: {
        channels: Array<{
          alternatives: Array<{
            transcript: string;
            confidence: number;
            words: Array<{ word: string; start: number; end: number }>;
          }>;
        }>;
        duration: number;
      };
    };

    const channel = data.result.channels[0];
    const alt = channel.alternatives[0];
    const durationMs = Date.now() - start;
    const audioSeconds = data.result.duration;

    return {
      data: {
        text: alt.transcript,
        confidence: alt.confidence,
        words: alt.words.map((w) => ({
          word: w.word,
          startMs: Math.round(w.start * 1000),
          endMs: Math.round(w.end * 1000),
        })),
      },
      cost: { costMicroUsd: Math.ceil((audioSeconds / 60) * this.costPerMinute) },
      usage: { durationMs, audioSeconds, bytes: audio.audio.length },
      providerId: this.id,
      completedAt: new Date().toISOString(),
    };
  }

  async startStream(ctx: ProviderContext, language?: string): Promise<STTStream> {
    const params = new URLSearchParams({
      model: 'nova-2',
      smart_format: 'true',
      interim_results: 'true',
      encoding: 'linear16',
      sample_rate: '16000',
      channels: '1',
    });
    if (language) {
      params.set('language', language);
    }

    const wsUrl = `${this.wsUrl}?${params}&Authorization=${encodeURIComponent(`Token ${this.apiKey}`)}`;

    let ws: WebSocket;
    let transcriptCallback: ((result: TranscriptionResult, isFinal: boolean) => void) | null = null;
    let closed = false;

    // Open WebSocket connection.
    const wsPromise = new Promise<WebSocket>((resolve, reject) => {
      ws = new WebSocket(wsUrl);
      ws.onopen = () => resolve(ws);
      ws.onerror = (e) => reject(new DeepgramError('WebSocket connection failed', 500));
    });

    const connectedWs = await wsPromise;

    connectedWs.onmessage = (event) => {
      if (closed) return;
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.channel?.alternatives?.[0]) {
          const alt = msg.channel.alternatives[0];
          const isFinal = msg.is_final ?? false;
          transcriptCallback?.(
            {
              text: alt.transcript,
              confidence: alt.confidence ?? 0,
              words: alt.words?.map((w: { word: string; start: number; end: number }) => ({
                word: w.word,
                startMs: Math.round(w.start * 1000),
                endMs: Math.round(w.end * 1000),
              })),
            },
            isFinal,
          );
        }
      } catch {
        // Ignore malformed messages.
      }
    };

    return {
      sessionId: `deepgram-stream-${Date.now()}`,
      send(chunk: Uint8Array) {
        if (closed || connectedWs.readyState !== WebSocket.OPEN) return;
        connectedWs.send(chunk);
      },
      onTranscript(cb: (result: TranscriptionResult, isFinal: boolean) => void) {
        transcriptCallback = cb;
      },
      async close() {
        closed = true;
        if (connectedWs.readyState === WebSocket.OPEN) {
          connectedWs.close();
        }
      },
    };
  }
}

export class DeepgramError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'DeepgramError';
  }
}
