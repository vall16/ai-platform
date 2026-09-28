// Historical pricing routes (Phase 6).
//
//   GET /api/v1/pricing/effective  — the rate in force at a point in time
//   GET /api/v1/pricing/history    — the full rate history for a provider/resource
//
// Both require a valid API key (authGuard).

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { PricingService } from '../services/pricing.js';

type AuthGuard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export function registerPricingRoutes(
  app: FastifyInstance,
  pricingService: PricingService,
  authGuard: AuthGuard,
) {
  app.get('/api/v1/pricing/effective', { preHandler: [authGuard] }, async (request, reply) => {
    const { provider_id, resource_type, at } = request.query as {
      provider_id?: string;
      resource_type?: string;
      at?: string;
    };
    if (!provider_id || !resource_type) {
      return reply.status(400).send({ error: 'provider_id and resource_type are required' });
    }
    const when = at ? new Date(at) : new Date();
    if (Number.isNaN(when.getTime())) {
      return reply.status(400).send({ error: 'at must be a valid ISO-8601 timestamp' });
    }
    const price = await pricingService.effectiveCost(provider_id, resource_type, when);
    if (!price) {
      return reply.status(404).send({ error: 'no effective price for this provider/resource at the given time' });
    }
    return reply.send(price);
  });

  app.get('/api/v1/pricing/history', { preHandler: [authGuard] }, async (request, reply) => {
    const { provider_id, resource_type } = request.query as {
      provider_id?: string;
      resource_type?: string;
    };
    if (!provider_id || !resource_type) {
      return reply.status(400).send({ error: 'provider_id and resource_type are required' });
    }
    return reply.send({ provider_id, resource_type, history: await pricingService.history(provider_id, resource_type) });
  });
}
