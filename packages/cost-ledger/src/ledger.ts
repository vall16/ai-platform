// CostLedger — records cost events and aggregates per-session / per-tenant.

import type { Pool } from 'pg';
import type { CostEvent, SessionCostSummary, TenantCostSummary, ResourceCost } from './types.js';

export class CostLedger {
  constructor(private readonly pool: Pool) {}

  /** Record a single cost event. Returns the inserted row ID. */
  async record(event: CostEvent): Promise<string> {
    const result = await this.pool.query(
      `INSERT INTO usage_ledger (tenant_id, session_id, provider_id, resource_type, cost_micro_usd, quantity, unit, trace_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        event.tenantId,
        event.sessionId,
        event.providerId,
        event.resourceType,
        event.costMicroUsd,
        event.quantity,
        event.unit,
        event.traceId ?? null,
      ],
    );
    return result.rows[0].id as string;
  }

  /** Record multiple cost events in a batch. */
  async recordBatch(events: CostEvent[]): Promise<string[]> {
    if (events.length === 0) return [];

    const values: unknown[] = [];
    const placeholders: string[] = [];
    events.forEach((e, i) => {
      const base = i * 8;
      values.push(e.tenantId, e.sessionId, e.providerId, e.resourceType, e.costMicroUsd, e.quantity, e.unit, e.traceId ?? null);
      placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`);
    });

    const result = await this.pool.query(
      `INSERT INTO usage_ledger (tenant_id, session_id, provider_id, resource_type, cost_micro_usd, quantity, unit, trace_id)
       VALUES ${placeholders.join(', ')}
       RETURNING id`,
      values,
    );
    return result.rows.map((r: { id: string }) => r.id);
  }

  /** Get cost breakdown for a single session. */
  async getSessionCosts(sessionId: string): Promise<SessionCostSummary | null> {
    // Get session metadata.
    const sessionResult = await this.pool.query(
      `SELECT id, tenant_id, started_at, ended_at FROM session WHERE id = $1`,
      [sessionId],
    );
    if (sessionResult.rows.length === 0) return null;

    const session = sessionResult.rows[0] as { id: string; tenant_id: string; started_at: string; ended_at: string | null };

    // Aggregate costs by resource type.
    const costResult = await this.pool.query(
      `SELECT resource_type,
              SUM(cost_micro_usd)::bigint AS total_cost,
              SUM(quantity)::bigint AS total_qty,
              COUNT(*)::int AS event_count
       FROM usage_ledger
       WHERE session_id = $1
       GROUP BY resource_type
       ORDER BY total_cost DESC`,
      [sessionId],
    );

    const byResource: ResourceCost[] = costResult.rows.map((r) => ({
      resourceType: r.resource_type,
      totalCostMicroUsd: Number(r.total_cost),
      totalQuantity: Number(r.total_qty),
      eventCount: r.event_count,
    }));

    const totalCost = byResource.reduce((sum, r) => sum + r.totalCostMicroUsd, 0);
    const startedMs = new Date(session.started_at).getTime();
    const endedMs = session.ended_at ? new Date(session.ended_at).getTime() : Date.now();

    return {
      sessionId: session.id,
      tenantId: session.tenant_id,
      totalCostMicroUsd: totalCost,
      byResource,
      startedAt: session.started_at,
      endedAt: session.ended_at,
      durationMs: endedMs - startedMs,
    };
  }

  /** Get tenant cost aggregation over a time range. */
  async getTenantCosts(tenantId: string, from: string, to: string): Promise<TenantCostSummary> {
    // By resource type.
    const byResourceResult = await this.pool.query(
      `SELECT resource_type,
              SUM(cost_micro_usd)::bigint AS total_cost,
              SUM(quantity)::bigint AS total_qty,
              COUNT(*)::int AS event_count
       FROM usage_ledger
       WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3
       GROUP BY resource_type
       ORDER BY total_cost DESC`,
      [tenantId, from, to],
    );

    const byResource: ResourceCost[] = byResourceResult.rows.map((r) => ({
      resourceType: r.resource_type,
      totalCostMicroUsd: Number(r.total_cost),
      totalQuantity: Number(r.total_qty),
      eventCount: r.event_count,
    }));

    // By provider.
    const byProviderResult = await this.pool.query(
      `SELECT provider_id,
              SUM(cost_micro_usd)::bigint AS total_cost,
              COUNT(*)::int AS event_count
       FROM usage_ledger
       WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3
       GROUP BY provider_id
       ORDER BY total_cost DESC`,
      [tenantId, from, to],
    );

    const byProvider = byProviderResult.rows.map((r) => ({
      providerId: r.provider_id,
      totalCostMicroUsd: Number(r.total_cost),
      eventCount: r.event_count,
    }));

    // Session count.
    const sessionResult = await this.pool.query(
      `SELECT COUNT(DISTINCT session_id)::int AS count
       FROM usage_ledger
       WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3 AND session_id IS NOT NULL`,
      [tenantId, from, to],
    );

    const totalCost = byResource.reduce((sum, r) => sum + r.totalCostMicroUsd, 0);

    return {
      tenantId,
      from,
      to,
      totalCostMicroUsd: totalCost,
      byResource,
      byProvider,
      sessionCount: sessionResult.rows[0].count,
    };
  }

  /** Get total cost for a tenant in a time range (quick scalar). */
  async getTenantTotalCost(tenantId: string, from: string, to: string): Promise<number> {
    const result = await this.pool.query(
      `SELECT COALESCE(SUM(cost_micro_usd), 0)::bigint AS total
       FROM usage_ledger
       WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3`,
      [tenantId, from, to],
    );
    return Number(result.rows[0].total);
  }
}
