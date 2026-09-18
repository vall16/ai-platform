// AgentService — bridges DB-backed sessions to the in-memory AgentCore.
//
// The AgentCore keeps conversation memory in-process, keyed by session id. This
// service resolves a tenant-scoped DB session, (re)registers its state with the
// core on each turn, runs the message, and persists the resulting audio + cost.

import type { Pool } from 'pg';
import type { Session, ProductType } from '@ai-platform/db';
import { AgentCore } from '@ai-platform/agent-core';
import type { AgentPersona, AgentSessionState, MessageResult } from '@ai-platform/agent-core';
import type { AudioStore } from './audio-store.js';

export interface AgentMessageResult extends MessageResult {
  /** Id of the stored audio (fetch via GET /sessions/:id/audio/:audioId). */
  audioId?: string;
}

export class AgentService {
  constructor(
    private readonly core: AgentCore,
    private readonly pool: Pool,
    private readonly audioStore: AudioStore,
  ) {}

  /**
   * Resolve a tenant-scoped active session and register its state with the core.
   * Re-registering each turn is idempotent: it refreshes the state map without
   * touching the core's in-session memory.
   */
  private async ensureSession(sessionId: string, tenantId: string): Promise<void> {
    const result = await this.pool.query(
      `SELECT id, tenant_id, product_type, status, metadata
       FROM session WHERE id = $1 AND tenant_id = $2`,
      [sessionId, tenantId],
    );
    if (result.rows.length === 0) {
      throw new Error('session_not_found');
    }
    const row = result.rows[0] as Session;
    if (row.status !== 'active') {
      throw new Error('session_not_active');
    }
    this.core.registerSession(this.buildState(row));
  }

  private buildState(session: Session): AgentSessionState {
    const meta = (session.metadata ?? {}) as Record<string, unknown>;
    return {
      tenantId: session.tenant_id,
      sessionId: session.id,
      persona: this.buildPersona(session.product_type, meta),
      // Voice (TTS) is on by default for the chatbot; opt out with voice_enabled:false.
      voiceEnabled: meta.voice_enabled !== false,
      voiceId: typeof meta.voice_id === 'string' ? meta.voice_id : undefined,
    };
  }

  private buildPersona(productType: ProductType, meta: Record<string, unknown>): AgentPersona {
    return {
      language: typeof meta.language === 'string' ? meta.language : 'it',
      personality:
        typeof meta.personality === 'string'
          ? meta.personality
          : productType === 'salesperson'
            ? 'persuasive, professional, focused on turning the visitor into a customer'
            : 'friendly, warm, helpful',
      greeting: typeof meta.greeting === 'string' ? meta.greeting : 'Ciao! Come posso aiutarti?',
      siteName: typeof meta.site_name === 'string' ? meta.site_name : undefined,
      siteDescription: typeof meta.site_description === 'string' ? meta.site_description : undefined,
      siteUrl: typeof meta.site_url === 'string' ? meta.site_url : undefined,
    };
  }

  /** Run one user message through the agent and persist audio + cost. */
  async sendMessage(
    sessionId: string,
    tenantId: string,
    text: string,
    traceId?: string,
  ): Promise<AgentMessageResult> {
    await this.ensureSession(sessionId, tenantId);
    const result = await this.core.handleMessage(sessionId, text, traceId);

    let audioId: string | undefined;
    if (result.audio) {
      const stored = this.audioStore.put(result.audio.bytes, result.audio.mimeType);
      audioId = stored.id;
    }

    if (result.costMicroUsd > 0) {
      await this.pool.query(
        `UPDATE session SET total_cost_micro_usd = total_cost_micro_usd + $1 WHERE id = $2`,
        [result.costMicroUsd, sessionId],
      );
    }

    return { ...result, audioId };
  }

  /** Stop the agent for a session (clears in-session memory). */
  async close(sessionId: string): Promise<void> {
    await this.core.closeSession(sessionId);
  }
}
