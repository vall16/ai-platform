// Environment configuration for the SaaS backend.

export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  apiKeyPrefix: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: parseInt(env.PORT ?? '3000', 10),
    host: env.HOST ?? '0.0.0.0',
    databaseUrl: env.DATABASE_URL ?? 'postgres://localhost:5432/ai_platform',
    stripeSecretKey: env.STRIPE_SECRET_KEY ?? '',
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET ?? '',
    apiKeyPrefix: env.API_KEY_PREFIX ?? 'sk_live_',
  };
}
