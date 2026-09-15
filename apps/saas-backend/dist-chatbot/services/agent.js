// AgentService — bridges DB-backed sessions to the in-memory AgentCore.
//
// The AgentCore keeps conversation memory in-process, keyed by session id. This
// service resolves a tenant-scoped DB session, (re)registers its state with the
// core on each turn, runs the message, and persists the resulting audio + cost.
export class AgentService {
    core;
    pool;
    audioStore;
    constructor(core, pool, audioStore) {
        this.core = core;
        this.pool = pool;
        this.audioStore = audioStore;
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
        };
    }
    /** Run one user message through the agent and persist audio + cost. */
    async sendMessage(sessionId, tenantId, text) {
        await this.ensureSession(sessionId, tenantId);
        const result = await this.core.handleMessage(sessionId, text);
        let audioId;
        if (result.audio) {
            const stored = this.audioStore.put(result.audio.bytes, result.audio.mimeType);
            audioId = stored.id;
        }
        if (result.costMicroUsd > 0) {
            await this.pool.query(`UPDATE session SET total_cost_micro_usd = total_cost_micro_usd + $1 WHERE id = $2`, [result.costMicroUsd, sessionId]);
        }
        return { ...result, audioId };
    }
    /** Stop the agent for a session (clears in-session memory). */
    async close(sessionId) {
        await this.core.closeSession(sessionId);
    }
}
//# sourceMappingURL=agent.js.map