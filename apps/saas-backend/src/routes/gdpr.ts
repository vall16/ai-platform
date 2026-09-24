// GDPR routes — data-subject rights + Shopify privacy webhooks.
//
//   GET  /api/v1/gdpr/export            right of access / portability (auth)
//   POST /api/v1/gdpr/delete            right to erasure (auth)
//   POST /api/v1/gdpr/retention/purge   storage limitation — cron-triggered (auth)
//   POST /api/v1/webhooks/shopify/privacy  Shopify privacy webhooks (HMAC, no auth)

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { GdprService, GdprCustomer } from '../services/gdpr.js';
import type { Config } from '../config.js';

type AuthGuard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

/** Shopify privacy-webhook topics we act on. */
const SHOPIFY_TOPICS = new Set(['customers/data_request', 'customers/redact', 'shop/redact']);

/**
 * Verify a Shopify webhook signature: base64 HMAC-SHA256 of the RAW request
 * body, keyed with the shared secret, compared in constant time.
 */
function verifyShopifyHmac(rawBody: Buffer, hmacHeader: string, secret: string): boolean {
  if (!secret) return false;
  const computed = createHmac('sha256', secret).update(rawBody).digest('base64');
  const a = Buffer.from(computed);
  const b = Buffer.from(hmacHeader);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function registerGdprRoutes(
  app: FastifyInstance,
  gdprService: GdprService,
  authGuard: AuthGuard,
  config: Config,
) {
  // GET /api/v1/gdpr/export — right of access / portability.
  app.get('/api/v1/gdpr/export', { preHandler: [authGuard] }, async (request, reply) => {
    const bundle = await gdprService.exportTenantData(request.auth!.tenantId);
    return reply.send(bundle);
  });

  // POST /api/v1/gdpr/delete — right to erasure.
  app.post('/api/v1/gdpr/delete', { preHandler: [authGuard] }, async (request, reply) => {
    const result = await gdprService.deleteTenantData(request.auth!.tenantId);
    return reply.send(result);
  });

  // POST /api/v1/gdpr/retention/purge — storage limitation. A scheduled job
  // (cron) calls this on the retention schedule. Accepts an explicit `before`
  // ISO date; otherwise the cutoff is now - dataRetentionDays.
  app.post('/api/v1/gdpr/retention/purge', { preHandler: [authGuard] }, async (request, reply) => {
    const { before } = (request.body as { before?: string }) ?? {};
    const beforeIso =
      before ?? new Date(Date.now() - config.dataRetentionDays * 86_400_000).toISOString();
    const result = await gdprService.purgeExpired(beforeIso);
    return reply.send(result);
  });

  // Shopify privacy webhooks. Encapsulated so the raw-body parser (needed for
  // HMAC verification) only applies to this route, not the whole app.
  app.register(async (f) => {
    f.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
      const raw = body as Buffer;
      (req as { rawBody?: Buffer }).rawBody = raw;
      try {
        done(null, JSON.parse(raw.toString('utf8')));
      } catch (err) {
        done(err as Error, undefined);
      }
    });

    f.post('/api/v1/webhooks/shopify/privacy', async (request, reply) => {
      const rawBody = (request as { rawBody?: Buffer }).rawBody;
      const hmacHeader = request.headers['x-shopify-hmac-sha256'] as string | undefined;
      const topic = request.headers['x-shopify-topic'] as string | undefined;

      if (!rawBody || !hmacHeader) {
        return reply.status(401).send({ error: 'Missing webhook signature' });
      }
      if (!verifyShopifyHmac(rawBody, hmacHeader, config.shopifyWebhookSecret)) {
        return reply.status(401).send({ error: 'Invalid webhook signature' });
      }
      if (!topic || !SHOPIFY_TOPICS.has(topic)) {
        return reply.status(400).send({ error: 'Unsupported webhook topic' });
      }

      const payload = request.body as {
        shop?: string;
        email?: string;
        customer_id?: number;
        data_request_url?: string;
      };
      const shopDomain = payload.shop ?? (request.headers['x-shopify-shop-domain'] as string | undefined);
      if (!shopDomain) {
        return reply.status(400).send({ error: 'Missing shop domain' });
      }

      const tenantId = await gdprService.findTenantByShop(shopDomain);
      if (!tenantId) {
        // Unknown shop: ack so Shopify does not retry, but take no action.
        return reply.send({ received: true, action: 'noop', reason: 'unknown_shop' });
      }

      const customer: GdprCustomer = {
        email: payload.email,
        customerId: payload.customer_id ? String(payload.customer_id) : undefined,
      };

      if (topic === 'shop/redact') {
        const result = await gdprService.deleteTenantData(tenantId);
        return reply.send({ received: true, action: 'shop_redact', ...result });
      }
      if (topic === 'customers/redact') {
        const result = await gdprService.deleteCustomerData(tenantId, customer);
        return reply.send({ received: true, action: 'customer_redact', ...result });
      }
      // customers/data_request — gather the data subject's data. In production
      // this bundle is POSTed to payload.data_request_url; here it is returned.
      const bundle = await gdprService.exportCustomerData(tenantId, customer);
      return reply.send({
        received: true,
        action: 'customer_data_request',
        data_request_url: payload.data_request_url,
        data: bundle,
      });
    });
  });
}
