// MockBillingProvider — in-memory subscription and usage tracking.

import type {
  BillingProvider,
  Subscription,
  UsageEvent,
  Balance,
  PlanId,
  ProviderContext,
  ProviderResult,
  HealthStatus,
  Capabilities,
  TenantId,
} from '@ai-platform/contracts';

const PLANS: Record<PlanId, { amountMicroUsd: number; quotaMicroUsd: number | null }> = {
  free: { amountMicroUsd: 0, quotaMicroUsd: 1_000_000 }, // $1/month quota
  pro: { amountMicroUsd: 29_990_000, quotaMicroUsd: 50_000_000 }, // $50/month quota
  enterprise: { amountMicroUsd: 99_990_000, quotaMicroUsd: null }, // unlimited
};

export class MockBillingProvider implements BillingProvider {
  readonly id = 'mock-billing-1';
  readonly name = 'mock-billing';

  private subscriptions = new Map<TenantId, Subscription>();
  private usage = new Map<TenantId, number>(); // accumulated cost per tenant

  constructor(private readonly latencyMs = 20) {}

  async getHealth(_ctx: ProviderContext): Promise<HealthStatus> {
    return { status: 'healthy', latencyMs: this.latencyMs, checkedAt: new Date().toISOString() };
  }

  async getCapabilities(): Promise<Capabilities> {
    return { streaming: false, features: { 'subscriptions': true, 'usage-tracking': true } };
  }

  async shutdown(): Promise<void> {
    this.subscriptions.clear();
    this.usage.clear();
  }

  async subscribe(ctx: ProviderContext, tenantId: TenantId, planId: PlanId): Promise<ProviderResult<Subscription>> {
    const plan = PLANS[planId];
    if (!plan) {
      throw new Error(`Unknown plan: ${planId}`);
    }

    const now = new Date();
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const sub: Subscription = {
      id: `sub-${tenantId}-${Date.now()}`,
      tenantId,
      planId,
      status: 'active',
      amountMicroUsd: plan.amountMicroUsd,
      currency: 'USD',
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: periodEnd.toISOString(),
    };

    this.subscriptions.set(tenantId, sub);
    this.usage.set(tenantId, 0);

    return {
      data: sub,
      cost: { costMicroUsd: 0 },
      usage: { durationMs: this.latencyMs },
      providerId: this.id,
      completedAt: now.toISOString(),
    };
  }

  async cancelSubscription(_ctx: ProviderContext, tenantId: TenantId): Promise<void> {
    const sub = this.subscriptions.get(tenantId);
    if (sub) {
      sub.status = 'canceled';
    }
  }

  async getSubscription(_ctx: ProviderContext, tenantId: TenantId): Promise<ProviderResult<Subscription>> {
    const sub = this.subscriptions.get(tenantId);
    if (!sub) {
      throw new Error(`No subscription for tenant: ${tenantId}`);
    }

    return {
      data: sub,
      cost: { costMicroUsd: 0 },
      usage: { durationMs: this.latencyMs },
      providerId: this.id,
      completedAt: new Date().toISOString(),
    };
  }

  async recordUsage(_ctx: ProviderContext, event: UsageEvent): Promise<void> {
    const current = this.usage.get(event.tenantId) ?? 0;
    this.usage.set(event.tenantId, current + event.costMicroUsd);
  }

  async getBalance(_ctx: ProviderContext, tenantId: TenantId): Promise<ProviderResult<Balance>> {
    const sub = this.subscriptions.get(tenantId);
    if (!sub) {
      throw new Error(`No subscription for tenant: ${tenantId}`);
    }

    const plan = PLANS[sub.planId];
    const used = this.usage.get(tenantId) ?? 0;
    const quota = plan.quotaMicroUsd;

    return {
      data: {
        tenantId,
        remainingMicroUsd: quota === null ? null : Math.max(0, quota - used),
        totalQuotaMicroUsd: quota,
        usedMicroUsd: used,
        resetsAt: sub.currentPeriodEnd,
      },
      cost: { costMicroUsd: 0 },
      usage: { durationMs: this.latencyMs },
      providerId: this.id,
      completedAt: new Date().toISOString(),
    };
  }
}
