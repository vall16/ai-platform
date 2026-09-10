// Fastify app factory — wires config, pool, services, and routes.

import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { Config } from './config.js';
import { getPool, closePool } from './db/pool.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { TenantService } from './services/tenant.js';
import { ApiKeyService } from './services/api-key.js';
import { SessionService } from './services/session.js';
import { BillingService } from './services/billing.js';
import { registerTenantRoutes } from './routes/tenants.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerBillingRoutes } from './routes/billing.js';

export interface AppContext {
  close: () => Promise<void>;
}

export async function buildApp(config: Config): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const app = Fastify({
    logger: true,
    bodyLimit: 1_048_576, // 1 MB
  });

  await app.register(cors, { origin: true });

  const pool = getPool(config);
  const authGuard = createAuthMiddleware(pool);

  // Services.
  const tenantService = new TenantService(pool);
  const apiKeyService = new ApiKeyService(pool, config.apiKeyPrefix);
  const sessionService = new SessionService(pool);
  const billingService = new BillingService(pool, config.stripeSecretKey);

  // Health check (no auth).
  app.get('/api/v1/health', async (_request, reply) => {
    return reply.send({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Routes.
  registerTenantRoutes(app, tenantService, apiKeyService, authGuard);
  registerSessionRoutes(app, sessionService, authGuard);
  registerBillingRoutes(app, billingService, authGuard);

  const ctx: AppContext = {
    close: async () => {
      await app.close();
      await closePool();
    },
  };

  return { app, ctx };
}
