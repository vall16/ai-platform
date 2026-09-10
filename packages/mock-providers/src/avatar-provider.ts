// MockAvatarProvider — simulates avatar sessions without real video generation.

import type {
  AvatarProvider,
  AvatarSessionConfig,
  AvatarSession,
  AvatarGenerationResult,
  ProviderContext,
  ProviderResult,
  HealthStatus,
  Capabilities,
} from '@ai-platform/contracts';

export class MockAvatarProvider implements AvatarProvider {
  readonly id = 'mock-avatar-1';
  readonly name = 'mock-avatar';

  constructor(
    private readonly costPerSession = 200_000, // microdollars per session
    private readonly latencyMs = 800,
  ) {}

  async getHealth(_ctx: ProviderContext): Promise<HealthStatus> {
    return { status: 'healthy', latencyMs: this.latencyMs, checkedAt: new Date().toISOString() };
  }

  async getCapabilities(): Promise<Capabilities> {
    return {
      streaming: true,
      languages: ['en', 'it'],
      maxConcurrentSessions: 50,
      features: { 'lip-sync': true, 'realtime': true },
    };
  }

  async shutdown(): Promise<void> {}

  async createSession(ctx: ProviderContext, config: AvatarSessionConfig): Promise<ProviderResult<AvatarSession>> {
    const sessionId = `mock-avatar-session-${Date.now()}`;

    return {
      data: {
        sessionId,
        streamUrl: `wss://mock.local/stream/${sessionId}`,
        clientToken: `mock-token-${ctx.tenantId}`,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
      cost: { costMicroUsd: this.costPerSession },
      usage: { durationMs: this.latencyMs },
      providerId: this.id,
      completedAt: new Date().toISOString(),
    };
  }

  async stopSession(_ctx: ProviderContext, _sessionId: string): Promise<void> {}

  async generate(
    ctx: ProviderContext,
    _config: AvatarSessionConfig,
    script: string,
  ): Promise<ProviderResult<AvatarGenerationResult>> {
    const durationSec = Math.max(1, Math.ceil(script.length / 15));

    return {
      data: {
        assetUrl: `https://mock.local/assets/avatar-${Date.now()}.mp4`,
        type: 'video',
        durationSec,
      },
      cost: { costMicroUsd: durationSec * 50_000 },
      usage: { durationMs: this.latencyMs, audioSeconds: durationSec },
      providerId: this.id,
      completedAt: new Date().toISOString(),
    };
  }
}
