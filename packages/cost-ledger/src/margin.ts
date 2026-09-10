// Margin calculator — gross margin from cost + revenue.

import type { Pool } from 'pg';
import type { MarginReport, ResourceCost } from './types.js';

export class MarginCalculator {
  constructor(private readonly pool: Pool) {}

  /** Calculate margin for a single session. */
  async getSessionMargin(sessionId: string, revenueMicroUsd: number): Promise<MarginReport | null> {
    const costResult = await this.pool.query(
      `SELECT COALESCE(SUM(cost_micro_usd), 0)::bigint AS total_cost
       FROM usage_ledger WHERE session_id = $1`,
      [sessionId],
    );

    const tenantResult = await this.pool.query(
      `SELECT tenant_id FROM session WHERE id = $1`,
      [sessionId],
    );
    if (tenantResult.rows.length === 0) return null;

    const totalCost = Number(costResult.rows[0].total_cost);
    const grossMargin = revenueMicroUsd - totalCost;
    const grossMarginPct = revenueMicroUsd > 0 ? (grossMargin / revenueMicroUsd) * 100 : 0;

    // By-resource breakdown.
    const byResourceResult = await this.pool.query(
      `SELECT resource_type, SUM(cost_micro_usd)::bigint AS total_cost, SUM(quantity)::bigint AS total_qty, COUNT(*)::int AS event_count
       FROM usage_ledger WHERE session_id = $1
       GROUP BY resource_type ORDER BY total_cost DESC`,
      [sessionId],
    );

    const byResource: ResourceCost[] = byResourceResult.rows.map((r) => ({
      resourceType: r.resource_type,
      totalCostMicroUsd: Number(r.total_cost),
      totalQuantity: Number(r.total_qty),
      eventCount: r.event_count,
    }));

    return {
      scope: 'session',
      scopeId: sessionId,
      totalCostMicroUsd: totalCost,
      revenueMicroUsd,
      grossMarginMicroUsd: grossMargin,
      grossMarginPct: Math.round(grossMarginPct * 100) / 100,
      byResource,
    };
  }

  /** Calculate margin for a tenant over a time range. */
  async getTenantMargin(
    tenantId: string,
    from: string,
    to: string,
    revenueMicroUsd: number,
  ): Promise<MarginReport> {
    const costResult = await this.pool.query(
      `SELECT COALESCE(SUM(cost_micro_usd), 0)::bigint AS total_cost
       FROM usage_ledger
       WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3`,
      [tenantId, from, to],
    );

    const totalCost = Number(costResult.rows[0].total_cost);
    const grossMargin = revenueMicroUsd - totalCost;
    const grossMarginPct = revenueMicroUsd > 0 ? (grossMargin / revenueMicroUsd) * 100 : 0;

    const byResourceResult = await this.pool.query(
      `SELECT resource_type, SUM(cost_micro_usd)::bigint AS total_cost, SUM(quantity)::bigint AS total_qty, COUNT(*)::int AS event_count
       FROM usage_ledger
       WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3
       GROUP BY resource_type ORDER BY total_cost DESC`,
      [tenantId, from, to],
    );

    const byResource: ResourceCost[] = byResourceResult.rows.map((r) => ({
      resourceType: r.resource_type,
      totalCostMicroUsd: Number(r.total_cost),
      totalQuantity: Number(r.total_qty),
      eventCount: r.event_count,
    }));

    return {
      scope: 'tenant',
      scopeId: tenantId,
      totalCostMicroUsd: totalCost,
      revenueMicroUsd,
      grossMarginMicroUsd: grossMargin,
      grossMarginPct: Math.round(grossMarginPct * 100) / 100,
      byResource,
    };
  }

  /** Get revenue for a tenant from their subscription (simplified: plan-based). */
  async getTenantRevenue(tenantId: string, from: string, to: string): Promise<number> {
    // In production, this would query Stripe invoices.
    // For now, return 0 — revenue is passed in from the billing layer.
    return 0;
  }
}
