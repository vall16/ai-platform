// Acceptance test 126 — AI Salesperson (Phase 2).
//
// Formal closure criterion for the AI Salesperson product: a salesperson
// session runs end-to-end through the REAL Fastify HTTP layer (buildApp +
// app.inject) with an injected fake pg pool. Covers: auth, salesperson session
// creation with shop config (persisted to metadata), text conversation (LLM +
// commerce tool + TTS), cost/ledger persistence, commerce attribution columns
// on the session, and multi-tenant isolation.
//
// The session is created WITHOUT a shop_url so the CommerceBridge falls back to
// the offline mock catalog (a live shop_url would drive a real Shopify/Woo
// request). The shop fields that do not trigger live mode (name, currency,
// platform, credentials) are still persisted and asserted.
//
// Run: node test/acceptance-126.mjs   (after the full `tsc` build -> dist/)

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { buildApp } from '../dist/app.js';

const tenantA = 'tenant-sales-a';
const tenantB = 'tenant-sales-b';
const keyA = 'sk_live_sales_a';
const keyB = 'sk_live_sales_b';
const keyHashA = createHash('sha256').update(keyA).digest('hex');
const keyHashB = createHash('sha256').update(keyB).digest('hex');

const sessions = new Map();
const ledgerResourceTypes = [];

/** Fake pg pool: two tenants, in-memory sessions, no quota row (unlimited). */
function makeFakePool() {
  return {
    async query(sql, params = []) {
      if (/FROM api_key/i.test(sql)) {
        if (params[0] === keyHashA) return { rows: [{ id: 'key-a', tenant_id: tenantA, tenant_status: 'active' }] };
        if (params[0] === keyHashB) return { rows: [{ id: 'key-b', tenant_id: tenantB, tenant_status: 'active' }] };
        return { rows: [] };
      }
      if (/UPDATE api_key/i.test(sql)) return { rows: [] };
      if (/INSERT INTO session/i.test(sql)) {
        const id = randomUUID();
        const s = {
          id,
          tenant_id: params[0],
          product_type: params[1],
          status: 'active',
          started_at: new Date().toISOString(),
          ended_at: null,
          total_cost_micro_usd: 0,
          revenue_micro_usd: params[3],
          metadata: JSON.parse(params[2]),
          cart_additions: 0,
          orders_influenced: 0,
          revenue_influenced: 0,
          created_at: new Date().toISOString(),
        };
        sessions.set(id, s);
        return { rows: [s] };
      }
      // Session lookups / updates.
      if (/FROM session/i.test(sql)) {
        const s = sessions.get(params[0]);
        return s && s.tenant_id === params[1] ? { rows: [s] } : { rows: [] };
      }
      if (/UPDATE session/i.test(sql)) {
        const s = sessions.get(params[1]);
        if (!s) return { rows: [] };
        if (/SET status = \$1/i.test(sql)) {
          s.status = params[0];
          s.ended_at = new Date().toISOString();
        } else if (/cart_additions = cart_additions/i.test(sql)) {
          s.cart_additions += params[0];
          s.orders_influenced += params[1];
          s.revenue_influenced += params[2];
        } else {
          s.total_cost_micro_usd += params[0];
        }
        return { rows: [s] };
      }
      if (/INSERT INTO usage_ledger/i.test(sql)) {
        for (let i = 3; i < params.length; i += 8) ledgerResourceTypes.push(params[i]);
        const n = params.length / 8;
        return { rows: Array.from({ length: n }, (_, i) => ({ id: `ledger_${i}` })) };
      }
      // Quota (tenant_quota) queries: no row configured -> unlimited.
      return { rows: [] };
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
};

const pool = makeFakePool();
const { app, ctx } = await buildApp(config, { pool });
await app.ready();

const authA = { Authorization: `Bearer ${keyA}`, 'Content-Type': 'application/json' };
const authB = { Authorization: `Bearer ${keyB}`, 'Content-Type': 'application/json' };

let sessionId;
try {
  // 1. Health check (no auth).
  const health = await app.inject({ method: 'GET', url: '/api/v1/health' });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().status, 'ok');

  // 2. Auth: missing key -> 401.
  const noAuth = await app.inject({
    method: 'POST',
    url: '/api/v1/sessions',
    headers: { 'Content-Type': 'application/json' },
    payload: JSON.stringify({ product_type: 'salesperson' }),
  });
  assert.equal(noAuth.statusCode, 401);

  // 3. Create a salesperson session with a shop config (no shop_url -> offline
  //    mock catalog) -> 201, revenue stamped.
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/sessions',
    headers: authA,
    payload: JSON.stringify({
      product_type: 'salesperson',
      language: 'it',
      shop_name: 'Boutique Alfa',
      platform: 'shopify',
      currency: 'EUR',
      shop_credentials: { shop_domain: 'boutique-alfa.myshopify.com', admin_token: 'shpat_mock' },
    }),
  });
  assert.equal(created.statusCode, 201);
  const createdBody = created.json();
  sessionId = createdBody.session_id;
  assert.ok(sessionId, 'session_id presente');
  assert.equal(createdBody.revenue_micro_usd, 100000, 'revenue stampata alla creazione');

  // 4. Shop config persisted into session metadata + commerce attribution columns.
  const fetched = await app.inject({ method: 'GET', url: `/api/v1/sessions/${sessionId}`, headers: authA });
  assert.equal(fetched.statusCode, 200);
  const fetchedBody = fetched.json();
  const meta = fetchedBody.metadata ?? {};
  assert.equal(meta.shop_name, 'Boutique Alfa', 'shop_name in metadata');
  assert.equal(meta.platform, 'shopify', 'platform in metadata');
  assert.equal(meta.currency, 'EUR', 'currency in metadata');
  assert.ok(meta.shop_credentials && meta.shop_credentials.admin_token, 'shop_credentials in metadata');
  assert.equal(fetchedBody.cart_additions, 0, 'cart_additions presente (default 0)');
  assert.equal(fetchedBody.orders_influenced, 0, 'orders_influenced presente (default 0)');
  assert.equal(fetchedBody.revenue_influenced, 0, 'revenue_influenced presente (default 0)');

  // 5. Text message -> 200, deterministic reply + audio_url (TTS). The
  //    salesperson advertises commerce tools, so the LLM runs a commerce tool
  //    round (search_products against the mock catalog) before answering.
  const msg = await app.inject({
    method: 'POST',
    url: `/api/v1/sessions/${sessionId}/messages`,
    headers: authA,
    payload: JSON.stringify({ text: 'Avete scarpe da corsa in offerta?' }),
  });
  assert.equal(msg.statusCode, 200);
  const msgBody = msg.json();
  assert.ok(msgBody.reply && msgBody.reply.length > 0, 'reply non vuoto');
  assert.ok(msgBody.reply.includes('mock-llm'), 'reply dal mock LLM');
  assert.ok(msgBody.audio_url, 'audio_url (TTS) presente');

  // 6. Cost accumulated on the session; ledger recorded llm and tts.
  const sess = sessions.get(sessionId);
  assert.ok(sess.total_cost_micro_usd > 0, 'costo accumulato sulla sessione');
  assert.ok(ledgerResourceTypes.includes('llm'), 'ledger: llm registrato');
  assert.ok(ledgerResourceTypes.includes('tts'), 'ledger: tts registrato');

  // 7. Multi-tenant isolation: tenant B cannot read or message tenant A's session.
  const crossRead = await app.inject({ method: 'GET', url: `/api/v1/sessions/${sessionId}`, headers: authB });
  assert.equal(crossRead.statusCode, 404, 'tenant B non legge la sessione di A');
  const crossMsg = await app.inject({
    method: 'POST',
    url: `/api/v1/sessions/${sessionId}/messages`,
    headers: authB,
    payload: JSON.stringify({ text: 'hi' }),
  });
  assert.equal(crossMsg.statusCode, 404, 'tenant B non scrive sulla sessione di A');

  // 8. Close the session -> 200, status completed.
  const closed = await app.inject({
    method: 'POST',
    url: `/api/v1/sessions/${sessionId}/close`,
    headers: authA,
    payload: JSON.stringify({ status: 'completed' }),
  });
  assert.equal(closed.statusCode, 200);
  assert.equal(closed.json().status, 'completed');

  console.log('OK — acceptance 126 (AI Salesperson, Phase 2): 8 checks passed');
} finally {
  await ctx.close();
}
