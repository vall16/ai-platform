// Provider factory — wires the AgentCore dependencies.
//
// Mock-first: LLM, TTS, and site content are deterministic mocks so the full
// chat pipeline runs offline. The cost ledger is real (writes to Postgres).
// Swap the mocks for live providers here when a real integration is ready —
// the AgentCore and the routes do not change.
import { randomUUID } from 'node:crypto';
import { CostLedger } from '@ai-platform/cost-ledger';
import { MockLLMProvider, MockTTSProvider, MockContentToolProvider } from '@ai-platform/mock-providers';
export function createAgentDependencies(pool) {
    return {
        llm: new MockLLMProvider(),
        tts: new MockTTSProvider(),
        content: new MockContentToolProvider(),
        ledger: new CostLedger(pool),
        makeContext: (tenantId, sessionId) => ({
            tenantId,
            sessionId,
            requestId: randomUUID(),
            traceId: randomUUID(),
        }),
    };
}
//# sourceMappingURL=factory.js.map