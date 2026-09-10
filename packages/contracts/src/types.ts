// Shared domain types used across all provider contracts.

/** Unique tenant identifier. */
export type TenantId = string;

/** Unique conversation session identifier. */
export type SessionId = string;

/** Unique provider instance identifier (e.g. "heygen-prod-1"). */
export type ProviderId = string;

/** Unique request/correlation identifier for tracing. */
export type RequestId = string;

/** ISO 8601 timestamp. */
export type Timestamp = string;

/**
 * Context passed with every provider call.
 * Carries tenant isolation and tracing metadata.
 */
export interface ProviderContext {
  tenantId: TenantId;
  sessionId: SessionId;
  requestId: RequestId;
  /** Optional trace ID for OTel propagation. */
  traceId?: string;
  /** Arbitrary metadata for provider-specific needs. */
  metadata?: Record<string, unknown>;
}

/** Provider health as reported by the provider itself. */
export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs: number;
  checkedAt: Timestamp;
  detail?: string;
}

/** Cost information for a single operation. */
export interface CostInfo {
  /** Cost in USD (microdollars for precision: 1 = $0.000001). */
  costMicroUsd: number;
  /** Breakdown by component if applicable. */
  breakdown?: Record<string, number>;
}

/** Usage metrics for a single operation. */
export interface UsageMetrics {
  durationMs: number;
  tokensIn?: number;
  tokensOut?: number;
  audioSeconds?: number;
  bytes?: number;
}

/**
 * Result envelope for provider operations.
 * Every provider call returns this shape so the Cost Ledger
 * can uniformly record cost + usage.
 */
export interface ProviderResult<T> {
  data: T;
  cost: CostInfo;
  usage: UsageMetrics;
  providerId: ProviderId;
  completedAt: Timestamp;
}

/** Capabilities a provider advertises. */
export interface Capabilities {
  /** Supported audio formats for voice-related providers. */
  audioFormats?: string[];
  /** Supported languages. */
  languages?: string[];
  /** Max concurrent sessions. */
  maxConcurrentSessions?: number;
  /** Whether the provider supports streaming. */
  streaming: boolean;
  /** Provider-specific capability flags. */
  features?: Record<string, boolean>;
}
