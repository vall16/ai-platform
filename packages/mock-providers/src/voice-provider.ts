// MockVoiceProvider — simulates the full voice pipeline.

import type {
  VoiceProvider,
  VoiceSessionConfig,
  VoiceSession,
  VoiceTurn,
  ProviderContext,
  ProviderResult,
  HealthStatus,
  Capabilities,
} from '@ai-platform/contracts';

export class MockVoiceProvider implements VoiceProvider {
  readonly id = 'mock-voice-1';
  readonly name = 'mock-voice';

  private sessions = new Map<string, VoiceTurn[]>();

  constructor(
    private readonly costPerSecond = 50_000, // microdollars per second
    private readonly latencyMs = 300,
  ) {}

  async getHealth(_ctx: ProviderContext): Promise<HealthStatus> {
    return { status: 'healthy', latencyMs: this.latencyMs, checkedAt: new Date().toISOString() };
  }

  async getCapabilities(): Promise<Capabilities> {
    return {
      streaming: true,
      languages: ['en', 'it'],
      maxConcurrentSessions: 100,
      features: { 'barge-in': true, 'realtime': true },
    };
  }

  async shutdown(): Promise<void> {
    this.sessions.clear();
  }

  async startSession(ctx: ProviderContext, config: VoiceSessionConfig): Promise<ProviderResult<VoiceSession>> {
    const sessionId = `mock-voice-${Date.now()}`;
    this.sessions.set(sessionId, []);

    return {
      data: {
        sessionId,
        inputUrl: `wss://mock.local/voice/${sessionId}/in`,
        outputUrl: `wss://mock.local/voice/${sessionId}/out`,
        expiresAt: new Date(Date.now() + config.maxDurationSec * 1000).toISOString(),
      },
      cost: { costMicroUsd: 0 },
      usage: { durationMs: this.latencyMs },
      providerId: this.id,
      completedAt: new Date().toISOString(),
    };
  }

  async stopSession(ctx: ProviderContext, sessionId: string): Promise<ProviderResult<VoiceTurn[]>> {
    const turns = this.sessions.get(sessionId) ?? [];
    this.sessions.delete(sessionId);

    const totalSeconds = turns.reduce((sum, t) => sum + t.audioDurationSec, 0);

    return {
      data: turns,
      cost: { costMicroUsd: totalSeconds * this.costPerSecond },
      usage: { durationMs: this.latencyMs, audioSeconds: totalSeconds },
      providerId: this.id,
      completedAt: new Date().toISOString(),
    };
  }

  async sendText(ctx: ProviderContext, sessionId: string, text: string): Promise<void> {
    const turns = this.sessions.get(sessionId);
    if (!turns) return;

    turns.push({
      role: 'user',
      text,
      audioDurationSec: Math.ceil(text.length / 15),
      timestamp: new Date().toISOString(),
    });

    // Simulate assistant response.
    turns.push({
      role: 'assistant',
      text: `[mock-voice] I heard: "${text.slice(0, 80)}"`,
      audioDurationSec: Math.ceil(30 / 15),
      timestamp: new Date().toISOString(),
    });
  }
}
