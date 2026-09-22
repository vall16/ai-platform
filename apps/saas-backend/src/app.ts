// Fastify app factory — wires config, pool, services, and routes.

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { Pool } from 'pg';
import type { Config } from './config.js';
import { continueTrace, buildTraceparent, type TraceContext } from './observability/trace.js';
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
import { ControlRoomService, type HealthProvider } from './services/control-room.js';
import type { Provider } from '@ai-platform/contracts';
import { Metrics } from './metrics.js';

export interface AppContext {
  close: () => Promise<void>;
}

export interface BuildAppOptions {
  /**
   * Inject a pool (e.g. a fake in tests). When omitted, getPool(config) is
   * used and owned (closed on ctx.close()).
   */
  pool?: Pool;
}

export async function buildApp(
  config: Config,
  opts: BuildAppOptions = {},
): Promise<{ app: FastifyInstance; ctx: AppContext }> {
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
    // Continue an inbound W3C trace (traceparent / X-Trace-Id) or start a new
    // one. The resulting trace id becomes request.id, shared by logs (reqId),
    // the X-Trace-Id + traceparent response headers and the cost ledger.
    genReqId: (req) => {
      const ctx = continueTrace(req.headers);
      (req as { traceContext?: TraceContext }).traceContext = ctx;
      return ctx.traceId;
    },
  });

  app.addHook('onRequest', async (request) => {
    (request as { startTime?: bigint }).startTime = process.hrtime.bigint();
  });

  // Set the trace headers before the response is sent (onResponse is too late):
  // X-Trace-Id (bare trace id) and traceparent (W3C) for downstream propagation.
  app.addHook('onSend', async (request, reply) => {
    const ctx =
      (request as { traceContext?: TraceContext }).traceContext ?? continueTrace(request.headers);
    reply.header('X-Trace-Id', request.id);
    reply.header('traceparent', buildTraceparent(ctx));
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

  const pool = opts.pool ?? getPool(config);
  const ownsPool = opts.pool === undefined;
  const authGuard = createAuthMiddleware(pool);

  // Services.
  const tenantService = new TenantService(pool);
  const apiKeyService = new ApiKeyService(pool, config.apiKeyPrefix);
  const sessionService = new SessionService(pool, config.sessionPriceMicroUsd);
  const billingService = new BillingService(pool, config.stripeSecretKey);

  // Agent (chatbot) wiring — mock-first providers, real cost ledger.
  const agentDeps = createAgentDependencies(pool);
  // Expose the live agent providers to the Control Room so it can report their
  // health (LLM/TTS/STT, plus avatar when configured).
  const healthProviders: HealthProvider[] = [];
  const addHealth = (p: Provider | undefined, type: string) => {
    if (p) healthProviders.push({ id: p.id, name: p.name, type, getHealth: (ctx) => p.getHealth(ctx) });
  };
  addHealth(agentDeps.llm, 'llm');
  addHealth(agentDeps.tts, 'tts');
  addHealth(agentDeps.stt, 'stt');
  addHealth(agentDeps.avatar, 'avatar');
  const controlRoomService = new ControlRoomService(pool, healthProviders);

  const agentCore = new AgentCore(agentDeps);
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
      if (ownsPool) await closePool();
    },
  };

  return { app, ctx };
}
