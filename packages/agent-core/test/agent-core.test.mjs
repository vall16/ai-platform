// Standalone unit test for AgentCore (no test framework, node:assert only).
// Run with: node test/agent-core.test.mjs  (after building agent-core + mock-providers)

import assert from 'node:assert/strict';
import { AgentCore } from '@ai-platform/agent-core';
import {
  MockLLMProvider,
  MockTTSProvider,
  MockAvatarProvider,
  MockContentToolProvider,
} from '@ai-platform/mock-providers';

/** In-memory fake ledger that captures recorded cost events. */
function makeFakeLedger() {
  const events = [];
  return {
    events,
    async record(event) {
      events.push(event);
      return `evt-${events.length}`;
    },
    async recordBatch(batch) {
      for (const e of batch) events.push(e);
      return batch.map((_, i) => `evt-${events.length - batch.length + i + 1}`);
    },
  };
}

function makeCore({ voiceEnabled = true, withAvatar = true } = {}) {
  const ledger = makeFakeLedger();
  const content = new MockContentToolProvider();
  const deps = {
    llm: new MockLLMProvider(),
    tts: new MockTTSProvider(),
    avatar: withAvatar ? new MockAvatarProvider() : undefined,
    content,
    ledger,
    makeContext: (tenantId, sessionId) => ({
      tenantId,
      sessionId,
      requestId: `req-${sessionId}`,
      traceId: `trace-${sessionId}`,
    }),
  };
  const core = new AgentCore(deps);
  core.registerSession({
    tenantId: 'tenant-1',
    sessionId: 'session-1',
    persona: {
      language: 'it',
      personality: 'friendly',
      greeting: 'Ciao!',
      siteName: 'Example Studio',
    },
    voiceEnabled,
    avatarId: 'avatar-1',
    voiceId: 'voice-1',
  });
  return { core, ledger };
}

// --- Test 1: handleMessage runs the LLM→tool loop, TTS, and records cost ---
{
  const { core, ledger } = makeCore();
  const result = await core.handleMessage('session-1', 'what are your pricing plans?');

  assert.ok(result.reply.length > 0, 'reply should be non-empty');
  assert.ok(!result.reply.includes('tool_call'), 'reply must not be a raw tool_call blob');
  assert.equal(result.llmCalls, 2, 'expected exactly 2 LLM round-trips (tool call + final)');
  assert.ok(result.costMicroUsd > 0, 'turn cost should be positive');
  assert.ok(result.audio, 'audio should be present when voice is enabled');
  assert.equal(result.audio.mimeType, 'audio/mpeg', 'audio mimeType should be mp3');
  assert.ok(result.audio.bytes.length > 0, 'audio bytes should be non-empty');

  const types = ledger.events.map((e) => e.resourceType);
  assert.ok(types.includes('llm'), 'ledger should record an llm event');
  assert.ok(types.includes('tts'), 'ledger should record a tts event');
  console.log('ok 1 - handleMessage (tool loop + tts + cost)');
}

// --- Test 2: handleMessage without voice does not produce audio or tts cost ---
{
  const { core, ledger } = makeCore({ voiceEnabled: false });
  const result = await core.handleMessage('session-1', 'hello');

  assert.equal(result.audio, undefined, 'no audio when voice disabled');
  const types = ledger.events.map((e) => e.resourceType);
  assert.ok(types.includes('llm'), 'llm event recorded');
  assert.ok(!types.includes('tts'), 'no tts event when voice disabled');
  console.log('ok 2 - handleMessage (voice disabled)');
}

// --- Test 3: handleAvatar returns a stream url and records avatar cost ---
{
  const { core, ledger } = makeCore();
  const result = await core.handleAvatar('session-1');

  assert.ok(result.streamUrl.startsWith('wss://'), 'streamUrl should be a wss url');
  assert.equal(result.providerId, 'mock-avatar-1', 'providerId should match the avatar provider');
  const types = ledger.events.map((e) => e.resourceType);
  assert.ok(types.includes('avatar'), 'avatar cost should be recorded');
  console.log('ok 3 - handleAvatar');
}

// --- Test 4: closeSession removes the session and clears memory ---
{
  const { core } = makeCore();
  assert.ok(core.hasSession('session-1'), 'session should exist before close');
  await core.closeSession('session-1');
  assert.ok(!core.hasSession('session-1'), 'session should be gone after close');
  console.log('ok 4 - closeSession');
}

// --- Test 5: unknown session rejects with unknown_session ---
{
  const { core } = makeCore();
  await assert.rejects(
    () => core.handleMessage('nope', 'hi'),
    /unknown_session/,
    'unknown session should reject with unknown_session',
  );
  console.log('ok 5 - unknown session rejects');
}

console.log('\nAll AgentCore tests passed.');
