// HeyGenAvatarProvider — adapter for HeyGen's avatar video API.

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

export interface HeyGenConfig {
  /** HeyGen API key for this tenant. */
  apiKey: string;
  /** Base URL (default: https://api.heygen.com). */
  baseUrl?: string;
  /** Cost per session in microdollars (for Cost Ledger). */
  costPerSessionMicroUsd?: number;
  /** Cost per second of generated video in microdollars. */
  costPerSecondMicroUsd?: number;
}

const DEFAULT_BASE_URL = 'https://api.heygen.com';
const DEFAULT_COST_PER_SESSION = 200_000; // $0.20
const DEFAULT_COST_PER_SECOND = 50_000; // $0.05/sec

export class HeyGenAvatarProvider implements AvatarProvider {
  readonly id: string;
  readonly name = 'heygen';

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly costPerSession: number;
  private readonly costPerSecond: number;
  private lastLatencyMs = 0;

  constructor(config: HeyGenConfig, id?: string) {
    this.id = id ?? `heygen-${config.apiKey.slice(0, 8)}`;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.apiKey = config.apiKey;
    this.costPerSession = config.costPerSessionMicroUsd ?? DEFAULT_COST_PER_SESSION;
    this.costPerSecond = config.costPerSecondMicroUsd ?? DEFAULT_COST_PER_SECOND;
  }

  async getHealth(ctx: ProviderContext): Promise<HealthStatus> {
    const start = Date.now();
    try {
      const res = await this.fetch('/v1/status');
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
      languages: ['en', 'it', 'es', 'fr', 'de', 'ja', 'ko'],
      maxConcurrentSessions: 100,
      features: {
        'lip-sync': true,
        'realtime': true,
        'custom-background': true,
        'photo-avatar': true,
      },
    };
  }

  async shutdown(): Promise<void> {
    // HeyGen sessions are server-side; nothing to clean up locally.
  }

  async createSession(ctx: ProviderContext, config: AvatarSessionConfig): Promise<ProviderResult<AvatarSession>> {
    const start = Date.now();

    const body = {
      activity_id: `session-${ctx.sessionId}`,
      avatar_id: config.avatarId,
      background: config.background ?? 'studio',
      resolution: config.resolution ?? '1080p',
      lip_sync: config.lipSync,
      greeting: config.greeting ?? '',
    };

    const res = await this.fetch('/v1/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new HeyGenError(`Failed to create session: HTTP ${res.status}`, res.status);
    }

    const data = await res.json() as {
      session_id: string;
      stream_url: string;
      client_token: string;
      expires_at: string;
    };

    const durationMs = Date.now() - start;

    return {
      data: {
        sessionId: data.session_id,
        streamUrl: data.stream_url,
        clientToken: data.client_token,
        expiresAt: data.expires_at,
      },
      cost: { costMicroUsd: this.costPerSession },
      usage: { durationMs },
      providerId: this.id,
      completedAt: new Date().toISOString(),
    };
  }

  async stopSession(ctx: ProviderContext, sessionId: string): Promise<void> {
    await this.fetch(`/v1/sessions/${sessionId}`, { method: 'DELETE' });
  }

  async generate(
    ctx: ProviderContext,
    config: AvatarSessionConfig,
    script: string,
  ): Promise<ProviderResult<AvatarGenerationResult>> {
    const start = Date.now();

    const body = {
      avatar_id: config.avatarId,
      script,
      background: config.background ?? 'studio',
      resolution: config.resolution ?? '1080p',
    };

    const res = await this.fetch('/v1/video/generate', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new HeyGenError(`Failed to generate video: HTTP ${res.status}`, res.status);
    }

    const data = await res.json() as {
      video_id: string;
      status: string;
    };

    // Poll until complete (with timeout).
    const videoUrl = await this.pollVideo(data.video_id, start);
    const durationMs = Date.now() - start;
    const estimatedSeconds = Math.ceil(script.length / 15);

    return {
      data: {
        assetUrl: videoUrl,
        type: 'video',
        durationSec: estimatedSeconds,
      },
      cost: { costMicroUsd: estimatedSeconds * this.costPerSecond },
      usage: { durationMs, audioSeconds: estimatedSeconds },
      providerId: this.id,
      completedAt: new Date().toISOString(),
    };
  }

  // --- Private helpers ---

  private async fetch(path: string, init?: RequestInit): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': this.apiKey,
        ...init?.headers,
      },
    });
    return res;
  }

  private async pollVideo(videoId: string, startTime: number, timeoutMs = 120_000): Promise<string> {
    const deadline = startTime + timeoutMs;

    while (Date.now() < deadline) {
      const res = await this.fetch(`/v1/video/${videoId}`);
      if (!res.ok) {
        throw new HeyGenError(`Poll failed: HTTP ${res.status}`, res.status);
      }

      const data = await res.json() as { status: string; output: string };

      if (data.status === 'completed') {
        return data.output;
      }
      if (data.status === 'failed') {
        throw new HeyGenError('Video generation failed', 500);
      }

      await new Promise((r) => setTimeout(r, 2000));
    }

    throw new HeyGenError('Video generation timed out', 408);
  }
}

export class HeyGenError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'HeyGenError';
  }
}
