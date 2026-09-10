// MockSTTProvider — returns fixed transcription text for development.

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

export class MockSTTProvider implements STTProvider {
  readonly id = 'mock-stt-1';
  readonly name = 'mock-stt';

  constructor(
    private readonly costPerSecond = 30_000, // microdollars per second of audio
    private readonly latencyMs = 150,
  ) {}

  async getHealth(_ctx: ProviderContext): Promise<HealthStatus> {
    return { status: 'healthy', latencyMs: this.latencyMs, checkedAt: new Date().toISOString() };
  }

  async getCapabilities(): Promise<Capabilities> {
    return {
      streaming: true,
      languages: ['en', 'it'],
      audioFormats: ['audio/webm', 'audio/mpeg', 'audio/wav'],
    };
  }

  async shutdown(): Promise<void> {}

  async transcribe(ctx: ProviderContext, audio: AudioInput): Promise<ProviderResult<TranscriptionResult>> {
    // Simulate: estimate duration from byte size (assume ~16KB/s for 16kHz 16-bit mono).
    const estimatedSeconds = Math.max(1, Math.ceil(audio.audio.length / 16000));

    return {
      data: {
        text: 'This is a mock transcription of the audio input.',
        confidence: 0.95,
        words: [
          { word: 'This', startMs: 0, endMs: 200 },
          { word: 'is', startMs: 200, endMs: 300 },
          { word: 'a', startMs: 300, endMs: 350 },
          { word: 'mock', startMs: 350, endMs: 600 },
          { word: 'transcription.', startMs: 600, endMs: 1200 },
        ],
      },
      cost: { costMicroUsd: estimatedSeconds * this.costPerSecond },
      usage: { durationMs: this.latencyMs, audioSeconds: estimatedSeconds, bytes: audio.audio.length },
      providerId: this.id,
      completedAt: new Date().toISOString(),
    };
  }

  async startStream(ctx: ProviderContext, _language?: string): Promise<STTStream> {
    let transcriptCallback: ((result: TranscriptionResult, isFinal: boolean) => void) | null = null;

    return {
      sessionId: `mock-stt-stream-${Date.now()}`,
      send(_chunk: Uint8Array) {
        // In a real mock, we could accumulate chunks and emit partial transcripts.
        // For simplicity, emit a partial on each send.
        transcriptCallback?.(
          { text: 'partial...', confidence: 0.5 },
          false,
        );
      },
      onTranscript(cb: (result: TranscriptionResult, isFinal: boolean) => void) {
        transcriptCallback = cb;
      },
      async close() {
        transcriptCallback?.(
          { text: 'This is a mock streaming transcription.', confidence: 0.92 },
          true,
        );
      },
    };
  }
}
