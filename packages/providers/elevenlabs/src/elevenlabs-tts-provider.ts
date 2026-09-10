// ElevenLabsTTSProvider — adapter for ElevenLabs' text-to-speech API.

import type {
  TTSProvider,
  TTSRequest,
  TTSResult,
  TTSStream,
  ProviderContext,
  ProviderResult,
  HealthStatus,
  Capabilities,
} from '@ai-platform/contracts';

export interface ElevenLabsConfig {
  /** ElevenLabs API key. */
  apiKey: string;
  /** Base URL (default: https://api.elevenlabs.io). */
  baseUrl?: string;
  /** Cost per character in microdollars. */
  costPerCharacterMicroUsd?: number;
  /** Default voice ID if not specified per request. */
  defaultVoiceId?: string;
}

const DEFAULT_BASE_URL = 'https://api.elevenlabs.io';
const DEFAULT_COST_PER_CHAR = 50; // ~$0.05 per 1000 chars

export class ElevenLabsTTSProvider implements TTSProvider {
  readonly id: string;
  readonly name = 'elevenlabs';

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly costPerChar: number;
  private readonly defaultVoiceId: string;
  private lastLatencyMs = 0;

  constructor(config: ElevenLabsConfig, id?: string) {
    this.id = id ?? `elevenlabs-${config.apiKey.slice(0, 8)}`;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.apiKey = config.apiKey;
    this.costPerChar = config.costPerCharacterMicroUsd ?? DEFAULT_COST_PER_CHAR;
    this.defaultVoiceId = config.defaultVoiceId ?? '21m00Tcm4TlvDq8ikWAM';
  }

  async getHealth(_ctx: ProviderContext): Promise<HealthStatus> {
    const start = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/v1/user`, {
        headers: { 'xi-api-key': this.apiKey },
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
      languages: ['en', 'it', 'es', 'fr', 'de', 'pl', 'dp', 'nl'],
      audioFormats: ['mp3', 'ogg', 'pcm'],
      features: {
        'voice-cloning': true,
        'style-referencing': true,
        'streaming': true,
      },
    };
  }

  async shutdown(): Promise<void> {}

  async synthesize(ctx: ProviderContext, request: TTSRequest): Promise<ProviderResult<TTSResult>> {
    const start = Date.now();
    const voiceId = request.voiceId || this.defaultVoiceId;

    const body = {
      text: request.text,
      model_id: 'eleven_turbo_v2',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        speed: request.speed ?? 1.0,
      },
    };

    const res = await fetch(
      `${this.baseUrl}/v1/text-to-speech/${voiceId}?output_format=${this.outputFormat(request.format)}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/*',
        },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      throw new ElevenLabsError(`TTS failed: HTTP ${res.status} — ${errText}`, res.status);
    }

    const audioBuffer = new Uint8Array(await res.arrayBuffer());
    const durationMs = Date.now() - start;
    // Estimate duration: ~15 chars per second.
    const estimatedSeconds = Math.max(1, Math.ceil(request.text.length / 15));

    return {
      data: {
        audio: audioBuffer,
        mimeType: this.mimeTypeFor(request.format),
        durationSec: estimatedSeconds,
      },
      cost: { costMicroUsd: Math.ceil(request.text.length * this.costPerChar) },
      usage: { durationMs, audioSeconds: estimatedSeconds, bytes: audioBuffer.length },
      providerId: this.id,
      completedAt: new Date().toISOString(),
    };
  }

  async startStream(ctx: ProviderContext, request: Omit<TTSRequest, 'text'>): Promise<TTSStream> {
    const voiceId = request.voiceId || this.defaultVoiceId;
    const self = this;
    let audioCallback: ((chunk: Uint8Array) => void) | null = null;
    let endCallback: (() => void) | null = null;
    let closed = false;

    return {
      send(text: string) {
        if (closed) return;

        // For streaming, we make a request per text segment.
        // In production, this would use ElevenLabs' streaming endpoint.
        void self.streamChunk(voiceId, text, request, (chunk: Uint8Array) => {
          audioCallback?.(chunk);
        });
      },
      onAudio(cb: (chunk: Uint8Array) => void) {
        audioCallback = cb;
      },
      onEnd(cb: () => void) {
        endCallback = cb;
      },
      async close() {
        closed = true;
        endCallback?.();
      },
    };
  }

  // --- Private helpers ---

  private async streamChunk(
    voiceId: string,
    text: string,
    request: Omit<TTSRequest, 'text'>,
    onChunk: (chunk: Uint8Array) => void,
  ): Promise<void> {
    const body = {
      text,
      model_id: 'eleven_turbo_v2',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        speed: request.speed ?? 1.0,
      },
    };

    try {
      const res = await fetch(
        `${this.baseUrl}/v1/text-to-speech/${voiceId}/stream?output_format=pcm_16000`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': this.apiKey,
            'Content-Type': 'application/json',
            'Accept': 'audio/*',
          },
          body: JSON.stringify(body),
        },
      );

      if (!res.ok) return;
      if (!res.body) return;

      const reader = res.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        onChunk(value);
      }
    } catch {
      // Stream chunk failed; silently skip.
    }
  }

  private outputFormat(format: TTSRequest['format']): string {
    const map: Record<string, string> = {
      mp3: 'mp3_44100_128',
      ogg: 'ogg_44100_64',
      wav: 'wav_44100_16bit',
      pcm: 'pcm_16000',
    };
    return map[format] ?? 'mp3_44100_128';
  }

  private mimeTypeFor(format: TTSRequest['format']): string {
    const map: Record<string, string> = {
      mp3: 'audio/mpeg',
      ogg: 'audio/ogg',
      wav: 'audio/wav',
      pcm: 'audio/pcm',
    };
    return map[format] ?? 'audio/mpeg';
  }
}

export class ElevenLabsError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'ElevenLabsError';
  }
}
