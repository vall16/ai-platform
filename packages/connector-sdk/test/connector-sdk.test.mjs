// Standalone unit test for @ai-platform/connector-sdk (no test framework, node:assert only).
// Run with: node test/connector-sdk.test.mjs  (after building connector-sdk)

import assert from 'node:assert/strict';
import {
  ConnectorClient,
  FetchTransport,
  MockTransport,
  createMockBackend,
  ConnectorError,
  AuthError,
  QuotaExhaustedError,
  SessionNotFoundError,
  SessionNotActiveError,
  SttNotConfiguredError,
  NetworkError,
} from '@ai-platform/connector-sdk';

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    failed += 1;
    failures.push({ name, err });
    console.error(`  \u2717 ${name}`);
    const detail = err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n    ') : String(err);
    console.error(`    ${detail}`);
  }
}

function makeClient(transport, overrides = {}) {
  return new ConnectorClient({
    apiBase: 'https://api.example.com',
    apiKey: 'sk_test_123',
    productType: 'persona',
    transport,
    ...overrides,
  });
}

function statusTransport(status, body) {
  return new MockTransport(() => ({ status, body }));
}

function jsonRes(status, body) {
  return { status, json: async () => body, text: async () => JSON.stringify(body) };
}

function makeFetch(behavior) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return behavior(url, init);
  };
  return { fetch, calls };
}

const fullSession = (id, status = 'active') => ({
  id,
  session_id: id,
  tenant_id: 't',
  product_type: 'persona',
  status,
  started_at: '',
  ended_at: null,
  total_cost_micro_usd: 0,
  revenue_micro_usd: 0,
  cart_additions: 0,
  orders_influenced: 0,
  revenue_influenced: 0,
  metadata: {},
  created_at: '',
});

console.log('connector-sdk: client (mock backend)');

await test('startSession returns a session and remembers its id', async () => {
  const client = makeClient(createMockBackend());
  const s = await client.startSession();
  assert.ok(s.session_id);
  assert.equal(client.currentSessionId, s.session_id);
});

await test('full happy path: message, voice, close', async () => {
  const client = makeClient(createMockBackend(), {
    language: 'it',
    personality: 'friendly',
    siteUrl: 'https://site.example',
  });
  await client.startSession();
  const msg = await client.sendMessage('Ciao');
  assert.match(msg.reply, /Mock reply to: Ciao/);
  const audio = await client.sendAudio(new Uint8Array([1, 2, 3]), 'audio/webm');
  assert.equal(audio.transcript, 'mock transcript');
  const closed = await client.closeSession('completed');
  assert.equal(closed.status, 'completed');
  assert.equal(client.currentSessionId, null);
});

await test('sendMessage before startSession throws no_session', async () => {
  const client = makeClient(createMockBackend());
  await assert.rejects(() => client.sendMessage('hi'), (e) => e instanceof ConnectorError && e.code === 'no_session');
});

await test('sendMessage rejects empty text', async () => {
  const client = makeClient(createMockBackend());
  await client.startSession();
  await assert.rejects(() => client.sendMessage('   '), (e) => e instanceof ConnectorError && e.code === 'invalid_argument');
});

await test('sendAudio rejects empty bytes', async () => {
  const client = makeClient(createMockBackend());
  await client.startSession();
  await assert.rejects(() => client.sendAudio(new Uint8Array(0)), (e) => e instanceof ConnectorError && e.code === 'invalid_argument');
});

await test('listSessions / countActiveSessions / getSession', async () => {
  const client = makeClient(createMockBackend());
  await client.startSession();
  await client.startSession();
  assert.equal(await client.countActiveSessions(), 2);
  assert.equal((await client.listSessions()).length, 2);
  const s = await client.getSession();
  assert.ok(s.id);
});

await test('audioUrl builds the absolute TTS url', async () => {
  const client = makeClient(createMockBackend());
  assert.equal(
    client.audioUrl('sess-1', 'aud-1'),
    'https://api.example.com/api/v1/sessions/sess-1/audio/aud-1',
  );
});

await test('health (no auth) returns ok', async () => {
  const client = makeClient(createMockBackend());
  const h = await client.health();
  assert.equal(h.status, 'ok');
});

console.log('connector-sdk: error mapping');

await test('401 -> AuthError', async () => {
  const client = makeClient(statusTransport(401, { error: 'unauthorized' }));
  await assert.rejects(() => client.startSession(), (e) => e instanceof AuthError);
});

await test('402 -> QuotaExhaustedError', async () => {
  const client = makeClient(statusTransport(402, { error: 'quota_exhausted' }));
  await assert.rejects(() => client.startSession(), (e) => e instanceof QuotaExhaustedError);
});

await test('404 -> SessionNotFoundError', async () => {
  const client = makeClient(statusTransport(404, { error: 'Session not found' }));
  await assert.rejects(() => client.startSession(), (e) => e instanceof SessionNotFoundError);
});

await test('409 -> SessionNotActiveError', async () => {
  const client = makeClient(statusTransport(409, { error: 'Session is not active' }));
  await assert.rejects(() => client.startSession(), (e) => e instanceof SessionNotActiveError);
});

await test('501 -> SttNotConfiguredError', async () => {
  const client = makeClient(statusTransport(501, { error: 'STT not configured' }));
  await assert.rejects(() => client.startSession(), (e) => e instanceof SttNotConfiguredError);
});

await test('500 -> generic ConnectorError with status', async () => {
  const client = makeClient(statusTransport(500, { error: 'boom' }));
  await assert.rejects(() => client.startSession(), (e) => e instanceof ConnectorError && e.status === 500 && e.code === 'boom');
});

console.log('connector-sdk: FetchTransport');

await test('sends Authorization + JSON body on startSession', async () => {
  const { fetch, calls } = makeFetch(() => jsonRes(201, fullSession('s1')));
  const client = new ConnectorClient({ apiBase: 'https://api.example.com', apiKey: 'sk_x', productType: 'persona', fetch });
  await client.startSession();
  assert.equal(calls[0].url, 'https://api.example.com/api/v1/sessions');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sk_x');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.equal(JSON.parse(calls[0].init.body).product_type, 'persona');
});

await test('sends raw audio bytes with the given content type', async () => {
  const { fetch, calls } = makeFetch((url) => {
    if (url.endsWith('/sessions')) return jsonRes(201, fullSession('s1'));
    if (url.endsWith('/audio')) return jsonRes(200, { reply: 'r', transcript: 't' });
    return jsonRes(200, {});
  });
  const client = new ConnectorClient({ apiBase: 'https://api.example.com', apiKey: 'sk_x', productType: 'persona', fetch });
  await client.startSession();
  await client.sendAudio(new Uint8Array([9, 9, 9]), 'audio/webm');
  const audioCall = calls.find((c) => c.url.endsWith('/audio'));
  assert.equal(audioCall.init.headers['Content-Type'], 'audio/webm');
  assert.ok(audioCall.init.body instanceof Uint8Array);
  assert.deepEqual([...audioCall.init.body], [9, 9, 9]);
});

await test('maps a 402 from fetch to QuotaExhaustedError', async () => {
  const { fetch } = makeFetch(() => jsonRes(402, { error: 'quota_exhausted' }));
  const client = new ConnectorClient({ apiBase: 'https://api.example.com', apiKey: 'sk_x', productType: 'persona', fetch });
  await assert.rejects(() => client.startSession(), (e) => e instanceof QuotaExhaustedError);
});

await test('maps a fetch throw to NetworkError', async () => {
  const fetch = async () => {
    throw new Error('ECONNREFUSED');
  };
  const client = new ConnectorClient({ apiBase: 'https://api.example.com', apiKey: 'sk_x', productType: 'persona', fetch });
  await assert.rejects(() => client.startSession(), (e) => e instanceof NetworkError);
});

await test('aborts on timeout and throws NetworkError', async () => {
  const { fetch } = makeFetch((_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }),
  );
  const client = new ConnectorClient({ apiBase: 'https://api.example.com', apiKey: 'sk_x', productType: 'persona', fetch, timeoutMs: 20 });
  await assert.rejects(() => client.startSession(), (e) => e instanceof NetworkError && /timed out/.test(e.message));
});

await test('FetchTransport throws when no fetch is available', async () => {
  const saved = globalThis.fetch;
  delete globalThis.fetch;
  try {
    assert.throws(() => new FetchTransport(), (e) => e instanceof NetworkError);
  } finally {
    globalThis.fetch = saved;
  }
});

console.log('connector-sdk: config validation');

await test('rejects missing apiBase / apiKey / productType', async () => {
  assert.throws(() => new ConnectorClient({ apiKey: 'x', productType: 'persona' }), (e) => e instanceof ConnectorError);
  assert.throws(() => new ConnectorClient({ apiBase: 'https://x', productType: 'persona' }), (e) => e instanceof ConnectorError);
  assert.throws(() => new ConnectorClient({ apiBase: 'https://x', apiKey: 'x' }), (e) => e instanceof ConnectorError);
});

console.log('');
console.log(`connector-sdk: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
