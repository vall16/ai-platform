// @ai-platform/cost-ledger — per-session cost tracking, margin, and prepaid quota.

export { CostLedger } from './ledger.js';
export { MarginCalculator } from './margin.js';
export { QuotaService } from './quota.js';
export {
  SelfHostedEconomics,
  CostAllocator,
  selectProvider,
} from './economics.js';
export { PricingEngine } from './pricing.js';
export type {
  ResourceType,
  CostEvent,
  ResourceCost,
  SessionCostSummary,
  TenantCostSummary,
  MarginReport,
  QuotaBalance,
  QuotaEconomics,
} from './types.js';
export type {
  GpuModel,
  SelfHostedConfig,
  SelfHostedEconomicsResult,
  RoutingObjective,
  ProviderEconomics,
} from './economics.js';
export type {
  PricingModel,
  Tier,
  VolumeDiscount,
  PricingPlan,
  Usage,
  PriceQuote,
} from './pricing.js';
