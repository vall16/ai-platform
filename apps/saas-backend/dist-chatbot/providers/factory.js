// Provider factory — wires the AgentCore dependencies.
//
// Mock-first: LLM, TTS, and site content are deterministic mocks so the full
// chat pipeline runs offline. The cost ledger is real (writes to Postgres).
// Swap the mocks for live providers here when a real integration is ready —
// the AgentCore and the routes do not change.
import { randomUUID } from 'node:crypto';
import { CostLedger } from '@ai-platform/cost-ledger';
import { MockLLMProvider, MockTTSProvider, MockSTTProvider, MockContentToolProvider } from '@ai-platform/mock-providers';
import { ContentBridge, WordPressContentToolProvider } from './wordpress-content.js';
export function createAgentDependencies(pool) {
    return {
        llm: new MockLLMProvider(),
        tts: new MockTTSProvider(),
        stt: new MockSTTProvider(),
        // Live WordPress content when a session carries a site_url, mock otherwise.
        content: new ContentBridge(new WordPressContentToolProvider(), new MockContentToolProvider()),
        ledger: new CostLedger(pool),
        makeContext: (tenantId, sessionId, traceId) => {
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
//# sourceMappingURL=factory.js.map