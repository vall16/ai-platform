// Historical pricing — resolve a provider's effective cost at a point in time
// (Phase 6).
//
// The `pricing` table is a bitemporal-ish ledger: each row is a rate that is
// effective from `effective_from` until `effective_to` (NULL = still current).
// Resolving "what did this cost at time T" lets the cost ledger and the
// control room attribute past usage to the rate that was in force then, rather
// than the current rate.

import type { Pool } from 'pg';

export interface EffectivePrice {
  provider_id: string;
  resource_type: string;
  unit: string;
  cost_micro_usd: number;
  effective_from: string;
  effective_to: string | null;
}

export class PricingService {
  constructor(private readonly pool: Pool) {}

  /**
   * The rate in force for (provider, resource) at time `at`. Returns null when
   * no rate was effective at that instant (e.g. a gap between two rates).
   */
  async effectiveCost(
    providerId: string,
    resourceType: string,
    at: Date,
  ): Promise<EffectivePrice | null> {
    const res = await this.pool.query(
      `SELECT provider_id, resource_type, unit, cost_micro_usd, effective_from, effective_to
       FROM pricing
       WHERE provider_id = $1
         AND resource_type = $2
         AND effective_from <= $3
         AND (effective_to IS NULL OR effective_to > $3)
       ORDER BY effective_from DESC
       LIMIT 1`,
      [providerId, resourceType, at],
    );
    const r = res.rows[0];
    if (!r) return null;
    return {
      provider_id: String(r.provider_id),
      resource_type: String(r.resource_type),
      unit: String(r.unit),
      cost_micro_usd: Number(r.cost_micro_usd),
      effective_from: String(r.effective_from),
      effective_to: r.effective_to == null ? null : String(r.effective_to),
    };
  }

  /**
   * The full rate history for (provider, resource), oldest first. Used to
   * render the "when did the price change" timeline.
   */
  async history(providerId: string, resourceType: string): Promise<EffectivePrice[]> {
    const res = await this.pool.query(
      `SELECT provider_id, resource_type, unit, cost_micro_usd, effective_from, effective_to
       FROM pricing
       WHERE provider_id = $1 AND resource_type = $2
       ORDER BY effective_from ASC`,
      [providerId, resourceType],
    );
    return res.rows.map((r) => ({
      provider_id: String(r.provider_id),
      resource_type: String(r.resource_type),
      unit: String(r.unit),
      cost_micro_usd: Number(r.cost_micro_usd),
      effective_from: String(r.effective_from),
      effective_to: r.effective_to == null ? null : String(r.effective_to),
    }));
  }
}
