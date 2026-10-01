// Provider factory — wires the AgentCore dependencies.
//
// Mock-first: LLM, TTS, and site content are deterministic mocks so the full
// chat pipeline runs offline. The cost ledger is real (writes to Postgres).
// Swap the mocks for live providers here when a real integration is ready —
// the AgentCore and the routes do not change.
import { randomUUID } from 'node:crypto';
import { CostLedger } from '@ai-platform/cost-ledger';
import { MockTTSProvider, MockSTTProvider, MockContentToolProvider, MockCommerceToolProvider, } from '@ai-platform/mock-providers';
import { QwenLLMProvider } from './qwen-llm.js';
import { CommerceBridge, ShopifyAdapter, WooCommerceAdapter } from '@ai-platform/commerce-core';
import { ContentBridge, WordPressContentToolProvider } from './wordpress-content.js';
export function createAgentDependencies(pool) {
    const llmBaseUrl = process.env.LLM_BASE_URL ?? 'http://192.168.1.145:11434/v1';
    const llmKey = process.env.LLM_API_KEY ?? 'not-needed';
    const llmModel = process.env.LLM_MODEL ?? 'qwen3.8-27b';
    return {
        llm: new QwenLLMProvider({
            apiKey: llmKey,
            model: llmModel,
            baseUrl: llmBaseUrl,
        }),
        tts: new MockTTSProvider(),
        stt: new MockSTTProvider(),
        // Live WordPress content when a session carries a site_url, mock otherwise.
        content: new ContentBridge(new WordPressContentToolProvider(), new MockContentToolProvider()),
        // Live commerce (Shopify / WooCommerce) when a session carries a shop config,
        // mock catalog otherwise.
        commerce: new CommerceBridge(new ShopifyAdapter(), new WooCommerceAdapter(), new MockCommerceToolProvider()),
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