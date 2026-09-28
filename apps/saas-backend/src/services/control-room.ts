// Control Room service — platform-wide operational overview (cross-tenant).
// Aggregates session, cost and provider-activity data for the internal ops dashboard.

import type { Pool } from 'pg';
import type { ProviderContext, HealthStatus } from '@ai-platform/contracts';

/**
 * A provider the Control Room can probe for health. The host wires the live
 * agent providers (LLM/TTS/STT/avatar) here; each reports its own status.
 */
export interface HealthProvider {
  id: string;
  name: string;
  type: string;
  getHealth(ctx: ProviderContext): Promise<HealthStatus>;
}

export interface ProviderHealth {
  id: string;
  name: string;
  type: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  latency_ms: number;
  checked_at: string;
  detail?: string;
}

/**
 * Alerting thresholds (Phase 6). Each maps to a rule evaluated in overview();
 * a breached rule produces an entry in `alerts`. Defaults are conservative so
 * a fresh platform stays quiet.
 */
export interface AlertThresholds {
  /** Warn when cost accrued in the last 5 minutes exceeds this (micro USD). */
  costLast5mMicroUsd: number;
  /** Warn when gross margin % drops below this (only when revenue > 0). */
  marginPct: number;
  /** Warn when the number of active sessions exceeds this. */
  activeSessions: number;
}

export const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {
  costLast5mMicroUsd: 1_000_000, // $1 in 5 minutes
  marginPct: 50,
  activeSessions: 100,
};

export interface Alert {
  severity: 'info' | 'warn' | 'critical';
  code: string;
  message: string;
  value: number;
  threshold: number;
}

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
    revenue_micro_usd: number;
    cost_micro_usd: number;
    gross_margin_micro_usd: number;
    gross_margin_pct: number | null;
    note: string;
  };
  /** Commerce attribution (salesperson): the agent's commercial impact. */
  commerce: {
    cart_additions: number;
    orders_influenced: number;
    revenue_influenced_micro_usd: number;
  };
  providers: Array<{ id: string; name: string; type: string; status: string }>;
  provider_usage: Array<{
    provider_id: string;
    total_requests: number;
    requests_last_5m: number;
    cost_last_5m_micro_usd: number;
    last_seen_at: string;
  }>;
  provider_health: ProviderHealth[];
  /** Routing distribution (Phase 6): how decisions split across providers/resources. */
  routing: {
    total: number;
    by_provider: Record<string, number>;
    by_resource_type: Record<string, number>;
  };
  /** Hourly cost/revenue/margin series over the last 24h (Phase 6). */
  series: Array<{ hour: string; cost_micro_usd: number; revenue_micro_usd: number; margin_micro_usd: number }>;
  /** Threshold alerts (Phase 6); empty when everything is within limits. */
  alerts: Alert[];
}

export class ControlRoomService {
  constructor(
    private readonly pool: Pool,
    private readonly providers: HealthProvider[] = [],
    private readonly thresholds: AlertThresholds = DEFAULT_ALERT_THRESHOLDS,
  ) {}

  async overview(): Promise<ControlRoomOverview> {
    const [statusRows, productRows, revenueRow, commerceRow, costRow, resourceRows, providerRows, usageRows, routingProviderRows, routingResourceRows, costSeriesRows, revenueSeriesRows, providerHealth] =
      await Promise.all([
        this.pool.query(`SELECT status, COUNT(*)::int AS n FROM session GROUP BY status`),
        this.pool.query(`SELECT product_type, COUNT(*)::int AS n FROM session GROUP BY product_type`),
        this.pool.query(
          `SELECT
             COALESCE(SUM(revenue_micro_usd) FILTER (WHERE started_at >= date_trunc('day', now())), 0)::bigint AS today,
             COALESCE(SUM(revenue_micro_usd), 0)::bigint AS total
           FROM session`,
        ),
        this.pool.query(
          `SELECT
             COALESCE(SUM(cart_additions), 0)::int AS cart_additions,
             COALESCE(SUM(orders_influenced), 0)::int AS orders_influenced,
             COALESCE(SUM(revenue_influenced), 0)::bigint AS revenue_influenced
           FROM session`,
        ),
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
        this.pool.query(
          `SELECT selected_provider_id, COUNT(*)::int AS n
           FROM routing_decision GROUP BY selected_provider_id ORDER BY n DESC`,
        ),
        this.pool.query(
          `SELECT resource_type, COUNT(*)::int AS n
           FROM routing_decision GROUP BY resource_type ORDER BY n DESC`,
        ),
        this.pool.query(
          `SELECT to_char(date_trunc('hour', created_at), 'YYYY-MM-DD HH24:00') AS hour,
                  COALESCE(SUM(cost_micro_usd), 0)::bigint AS cost
           FROM usage_ledger
           WHERE created_at > now() - interval '24 hours'
           GROUP BY 1 ORDER BY 1`,
        ),
        this.pool.query(
          `SELECT to_char(date_trunc('hour', started_at), 'YYYY-MM-DD HH24:00') AS hour,
                  COALESCE(SUM(revenue_micro_usd), 0)::bigint AS revenue
           FROM session
           WHERE started_at > now() - interval '24 hours'
           GROUP BY 1 ORDER BY 1`,
        ),
        this.gatherHealth(),
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

    const revenueTotal = Number(revenueRow.rows[0].total);
    const costTotal = Number(costRow.rows[0].total);
    const grossMargin = revenueTotal - costTotal;
    const grossMarginPct = revenueTotal > 0 ? (grossMargin / revenueTotal) * 100 : null;

    // Routing distribution (Phase 6).
    const routingByProvider: Record<string, number> = {};
    let routingTotal = 0;
    for (const row of routingProviderRows.rows) {
      routingByProvider[row.selected_provider_id] = row.n;
      routingTotal += row.n;
    }
    const routingByResource: Record<string, number> = {};
    for (const row of routingResourceRows.rows) routingByResource[row.resource_type] = row.n;

    // Hourly cost/revenue/margin series over the last 24h (Phase 6). Hours are
    // merged from the two independent aggregates; missing hours read as 0.
    const seriesMap = new Map<string, { cost: number; revenue: number }>();
    for (const row of costSeriesRows.rows) {
      const cur = seriesMap.get(row.hour) ?? { cost: 0, revenue: 0 };
      cur.cost = Number(row.cost);
      seriesMap.set(row.hour, cur);
    }
    for (const row of revenueSeriesRows.rows) {
      const cur = seriesMap.get(row.hour) ?? { cost: 0, revenue: 0 };
      cur.revenue = Number(row.revenue);
      seriesMap.set(row.hour, cur);
    }
    const series = [...seriesMap.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([hour, v]) => ({
        hour,
        cost_micro_usd: v.cost,
        revenue_micro_usd: v.revenue,
        margin_micro_usd: v.revenue - v.cost,
      }));

    // Threshold alerts (Phase 6).
    const alerts: Alert[] = [];
    const costLast5m = Number(costRow.rows[0].last_5m);
    if (costLast5m > this.thresholds.costLast5mMicroUsd) {
      alerts.push({
        severity: 'warn',
        code: 'high_cost_rate',
        message: `Cost in the last 5 minutes (${costLast5m} µUSD) exceeds the ${this.thresholds.costLast5mMicroUsd} µUSD threshold.`,
        value: costLast5m,
        threshold: this.thresholds.costLast5mMicroUsd,
      });
    }
    if (grossMarginPct !== null && grossMarginPct < this.thresholds.marginPct) {
      alerts.push({
        severity: 'warn',
        code: 'low_margin',
        message: `Gross margin (${grossMarginPct.toFixed(1)}%) is below the ${this.thresholds.marginPct}% threshold.`,
        value: grossMarginPct,
        threshold: this.thresholds.marginPct,
      });
    }
    if (active > this.thresholds.activeSessions) {
      alerts.push({
        severity: 'warn',
        code: 'high_load',
        message: `Active sessions (${active}) exceed the ${this.thresholds.activeSessions} threshold.`,
        value: active,
        threshold: this.thresholds.activeSessions,
      });
    }
    for (const h of providerHealth) {
      if (h.status === 'unhealthy') {
        alerts.push({
          severity: 'critical',
          code: 'provider_unhealthy',
          message: `Provider "${h.name}" (${h.type}) is unhealthy${h.detail ? `: ${h.detail}` : '.'}`,
          value: 1,
          threshold: 0,
        });
      }
    }

    return {
      generated_at: new Date().toISOString(),
      sessions: { active, total, by_status, by_product_type },
      cost: {
        last_1m_micro_usd: Number(costRow.rows[0].last_1m),
        last_5m_micro_usd: Number(costRow.rows[0].last_5m),
        today_micro_usd: Number(costRow.rows[0].today),
        total_micro_usd: costTotal,
        by_resource_type,
      },
      margin: {
        available: true,
        revenue_micro_usd: revenueTotal,
        cost_micro_usd: costTotal,
        gross_margin_micro_usd: grossMargin,
        gross_margin_pct: grossMarginPct,
        note: 'Flat per-session price (SESSION_PRICE_MICRO_USD) vs. usage_ledger cost. margin = (revenue - cost) / revenue.',
      },
      commerce: {
        cart_additions: Number(commerceRow.rows[0].cart_additions),
        orders_influenced: Number(commerceRow.rows[0].orders_influenced),
        revenue_influenced_micro_usd: Number(commerceRow.rows[0].revenue_influenced),
      },
      providers,
      provider_usage,
      provider_health: providerHealth,
      routing: { total: routingTotal, by_provider: routingByProvider, by_resource_type: routingByResource },
      series,
      alerts,
    };
  }

  /**
   * Probe every wired provider for health. A provider that throws (or is
   * unreachable) is reported as `unhealthy` with the error as detail, so one
   * bad provider never breaks the overview.
   */
  private async gatherHealth(): Promise<ProviderHealth[]> {
    const ctx: ProviderContext = {
      tenantId: 'platform',
      sessionId: 'control-room',
      requestId: 'control-room-health',
      traceId: 'control-room-health',
    };
    return Promise.all(
      this.providers.map(async (p): Promise<ProviderHealth> => {
        try {
          const h = await p.getHealth(ctx);
          return {
            id: p.id,
            name: p.name,
            type: p.type,
            status: h.status,
            latency_ms: h.latencyMs,
            checked_at: h.checkedAt,
            detail: h.detail,
          };
        } catch (err) {
          return {
            id: p.id,
            name: p.name,
            type: p.type,
            status: 'unhealthy',
            latency_ms: 0,
            checked_at: new Date().toISOString(),
            detail: err instanceof Error ? err.message : 'health check failed',
          };
        }
      }),
    );
  }
}
