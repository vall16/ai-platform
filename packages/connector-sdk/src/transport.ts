// @ai-platform/connector-sdk — transport layer.
//
// The client talks to the backend through a Transport, so the HTTP mechanism is
// swappable. FetchTransport is the default (global fetch, works in browsers, mobile
// and Node 20+). MockTransport + createMockBackend let a connector run fully offline
// — the same "mock sempre disponibili" rule the rest of the platform follows.

import type { FetchLike } from './types.js';
import { NetworkError } from './errors.js';

/** A single HTTP request the transport must execute. */
export interface TransportRequest {
  method: 'GET' | 'POST';
  /** Absolute URL. */
  url: string;
  headers: Record<string, string>;
  /** JSON string or raw bytes (voice input). */
  body?: string | Uint8Array;
}

/** The transport's response. Only JSON is consumed by the client. */
export interface TransportResponse {
  status: number;
  json: <T = unknown>() => Promise<T>;
  text: () => Promise<string>;
}

/** Swappable HTTP executor. */
export interface Transport {
  request(req: TransportRequest): Promise<TransportResponse>;
}

export interface FetchTransportOptions {
  fetch?: FetchLike;
  /** Per-request timeout in milliseconds (default 30000). */
  timeoutMs?: number;
}

/** Default transport: executes requests with fetch and enforces a timeout. */
export class FetchTransport implements Transport {
  private readonly fetch: FetchLike;
  private readonly timeoutMs: number;

  constructor(opts: FetchTransportOptions = {}) {
    const f = opts.fetch ?? (globalThis as { fetch?: FetchLike }).fetch;
    if (typeof f !== 'function') {
      throw new NetworkError('No fetch implementation available; pass one via config.fetch');
    }
    this.fetch = f;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  async request(req: TransportRequest): Promise<TransportResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetch(req.url, {
        method: req.method,
        headers: req.headers,
        body: req.body,
        signal: controller.signal,
      });
      return {
        status: res.status,
        json: () => res.json(),
        text: () => res.text(),
      };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new NetworkError(`Request timed out after ${this.timeoutMs}ms`);
      }
      throw new NetworkError(err instanceof Error ? err.message : 'Network request failed');
    } finally {
      clearTimeout(timer);
    }
  }
}

/** A canned response for MockTransport. */
export interface MockResponse {
  status: number;
  /** JSON-serializable body. */
  body: unknown;
}

/** Handler that turns a request into a canned response. */
export type MockHandler = (req: TransportRequest) => MockResponse | Promise<MockResponse>;

/** In-memory transport driven by a handler — for tests and offline development. */
export class MockTransport implements Transport {
  constructor(private readonly handler: MockHandler) {}

  async request(req: TransportRequest): Promise<TransportResponse> {
    const res = await this.handler(req);
    return {
      status: res.status,
      json: <T = unknown>() => Promise.resolve(res.body as T),
      text: () => Promise.resolve(JSON.stringify(res.body)),
    };
  }
}

/**
 * Build a MockTransport that simulates the SaaS backend well enough for offline
 * development and tests: it keeps an in-memory session store, echoes messages, and
 * returns a canned voice transcript. No network, no API key required.
 */
export function createMockBackend(): MockTransport {
  let counter = 0;
  const now = () => new Date().toISOString();
  const sessions = new Map<
    string,
    { id: string; status: 'active' | 'completed' | 'abandoned' | 'error'; product_type: 'persona' | 'salesperson'; messages: string[] }
  >();

  const fullSession = (
    s: { id: string; status: 'active' | 'completed' | 'abandoned' | 'error'; product_type: 'persona' | 'salesperson' },
    ended: boolean,
  ) => ({
    id: s.id,
    tenant_id: 'mock-tenant',
    product_type: s.product_type,
    status: s.status,
    started_at: now(),
    ended_at: ended ? now() : null,
    total_cost_micro_usd: 0,
    revenue_micro_usd: 0,
    cart_additions: 0,
    orders_influenced: 0,
    revenue_influenced: 0,
    metadata: {},
    created_at: now(),
  });

  return new MockTransport((req) => {
    const path = new URL(req.url).pathname;
    const method = req.method;

    // POST /api/v1/sessions — create
    if (method === 'POST' && path === '/api/v1/sessions') {
      counter += 1;
      const id = `mock-session-${counter}`;
      const body = JSON.parse(req.body as string) as { product_type?: string };
      const s = {
        id,
        status: 'active' as const,
        product_type: (body.product_type ?? 'persona') as 'persona' | 'salesperson',
        messages: [] as string[],
      };
      sessions.set(id, s);
      return { status: 201, body: { ...fullSession(s, false), session_id: id } };
    }

    // POST /api/v1/sessions/:id/messages
    const msg = path.match(/^\/api\/v1\/sessions\/([^/]+)\/messages$/);
    if (method === 'POST' && msg) {
      const s = sessions.get(msg[1]);
      if (!s) return { status: 404, body: { error: 'Session not found' } };
      if (s.status !== 'active') return { status: 409, body: { error: 'Session is not active' } };
      const body = JSON.parse(req.body as string) as { text?: string };
      s.messages.push(body.text ?? '');
      return { status: 200, body: { reply: `Mock reply to: ${body.text ?? ''}` } };
    }

    // POST /api/v1/sessions/:id/audio
    const audio = path.match(/^\/api\/v1\/sessions\/([^/]+)\/audio$/);
    if (method === 'POST' && audio) {
      const s = sessions.get(audio[1]);
      if (!s) return { status: 404, body: { error: 'Session not found' } };
      if (s.status !== 'active') return { status: 409, body: { error: 'Session is not active' } };
      return { status: 200, body: { reply: 'Mock voice reply', transcript: 'mock transcript' } };
    }

    // POST /api/v1/sessions/:id/close
    const close = path.match(/^\/api\/v1\/sessions\/([^/]+)\/close$/);
    if (method === 'POST' && close) {
      const s = sessions.get(close[1]);
      if (!s) return { status: 404, body: { error: 'Session not found' } };
      const body = JSON.parse(req.body as string) as { status?: string };
      s.status = (body.status as 'completed' | 'abandoned' | 'error') ?? 'completed';
      return { status: 200, body: fullSession(s, true) };
    }

    // GET /api/v1/sessions/:id
    const get = path.match(/^\/api\/v1\/sessions\/([^/]+)$/);
    if (method === 'GET' && get) {
      const s = sessions.get(get[1]);
      if (!s) return { status: 404, body: { error: 'Session not found' } };
      return { status: 200, body: fullSession(s, s.status !== 'active') };
    }

    // GET /api/v1/sessions — list
    if (method === 'GET' && path === '/api/v1/sessions') {
      const all = [...sessions.values()].map((s) => fullSession(s, s.status !== 'active'));
      return { status: 200, body: all };
    }

    // GET /api/v1/sessions/active/count
    if (method === 'GET' && path === '/api/v1/sessions/active/count') {
      const count = [...sessions.values()].filter((s) => s.status === 'active').length;
      return { status: 200, body: { count } };
    }

    // GET /api/v1/health
    if (method === 'GET' && path === '/api/v1/health') {
      return { status: 200, body: { status: 'ok', timestamp: now() } };
    }

    return { status: 404, body: { error: 'Not found' } };
  });
}
