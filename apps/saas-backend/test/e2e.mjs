// End-to-end test of the chatbot flow through the REAL Fastify HTTP layer.
//
// Unlike chatbot.integration.mjs (which drives AgentService directly), this
// builds the full app (buildApp) with an injected fake pg pool and exercises
// the actual endpoints via app.inject(): auth, session lifecycle, a message
// carrying a W3C traceparent (verifying trace continuity through the HTTP
// layer), audio retrieval, cost/ledger persistence, and error paths.
//
// Run: node test/e2e.mjs   (after the full `tsc` build -> dist/)

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildApp } from '../dist/app.js';

const tenantId = 'tenant-e2e';
const rawKey = 'sk_live_test_e2e_key';
const keyHash = createHash('sha256').update(rawKey).digest('hex');

const session = {
  id: 'sess-e2e',
  tenant_id: tenantId,
  product_type: 'persona',
  status: 'active',
  started_at: new Date().toISOString(),
  ended_at: null,
  total_cost_micro_usd: 0,
  metadata: { language: 'it', personality: 'friendly', voice_id: 'voice-1' },
  created_at: new Date().toISOString(),
};

/** Fake pg pool serving the canned session + a valid API key. */
function makeFakePool() {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (/FROM api_key/i.test(sql)) {
        return params && params[0] === keyHash
          ? { rows: [{ id: 'key-e2e', tenant_id: tenantId, tenant_status: 'active' }] }
          : { rows: [] };
      }
      if (/INSERT INTO session/i.test(sql)) {
        return {
          rows: [{ ...session, tenant_id: params[0], product_type: params[1], metadata: JSON.parse(params[2]) }],
        };
      }
      if (/FROM session/i.test(sql)) {
        return params && params[0] === session.id && params[1] === tenantId ? { rows: [session] } : { rows: [] };
      }
      if (/UPDATE session/i.test(sql)) {
        return { rows: [{ ...session, status: 'completed' }] };
      }
      if (/INSERT INTO usage_ledger/i.test(sql)) {
        return { rows: [{ id: `ledger_${queries.length}` }] };
      }
      if (/SELECT COUNT/i.test(sql)) {
        return { rows: [{ n: 1 }] };
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
};

const pool = makeFakePool();
const { app, ctx } = await buildApp(config, { pool });
await app.ready();

const auth = { Authorization: `Bearer ${rawKey}`, 'Content-Type': 'application/json' };

try {
  // 1. Health check (no auth).
  const health = await app.inject({ method: 'GET', url: '/api/v1/health' });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().status, 'ok');

  // 2. Missing Authorization -> 401.
  const noAuth = await app.inject({
    method: 'POST',
    url: '/api/v1/sessions',
    headers: { 'Content-Type': 'application/json' },
    payload: JSON.stringify({ product_type: 'persona' }),
  });
  assert.equal(noAuth.statusCode, 401);

  // 3. Invalid API key -> 401.
  const badKey = await app.inject({
    method: 'POST',
    url: '/api/v1/sessions',
    headers: { Authorization: 'Bearer sk_live_wrong', 'Content-Type': 'application/json' },
    payload: JSON.stringify({ product_type: 'persona' }),
  });
  assert.equal(badKey.statusCode, 401);

  // 4. Create session -> 201 with session_id.
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/sessions',
    headers: auth,
    payload: JSON.stringify({ product_type: 'persona', language: 'it', personality: 'friendly', voice_id: 'voice-1' }),
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().session_id, session.id);

  // 5. Send a message carrying a W3C traceparent -> 200, reply + audio_url,
  //    and the trace is continued (same trace id, new span) on the response.
  const traceId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const inboundTp = `00-${traceId}-bbbbbbbbbbbbbbbb-01`;
  const msg = await app.inject({
    method: 'POST',
    url: `/api/v1/sessions/${session.id}/messages`,
    headers: { ...auth, traceparent: inboundTp },
    payload: JSON.stringify({ text: 'Ciao, cosa vendete?' }),
  });
  assert.equal(msg.statusCode, 200);
  const msgBody = msg.json();
  assert.ok(msgBody.reply && msgBody.reply.length > 0, 'reply non vuoto');
  assert.ok(msgBody.audio_url, 'audio_url presente');
  assert.equal(msg.headers['x-trace-id'], traceId, 'X-Trace-Id = trace id in ingresso');
  assert.ok(msg.headers['traceparent'].startsWith(`00-${traceId}-`), 'traceparent continua lo stesso trace id');
  const echoedSpan = msg.headers['traceparent'].split('-')[2];
  assert.notEqual(echoedSpan, 'bbbbbbbbbbbbbbbb', 'nuovo span per questo hop');

  // 6. Fetch the synthesized audio by id (unauthenticated).
  const audioId = msgBody.audio_url.split('/').pop();
  const audio = await app.inject({ method: 'GET', url: `/api/v1/sessions/${session.id}/audio/${audioId}` });
  assert.equal(audio.statusCode, 200);
  assert.ok(String(audio.headers['content-type']).includes('audio/mpeg'), 'content-type audio/mpeg');
  assert.ok(audio.rawPayload.length > 0, 'audio ha byte');

  // 7. Cost was persisted to the session and the ledger recorded.
  assert.ok(
    pool.queries.some((q) => /UPDATE session SET total_cost_micro_usd/i.test(q.sql)),
    'costo persistito sulla sessione',
  );
  assert.ok(pool.queries.some((q) => /INSERT INTO usage_ledger/i.test(q.sql)), 'ledger registrato');

  // 8. Close the session -> 200.
  const closed = await app.inject({
    method: 'POST',
    url: `/api/v1/sessions/${session.id}/close`,
    headers: auth,
    payload: JSON.stringify({ status: 'completed' }),
  });
  assert.equal(closed.statusCode, 200);

  // 9. Unknown session -> 404.
  const missing = await app.inject({
    method: 'POST',
    url: '/api/v1/sessions/nope/messages',
    headers: auth,
    payload: JSON.stringify({ text: 'hi' }),
  });
  assert.equal(missing.statusCode, 404);

  console.log('OK — e2e (Fastify HTTP, chatbot flow + trace continuity): 9 checks passed');
} finally {
  await ctx.close();
}
