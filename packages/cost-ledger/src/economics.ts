// Phase 3 — Self-hosted economics, cost allocation, and routing objective.

/** GPU models supported by the self-hosted provider. */
export type GpuModel = 'H200' | 'H100' | 'B200';

/** Configuration for a self-hosted GPU. */
export interface SelfHostedConfig {
  gpuModel: GpuModel;
  /** Fixed cost of the GPU per hour, in microdollars. */
  fixedCostPerHourMicroUsd: number;
  /** Maximum concurrent sessions the GPU can serve. */
  capacity: number;
}

/** Result of a self-hosted economics calculation. */
export interface SelfHostedEconomicsResult {
  /** Effective cost per session per minute at the given utilization (microdollars). */
  effectiveCostPerMinMicroUsd: number;
  /** Effective cost per session (microdollars), assuming the average session duration. */
  effectiveCostPerSessionMicroUsd: number;
  /** Current utilization (0..1). */
  utilization: number;
  /** Number of active sessions at the given utilization. */
  activeSessions: number;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/**
 * SelfHostedEconomics — dynamic economics for a self-hosted GPU.
 *
 * The GPU has a fixed cost per hour regardless of utilization. The effective
 * cost per session depends on how many sessions are active: the more
 * utilization, the cheaper each session becomes.
 */
export class SelfHostedEconomics {
  constructor(private readonly config: SelfHostedConfig) {}

  /**
   * Compute the effective cost per session per minute at the given utilization.
   *
   * @param utilization - Current utilization (0..1).
   * @param avgSessionMinutes - Average session duration in minutes (default 5).
   */
  effectiveCost(utilization: number, avgSessionMinutes = 5): SelfHostedEconomicsResult {
    const u = clamp01(utilization);
    const activeSessions = Math.max(1, Math.round(this.config.capacity * u));
    const costPerMinPerSession = this.config.fixedCostPerHourMicroUsd / 60 / activeSessions;
    const costPerSession = costPerMinPerSession * avgSessionMinutes;

    return {
      effectiveCostPerMinMicroUsd: Math.round(costPerMinPerSession),
      effectiveCostPerSessionMicroUsd: Math.round(costPerSession),
      utilization: u,
      activeSessions,
    };
  }
}

/**
 * CostAllocator — amortizes a fixed cost over actual usage to get the true
 * realized cost per minute, and allocates it across sessions.
 */
export class CostAllocator {
  /**
   * True realized cost per minute: total fixed cost divided by total minutes used.
   */
  trueRealizedCostPerMin(totalFixedCostMicroUsd: number, totalMinutes: number): number {
    if (totalMinutes <= 0) return 0;
    return Math.round(totalFixedCostMicroUsd / totalMinutes);
  }

  /**
   * Allocate a fixed cost across sessions proportionally to their duration.
   * Returns the allocated cost per session (microdollars).
   */
  allocate(fixedCostMicroUsd: number, sessions: { id: string; minutes: number }[]): Map<string, number> {
    const totalMinutes = sessions.reduce((sum, s) => sum + s.minutes, 0);
    const result = new Map<string, number>();
    if (totalMinutes <= 0) {
      for (const s of sessions) result.set(s.id, 0);
      return result;
    }
    for (const s of sessions) {
      result.set(s.id, Math.round((fixedCostMicroUsd * s.minutes) / totalMinutes));
    }
    return result;
  }
}

/** Routing objective for cost-aware routing. */
export type RoutingObjective = 'MINIMIZE_MARGINAL_COST' | 'MAXIMIZE_GROSS_MARGIN';

/** Economics of a provider candidate for routing. */
export interface ProviderEconomics {
  providerId: string;
  /** Variable (marginal) cost of serving the request, in microdollars. */
  marginalCostMicroUsd: number;
  /** Revenue from the request, in microdollars. */
  revenueMicroUsd: number;
}

/**
 * Select the best provider for the given routing objective.
 *
 * - MINIMIZE_MARGINAL_COST: pick the provider with the lowest marginal cost.
 * - MAXIMIZE_GROSS_MARGIN: pick the provider with the highest (revenue - marginal cost).
 */
export function selectProvider(
  objective: RoutingObjective,
  candidates: ProviderEconomics[],
): ProviderEconomics | null {
  if (candidates.length === 0) return null;

  if (objective === 'MINIMIZE_MARGINAL_COST') {
    return candidates.reduce((best, c) =>
      c.marginalCostMicroUsd < best.marginalCostMicroUsd ? c : best,
    );
  }

  // MAXIMIZE_GROSS_MARGIN
  return candidates.reduce((best, c) => {
    const bestMargin = best.revenueMicroUsd - best.marginalCostMicroUsd;
    const cMargin = c.revenueMicroUsd - c.marginalCostMicroUsd;
    return cMargin > bestMargin ? c : best;
  });
}
