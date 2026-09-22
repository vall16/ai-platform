import type { Pool } from 'pg';
import { AgentCore } from '@ai-platform/agent-core';
import type { MessageResult } from '@ai-platform/agent-core';
import type { AudioStore } from './audio-store.js';
export interface AgentMessageResult extends MessageResult {
    /** Id of the stored audio (fetch via GET /sessions/:id/audio/:audioId). */
    audioId?: string;
}
export interface AgentAudioMessageResult extends AgentMessageResult {
    /** Transcribed text of the input audio. */
    transcript: string;
}
export declare class AgentService {
    private readonly core;
    private readonly pool;
    private readonly audioStore;
    constructor(core: AgentCore, pool: Pool, audioStore: AudioStore);
    /**
     * Resolve a tenant-scoped active session and register its state with the core.
     * Re-registering each turn is idempotent: it refreshes the state map without
     * touching the core's in-session memory.
     */
    private ensureSession;
    private buildState;
    private buildPersona;
    /** Run one user message through the agent and persist audio + cost. */
    sendMessage(sessionId: string, tenantId: string, text: string, traceId?: string): Promise<AgentMessageResult>;
    /**
     * Run one audio message through the agent: STT (transcribe) -> LLM/TTS.
     * Persists the synthesized audio and folds the STT + turn cost into the
     * session total. Returns the transcript alongside the usual result.
     */
    sendAudio(sessionId: string, tenantId: string, audio: {
        bytes: Uint8Array;
        mimeType: string;
    }, traceId?: string): Promise<AgentAudioMessageResult>;
    /** Stop the agent for a session (clears in-session memory). */
    close(sessionId: string): Promise<void>;
}
//# sourceMappingURL=agent.d.ts.map