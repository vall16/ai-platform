// Acceptance test 133 — GDPR completo (Phase 4).
//
// Formal closure criterion for the GDPR data-subject rights: a tenant can
// export all its data (right of access / portability), erase it (right to
// erasure), and the platform enforces a retention window (storage limitation).
// Shopify privacy webhooks (customers/data_request, customers/redact,
// shop/redact) are HMAC-verified and routed to the owning tenant via the shop
// domain. Runs end-to-end through the REAL Fastify HTTP layer (buildApp +
// app.inject) with an injected fake pg pool that keeps all GDPR-relevant rows
// in memory.
//
// Run: node test/acceptance-133.mjs   (after the full `tsc` build -> dist/)

import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { buildApp } from '../dist/app.js';

const tenantA = 'tenant-gdpr-a';
const keyA = 'sk_live_gdpr_a';
const keyHashA = createHash('sha256').update(keyA).digest('hex');
const shopDomain = 'gdpr-shop.myshopify.com';
const webhookSecret = 'shopify_webhook_secret_test';

// Timestamps: s1 is old (before the retention cutoff), s2/s3 are recent.
const OLD = '2020-01-01T00:00:00.000Z';
const RECENT = '2026-09-01T00:00:00.000Z';
const CUTOFF = '2025-01-01T00:00:00.000Z';

function makeSession(id, email, startedAt) {
  return {
    id,
    tenant_id: tenantA,
    product_type: 'persona',
    status: 'completed',
    started_at: startedAt,
    ended_at: startedAt,
    total_cost_micro_usd: 100,
    revenue_micro_usd: 100000,
    cart_additions: 0,
    orders_influenced: 0,
    revenue_influenced: 0,
    metadata: { email },
    created_at: startedAt,
  };
}

function makeUsage(id, sessionId, createdAt) {
  return {
    id,
    tenant_id: tenantA,
    session_id: sessionId,
    provider_id: 'mock-llm',
    resource_type: 'llm',
    cost_micro_usd: 100,
    quantity: 1,
    unit: 'token',
    trace_id: null,
    created_at: createdAt,
  };
}

function makeRouting(id, sessionId, createdAt) {
  return {
    id,
    tenant_id: tenantA,
    session_id: sessionId,
    request_id: `req-${sessionId}`,
    resource_type: 'llm',
    selected_provider_id: 'mock-llm',
    score: 0.9,
    candidates: [],
    reason: null,
    created_at: createdAt,
  };
}

/** Fake pg pool: one tenant, in-memory GDPR-relevant rows. */
function makeFakePool() {
  const tenants = new Map([[tenantA, {
    id: tenantA, name: 'GDPR Shop', slug: 'gdpr-shop', status: 'active',
    created_at: OLD, updated_at: OLD, deleted_at: null, shop_domain: shopDomain,
  }]]);
  const sessions = new Map([
    ['sess-alice', makeSession('sess-alice', 'alice@example.com', OLD)],
    ['sess-bob', makeSession('sess-bob', 'bob@example.com', RECENT)],
    ['sess-carol', makeSession('sess-carol', 'carol@example.com', RECENT)],
  ]);
  const usage = new Map([
    ['u1', makeUsage('u1', 'sess-alice', OLD)],
    ['u2', makeUsage('u2', 'sess-bob', RECENT)],
    ['u3', makeUsage('u3', 'sess-carol', RECENT)],
  ]);
  const routing = new Map([
    ['r1', makeRouting('r1', 'sess-alice', OLD)],
    ['r2', makeRouting('r2', 'sess-bob', RECENT)],
    ['r3', makeRouting('r3', 'sess-carol', RECENT)],
  ]);
  const accounts = new Map([['pa1', { id: 'pa1', tenant_id: tenantA, provider_id: 'mock-llm', config: { model: 'gpt' }, status: 'active' }]]);
  const apiKeys = new Map([['ak1', { id: 'ak1', tenant_id: tenantA, key_hash: keyHashA, status: 'active' }]]);

  const sessionsFor = (tenantId) => [...sessions.values()].filter((s) => s.tenant_id === tenantId);
  const usageFor = (tenantId) => [...usage.values()].filter((u) => u.tenant_id === tenantId);
  const routingFor = (tenantId) => [...routing.values()].filter((r) => r.tenant_id === tenantId);
  const sessionsByEmail = (tenantId, email) => sessionsFor(tenantId).filter((s) => s.metadata?.email === email);

  return {
    async query(sql, params = []) {
      // --- auth middleware -------------------------------------------------
      if (/FROM api_key ak/i.test(sql)) {
        const key = [...apiKeys.values()].find((k) => k.key_hash === params[0] && k.status === 'active');
        if (!key) return { rows: [] };
        const t = tenants.get(key.tenant_id);
        return { rows: [{ id: key.id, tenant_id: key.tenant_id, tenant_status: t?.status ?? 'deleted' }] };
      }
      if (/UPDATE api_key/i.test(sql)) return { rows: [], rowCount: 0 };

      // --- tenant ----------------------------------------------------------
      if (/FROM tenant WHERE shop_domain/i.test(sql)) {
        const t = [...tenants.values()].find((x) => x.shop_domain === params[0] && x.status !== 'deleted');
        return { rows: t ? [{ id: t.id }] : [] };
      }
      if (/UPDATE tenant SET status = 'deleted'/i.test(sql)) {
        const t = tenants.get(params[1]);
        if (t) { t.status = 'deleted'; t.deleted_at = params[0]; }
        return { rows: [], rowCount: t ? 1 : 0 };
      }
      if (/FROM tenant WHERE id = \$1/i.test(sql)) {
        const t = tenants.get(params[0]);
        return { rows: t ? [{ id: t.id, name: t.name, slug: t.slug, status: t.status, created_at: t.created_at }] : [] };
      }

      // --- session ---------------------------------------------------------
      if (/DELETE FROM session WHERE started_at/i.test(sql)) {
        let n = 0;
        for (const s of [...sessions.values()]) {
          if (s.started_at < params[0]) { sessions.delete(s.id); n++; }
        }
        return { rows: [], rowCount: n };
      }
      if (/DELETE FROM session WHERE tenant_id = \$1 AND metadata/i.test(sql)) {
        const matches = sessionsByEmail(params[0], params[1]);
        for (const s of matches) sessions.delete(s.id);
        return { rows: [], rowCount: matches.length };
      }
      if (/DELETE FROM session WHERE tenant_id = \$1/i.test(sql)) {
        const matches = sessionsFor(params[0]);
        for (const s of matches) sessions.delete(s.id);
        return { rows: [], rowCount: matches.length };
      }
      if (/^SELECT[\s\S]*FROM session WHERE tenant_id = \$1 AND metadata/i.test(sql)) {
        return { rows: sessionsByEmail(params[0], params[1]) };
      }
      if (/^SELECT[\s\S]*FROM session WHERE tenant_id = \$1/i.test(sql)) {
        return { rows: sessionsFor(params[0]) };
      }

      // --- usage_ledger ----------------------------------------------------
      if (/DELETE FROM usage_ledger WHERE tenant_id = \$1 AND session_id IN \(\s*SELECT/i.test(sql)) {
        const ids = new Set(sessionsByEmail(params[0], params[1]).map((s) => s.id));
        let n = 0;
        for (const u of usageFor(params[0])) {
          if (u.session_id && ids.has(u.session_id)) { usage.delete(u.id); n++; }
        }
        return { rows: [], rowCount: n };
      }
      if (/DELETE FROM usage_ledger WHERE created_at/i.test(sql)) {
        let n = 0;
        for (const u of [...usage.values()]) {
          if (u.created_at < params[0]) { usage.delete(u.id); n++; }
        }
        return { rows: [], rowCount: n };
      }
      if (/DELETE FROM usage_ledger WHERE tenant_id = \$1/i.test(sql)) {
        const matches = usageFor(params[0]);
        for (const u of matches) usage.delete(u.id);
        return { rows: [], rowCount: matches.length };
      }
      if (/FROM usage_ledger WHERE tenant_id = \$1 AND session_id IN/i.test(sql)) {
        const ids = new Set(params.slice(1));
        return { rows: usageFor(params[0]).filter((u) => u.session_id && ids.has(u.session_id)) };
      }
      if (/FROM usage_ledger WHERE tenant_id = \$1/i.test(sql)) {
        return { rows: usageFor(params[0]) };
      }

      // --- routing_decision ------------------------------------------------
      if (/DELETE FROM routing_decision WHERE created_at/i.test(sql)) {
        let n = 0;
        for (const r of [...routing.values()]) {
          if (r.created_at < params[0]) { routing.delete(r.id); n++; }
        }
        return { rows: [], rowCount: n };
      }
      if (/DELETE FROM routing_decision WHERE tenant_id = \$1/i.test(sql)) {
        const matches = routingFor(params[0]);
        for (const r of matches) routing.delete(r.id);
        return { rows: [], rowCount: matches.length };
      }
      if (/FROM routing_decision WHERE tenant_id = \$1/i.test(sql)) {
        return { rows: routingFor(params[0]) };
      }

      // --- provider_account ------------------------------------------------
      if (/DELETE FROM provider_account WHERE tenant_id = \$1/i.test(sql)) {
        let n = 0;
        for (const a of [...accounts.values()]) {
          if (a.tenant_id === params[0]) { accounts.delete(a.id); n++; }
        }
        return { rows: [], rowCount: n };
      }
      if (/FROM provider_account WHERE tenant_id = \$1/i.test(sql)) {
        return { rows: [...accounts.values()].filter((a) => a.tenant_id === params[0]) };
      }

      // --- api_key (GDPR delete) ------------------------------------------
      if (/DELETE FROM api_key WHERE tenant_id = \$1/i.test(sql)) {
        let n = 0;
        for (const k of [...apiKeys.values()]) {
          if (k.tenant_id === params[0]) { apiKeys.delete(k.id); n++; }
        }
        return { rows: [], rowCount: n };
      }

      return { rows: [], rowCount: 0 };
    },
    async end() {},
  };
}

const config = {
  port: 3000,
  host: '127.0.0.1',
  databaseUrl: 'postgres://localhost:5432/ai_platform',
  stripeSecretKey: 'sk_test_dummy',
  stripeWebhookSecret: 'whsec_dummy',
  apiKeyPrefix: 'sk_live_',
  sessionPriceMicroUsd: 100000,
  quotaFixedCostMicroUsd: 0,
  shopifyWebhookSecret: webhookSecret,
  dataRetentionDays: 365,
};

const pool = makeFakePool();
const { app, ctx } = await buildApp(config, { pool });
await app.ready();

const authA = { Authorization: `Bearer ${keyA}`, 'Content-Type': 'application/json' };

/** Send a Shopify privacy webhook with a valid (or forced-invalid) HMAC. */
async function sendWebhook(topic, payload, { badHmac = false } = {}) {
  const body = JSON.stringify(payload);
  const hmac = createHmac('sha256', webhookSecret).update(body).digest('base64');
  return app.inject({
    method: 'POST',
    url: '/api/v1/webhooks/shopify/privacy',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Hmac-Sha256': badHmac ? 'invalid_signature' : hmac,
      'X-Shopify-Topic': topic,
    },
    payload: body,
  });
}

try {
  // 1. Health check (no auth).
  const health = await app.inject({ method: 'GET', url: '/api/v1/health' });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().status, 'ok');

  // 2. Right of access: export the full tenant bundle.
  const exp = await app.inject({ method: 'GET', url: '/api/v1/gdpr/export', headers: authA });
  assert.equal(exp.statusCode, 200, 'export 200');
  const bundle = exp.json();
  assert.equal(bundle.tenant.id, tenantA, 'tenant nel bundle');
  assert.equal(bundle.sessions.length, 3, '3 sessioni nel bundle');
  assert.equal(bundle.usage_ledger.length, 3, '3 usage nel bundle');
  assert.equal(bundle.routing_decisions.length, 3, '3 routing nel bundle');
  assert.equal(bundle.provider_accounts.length, 1, '1 provider account nel bundle');
  assert.ok(bundle.exported_at, 'exported_at presente');

  // 3. Shopify customers/data_request (alice) -> gathers only her data.
  const req = await sendWebhook('customers/data_request', { shop: shopDomain, email: 'alice@example.com', customer_id: 123 });
  assert.equal(req.statusCode, 200, 'data_request 200');
  const reqBody = req.json();
  assert.equal(reqBody.action, 'customer_data_request');
  assert.equal(reqBody.data.sessions.length, 1, 'solo la sessione di alice');
  assert.equal(reqBody.data.sessions[0].metadata.email, 'alice@example.com');
  assert.equal(reqBody.data.usage_ledger.length, 1, 'solo l\'usage di alice');

  // 4. Shopify customers/redact (bob) -> erases only his data.
  const redact = await sendWebhook('customers/redact', { shop: shopDomain, email: 'bob@example.com', customer_id: 456 });
  assert.equal(redact.statusCode, 200, 'redact 200');
  const redactBody = redact.json();
  assert.equal(redactBody.action, 'customer_redact');
  assert.equal(redactBody.deleted.sessions, 1, '1 sessione di bob cancellata');
  assert.equal(redactBody.deleted.usage_ledger, 1, '1 usage di bob cancellata');

  // 5. Export now shows 2 sessions (alice, carol).
  const exp2 = await app.inject({ method: 'GET', url: '/api/v1/gdpr/export', headers: authA });
  assert.equal(exp2.statusCode, 200);
  assert.equal(exp2.json().sessions.length, 2, '2 sessioni dopo redact di bob');

  // 6. Retention purge (before cutoff) -> removes only the old session (alice).
  const purge = await app.inject({
    method: 'POST',
    url: '/api/v1/gdpr/retention/purge',
    headers: authA,
    payload: JSON.stringify({ before: CUTOFF }),
  });
  assert.equal(purge.statusCode, 200, 'purge 200');
  const purgeBody = purge.json();
  assert.equal(purgeBody.deleted.sessions, 1, '1 sessione vecchia purgata');
  assert.equal(purgeBody.deleted.usage_ledger, 1, '1 usage vecchia purgata');

  // 7. Export now shows 1 session (carol).
  const exp3 = await app.inject({ method: 'GET', url: '/api/v1/gdpr/export', headers: authA });
  assert.equal(exp3.statusCode, 200);
  assert.equal(exp3.json().sessions.length, 1, '1 sessione dopo retention');

  // 8. Shopify shop/redact -> erases the whole tenant (incl. api key).
  const shopRedact = await sendWebhook('shop/redact', { shop: shopDomain });
  assert.equal(shopRedact.statusCode, 200, 'shop/redact 200');
  const shopBody = shopRedact.json();
  assert.equal(shopBody.action, 'shop_redact');
  assert.equal(shopBody.deleted.sessions, 1, 'ultima sessione cancellata');
  assert.equal(shopBody.deleted.usage_ledger, 1, 'ultimo usage cancellato');
  assert.equal(shopBody.deleted.api_keys, 1, 'api key cancellata');

  // 9. After erasure the tenant can no longer authenticate (api key gone).
  const expAfter = await app.inject({ method: 'GET', url: '/api/v1/gdpr/export', headers: authA });
  assert.equal(expAfter.statusCode, 401, 'auth fallisce dopo erasure');

  // 10. A webhook with an invalid HMAC signature is rejected.
  const bad = await sendWebhook('shop/redact', { shop: shopDomain }, { badHmac: true });
  assert.equal(bad.statusCode, 401, 'HMAC invalido rifiutato');

  console.log('OK — acceptance 133 (GDPR completo, Phase 4): 10 checks passed');
} finally {
  await ctx.close();
}
