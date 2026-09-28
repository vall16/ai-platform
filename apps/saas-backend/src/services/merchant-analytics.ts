// Merchant analytics — per-tenant dashboard data (Phase 6).
//
// The Control Room is platform-wide (cross-tenant, ops). The merchant
// dashboard is the tenant-facing mirror: the same session / cost / revenue /
// margin / commerce numbers, but scoped to a single tenant and exposed over a
// range the merchant picks (7/30/90 days or all time). Every query is
// tenant-scoped (WHERE tenant_id = $1) so a tenant can never see another
// tenant's data.

import type { Pool } from 'pg';

export interface MerchantAnalytics {
  generated_at: string;
  range: { days: number; from: string | null };
  sessions: {
    total: number;
    active: number;
    by_status: Record<string, number>;
    by_product_type: Record<string, number>;
  };
  cost: {
    total_micro_usd: number;
    by_resource_type: Record<string, number>;
  };
  revenue: { total_micro_usd: number };
  margin: {
    revenue_micro_usd: number;
    cost_micro_usd: number;
    gross_margin_micro_usd: number;
    gross_margin_pct: number | null;
  };
  commerce: {
    cart_additions: number;
    orders_influenced: number;
    revenue_influenced_micro_usd: number;
  };
  series: Array<{ day: string; sessions: number; cost_micro_usd: number; revenue_micro_usd: number }>;
}

export class MerchantAnalyticsService {
  constructor(private readonly pool: Pool) {}

  /**
   * @param tenantId the authenticated tenant (from the API key).
   * @param days window in days; 0 (or negative) means "all time".
   */
  async analytics(tenantId: string, days: number): Promise<MerchantAnalytics> {
    const from = days > 0 ? new Date(Date.now() - days * 86_400_000).toISOString() : null;
    const p = [tenantId, from];

    // One aggregate pass over the tenant's sessions in range: totals, active
    // count, cost, revenue and the commerce counters (all live on `session`).
    const agg = await this.pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'active')::int AS active,
         COALESCE(SUM(total_cost_micro_usd), 0)::bigint AS cost,
         COALESCE(SUM(revenue_micro_usd), 0)::bigint AS revenue,
         COALESCE(SUM(cart_additions), 0)::int AS cart_additions,
         COALESCE(SUM(orders_influenced), 0)::int AS orders_influenced,
         COALESCE(SUM(revenue_influenced), 0)::bigint AS revenue_influenced
       FROM session
       WHERE tenant_id = $1 AND ($2::timestamptz IS NULL OR started_at >= $2)`,
      p,
    );
    const a = agg.rows[0];

    const [byStatus, byProduct, byResource, series] = await Promise.all([
      this.pool.query(
        `SELECT status, COUNT(*)::int AS n
         FROM session
         WHERE tenant_id = $1 AND ($2::timestamptz IS NULL OR started_at >= $2)
         GROUP BY status`,
        p,
      ),
      this.pool.query(
        `SELECT product_type, COUNT(*)::int AS n
         FROM session
         WHERE tenant_id = $1 AND ($2::timestamptz IS NULL OR started_at >= $2)
         GROUP BY product_type`,
        p,
      ),
      this.pool.query(
        `SELECT resource_type, COALESCE(SUM(cost_micro_usd), 0)::bigint AS cost
         FROM usage_ledger
         WHERE tenant_id = $1 AND ($2::timestamptz IS NULL OR created_at >= $2)
         GROUP BY resource_type`,
        p,
      ),
      this.pool.query(
        `SELECT to_char(date_trunc('day', started_at), 'YYYY-MM-DD') AS day,
                COUNT(*)::int AS sessions,
                COALESCE(SUM(total_cost_micro_usd), 0)::bigint AS cost,
                COALESCE(SUM(revenue_micro_usd), 0)::bigint AS revenue
         FROM session
         WHERE tenant_id = $1 AND ($2::timestamptz IS NULL OR started_at >= $2)
         GROUP BY 1
         ORDER BY 1`,
        p,
      ),
    ]);

    const toMap = (rows: Array<Record<string, unknown>>, key: string, val: string): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const r of rows) out[String(r[key])] = Number(r[val]);
      return out;
    };

    const revenue = Number(a.revenue);
    const cost = Number(a.cost);
    const gross = revenue - cost;
    const pct = revenue > 0 ? (gross / revenue) * 100 : null;

    return {
      generated_at: new Date().toISOString(),
      range: { days, from },
      sessions: {
        total: Number(a.total),
        active: Number(a.active),
        by_status: toMap(byStatus.rows, 'status', 'n'),
        by_product_type: toMap(byProduct.rows, 'product_type', 'n'),
      },
      cost: {
        total_micro_usd: cost,
        by_resource_type: toMap(byResource.rows, 'resource_type', 'cost'),
      },
      revenue: { total_micro_usd: revenue },
      margin: {
        revenue_micro_usd: revenue,
        cost_micro_usd: cost,
        gross_margin_micro_usd: gross,
        gross_margin_pct: pct,
      },
      commerce: {
        cart_additions: Number(a.cart_additions),
        orders_influenced: Number(a.orders_influenced),
        revenue_influenced_micro_usd: Number(a.revenue_influenced),
      },
      series: series.rows.map((r) => ({
        day: String(r.day),
        sessions: Number(r.sessions),
        cost_micro_usd: Number(r.cost),
        revenue_micro_usd: Number(r.revenue),
      })),
    };
  }
}
