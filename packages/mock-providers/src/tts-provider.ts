// MockTTSProvider — returns silent audio bytes for development.

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

export class MockTTSProvider implements TTSProvider {
  readonly id = 'mock-tts-1';
  readonly name = 'mock-tts';

  constructor(
    private readonly costPerSecond = 25_000, // microdollars per second of audio
    private readonly latencyMs = 100,
  ) {}

  async getHealth(_ctx: ProviderContext): Promise<HealthStatus> {
    return { status: 'healthy', latencyMs: this.latencyMs, checkedAt: new Date().toISOString() };
  }

  async getCapabilities(): Promise<Capabilities> {
    return {
      streaming: true,
      languages: ['en', 'it'],
      audioFormats: ['mp3', 'ogg', 'wav', 'pcm'],
    };
  }

  async shutdown(): Promise<void> {}

  async synthesize(ctx: ProviderContext, request: TTSRequest): Promise<ProviderResult<TTSResult>> {
    // Estimate duration: ~15 chars per second of speech.
    const estimatedSeconds = Math.max(1, Math.ceil(request.text.length / 15));
    // Generate silent PCM data (16-bit, 16kHz mono) as placeholder.
    const sampleRate = 16000;
    const bytesPerSample = 2;
    const audio = new Uint8Array(estimatedSeconds * sampleRate * bytesPerSample);

    return {
      data: {
        audio,
        mimeType: this.mimeTypeFor(request.format),
        durationSec: estimatedSeconds,
      },
      cost: { costMicroUsd: estimatedSeconds * this.costPerSecond },
      usage: { durationMs: this.latencyMs, audioSeconds: estimatedSeconds, bytes: audio.length },
      providerId: this.id,
      completedAt: new Date().toISOString(),
    };
  }

  async startStream(ctx: ProviderContext, _request: Omit<TTSRequest, 'text'>): Promise<TTSStream> {
    let audioCallback: ((chunk: Uint8Array) => void) | null = null;
    let endCallback: (() => void) | null = null;

    return {
      send(text: string) {
        // Emit a small chunk of "audio" per text segment.
        const chunkSize = Math.max(1, Math.ceil(text.length / 15)) * 16000 * 2;
        audioCallback?.(new Uint8Array(chunkSize));
      },
      onAudio(cb: (chunk: Uint8Array) => void) {
        audioCallback = cb;
      },
      onEnd(cb: () => void) {
        endCallback = cb;
      },
      async close() {
        endCallback?.();
      },
    };
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
