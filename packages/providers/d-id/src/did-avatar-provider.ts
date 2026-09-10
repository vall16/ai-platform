// DIDAvatarProvider — adapter for D-ID's talking head API (fallback provider).

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

export interface DIDConfig {
  /** D-ID API key for this tenant. */
  apiKey: string;
  /** Base URL (default: https://api.d-id.com). */
  baseUrl?: string;
  /** Cost per session in microdollars. */
  costPerSessionMicroUsd?: number;
  /** Cost per second of generated video in microdollars. */
  costPerSecondMicroUsd?: number;
}

const DEFAULT_BASE_URL = 'https://api.d-id.com';
const DEFAULT_COST_PER_SESSION = 150_000; // $0.15
const DEFAULT_COST_PER_SECOND = 40_000; // $0.04/sec

export class DIDAvatarProvider implements AvatarProvider {
  readonly id: string;
  readonly name = 'd-id';

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly costPerSession: number;
  private readonly costPerSecond: number;
  private lastLatencyMs = 0;

  constructor(config: DIDConfig, id?: string) {
    this.id = id ?? `d-id-${config.apiKey.slice(0, 8)}`;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.apiKey = config.apiKey;
    this.costPerSession = config.costPerSessionMicroUsd ?? DEFAULT_COST_PER_SESSION;
    this.costPerSecond = config.costPerSecondMicroUsd ?? DEFAULT_COST_PER_SECOND;
  }

  async getHealth(ctx: ProviderContext): Promise<HealthStatus> {
    const start = Date.now();
    try {
      const res = await this.fetch('/v1/health');
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
      languages: ['en', 'it', 'es', 'fr', 'de', 'pt', 'hi'],
      maxConcurrentSessions: 50,
      features: {
        'lip-sync': true,
        'realtime': true,
        'photo-avatar': true,
        'custom-background': false,
      },
    };
  }

  async shutdown(): Promise<void> {
    // D-ID talks are server-side; nothing to clean up locally.
  }

  async createSession(ctx: ProviderContext, config: AvatarSessionConfig): Promise<ProviderResult<AvatarSession>> {
    const start = Date.now();

    const body = {
      source_url: `avatar://${config.avatarId}`,
      script: {
        type: 'text',
        input: config.greeting ?? 'Hello!',
      },
      voice: {
        type: 'text-to-speech',
        voice_id: 'default',
      },
      div_id: `session-${ctx.sessionId}`,
      privacy: true,
    };

    const res = await this.fetch('/v2/talks', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new DIDError(`Failed to create talk: HTTP ${res.status}`, res.status);
    }

    const data = await res.json() as {
      output: {
        resource_url: string;
        resource_id: string;
      };
    };

    const durationMs = Date.now() - start;
    const sessionId = data.output.resource_id;

    return {
      data: {
        sessionId,
        streamUrl: `${this.baseUrl}${data.output.resource_url}`,
        clientToken: this.apiKey,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
      cost: { costMicroUsd: this.costPerSession },
      usage: { durationMs },
      providerId: this.id,
      completedAt: new Date().toISOString(),
    };
  }

  async stopSession(ctx: ProviderContext, sessionId: string): Promise<void> {
    await this.fetch(`/v2/talks/${sessionId}`, { method: 'DELETE' });
  }

  async generate(
    ctx: ProviderContext,
    config: AvatarSessionConfig,
    script: string,
  ): Promise<ProviderResult<AvatarGenerationResult>> {
    const start = Date.now();

    const body = {
      source_url: `avatar://${config.avatarId}`,
      script: {
        type: 'text',
        input: script,
      },
      voice: {
        type: 'text-to-speech',
        voice_id: 'default',
      },
      privacy: true,
    };

    const res = await this.fetch('/v2/talks', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new DIDError(`Failed to create talk: HTTP ${res.status}`, res.status);
    }

    const data = await res.json() as {
      output: {
        resource_url: string;
        resource_id: string;
      };
    };

    // Poll for completion.
    const videoUrl = await this.pollTalk(data.output.resource_id, start);
    const durationMs = Date.now() - start;
    const estimatedSeconds = Math.ceil(script.length / 15);

    return {
      data: {
        assetUrl: `${this.baseUrl}${videoUrl}`,
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
        Authorization: `Bearer ${this.apiKey}`,
        ...init?.headers,
      },
    });
    return res;
  }

  private async pollTalk(talkId: string, startTime: number, timeoutMs = 120_000): Promise<string> {
    const deadline = startTime + timeoutMs;

    while (Date.now() < deadline) {
      const res = await this.fetch(`/v2/talks/${talkId}`);
      if (!res.ok) {
        throw new DIDError(`Poll failed: HTTP ${res.status}`, res.status);
      }

      const data = await res.json() as {
        status: string;
        output?: { resource_url: string };
      };

      if (data.status === 'done' && data.output) {
        return data.output.resource_url;
      }
      if (data.status === 'error') {
        throw new DIDError('Talk generation failed', 500);
      }

      await new Promise((r) => setTimeout(r, 2000));
    }

    throw new DIDError('Talk generation timed out', 408);
  }
}

export class DIDError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'DIDError';
  }
}
