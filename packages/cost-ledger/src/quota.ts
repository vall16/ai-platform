// QuotaService — prepaid quota management and economics (Cost Ledger completo).
//
// A tenant buys a prepaid quota (a budget in micro USD for a period). As the
// tenant uses the platform, the marginal (provider) cost of each session is
// consumed from the quota. When the quota is exhausted, new sessions are
// rejected. The service also reports the quota economics: marginal cost
// (variable provider cost) vs accounting cost (fully-loaded, incl. amortized
// fixed overhead) and the gross margin on the prepaid revenue under both bases.

import type { Pool } from 'pg';
import type { QuotaBalance, QuotaEconomics } from './types.js';

export class QuotaService {
  constructor(
    private readonly pool: Pool,
    /** Amortized fixed overhead (micro USD) folded into the accounting cost. */
    private readonly fixedCostMicroUsd = 0,
  ) {}

  /** Set (or reset) the tenant's prepaid quota. Returns the new balance. */
  async setQuota(tenantId: string, totalMicroUsd: number, periodEnd?: string): Promise<QuotaBalance> {
    await this.pool.query(
      `INSERT INTO tenant_quota (tenant_id, total_micro_usd, used_micro_usd, period_end)
       VALUES ($1, $2, 0, $3)
       ON CONFLICT (tenant_id) DO UPDATE SET
         total_micro_usd = EXCLUDED.total_micro_usd,
         used_micro_usd = 0,
         period_end = EXCLUDED.period_end,
         updated_at = now()`,
      [tenantId, totalMicroUsd, periodEnd ?? null],
    );
    const balance = await this.getBalance(tenantId);
    if (!balance) throw new Error('quota_not_set');
    return balance;
  }

  /** Get the tenant's quota balance. Null when no quota is configured (unlimited). */
  async getBalance(tenantId: string): Promise<QuotaBalance | null> {
    const result = await this.pool.query(
      `SELECT tenant_id, total_micro_usd, used_micro_usd, period_end
       FROM tenant_quota WHERE tenant_id = $1`,
      [tenantId],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0] as {
      tenant_id: string;
      total_micro_usd: string | number;
      used_micro_usd: string | number;
      period_end: string | null;
    };
    const total = Number(row.total_micro_usd);
    const used = Number(row.used_micro_usd);
    return {
      tenantId: tenantId,
      totalMicroUsd: total,
      usedMicroUsd: used,
      remainingMicroUsd: Math.max(0, total - used),
      exhausted: total - used <= 0,
      periodEnd: row.period_end,
    };
  }

  /**
   * Gate for session creation: throw `quota_exhausted` when the tenant has a
   * quota and it is fully consumed. A tenant with no quota row is unlimited.
   */
  async assertAvailable(tenantId: string): Promise<void> {
    const balance = await this.getBalance(tenantId);
    if (balance && balance.exhausted) {
      throw new Error('quota_exhausted');
    }
  }

  /** Consume marginal cost from the tenant's quota (capped at the total). */
  async consume(tenantId: string, costMicroUsd: number): Promise<void> {
    if (costMicroUsd <= 0) return;
    await this.pool.query(
      `UPDATE tenant_quota
       SET used_micro_usd = LEAST(total_micro_usd, used_micro_usd + $1), updated_at = now()
       WHERE tenant_id = $2`,
      [costMicroUsd, tenantId],
    );
  }

  /**
   * Economics of the prepaid quota: marginal vs accounting cost and the gross
   * margin on the prepaid revenue under both bases. Null when no quota is set.
   */
  async getEconomics(tenantId: string): Promise<QuotaEconomics | null> {
    const balance = await this.getBalance(tenantId);
    if (!balance) return null;

    // Marginal cost = the variable provider cost consumed (COGS).
    const marginalCostMicroUsd = balance.usedMicroUsd;
    // Accounting cost = fully-loaded: marginal + amortized fixed overhead.
    const accountingCostMicroUsd = marginalCostMicroUsd + this.fixedCostMicroUsd;

    // Revenue = the prepaid quota price. Margin under each cost basis.
    const marginalGrossMarginMicroUsd = balance.totalMicroUsd - marginalCostMicroUsd;
    const accountingGrossMarginMicroUsd = balance.totalMicroUsd - accountingCostMicroUsd;
    const marginalGrossMarginPct =
      balance.totalMicroUsd > 0 ? round2((marginalGrossMarginMicroUsd / balance.totalMicroUsd) * 100) : null;
    const accountingGrossMarginPct =
      balance.totalMicroUsd > 0 ? round2((accountingGrossMarginMicroUsd / balance.totalMicroUsd) * 100) : null;

    return {
      ...balance,
      marginalCostMicroUsd,
      accountingCostMicroUsd,
      marginalGrossMarginMicroUsd,
      marginalGrossMarginPct,
      accountingGrossMarginMicroUsd,
      accountingGrossMarginPct,
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
