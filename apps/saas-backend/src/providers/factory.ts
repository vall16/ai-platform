// Provider factory — wires the AgentCore dependencies.
//
// Mock-first: LLM, TTS, and site content are deterministic mocks so the full
// chat pipeline runs offline. The cost ledger is real (writes to Postgres).
// Swap the mocks for live providers here when a real integration is ready —
// the AgentCore and the routes do not change.

import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { ProviderContext, TenantId, SessionId } from '@ai-platform/contracts';
import { CostLedger } from '@ai-platform/cost-ledger';
import type { AgentDependencies } from '@ai-platform/agent-core';
import { MockLLMProvider, MockTTSProvider, MockContentToolProvider } from '@ai-platform/mock-providers';

export function createAgentDependencies(pool: Pool): AgentDependencies {
  return {
    llm: new MockLLMProvider(),
    tts: new MockTTSProvider(),
    content: new MockContentToolProvider(),
    ledger: new CostLedger(pool),
    makeContext: (tenantId: TenantId, sessionId: SessionId): ProviderContext => ({
      tenantId,
      sessionId,
      requestId: randomUUID(),
      traceId: randomUUID(),
    }),
  };
}
