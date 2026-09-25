// @ai-platform/connector-sdk — shared types for the connector client.
//
// These mirror the SaaS backend's public API (apps/saas-backend/src/routes/sessions.ts)
// and the DB session shape (packages/db/src/types.ts). They are intentionally
// self-contained so the SDK has no dependency on the rest of the monorepo and can be
// consumed by any connector runtime (browser, mobile, Node).

import type { Transport } from './transport.js';

export type ProductType = 'persona' | 'salesperson';

export type SessionStatus = 'active' | 'completed' | 'abandoned' | 'error';

/** A conversation session as returned by the backend. */
export interface Session {
  id: string;
  tenant_id: string;
  product_type: ProductType;
  status: SessionStatus;
  started_at: string;
  ended_at: string | null;
  total_cost_micro_usd: number;
  revenue_micro_usd: number;
  /** Commerce attribution (salesperson): add-to-cart actions the agent performed. */
  cart_additions: number;
  /** Commerce attribution (salesperson): checkouts the agent started. */
  orders_influenced: number;
  /** Commerce attribution (salesperson): cart value (micro USD) at each checkout. */
  revenue_influenced: number;
  metadata: Record<string, unknown>;
  created_at: string;
  /** Present on the create response (the DB row uses `id`). */
  session_id?: string;
}

/** Response of POST /sessions/:id/messages. */
export interface MessageResult {
  reply: string;
  /** Absolute URL of the synthesized TTS audio, when voice is enabled. */
  audio_url?: string;
}

/** Response of POST /sessions/:id/audio (voice input: STT -> agent). */
export interface AudioResult {
  reply: string;
  /** Transcribed text of the voice input. */
  transcript: string;
  /** Absolute URL of the synthesized TTS audio, when voice is enabled. */
  audio_url?: string;
}

/** Response of GET /health (no auth). */
export interface HealthResult {
  status: string;
  timestamp: string;
}

/**
 * Minimal fetch signature so the SDK does not depend on the DOM lib or a specific
 * @types/node version. Both the browser and Node 20+ satisfy this.
 */
export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Uint8Array;
    signal?: AbortSignal;
  },
) => Promise<{
  status: number;
  json: <T = unknown>() => Promise<T>;
  text: () => Promise<string>;
}>;

/**
 * Configuration for a ConnectorClient.
 *
 * Persona fields (avatarId, voiceId, language, personality, siteUrl) and salesperson
 * fields (shopName, shopUrl, platform, currency, shopCredentials) are merged into the
 * session metadata by the backend — the SDK sends them flat, exactly like the
 * WordPress widget does.
 */
export interface ConnectorConfig {
  /** Base URL of the SaaS backend, e.g. "https://api.example.com" (no trailing slash). */
  apiBase: string;
  /** Bearer API key (from the Control Room). */
  apiKey: string;
  /** Product this connector serves. */
  productType: ProductType;

  // --- Persona (AI Persona) ---
  avatarId?: string;
  voiceId?: string;
  language?: string;
  personality?: string;
  /** Origin of the host site, so the agent can fetch live content (e.g. WP REST API). */
  siteUrl?: string;

  // --- Salesperson (AI Salesperson) ---
  shopName?: string;
  shopUrl?: string;
  platform?: 'shopify' | 'woocommerce';
  currency?: string;
  shopCredentials?: Record<string, string>;

  // --- Common ---
  /** Extra metadata merged into the session. */
  metadata?: Record<string, unknown>;
  /** Custom fetch implementation (defaults to globalThis.fetch). */
  fetch?: FetchLike;
  /** Per-request timeout in milliseconds (default 30000). */
  timeoutMs?: number;
  /**
   * Inject a custom transport (advanced / testing). When set, `fetch` and
   * `timeoutMs` are ignored. This is the seam that lets connectors run fully
   * offline against a mock backend.
   */
  transport?: Transport;
}
