// Acceptance test 129 — Prepaid quota (Phase 2, Cost Ledger completo).
//
// Formal closure criterion for the prepaid-quota feature: a tenant's prepaid
// balance is set via the billing API, surfaced with unit economics, decremented
// as sessions consume cost, and — once exhausted — blocks new session creation
// with 402 quota_exhausted. Runs end-to-end through the REAL Fastify HTTP layer
// (buildApp + app.inject) with an injected fake pg pool that keeps the
// tenant_quota row in memory.
//
// Run: node test/acceptance-129.mjs   (after the full `tsc` build -> dist/)

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { buildApp } from '../dist/app.js';

const tenantA = 'tenant-quota-a';
const keyA = 'sk_live_quota_a';
const keyHashA = createHash('sha256').update(keyA).digest('hex');

const sessions = new Map();
const quotas = new Map(); // tenant_id -> { total_micro_usd, used_micro_usd, fixed_cost_micro_usd, period_end }

/** Fake pg pool: one tenant, in-memory sessions + tenant_quota row. */
function makeFakePool() {
  return {
    async query(sql, params = []) {
      if (/FROM api_key/i.test(sql)) {
        if (params[0] === keyHashA) return { rows: [{ id: 'key-a', tenant_id: tenantA, tenant_status: 'active' }] };
        return { rows: [] };
      }
      if (/UPDATE api_key/i.test(sql)) return { rows: [] };

      // Quota (tenant_quota).
      if (/INSERT INTO tenant_quota/i.test(sql)) {
        const q = {
          tenant_id: params[0],
          total_micro_usd: params[1],
          used_micro_usd: 0,
          period_end: params[2],
        };
        quotas.set(params[0], q);
        return { rows: [q] };
      }
      if (/UPDATE tenant_quota/i.test(sql)) {
        const q = quotas.get(params[1]);
        if (q) q.used_micro_usd = Math.min(q.total_micro_usd, q.used_micro_usd + params[0]);
        return { rows: [] };
      }
      if (/FROM tenant_quota/i.test(sql)) {
        const q = quotas.get(params[0]);
        return q ? { rows: [q] } : { rows: [] };
      }

      // Sessions.
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
        } else {
          s.total_cost_micro_usd += params[0];
        }
        return { rows: [s] };
      }
      if (/INSERT INTO usage_ledger/i.test(sql)) {
        const n = params.length / 8;
        return { rows: Array.from({ length: n }, (_, i) => ({ id: `ledger_${i}` })) };
      }
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

let sessionId;
try {
  // 1. Health check (no auth).
  const health = await app.inject({ method: 'GET', url: '/api/v1/health' });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().status, 'ok');

  // 2. Set a prepaid quota -> 200, balance returned (nothing consumed yet).
  const setQuota = await app.inject({
    method: 'POST',
    url: '/api/v1/billing/quota',
    headers: authA,
    payload: JSON.stringify({ total_micro_usd: 1_000_000 }),
  });
  assert.equal(setQuota.statusCode, 200);
  const balance = setQuota.json();
  assert.equal(balance.total_micro_usd, 1_000_000, 'total impostato');
  assert.equal(balance.used_micro_usd, 0, 'used iniziale 0');
  assert.equal(balance.remaining_micro_usd, 1_000_000, 'remaining = total');

  // 3. GET quota -> economics present, not unlimited, full margin (no cost yet).
  const getQuota = await app.inject({ method: 'GET', url: '/api/v1/billing/quota', headers: authA });
  assert.equal(getQuota.statusCode, 200);
  const econBody = getQuota.json();
  assert.equal(econBody.unlimited, false, 'quota configurata (non illimitata)');
  assert.ok(econBody.quota, 'economics presenti');
  assert.equal(econBody.quota.total_micro_usd, 1_000_000);
  assert.equal(econBody.quota.marginal_cost_micro_usd, 0, 'costo marginale 0 senza consumi');
  assert.equal(econBody.quota.accounting_cost_micro_usd, 0, 'costo contabile 0 senza consumi');
  assert.equal(econBody.quota.marginal_gross_margin_pct, 100, 'margine marginale 100% senza costi');
  assert.equal(econBody.quota.accounting_gross_margin_pct, 100, 'margine contabile 100% senza costi');

  // 4. Create a session -> 201 (quota available).
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/sessions',
    headers: authA,
    payload: JSON.stringify({ product_type: 'persona', language: 'it' }),
  });
  assert.equal(created.statusCode, 201, 'sessione creata con quota disponibile');
  sessionId = created.json().session_id;

  // 5. Send a message -> 200; the session cost is consumed against the quota.
  const msg = await app.inject({
    method: 'POST',
    url: `/api/v1/sessions/${sessionId}/messages`,
    headers: authA,
    payload: JSON.stringify({ text: 'Ciao, raccontami della tua azienda' }),
  });
  assert.equal(msg.statusCode, 200);

  // 6. Quota decremented: used > 0, remaining < total.
  const after = await app.inject({ method: 'GET', url: '/api/v1/billing/quota', headers: authA });
  assert.equal(after.statusCode, 200);
  const afterQuota = after.json().quota;
  assert.ok(afterQuota.used_micro_usd > 0, 'quota consumata dal messaggio');
  assert.ok(afterQuota.remaining_micro_usd < 1_000_000, 'remaining diminuita');
  assert.equal(afterQuota.total_micro_usd - afterQuota.used_micro_usd, afterQuota.remaining_micro_usd, 'coerenza total - used = remaining');

  // 7. Deplete the balance (set total to 0) -> remaining 0.
  const deplete = await app.inject({
    method: 'POST',
    url: '/api/v1/billing/quota',
    headers: authA,
    payload: JSON.stringify({ total_micro_usd: 0 }),
  });
  assert.equal(deplete.statusCode, 200);
  assert.equal(deplete.json().remaining_micro_usd, 0, 'remaining 0 dopo esaurimento');

  // 8. New session with an exhausted quota -> 402 quota_exhausted.
  const blocked = await app.inject({
    method: 'POST',
    url: '/api/v1/sessions',
    headers: authA,
    payload: JSON.stringify({ product_type: 'persona', language: 'it' }),
  });
  assert.equal(blocked.statusCode, 402, 'sessione bloccata a quota esaurita');
  assert.equal(blocked.json().error, 'quota_exhausted');

  console.log('OK — acceptance 129 (prepaid quota, Phase 2): 8 checks passed');
} finally {
  await ctx.close();
}
