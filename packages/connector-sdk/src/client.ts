// @ai-platform/connector-sdk — the connector client.
//
// ConnectorClient is the single entry point a connector uses to talk to the SaaS
// backend. It owns the current session id, builds the session body from config, and
// maps backend failures to typed errors. It is transport-agnostic (see transport.ts)
// so the same code runs in a browser widget, a mobile app, or a Node service.

import type {
  ConnectorConfig,
  Session,
  SessionStatus,
  MessageResult,
  AudioResult,
  HealthResult,
} from './types.js';
import type { Transport, TransportResponse } from './transport.js';
import { FetchTransport } from './transport.js';
import {
  ConnectorError,
  AuthError,
  QuotaExhaustedError,
  SessionNotFoundError,
  SessionNotActiveError,
  SttNotConfiguredError,
} from './errors.js';

interface RequestOptions {
  body?: Record<string, unknown>;
  /** Raw request body (voice input) with an explicit content type. */
  raw?: Uint8Array;
  rawContentType?: string;
  /** Send the Authorization header (default true). */
  auth?: boolean;
}

export class ConnectorClient {
  private readonly config: ConnectorConfig;
  private readonly transport: Transport;
  private sessionId: string | null = null;

  constructor(config: ConnectorConfig) {
    if (!config.apiBase) throw new ConnectorError('apiBase is required', 0, 'invalid_config');
    if (!config.apiKey) throw new ConnectorError('apiKey is required', 0, 'invalid_config');
    if (!config.productType) throw new ConnectorError('productType is required', 0, 'invalid_config');
    this.config = config;
    this.transport =
      config.transport ??
      new FetchTransport({ fetch: config.fetch, timeoutMs: config.timeoutMs });
  }

  /** The id of the session started by the most recent startSession(), if any. */
  get currentSessionId(): string | null {
    return this.sessionId;
  }

  /** Start a new conversation session and remember its id. */
  async startSession(): Promise<Session> {
    const data = await this.request<Session>('POST', '/api/v1/sessions', {
      body: this.buildSessionBody(),
    });
    this.sessionId = data.session_id ?? data.id;
    return data;
  }

  /** Send a text message on the current session. */
  async sendMessage(text: string): Promise<MessageResult> {
    if (!text || text.trim().length === 0) {
      throw new ConnectorError('text is required', 0, 'invalid_argument');
    }
    const id = this.requireSession();
    return this.request<MessageResult>('POST', `/api/v1/sessions/${id}/messages`, {
      body: { text },
    });
  }

  /** Send a voice message (raw audio bytes) on the current session. */
  async sendAudio(bytes: Uint8Array, mimeType = 'audio/webm'): Promise<AudioResult> {
    if (!bytes || bytes.length === 0) {
      throw new ConnectorError('audio bytes are required', 0, 'invalid_argument');
    }
    const id = this.requireSession();
    return this.request<AudioResult>('POST', `/api/v1/sessions/${id}/audio`, {
      raw: bytes,
      rawContentType: mimeType,
    });
  }

  /** Close the current session and clear it. */
  async closeSession(status: 'completed' | 'abandoned' | 'error' = 'completed'): Promise<Session> {
    const id = this.requireSession();
    const data = await this.request<Session>('POST', `/api/v1/sessions/${id}/close`, {
      body: { status },
    });
    this.sessionId = null;
    return data;
  }

  /** Get a session by id (defaults to the current session). */
  async getSession(id?: string): Promise<Session> {
    const sid = id ?? this.requireSession();
    return this.request<Session>('GET', `/api/v1/sessions/${sid}`);
  }

  /** List the tenant's sessions. */
  async listSessions(opts: { status?: SessionStatus; limit?: number } = {}): Promise<Session[]> {
    const qs = new URLSearchParams();
    if (opts.status) qs.set('status', opts.status);
    if (opts.limit !== undefined) qs.set('limit', String(opts.limit));
    const q = qs.toString();
    return this.request<Session[]>('GET', `/api/v1/sessions${q ? `?${q}` : ''}`);
  }

  /** Count the tenant's active sessions. */
  async countActiveSessions(): Promise<number> {
    const data = await this.request<{ count: number }>('GET', '/api/v1/sessions/active/count');
    return data.count;
  }

  /** Build the absolute URL for a synthesized TTS audio (play it with <audio>/AVPlayer). */
  audioUrl(sessionId: string, audioId: string): string {
    return this.resolveUrl(`/api/v1/sessions/${sessionId}/audio/${audioId}`);
  }

  /** Health check (no auth). */
  async health(): Promise<HealthResult> {
    return this.request<HealthResult>('GET', '/api/v1/health', { auth: false });
  }

  // --- internals ---

  private requireSession(): string {
    if (!this.sessionId) {
      throw new ConnectorError('No active session; call startSession() first', 0, 'no_session');
    }
    return this.sessionId;
  }

  private resolveUrl(path: string): string {
    return new URL(path, this.config.apiBase).toString();
  }

  private buildSessionBody(): Record<string, unknown> {
    const c = this.config;
    const body: Record<string, unknown> = { product_type: c.productType };
    if (c.language) body.language = c.language;
    if (c.personality) body.personality = c.personality;
    if (c.avatarId) body.avatar_id = c.avatarId;
    if (c.voiceId) body.voice_id = c.voiceId;
    if (c.siteUrl) body.site_url = c.siteUrl;
    if (c.shopName) body.shop_name = c.shopName;
    if (c.shopUrl) body.shop_url = c.shopUrl;
    if (c.platform) body.platform = c.platform;
    if (c.currency) body.currency = c.currency;
    if (c.shopCredentials) body.shop_credentials = c.shopCredentials;
    if (c.metadata) body.metadata = c.metadata;
    return body;
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    opts: RequestOptions = {},
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (opts.auth !== false) headers.Authorization = `Bearer ${this.config.apiKey}`;

    let payload: string | Uint8Array | undefined;
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(opts.body);
    } else if (opts.raw !== undefined) {
      headers['Content-Type'] = opts.rawContentType ?? 'application/octet-stream';
      payload = opts.raw;
    }

    let res: TransportResponse;
    try {
      res = await this.transport.request({ method, url: this.resolveUrl(path), headers, body: payload });
    } catch (err) {
      // NetworkError (or a custom transport's network failure) propagates as-is.
      throw err;
    }

    if (res.status >= 400) {
      throw await this.toError(res);
    }
    return res.json<T>();
  }

  private async toError(res: TransportResponse): Promise<ConnectorError> {
    let code = 'error';
    let message = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data && typeof data.error === 'string') {
        code = data.error;
        message = data.error;
      }
    } catch {
      // Non-JSON error body — keep the generic message.
    }

    switch (res.status) {
      case 401:
        return new AuthError(message);
      case 402:
        return new QuotaExhaustedError(message);
      case 404:
        return new SessionNotFoundError(message);
      case 409:
        return new SessionNotActiveError(message);
      case 501:
        return new SttNotConfiguredError(message);
      default:
        return new ConnectorError(message, res.status, code);
    }
  }
}
