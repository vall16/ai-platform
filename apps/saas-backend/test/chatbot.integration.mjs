// Integration test for the chatbot pipeline (AgentService + AgentCore + AudioStore).
//
// This runs WITHOUT Fastify and WITHOUT Postgres: it uses the real provider
// factory (mock LLM/TTS/content + real CostLedger) against a fake pg Pool that
// serves a canned active session. It verifies the full message flow the backend
// endpoints rely on: send message -> reply + audio id -> audio retrievable ->
// cost persisted -> ledger recorded, plus session error paths.
//
// Run: node test/chatbot.integration.mjs   (after `tsc -p tsconfig.chatbot.json`)

import assert from 'node:assert/strict';
import { AgentCore } from '@ai-platform/agent-core';
import { createAgentDependencies } from '../dist-chatbot/providers/factory.js';
import { AgentService } from '../dist-chatbot/services/agent.js';
import { AudioStore } from '../dist-chatbot/services/audio-store.js';

/** Fake pg Pool: serves a canned session row and records every query. */
function makeFakePool(sessionRow) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (/INSERT INTO usage_ledger/i.test(sql)) {
        return { rows: [{ id: `ledger_${queries.length}` }] };
      }
      if (/UPDATE session/i.test(sql)) {
        return { rows: [] };
      }
      if (/FROM session/i.test(sql)) {
        // Only return the row when the (id, tenant_id) params match it.
        const [id, tenantId] = params;
        if (id === sessionRow.id && tenantId === sessionRow.tenant_id) {
          return { rows: [sessionRow] };
        }
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

const activeSession = {
  id: 'sess-1',
  tenant_id: 'tenant-1',
  product_type: 'persona',
  status: 'active',
  metadata: { language: 'it', personality: 'friendly', voice_id: 'voice-1' },
};

const pool = makeFakePool(activeSession);
const core = new AgentCore(createAgentDependencies(pool));
const audioStore = new AudioStore();
const agentService = new AgentService(core, pool, audioStore);

// 1. Send a message: get a reply, an audio id, and a positive cost.
const result = await agentService.sendMessage('sess-1', 'tenant-1', 'Ciao, cosa vendete?');
assert.ok(result.reply.length > 0, 'reply non vuoto');
assert.ok(!result.reply.includes('tool_call'), 'reply non è un blob tool_call');
assert.ok(result.audioId, 'audioId presente');
assert.ok(result.costMicroUsd > 0, 'costo > 0');

// 2. The audio is retrievable by id (what GET /audio/:audioId serves).
const audio = audioStore.get(result.audioId);
assert.ok(audio, 'audio recuperabile per id');
assert.equal(audio.mimeType, 'audio/mpeg');
assert.ok(audio.bytes.length > 0, 'audio ha byte');

// 3. The session cost was persisted (UPDATE session).
const update = pool.queries.find((q) => /UPDATE session/i.test(q.sql));
assert.ok(update, 'UPDATE session eseguito');
assert.ok(update.params[0] > 0, 'costo aggiornato > 0');

// 4. The ledger recorded both llm and tts events. recordBatch issues a single
// INSERT with 8 params per event; resourceType is the 4th (index 3) of each group.
const inserts = pool.queries.filter((q) => /INSERT INTO usage_ledger/i.test(q.sql));
const resourceTypes = [];
for (const q of inserts) {
  for (let i = 0; i + 3 < q.params.length; i += 8) {
    resourceTypes.push(q.params[i + 3]);
  }
}
assert.ok(resourceTypes.includes('llm'), 'ledger: evento llm');
assert.ok(resourceTypes.includes('tts'), 'ledger: evento tts');

// 5. A second message on the same session works (in-session memory retained).
const result2 = await agentService.sendMessage('sess-1', 'tenant-1', 'Grazie');
assert.ok(result2.reply.length > 0, 'seconda reply non vuota');

// 6. Unknown session -> session_not_found.
await assert.rejects(
  () => agentService.sendMessage('nope', 'tenant-1', 'hi'),
  /session_not_found/,
);

// 7. Inactive session -> session_not_active.
const poolInactive = makeFakePool({ ...activeSession, status: 'completed' });
const core2 = new AgentCore(createAgentDependencies(poolInactive));
const svc2 = new AgentService(core2, poolInactive, new AudioStore());
await assert.rejects(
  () => svc2.sendMessage('sess-1', 'tenant-1', 'hi'),
  /session_not_active/,
);

console.log('OK — chatbot integration (AgentService + AgentCore + AudioStore): 7 checks passed');
