// AgentService — bridges DB-backed sessions to the in-memory AgentCore.
//
// The AgentCore keeps conversation memory in-process, keyed by session id. This
// service resolves a tenant-scoped DB session, (re)registers its state with the
// core on each turn, runs the message, and persists the resulting audio + cost.
export class AgentService {
    core;
    pool;
    audioStore;
    quotaService;
    constructor(core, pool, audioStore, 
    /** Prepaid quota: marginal cost of each turn is consumed from it. */
    quotaService) {
        this.core = core;
        this.pool = pool;
        this.audioStore = audioStore;
        this.quotaService = quotaService;
    }
    /**
     * Resolve a tenant-scoped active session and register its state with the core.
     * Re-registering each turn is idempotent: it refreshes the state map without
     * touching the core's in-session memory.
     */
    async ensureSession(sessionId, tenantId) {
        const result = await this.pool.query(`SELECT id, tenant_id, product_type, status, metadata
       FROM session WHERE id = $1 AND tenant_id = $2`, [sessionId, tenantId]);
        if (result.rows.length === 0) {
            throw new Error('session_not_found');
        }
        const row = result.rows[0];
        if (row.status !== 'active') {
            throw new Error('session_not_active');
        }
        this.core.registerSession(this.buildState(row));
    }
    buildState(session) {
        const meta = (session.metadata ?? {});
        return {
            tenantId: session.tenant_id,
            sessionId: session.id,
            persona: this.buildPersona(session.product_type, meta),
            // Voice (TTS) is on by default for the chatbot; opt out with voice_enabled:false.
            voiceEnabled: meta.voice_enabled !== false,
            voiceId: typeof meta.voice_id === 'string' ? meta.voice_id : undefined,
        };
    }
    buildPersona(productType, meta) {
        return {
            language: typeof meta.language === 'string' ? meta.language : 'it',
            personality: typeof meta.personality === 'string'
                ? meta.personality
                : productType === 'salesperson'
                    ? 'persuasive, professional, focused on turning the visitor into a customer'
                    : 'friendly, warm, helpful',
            greeting: typeof meta.greeting === 'string' ? meta.greeting : 'Ciao! Come posso aiutarti?',
            siteName: typeof meta.site_name === 'string' ? meta.site_name : undefined,
            siteDescription: typeof meta.site_description === 'string' ? meta.site_description : undefined,
            siteUrl: typeof meta.site_url === 'string' ? meta.site_url : undefined,
            // Commerce (AI Salesperson): product type + shop config drive the live
            // commerce bridge (Shopify / WooCommerce) vs the mock catalog.
            productType,
            shopName: typeof meta.shop_name === 'string' ? meta.shop_name : undefined,
            shopUrl: typeof meta.shop_url === 'string' ? meta.shop_url : undefined,
            platform: meta.platform === 'shopify' || meta.platform === 'woocommerce' ? meta.platform : undefined,
            currency: typeof meta.currency === 'string' ? meta.currency : undefined,
            shopCredentials: meta.shop_credentials && typeof meta.shop_credentials === 'object'
                ? meta.shop_credentials
                : undefined,
        };
    }
    /** Run one user message through the agent and persist audio + cost. */
    async sendMessage(sessionId, tenantId, text, traceId) {
        await this.ensureSession(sessionId, tenantId);
        const result = await this.core.handleMessage(sessionId, text, traceId);
        let audioId;
        if (result.audio) {
            const stored = this.audioStore.put(result.audio.bytes, result.audio.mimeType);
            audioId = stored.id;
        }
        if (result.costMicroUsd > 0) {
            await this.pool.query(`UPDATE session SET total_cost_micro_usd = total_cost_micro_usd + $1 WHERE id = $2`, [result.costMicroUsd, sessionId]);
            await this.quotaService?.consume(tenantId, result.costMicroUsd);
        }
        // Persist commerce attribution (salesperson): the agent's cart/checkout
        // actions, so the Control Room can report influenced revenue per session.
        const c = result.commerce;
        if (c && (c.cartAdditions > 0 || c.ordersInfluenced > 0 || c.revenueInfluencedMicroUsd > 0)) {
            await this.pool.query(`UPDATE session
         SET cart_additions = cart_additions + $1,
             orders_influenced = orders_influenced + $2,
             revenue_influenced = revenue_influenced + $3
         WHERE id = $4`, [c.cartAdditions, c.ordersInfluenced, c.revenueInfluencedMicroUsd, sessionId]);
        }
        return { ...result, audioId };
    }
    /**
     * Run one audio message through the agent: STT (transcribe) -> LLM/TTS.
     * Persists the synthesized audio and folds the STT + turn cost into the
     * session total. Returns the transcript alongside the usual result.
     */
    async sendAudio(sessionId, tenantId, audio, traceId) {
        await this.ensureSession(sessionId, tenantId);
        const { transcript, sttCost } = await this.core.transcribe(sessionId, audio, traceId);
        const result = await this.core.handleMessage(sessionId, transcript, traceId);
        let audioId;
        if (result.audio) {
            const stored = this.audioStore.put(result.audio.bytes, result.audio.mimeType);
            audioId = stored.id;
        }
        const totalCost = sttCost + result.costMicroUsd;
        if (totalCost > 0) {
            await this.pool.query(`UPDATE session SET total_cost_micro_usd = total_cost_micro_usd + $1 WHERE id = $2`, [totalCost, sessionId]);
            await this.quotaService?.consume(tenantId, totalCost);
        }
        return { ...result, audioId, transcript };
    }
    /** Stop the agent for a session (clears in-session memory). */
    async close(sessionId) {
        await this.core.closeSession(sessionId);
    }
}
//# sourceMappingURL=agent.js.map