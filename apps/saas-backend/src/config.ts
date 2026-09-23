// Environment configuration for the SaaS backend.

export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  apiKeyPrefix: string;
  sessionPriceMicroUsd: number;
  /** Amortized fixed overhead (micro USD) folded into the quota accounting cost. */
  quotaFixedCostMicroUsd: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: parseInt(env.PORT ?? '3000', 10),
    host: env.HOST ?? '0.0.0.0',
    databaseUrl: env.DATABASE_URL ?? 'postgres://localhost:5432/ai_platform',
    stripeSecretKey: env.STRIPE_SECRET_KEY ?? '',
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET ?? '',
    apiKeyPrefix: env.API_KEY_PREFIX ?? 'sk_live_',
    // Flat per-session price (micro USD) stamped onto each session at creation.
    // Phase 1 revenue model; real per-product pricing lands in Phase 2/4.
    sessionPriceMicroUsd: parseInt(env.SESSION_PRICE_MICRO_USD ?? '100000', 10),
    // Amortized fixed overhead (micro USD) for the quota accounting cost basis.
    quotaFixedCostMicroUsd: parseInt(env.QUOTA_FIXED_COST_MICRO_USD ?? '0', 10),
  };
}
