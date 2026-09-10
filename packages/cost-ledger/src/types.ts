// Cost Ledger domain types.

import type { PricingUnit } from '@ai-platform/db';

/** Resource categories tracked in the ledger. */
export type ResourceType = 'avatar' | 'stt' | 'llm' | 'tts' | 'infra' | 'commerce' | 'billing';

/** A single cost event to be recorded. */
export interface CostEvent {
  tenantId: string;
  sessionId: string | null;
  providerId: string;
  resourceType: ResourceType;
  costMicroUsd: number;
  quantity: number;
  unit: PricingUnit;
  traceId?: string;
}

/** Per-resource cost breakdown for a session. */
export interface ResourceCost {
  resourceType: ResourceType;
  totalCostMicroUsd: number;
  totalQuantity: number;
  eventCount: number;
}

/** Aggregated cost summary for a single session. */
export interface SessionCostSummary {
  sessionId: string;
  tenantId: string;
  totalCostMicroUsd: number;
  byResource: ResourceCost[];
  startedAt: string;
  endedAt: string | null;
  durationMs: number;
}

/** Tenant-level cost aggregation over a time range. */
export interface TenantCostSummary {
  tenantId: string;
  from: string;
  to: string;
  totalCostMicroUsd: number;
  byResource: ResourceCost[];
  byProvider: Array<{ providerId: string; totalCostMicroUsd: number; eventCount: number }>;
  sessionCount: number;
}

/** Margin calculation for a session or period. */
export interface MarginReport {
  scope: 'session' | 'tenant';
  scopeId: string;
  totalCostMicroUsd: number;
  revenueMicroUsd: number;
  grossMarginMicroUsd: number;
  grossMarginPct: number;
  byResource?: ResourceCost[];
}
