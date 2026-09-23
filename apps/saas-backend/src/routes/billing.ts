// Billing routes — Stripe subscription management.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { BillingService } from '../services/billing.js';
import type { QuotaService } from '@ai-platform/cost-ledger';

type AuthGuard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export function registerBillingRoutes(
  app: FastifyInstance,
  billingService: BillingService,
  authGuard: AuthGuard,
  quotaService: QuotaService,
) {
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

  // POST /api/v1/billing/quota — set (or reset) the tenant's prepaid quota.
  app.post('/api/v1/billing/quota', { preHandler: [authGuard] }, async (request, reply) => {
    const { total_micro_usd, period_end } = request.body as {
      total_micro_usd: number;
      period_end?: string;
    };
    if (typeof total_micro_usd !== 'number' || total_micro_usd < 0) {
      return reply.status(400).send({ error: 'total_micro_usd (>= 0) is required' });
    }
    const balance = await quotaService.setQuota(request.auth!.tenantId, total_micro_usd, period_end);
    return reply.status(200).send({
      tenant_id: balance.tenantId,
      total_micro_usd: balance.totalMicroUsd,
      used_micro_usd: balance.usedMicroUsd,
      remaining_micro_usd: balance.remainingMicroUsd,
      exhausted: balance.exhausted,
      period_end: balance.periodEnd,
    });
  });

  // GET /api/v1/billing/quota — quota balance + economics (marginal vs
  // accounting cost, gross margin on the prepaid revenue under both bases).
  app.get('/api/v1/billing/quota', { preHandler: [authGuard] }, async (request, reply) => {
    const economics = await quotaService.getEconomics(request.auth!.tenantId);
    if (!economics) return reply.send({ quota: null, unlimited: true });
    return reply.send({
      quota: {
        tenant_id: economics.tenantId,
        total_micro_usd: economics.totalMicroUsd,
        used_micro_usd: economics.usedMicroUsd,
        remaining_micro_usd: economics.remainingMicroUsd,
        exhausted: economics.exhausted,
        period_end: economics.periodEnd,
        marginal_cost_micro_usd: economics.marginalCostMicroUsd,
        accounting_cost_micro_usd: economics.accountingCostMicroUsd,
        marginal_gross_margin_micro_usd: economics.marginalGrossMarginMicroUsd,
        marginal_gross_margin_pct: economics.marginalGrossMarginPct,
        accounting_gross_margin_micro_usd: economics.accountingGrossMarginMicroUsd,
        accounting_gross_margin_pct: economics.accountingGrossMarginPct,
      },
      unlimited: false,
    });
  });
}
