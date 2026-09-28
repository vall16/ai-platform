// Acceptance test 138 — Historical pricing (Phase 6).
//
// The pricing table is a rate ledger: each row is effective from
// `effective_from` until `effective_to` (NULL = still current). Resolving the
// rate in force at a point in time lets past usage be attributed to the rate
// that applied then, not the current one. This test exercises the two
// endpoints end-to-end through the REAL Fastify HTTP layer (buildApp +
// app.inject) with an injected fake pg pool holding the pricing rows in memory.
// Timestamps are relative to "now" so the window logic is deterministic.
//
// Run: node test/acceptance-138.mjs   (after the full `tsc` build -> dist/)

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildApp } from '../dist/app.js';

const tenantA = 'tenant-pricing-a';
const keyA = 'sk_live_pricing_a';
const keyHashA = createHash('sha256').update(keyA).digest('hex');

const DAY = 86_400_000;
const NOW = Date.now();
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

// Rate ledger for provider prov-1:
//   llm: 100 from T0 until T1, then 200 from T1 (current)
//   tts: 300 from T0 (current)
const T0 = iso(10 * DAY);
const T1 = iso(5 * DAY);
const PRICING = [
  { provider_id: 'prov-1', resource_type: 'llm', unit: 'token', cost_micro_usd: 100, effective_from: T0, effective_to: T1 },
  { provider_id: 'prov-1', resource_type: 'llm', unit: 'token', cost_micro_usd: 200, effective_from: T1, effective_to: null },
  { provider_id: 'prov-1', resource_type: 'tts', unit: 'second', cost_micro_usd: 300, effective_from: T0, effective_to: null },
];

function makeFakePool() {
  const tenants = new Map([[tenantA, {
    id: tenantA, name: 'Pricing Shop', slug: 'pricing-shop', status: 'active',
    created_at: iso(30 * DAY), updated_at: iso(30 * DAY), deleted_at: null, shop_domain: null,
  }]]);
  const apiKeys = new Map([['ak1', { id: 'ak1', tenant_id: tenantA, key_hash: keyHashA, status: 'active' }]]);

  return {
    async query(sql, params = []) {
      // --- auth middleware -------------------------------------------------
      if (/FROM api_key ak/i.test(sql)) {
        const key = [...apiKeys.values()].find((k) => k.key_hash === params[0] && k.status === 'active');
        if (!key) return { rows: [] };
        const t = tenants.get(key.tenant_id);
        return { rows: [{ id: key.id, tenant_id: key.tenant_id, tenant_status: t?.status ?? 'deleted' }] };
      }

      // --- pricing ---------------------------------------------------------
      if (/FROM pricing/i.test(sql)) {
        const [providerId, resourceType] = params;
        const rows = PRICING.filter((r) => r.provider_id === providerId && r.resource_type === resourceType);
        if (/effective_from <= \$3/i.test(sql)) {
          const at = new Date(params[2]);
          const match = rows
            .filter((r) => new Date(r.effective_from) <= at && (r.effective_to == null || new Date(r.effective_to) > at))
            .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0];
          return { rows: match ? [match] : [] };
        }
        return { rows: [...rows].sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1)) };
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
  shopifyWebhookSecret: 'whsec_dummy',
  dataRetentionDays: 365,
};

const pool = makeFakePool();
const { app, ctx } = await buildApp(config, { pool });
await app.ready();

const authA = { Authorization: `Bearer ${keyA}`, 'Content-Type': 'application/json' };

try {
  // 1. Health check (no auth).
  const health = await app.inject({ method: 'GET', url: '/api/v1/health' });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().status, 'ok');

  // 2. Unauthenticated effective -> 401.
  const noAuth = await app.inject({ method: 'GET', url: '/api/v1/pricing/effective?provider_id=prov-1&resource_type=llm' });
  assert.equal(noAuth.statusCode, 401, 'no auth -> 401');

  // 3. Effective rate inside the first window (T0 <= t < T1) -> 100.
  const inFirst = await app.inject({
    method: 'GET',
    url: `/api/v1/pricing/effective?provider_id=prov-1&resource_type=llm&at=${encodeURIComponent(iso(7 * DAY))}`,
    headers: authA,
  });
  assert.equal(inFirst.statusCode, 200, 'effective in first window 200');
  assert.equal(inFirst.json().cost_micro_usd, 100, 'rate 100 in first window');
  assert.equal(inFirst.json().unit, 'token', 'unit token');

  // 4. Effective rate now (after T1, current rate) -> 200.
  const now = await app.inject({
    method: 'GET',
    url: `/api/v1/pricing/effective?provider_id=prov-1&resource_type=llm&at=${encodeURIComponent(iso(0))}`,
    headers: authA,
  });
  assert.equal(now.statusCode, 200, 'effective now 200');
  assert.equal(now.json().cost_micro_usd, 200, 'rate 200 now');
  assert.equal(now.json().effective_to, null, 'current rate has no effective_to');

  // 5. Effective rate before any window -> 404.
  const before = await app.inject({
    method: 'GET',
    url: `/api/v1/pricing/effective?provider_id=prov-1&resource_type=llm&at=${encodeURIComponent(iso(12 * DAY))}`,
    headers: authA,
  });
  assert.equal(before.statusCode, 404, 'no rate before T0 -> 404');

  // 6. History for llm -> both rates, oldest first.
  const hist = await app.inject({
    method: 'GET',
    url: '/api/v1/pricing/history?provider_id=prov-1&resource_type=llm',
    headers: authA,
  });
  assert.equal(hist.statusCode, 200, 'history 200');
  const h = hist.json().history;
  assert.equal(h.length, 2, '2 llm rates');
  assert.equal(h[0].cost_micro_usd, 100, 'oldest first: 100');
  assert.equal(h[1].cost_micro_usd, 200, 'then: 200');

  // 7. History for tts -> single current rate.
  const histTts = await app.inject({
    method: 'GET',
    url: '/api/v1/pricing/history?provider_id=prov-1&resource_type=tts',
    headers: authA,
  });
  assert.equal(histTts.statusCode, 200, 'tts history 200');
  assert.equal(histTts.json().history.length, 1, '1 tts rate');
  assert.equal(histTts.json().history[0].cost_micro_usd, 300, 'tts 300');

  // 8. Missing required params -> 400.
  const missing = await app.inject({ method: 'GET', url: '/api/v1/pricing/effective?provider_id=prov-1', headers: authA });
  assert.equal(missing.statusCode, 400, 'missing resource_type -> 400');

  console.log('OK — acceptance 138 (Historical pricing, Phase 6): 8 checks passed');
} finally {
  await ctx.close();
}
