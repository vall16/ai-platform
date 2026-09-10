// Billing routes — Stripe subscription management.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { BillingService } from '../services/billing.js';

type AuthGuard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export function registerBillingRoutes(app: FastifyInstance, billingService: BillingService, authGuard: AuthGuard) {
  // POST /api/v1/billing/subscribe — create a subscription
  app.post('/api/v1/billing/subscribe', { preHandler: [authGuard] }, async (request, reply) => {
    const { plan, email } = request.body as { plan: string; email: string };
    if (!plan || !email) {
      return reply.status(400).send({ error: 'plan and email are required' });
    }

    try {
      const subscription = await billingService.subscribe(request.auth!.tenantId, plan, email);
      return reply.status(201).send(subscription);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'StripeError') {
        return reply.status(402).send({ error: 'Billing error', detail: err.message });
      }
      throw err;
    }
  });

  // POST /api/v1/billing/cancel — cancel subscription
  app.post('/api/v1/billing/cancel', { preHandler: [authGuard] }, async (request, reply) => {
    const cancelled = await billingService.cancelSubscription(request.auth!.tenantId);
    if (!cancelled) return reply.status(404).send({ error: 'No active subscription' });
    return reply.send({ cancelled: true });
  });

  // GET /api/v1/billing/subscription — get current subscription
  app.get('/api/v1/billing/subscription', { preHandler: [authGuard] }, async (request, reply) => {
    const subscription = await billingService.getSubscription(request.auth!.tenantId);
    if (!subscription) return reply.status(404).send({ error: 'No subscription found' });
    return reply.send(subscription);
  });

  // POST /api/v1/billing/webhook — Stripe webhook (signature-verified, no API key auth)
  app.post('/api/v1/billing/webhook', async (request, reply) => {
    const signature = request.headers['stripe-signature'] as string | undefined;
    if (!signature) {
      return reply.status(400).send({ error: 'Missing Stripe signature' });
    }

    try {
      const rawBody = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
      const event = JSON.parse(rawBody) as import('stripe').Stripe.Event;
      await billingService.handleWebhook(event);
      return reply.send({ received: true });
    } catch {
      return reply.status(400).send({ error: 'Invalid webhook payload' });
    }
  });
}
