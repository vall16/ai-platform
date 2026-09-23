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

/** Prepaid quota balance for a tenant. */
export interface QuotaBalance {
  tenantId: string;
  /** Prepaid quota (budget) for the period, in micro USD. */
  totalMicroUsd: number;
  /** Marginal (provider) cost consumed from the quota, in micro USD. */
  usedMicroUsd: number;
  /** Remaining quota (total - used, floored at 0), in micro USD. */
  remainingMicroUsd: number;
  /** True when no quota remains (new sessions are rejected). */
  exhausted: boolean;
  /** When the quota period ends (ISO 8601), if set. */
  periodEnd: string | null;
}

/**
 * Economics of a prepaid quota. Distinguishes marginal cost (variable provider
 * cost — what the router minimizes) from accounting cost (fully-loaded, incl.
 * amortized fixed overhead) and reports the gross margin on the prepaid
 * revenue under both bases.
 */
export interface QuotaEconomics extends QuotaBalance {
  /** Variable provider cost consumed (COGS). */
  marginalCostMicroUsd: number;
  /** Fully-loaded cost: marginal + amortized fixed overhead. */
  accountingCostMicroUsd: number;
  /** Revenue (prepaid quota) - marginal cost. */
  marginalGrossMarginMicroUsd: number;
  marginalGrossMarginPct: number | null;
  /** Revenue (prepaid quota) - accounting cost. */
  accountingGrossMarginMicroUsd: number;
  accountingGrossMarginPct: number | null;
}
