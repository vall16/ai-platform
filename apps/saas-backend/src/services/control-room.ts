// Control Room service — platform-wide operational overview (cross-tenant).
// Aggregates session, cost and provider-activity data for the internal ops dashboard.

import type { Pool } from 'pg';

export interface ControlRoomOverview {
  generated_at: string;
  sessions: {
    active: number;
    total: number;
    by_status: Record<string, number>;
    by_product_type: Record<string, number>;
  };
  cost: {
    last_1m_micro_usd: number;
    last_5m_micro_usd: number;
    today_micro_usd: number;
    total_micro_usd: number;
    by_resource_type: Record<string, number>;
  };
  margin: {
    available: boolean;
    note: string;
  };
  providers: Array<{ id: string; name: string; type: string; status: string }>;
  provider_usage: Array<{
    provider_id: string;
    total_requests: number;
    requests_last_5m: number;
    cost_last_5m_micro_usd: number;
    last_seen_at: string;
  }>;
}

export class ControlRoomService {
  constructor(private readonly pool: Pool) {}

  async overview(): Promise<ControlRoomOverview> {
    const [statusRows, productRows, costRow, resourceRows, providerRows, usageRows] =
      await Promise.all([
        this.pool.query(`SELECT status, COUNT(*)::int AS n FROM session GROUP BY status`),
        this.pool.query(`SELECT product_type, COUNT(*)::int AS n FROM session GROUP BY product_type`),
        this.pool.query(
          `SELECT
             COALESCE(SUM(cost_micro_usd) FILTER (WHERE created_at > now() - interval '1 minute'), 0)::bigint AS last_1m,
             COALESCE(SUM(cost_micro_usd) FILTER (WHERE created_at > now() - interval '5 minutes'), 0)::bigint AS last_5m,
             COALESCE(SUM(cost_micro_usd) FILTER (WHERE created_at >= date_trunc('day', now())), 0)::bigint AS today,
             COALESCE(SUM(cost_micro_usd), 0)::bigint AS total
           FROM usage_ledger`,
        ),
        this.pool.query(
          `SELECT resource_type, COALESCE(SUM(cost_micro_usd), 0)::bigint AS cost
           FROM usage_ledger GROUP BY resource_type ORDER BY cost DESC`,
        ),
        this.pool.query(`SELECT id, name, type, status FROM provider ORDER BY type, name`),
        this.pool.query(
          `SELECT provider_id,
                  COUNT(*)::int AS total_requests,
                  COUNT(*) FILTER (WHERE created_at > now() - interval '5 minutes')::int AS requests_last_5m,
                  COALESCE(SUM(cost_micro_usd) FILTER (WHERE created_at > now() - interval '5 minutes'), 0)::bigint AS cost_last_5m,
                  MAX(created_at) AS last_seen_at
           FROM usage_ledger
           GROUP BY provider_id
           ORDER BY last_seen_at DESC`,
        ),
      ]);

    const by_status: Record<string, number> = {};
    let active = 0;
    let total = 0;
    for (const row of statusRows.rows) {
      by_status[row.status] = row.n;
      total += row.n;
      if (row.status === 'active') active = row.n;
    }

    const by_product_type: Record<string, number> = {};
    for (const row of productRows.rows) by_product_type[row.product_type] = row.n;

    const by_resource_type: Record<string, number> = {};
    for (const row of resourceRows.rows) by_resource_type[row.resource_type] = Number(row.cost);

    const providers = providerRows.rows.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      status: p.status,
    }));

    const provider_usage = usageRows.rows.map((u) => ({
      provider_id: u.provider_id,
      total_requests: u.total_requests,
      requests_last_5m: u.requests_last_5m,
      cost_last_5m_micro_usd: Number(u.cost_last_5m),
      last_seen_at: u.last_seen_at,
    }));

    return {
      generated_at: new Date().toISOString(),
      sessions: { active, total, by_status, by_product_type },
      cost: {
        last_1m_micro_usd: Number(costRow.rows[0].last_1m),
        last_5m_micro_usd: Number(costRow.rows[0].last_5m),
        today_micro_usd: Number(costRow.rows[0].today),
        total_micro_usd: Number(costRow.rows[0].total),
        by_resource_type,
      },
      margin: {
        available: false,
        note: 'Revenue tracking not yet wired (Phase 2 Cost Ledger). margin = (revenue - cost) / revenue.',
      },
      providers,
      provider_usage,
    };
  }
}
