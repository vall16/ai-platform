// Fastify app factory — wires config, pool, services, and routes.

import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { Config } from './config.js';
import { getPool, closePool } from './db/pool.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { TenantService } from './services/tenant.js';
import { ApiKeyService } from './services/api-key.js';
import { SessionService } from './services/session.js';
import { BillingService } from './services/billing.js';
import { AgentService } from './services/agent.js';
import { AudioStore } from './services/audio-store.js';
import { createAgentDependencies } from './providers/factory.js';
import { AgentCore } from '@ai-platform/agent-core';
import { registerTenantRoutes } from './routes/tenants.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerBillingRoutes } from './routes/billing.js';
import { registerControlRoomRoutes } from './routes/control-room.js';
import { ControlRoomService } from './services/control-room.js';
import { Metrics } from './metrics.js';

export interface AppContext {
  close: () => Promise<void>;
}

export async function buildApp(config: Config): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const metrics = new Metrics();
  const httpRequests = metrics.counter('http_requests_total', 'Total HTTP requests');
  const httpDuration = metrics.histogram(
    'http_request_duration_seconds',
    'HTTP request duration in seconds',
    [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  );
  const activeSessions = metrics.gauge('active_sessions', 'Number of active sessions');

  const app = Fastify({
    logger: true,
    bodyLimit: 1_048_576, // 1 MB
    // One UUID per request: becomes the trace id shared by logs (reqId),
    // the X-Trace-Id response header and the cost ledger.
    genReqId: () => randomUUID(),
  });

  app.addHook('onRequest', async (request) => {
    (request as { startTime?: bigint }).startTime = process.hrtime.bigint();
  });

  // Set the trace header before the response is sent (onResponse is too late).
  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Trace-Id', request.id);
  });

  app.addHook('onResponse', async (request, reply) => {
    const start = (request as { startTime?: bigint }).startTime;
    if (start) {
      const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
      // Use the route pattern (not the full URL) to keep metric cardinality low.
      const req = request as unknown as { routeOptions?: { url?: string }; route?: { url?: string } };
      const route = req.routeOptions?.url ?? req.route?.url ?? request.url;
      httpRequests.inc({ method: request.method, route, status: String(reply.statusCode) });
      httpDuration.observe({ method: request.method, route }, durationSec);
    }
  });

  await app.register(cors, { origin: true });

  const pool = getPool(config);
  const authGuard = createAuthMiddleware(pool);

  // Services.
  const tenantService = new TenantService(pool);
  const apiKeyService = new ApiKeyService(pool, config.apiKeyPrefix);
  const sessionService = new SessionService(pool);
  const billingService = new BillingService(pool, config.stripeSecretKey);
  const controlRoomService = new ControlRoomService(pool);

  // Agent (chatbot) wiring — mock-first providers, real cost ledger.
  const agentCore = new AgentCore(createAgentDependencies(pool));
  const audioStore = new AudioStore();
  const agentService = new AgentService(agentCore, pool, audioStore);

  // Health check (no auth).
  app.get('/api/v1/health', async (_request, reply) => {
    return reply.send({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Prometheus metrics (no auth) — HTTP traffic + active sessions.
  app.get('/metrics', async (_request, reply) => {
    const result = await pool.query(`SELECT COUNT(*)::int AS n FROM session WHERE status = 'active'`);
    activeSessions.set({}, result.rows[0].n);
    reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    return metrics.render();
  });

  // Routes.
  registerTenantRoutes(app, tenantService, apiKeyService, authGuard);
  registerSessionRoutes(app, sessionService, agentService, audioStore, authGuard);
  registerBillingRoutes(app, billingService, authGuard);
  registerControlRoomRoutes(app, controlRoomService, authGuard);

  const ctx: AppContext = {
    close: async () => {
      await app.close();
      await closePool();
    },
  };

  return { app, ctx };
}
