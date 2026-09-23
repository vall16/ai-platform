// Acceptance test 125 — AI Persona (Phase 1 MVP).
//
// Formal closure criterion for Phase 1: the AI Persona product works
// end-to-end through the REAL Fastify HTTP layer (buildApp + app.inject) with
// an injected fake pg pool. Covers: auth, persona session lifecycle, text
// conversation (LLM + content tool + TTS), voice input (STT), cost/ledger
// persistence, per-session revenue + gross margin (Control Room), provider
// health, W3C trace continuity, and multi-tenant isolation.
//
// Run: node test/acceptance-125.mjs   (after the full `tsc` build -> dist/)

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { buildApp } from '../dist/app.js';

const tenantA = 'tenant-accept-a';
const tenantB = 'tenant-accept-b';
const keyA = 'sk_live_accept_a';
const keyB = 'sk_live_accept_b';
const keyHashA = createHash('sha256').update(keyA).digest('hex');
const keyHashB = createHash('sha256').update(keyB).digest('hex');

const sessions = new Map();
const ledgerResourceTypes = [];

/** Fake pg pool: two tenants, in-memory sessions, canned Control Room data. */
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
          created_at: new Date().toISOString(),
        };
        sessions.set(id, s);
        return { rows: [s] };
      }
      // Control Room aggregates (canned).
      if (/GROUP BY status/i.test(sql)) return { rows: [{ status: 'active', n: 1 }] };
      if (/GROUP BY product_type/i.test(sql)) return { rows: [{ product_type: 'persona', n: 1 }] };
      if (/SUM\(revenue_micro_usd\)/i.test(sql)) return { rows: [{ today: 100000, total: 100000 }] };
      if (/SUM\(cart_additions\)/i.test(sql)) return { rows: [{ cart_additions: 0, orders_influenced: 0, revenue_influenced: 0 }] };
      if (/last_1m/i.test(sql)) return { rows: [{ last_1m: 0, last_5m: 0, today: 30000, total: 30000 }] };
      if (/GROUP BY resource_type/i.test(sql)) return { rows: [{ resource_type: 'llm', cost: 30000 }] };
      if (/FROM provider/i.test(sql)) return { rows: [] };
      if (/GROUP BY provider_id/i.test(sql)) return { rows: [] };
      if (/SELECT COUNT/i.test(sql)) return { rows: [{ count: 1, n: 1 }] };
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

  // 2. Auth: missing key -> 401, wrong key -> 401.
  const noAuth = await app.inject({
    method: 'POST',
    url: '/api/v1/sessions',
    headers: { 'Content-Type': 'application/json' },
    payload: JSON.stringify({ product_type: 'persona' }),
  });
  assert.equal(noAuth.statusCode, 401);
  const badKey = await app.inject({
    method: 'POST',
    url: '/api/v1/sessions',
    headers: { Authorization: 'Bearer sk_live_wrong', 'Content-Type': 'application/json' },
    payload: JSON.stringify({ product_type: 'persona' }),
  });
  assert.equal(badKey.statusCode, 401);

  // 3. Create a persona session (language, personality, voice) -> 201, revenue stamped.
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/sessions',
    headers: authA,
    payload: JSON.stringify({ product_type: 'persona', language: 'it', personality: 'friendly, warm', voice_id: 'voice-1' }),
  });
  assert.equal(created.statusCode, 201);
  const createdBody = created.json();
  sessionId = createdBody.session_id;
  assert.ok(sessionId, 'session_id presente');
  assert.equal(createdBody.revenue_micro_usd, 100000, 'revenue stampata alla creazione');

  // 4. Text message with a W3C traceparent -> 200, deterministic reply + audio_url,
  //    and the trace is continued (same trace id) on the response.
  const traceId = '11111111111111111111111111111111';
  const inboundTp = `00-${traceId}-2222222222222222-01`;
  const msg = await app.inject({
    method: 'POST',
    url: `/api/v1/sessions/${sessionId}/messages`,
    headers: { ...authA, traceparent: inboundTp },
    payload: JSON.stringify({ text: 'Ciao, raccontami del vostro studio' }),
  });
  assert.equal(msg.statusCode, 200);
  const msgBody = msg.json();
  assert.ok(msgBody.reply && msgBody.reply.length > 0, 'reply non vuoto');
  assert.ok(msgBody.reply.includes('mock-llm'), 'reply dal mock LLM');
  assert.ok(msgBody.audio_url, 'audio_url (TTS) presente');
  assert.equal(msg.headers['x-trace-id'], traceId, 'X-Trace-Id = trace id in ingresso');
  assert.ok(msg.headers['traceparent'].startsWith(`00-${traceId}-`), 'traceparent continua lo stesso trace id');

  // 5. Fetch the synthesized TTS audio (unauthenticated) -> 200, audio/mpeg, bytes.
  const audioId = msgBody.audio_url.split('/').pop();
  const audio = await app.inject({ method: 'GET', url: `/api/v1/sessions/${sessionId}/audio/${audioId}` });
  assert.equal(audio.statusCode, 200);
  assert.ok(String(audio.headers['content-type']).includes('audio/mpeg'), 'content-type audio/mpeg');
  assert.ok(audio.rawPayload.length > 0, 'audio ha byte');

  // 6. Voice input (raw audio body) -> STT -> agent -> 200, transcript + reply + audio_url.
  const voice = await app.inject({
    method: 'POST',
    url: `/api/v1/sessions/${sessionId}/audio`,
    headers: { Authorization: `Bearer ${keyA}`, 'Content-Type': 'audio/webm' },
    payload: Buffer.from(new Uint8Array(32000)),
  });
  assert.equal(voice.statusCode, 200);
  const voiceBody = voice.json();
  assert.ok(voiceBody.transcript && voiceBody.transcript.length > 0, 'transcript (STT) non vuoto');
  assert.ok(voiceBody.reply && voiceBody.reply.length > 0, 'reply non vuoto');
  assert.ok(voiceBody.audio_url, 'audio_url (TTS) presente');

  // 7. Cost accumulated on the session; ledger recorded llm, tts and stt.
  const sess = sessions.get(sessionId);
  assert.ok(sess.total_cost_micro_usd > 0, 'costo accumulato sulla sessione');
  assert.ok(ledgerResourceTypes.includes('llm'), 'ledger: llm registrato');
  assert.ok(ledgerResourceTypes.includes('tts'), 'ledger: tts registrato');
  assert.ok(ledgerResourceTypes.includes('stt'), 'ledger: stt registrato');

  // 8. Control Room: margin available (revenue > cost) + provider health (llm/tts/stt healthy).
  const cr = await app.inject({ method: 'GET', url: '/api/v1/control-room/overview', headers: authA });
  assert.equal(cr.statusCode, 200);
  const crBody = cr.json();
  assert.equal(crBody.margin.available, true, 'margin disponibile');
  assert.ok(crBody.margin.gross_margin_pct > 0, 'margin positivo');
  const healthTypes = crBody.provider_health.map((h) => h.type).sort();
  assert.deepEqual(healthTypes, ['llm', 'stt', 'tts'], 'health per llm/stt/tts');
  assert.ok(crBody.provider_health.every((h) => h.status === 'healthy'), 'tutti i provider healthy');

  // 9. Multi-tenant isolation: tenant B cannot read or message tenant A's session.
  const crossRead = await app.inject({ method: 'GET', url: `/api/v1/sessions/${sessionId}`, headers: authB });
  assert.equal(crossRead.statusCode, 404, 'tenant B non legge la sessione di A');
  const crossMsg = await app.inject({
    method: 'POST',
    url: `/api/v1/sessions/${sessionId}/messages`,
    headers: authB,
    payload: JSON.stringify({ text: 'hi' }),
  });
  assert.equal(crossMsg.statusCode, 404, 'tenant B non scrive sulla sessione di A');

  // 10. Close the session -> 200, status completed.
  const closed = await app.inject({
    method: 'POST',
    url: `/api/v1/sessions/${sessionId}/close`,
    headers: authA,
    payload: JSON.stringify({ status: 'completed' }),
  });
  assert.equal(closed.statusCode, 200);
  assert.equal(closed.json().status, 'completed');

  // 11. Unknown session -> 404.
  const missing = await app.inject({
    method: 'POST',
    url: '/api/v1/sessions/nope/messages',
    headers: authA,
    payload: JSON.stringify({ text: 'hi' }),
  });
  assert.equal(missing.statusCode, 404);

  console.log('OK — acceptance 125 (AI Persona, Phase 1): 11 checks passed');
} finally {
  await ctx.close();
}
