// Acceptance test 135 — Merchant dashboard (Phase 6).
//
// The tenant-facing analytics endpoint scopes every number to the
// authenticated tenant (WHERE tenant_id = $1) and to a merchant-chosen range
// (?days=, 0 = all time): session counts (total/active/by status/by product),
// cost (total + by resource type), revenue, gross margin, commerce counters
// (cart additions / orders influenced / revenue influenced) and a daily
// series. Runs end-to-end through the REAL Fastify HTTP layer (buildApp +
// app.inject) with an injected fake pg pool that keeps the tenant's rows in
// memory. Timestamps are relative to "now" so the range filter is
// deterministic regardless of the machine clock.
//
// Run: node test/acceptance-135.mjs   (after the full `tsc` build -> dist/)

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildApp } from '../dist/app.js';

const tenantA = 'tenant-merchant-a';
const keyA = 'sk_live_merchant_a';
const keyHashA = createHash('sha256').update(keyA).digest('hex');

const NOW = Date.now();
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const DAY = 86_400_000;
const HOUR = 3_600_000;

function makeSession(id, productType, status, startedAt, cost, revenue, cart, orders, revInfl) {
  return {
    id,
    tenant_id: tenantA,
    product_type: productType,
    status,
    started_at: startedAt,
    ended_at: status === 'active' ? null : startedAt,
    total_cost_micro_usd: cost,
    revenue_micro_usd: revenue,
    cart_additions: cart,
    orders_influenced: orders,
    revenue_influenced: revInfl,
    metadata: {},
    created_at: startedAt,
  };
}

function makeUsage(id, sessionId, resourceType, cost, createdAt) {
  return {
    id,
    tenant_id: tenantA,
    session_id: sessionId,
    provider_id: 'mock-llm',
    resource_type: resourceType,
    cost_micro_usd: cost,
    quantity: 1,
    unit: 'token',
    trace_id: null,
    created_at: createdAt,
  };
}

/**
 * Fake pg pool: one tenant.
 *   s1 persona/completed  3 days ago   cost 100  rev 100000
 *   s2 salesperson/compl  2 days ago   cost 200  rev 200000  cart 2, order 1, revInfl 50000
 *   s3 salesperson/active 1 hour ago   cost 50   rev 0
 * usage: u1 llm 100 (s1), u2 llm 150 (s2), u3 tts 50 (s2), u4 llm 50 (s3)
 */
function makeFakePool() {
  const tenants = new Map([[tenantA, {
    id: tenantA, name: 'Merchant Shop', slug: 'merchant-shop', status: 'active',
    created_at: iso(30 * DAY), updated_at: iso(30 * DAY), deleted_at: null, shop_domain: null,
  }]]);
  const sessions = new Map([
    ['s1', makeSession('s1', 'persona', 'completed', iso(3 * DAY), 100, 100000, 0, 0, 0)],
    ['s2', makeSession('s2', 'salesperson', 'completed', iso(2 * DAY), 200, 200000, 2, 1, 50000)],
    ['s3', makeSession('s3', 'salesperson', 'active', iso(HOUR), 50, 0, 0, 0, 0)],
  ]);
  const usage = new Map([
    ['u1', makeUsage('u1', 's1', 'llm', 100, iso(3 * DAY))],
    ['u2', makeUsage('u2', 's2', 'llm', 150, iso(2 * DAY))],
    ['u3', makeUsage('u3', 's2', 'tts', 50, iso(2 * DAY))],
    ['u4', makeUsage('u4', 's3', 'llm', 50, iso(HOUR))],
  ]);
  const apiKeys = new Map([['ak1', { id: 'ak1', tenant_id: tenantA, key_hash: keyHashA, status: 'active' }]]);

  const inRange = (ts, from) => from === null || ts >= from;
  const ss = (from) => [...sessions.values()].filter((s) => s.tenant_id === tenantA && inRange(s.started_at, from));
  const uu = (from) => [...usage.values()].filter((u) => u.tenant_id === tenantA && inRange(u.created_at, from));

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

      const from = params[1] ?? null;

      // --- daily series ----------------------------------------------------
      if (/to_char\(date_trunc/i.test(sql)) {
        const byDay = new Map();
        for (const s of ss(from)) {
          const day = s.started_at.slice(0, 10);
          const cur = byDay.get(day) ?? { day, sessions: 0, cost: 0, revenue: 0 };
          cur.sessions += 1;
          cur.cost += s.total_cost_micro_usd;
          cur.revenue += s.revenue_micro_usd;
          byDay.set(day, cur);
        }
        return { rows: [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1)) };
      }

      // --- sessions by status ---------------------------------------------
      if (/GROUP BY status/i.test(sql)) {
        const m = new Map();
        for (const s of ss(from)) m.set(s.status, (m.get(s.status) ?? 0) + 1);
        return { rows: [...m.entries()].map(([status, n]) => ({ status, n })) };
      }

      // --- sessions by product type ---------------------------------------
      if (/GROUP BY product_type/i.test(sql)) {
        const m = new Map();
        for (const s of ss(from)) m.set(s.product_type, (m.get(s.product_type) ?? 0) + 1);
        return { rows: [...m.entries()].map(([product_type, n]) => ({ product_type, n })) };
      }

      // --- cost by resource type ------------------------------------------
      if (/FROM usage_ledger\s+WHERE tenant_id/i.test(sql)) {
        const m = new Map();
        for (const u of uu(from)) m.set(u.resource_type, (m.get(u.resource_type) ?? 0) + u.cost_micro_usd);
        return { rows: [...m.entries()].map(([resource_type, cost]) => ({ resource_type, cost })) };
      }

      // --- sessions aggregate (fallback) ----------------------------------
      if (/FROM session\s+WHERE tenant_id/i.test(sql)) {
        const rows = ss(from);
        return { rows: [{
          total: rows.length,
          active: rows.filter((s) => s.status === 'active').length,
          cost: rows.reduce((a, s) => a + s.total_cost_micro_usd, 0),
          revenue: rows.reduce((a, s) => a + s.revenue_micro_usd, 0),
          cart_additions: rows.reduce((a, s) => a + s.cart_additions, 0),
          orders_influenced: rows.reduce((a, s) => a + s.orders_influenced, 0),
          revenue_influenced: rows.reduce((a, s) => a + s.revenue_influenced, 0),
        }] };
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

  // 2. Unauthenticated analytics -> 401.
  const noAuth = await app.inject({ method: 'GET', url: '/api/v1/merchant/analytics' });
  assert.equal(noAuth.statusCode, 401, 'no auth -> 401');

  // 3. All-time analytics (days=0): every aggregate scoped to the tenant.
  const all = await app.inject({ method: 'GET', url: '/api/v1/merchant/analytics?days=0', headers: authA });
  assert.equal(all.statusCode, 200, 'analytics 200');
  const a = all.json();
  assert.equal(a.sessions.total, 3, '3 sessioni totali');
  assert.equal(a.sessions.active, 1, '1 attiva');
  assert.equal(a.sessions.by_status.completed, 2, '2 completed');
  assert.equal(a.sessions.by_status.active, 1, '1 active');
  assert.equal(a.sessions.by_product_type.persona, 1, '1 persona');
  assert.equal(a.sessions.by_product_type.salesperson, 2, '2 salesperson');
  assert.equal(a.cost.total_micro_usd, 350, 'costo totale 350');
  assert.equal(a.cost.by_resource_type.llm, 300, 'llm 300');
  assert.equal(a.cost.by_resource_type.tts, 50, 'tts 50');
  assert.equal(a.revenue.total_micro_usd, 300000, 'revenue 300000');
  assert.equal(a.margin.gross_margin_micro_usd, 299650, 'margine lordo');
  assert.ok(a.margin.gross_margin_pct > 99 && a.margin.gross_margin_pct < 100, 'pct ~99.9');
  assert.equal(a.commerce.cart_additions, 2, '2 carrelli');
  assert.equal(a.commerce.orders_influenced, 1, '1 ordine');
  assert.equal(a.commerce.revenue_influenced_micro_usd, 50000, 'revenue influenzata');
  assert.equal(a.series.length, 3, '3 giorni nella serie');
  assert.equal(a.series.reduce((x, s) => x + s.sessions, 0), 3, 'serie: 3 sessioni');

  // 4. Range filter (days=1): only the recent active session survives.
  const d1 = await app.inject({ method: 'GET', url: '/api/v1/merchant/analytics?days=1', headers: authA });
  assert.equal(d1.statusCode, 200, 'days=1 200');
  const b = d1.json();
  assert.equal(b.sessions.total, 1, '1 sessione negli ultimi 1 giorno');
  assert.equal(b.sessions.active, 1, '1 attiva');
  assert.equal(b.sessions.by_product_type.salesperson, 1, 'salesperson');
  assert.equal(b.cost.total_micro_usd, 50, 'costo 50');
  assert.equal(b.cost.by_resource_type.llm, 50, 'llm 50');
  assert.equal(b.revenue.total_micro_usd, 0, 'revenue 0');
  assert.equal(b.margin.gross_margin_pct, null, 'pct null senza revenue');
  assert.equal(b.commerce.cart_additions, 0, '0 carrelli');

  // 5. Self-contained HTML dashboard (no auth).
  const html = await app.inject({ method: 'GET', url: '/merchant' });
  assert.equal(html.statusCode, 200, 'merchant html 200');
  assert.match(html.headers['content-type'], /text\/html/);
  assert.match(html.payload, /Dashboard/);

  console.log('OK — acceptance 135 (Merchant dashboard, Phase 6): 5 checks passed');
} finally {
  await ctx.close();
}
