// BillingProvider — subscription, usage recording, and balance management.

import type { Provider } from './provider.js';
import type { ProviderContext, ProviderResult, TenantId } from './types.js';

/** Billing plan identifier. */
export type PlanId = string;

/** Subscription status. */
export type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'trialing';

/** Subscription details. */
export interface Subscription {
  id: string;
  tenantId: TenantId;
  planId: PlanId;
  status: SubscriptionStatus;
  /** Monthly cost in microdollars. */
  amountMicroUsd: number;
  currency: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
}

/** Usage event to record. */
export interface UsageEvent {
  tenantId: TenantId;
  sessionId: string;
  /** What was consumed. */
  resource: 'avatar' | 'stt' | 'llm' | 'tts' | 'infra' | 'commerce';
  /** Cost in microdollars. */
  costMicroUsd: number;
  /** Quantity (tokens, seconds, requests). */
  quantity: number;
  unit: 'token' | 'second' | 'request' | 'byte';
  timestamp: string;
}

/** Balance / quota state for a tenant. */
export interface Balance {
  tenantId: TenantId;
  /** Remaining quota in microdollars (null = unlimited). */
  remainingMicroUsd: number | null;
  /** Total quota for the period in microdollars. */
  totalQuotaMicroUsd: number | null;
  /** Used this period in microdollars. */
  usedMicroUsd: number;
  /** When the quota resets (ISO 8601). */
  resetsAt: string;
}

/**
 * Provider for billing and usage management.
 * Implementations: StripeAdapter, custom prepaid quota.
 */
export interface BillingProvider extends Provider {
  /** Create or update a subscription for a tenant. */
  subscribe(ctx: ProviderContext, tenantId: TenantId, planId: PlanId): Promise<ProviderResult<Subscription>>;

  /** Cancel a subscription. */
  cancelSubscription(ctx: ProviderContext, tenantId: TenantId): Promise<void>;

  /** Get the active subscription for a tenant. */
  getSubscription(ctx: ProviderContext, tenantId: TenantId): Promise<ProviderResult<Subscription>>;

  /** Record a usage event (called by the Cost Ledger). */
  recordUsage(ctx: ProviderContext, event: UsageEvent): Promise<void>;

  /** Get the current balance/quota for a tenant. */
  getBalance(ctx: ProviderContext, tenantId: TenantId): Promise<ProviderResult<Balance>>;
}
