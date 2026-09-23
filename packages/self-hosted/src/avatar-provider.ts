// SelfHostedAvatarProvider — avatar sessions served by a self-hosted GPU
// (H200/H100/B200). Cost is dynamic: the GPU has a fixed hourly cost that is
// amortized over the active sessions, so each session gets cheaper as
// utilization rises.

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
import {
  SelfHostedEconomics,
  type SelfHostedConfig,
  type SelfHostedEconomicsResult,
} from '@ai-platform/cost-ledger';

export class SelfHostedAvatarProvider implements AvatarProvider {
  readonly id = 'self-hosted-avatar-1';
  readonly name = 'self-hosted-avatar';
  readonly capacity: number;

  private activeSessions = 0;
  private readonly economics: SelfHostedEconomics;
  private readonly latencyMs: number;

  constructor(config: SelfHostedConfig, latencyMs = 1200) {
    this.capacity = config.capacity;
    this.economics = new SelfHostedEconomics(config);
    this.latencyMs = latencyMs;
  }

  /** Current number of active sessions on this GPU. */
  get activeSessionCount(): number {
    return this.activeSessions;
  }

  /** Current utilization (0..1). */
  get utilization(): number {
    return this.capacity > 0 ? this.activeSessions / this.capacity : 0;
  }

  /** The underlying economics calculator (exposed for inspection/testing). */
  getEconomics(): SelfHostedEconomics {
    return this.economics;
  }

  /** Effective economics at the current utilization. */
  currentEconomics(avgSessionMinutes = 5): SelfHostedEconomicsResult {
    return this.economics.effectiveCost(this.utilization, avgSessionMinutes);
  }

  async getHealth(_ctx: ProviderContext): Promise<HealthStatus> {
    return { status: 'healthy', latencyMs: this.latencyMs, checkedAt: new Date().toISOString() };
  }

  async getCapabilities(): Promise<Capabilities> {
    return {
      streaming: true,
      languages: ['en', 'it'],
      maxConcurrentSessions: this.capacity,
      features: { 'lip-sync': true, realtime: true, 'self-hosted': true },
    };
  }

  async shutdown(): Promise<void> {
    this.activeSessions = 0;
  }

  async createSession(
    ctx: ProviderContext,
    _config: AvatarSessionConfig,
  ): Promise<ProviderResult<AvatarSession>> {
    this.activeSessions += 1;
    const cost = this.economics.effectiveCost(this.utilization).effectiveCostPerSessionMicroUsd;
    const sessionId = `self-hosted-session-${Date.now()}-${this.activeSessions}`;

    return {
      data: {
        sessionId,
        streamUrl: `wss://self-hosted.local/stream/${sessionId}`,
        clientToken: `self-hosted-token-${ctx.tenantId}`,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
      cost: { costMicroUsd: cost },
      usage: { durationMs: this.latencyMs },
      providerId: this.id,
      completedAt: new Date().toISOString(),
    };
  }

  async stopSession(_ctx: ProviderContext, _sessionId: string): Promise<void> {
    this.activeSessions = Math.max(0, this.activeSessions - 1);
  }

  async generate(
    ctx: ProviderContext,
    _config: AvatarSessionConfig,
    script: string,
  ): Promise<ProviderResult<AvatarGenerationResult>> {
    const durationSec = Math.max(1, Math.ceil(script.length / 15));
    const costPerMin = this.economics.effectiveCost(this.utilization).effectiveCostPerMinMicroUsd;
    const cost = Math.round((durationSec / 60) * costPerMin);

    return {
      data: {
        assetUrl: `https://self-hosted.local/assets/avatar-${Date.now()}.mp4`,
        type: 'video',
        durationSec,
      },
      cost: { costMicroUsd: cost },
      usage: { durationMs: this.latencyMs, audioSeconds: durationSec },
      providerId: this.id,
      completedAt: new Date().toISOString(),
    };
  }
}
