// Session routes — create, list, close conversation sessions.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { SessionService } from '../services/session.js';

type AuthGuard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export function registerSessionRoutes(app: FastifyInstance, sessionService: SessionService, authGuard: AuthGuard) {
  // POST /api/v1/sessions — start a new session
  app.post('/api/v1/sessions', { preHandler: [authGuard] }, async (request, reply) => {
    const { product_type, metadata } = request.body as {
      product_type: 'persona' | 'salesperson';
      metadata?: Record<string, unknown>;
    };

    if (!product_type || !['persona', 'salesperson'].includes(product_type)) {
      return reply.status(400).send({ error: 'product_type must be "persona" or "salesperson"' });
    }

    const session = await sessionService.create(request.auth!.tenantId, product_type, metadata);
    return reply.status(201).send(session);
  });

  // GET /api/v1/sessions — list sessions for the tenant
  app.get('/api/v1/sessions', { preHandler: [authGuard] }, async (request, reply) => {
    const { status, limit } = request.query as { status?: string; limit?: string };
    const sessions = await sessionService.listByTenant(
      request.auth!.tenantId,
      status as 'active' | 'completed' | 'abandoned' | 'error' | undefined,
      limit ? parseInt(limit, 10) : 50,
    );
    return reply.send(sessions);
  });

  // GET /api/v1/sessions/active/count — count active sessions
  app.get('/api/v1/sessions/active/count', { preHandler: [authGuard] }, async (request, reply) => {
    const count = await sessionService.countActive(request.auth!.tenantId);
    return reply.send({ count });
  });

  // GET /api/v1/sessions/:id — get a specific session
  app.get('/api/v1/sessions/:id', { preHandler: [authGuard] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = await sessionService.getById(id, request.auth!.tenantId);
    if (!session) return reply.status(404).send({ error: 'Session not found' });
    return reply.send(session);
  });

  // POST /api/v1/sessions/:id/close — close a session
  app.post('/api/v1/sessions/:id/close', { preHandler: [authGuard] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { status } = (request.body as { status?: string }) ?? {};
    const session = await sessionService.close(
      id,
      request.auth!.tenantId,
      (status as 'completed' | 'abandoned' | 'error') ?? 'completed',
    );
    if (!session) return reply.status(404).send({ error: 'Session not found or not active' });
    return reply.send(session);
  });
}
