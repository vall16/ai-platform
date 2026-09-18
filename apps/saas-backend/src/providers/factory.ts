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
import { ContentBridge, WordPressContentToolProvider } from './wordpress-content.js';

export function createAgentDependencies(pool: Pool): AgentDependencies {
  return {
    llm: new MockLLMProvider(),
    tts: new MockTTSProvider(),
    // Live WordPress content when a session carries a site_url, mock otherwise.
    content: new ContentBridge(new WordPressContentToolProvider(), new MockContentToolProvider()),
    ledger: new CostLedger(pool),
    makeContext: (tenantId: TenantId, sessionId: SessionId, traceId?: string): ProviderContext => {
      // Reuse the host request id when provided so logs, the X-Trace-Id header
      // and the cost ledger all carry one correlation id end-to-end.
      const id = traceId ?? randomUUID();
      return {
        tenantId,
        sessionId,
        requestId: id,
        traceId: id,
      };
    },
  };
}
