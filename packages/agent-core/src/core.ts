import type { ChatMessage, LLMResponse, ProviderContext } from '@ai-platform/contracts';
import type { CostEvent } from '@ai-platform/cost-ledger';
import type {
  AgentAudio,
  AgentDependencies,
  AgentSessionState,
  AvatarResult,
  MessageResult,
} from './types.js';
import { SessionMemory } from './memory.js';
import { buildSystemPrompt } from './prompt.js';
import { CONTENT_TOOLS, executeContentTool } from './tools.js';
import { COMMERCE_TOOLS, executeCommerceTool } from './commerce-tools.js';
import type { ShopContext } from './types.js';

/** Maximum LLM→tool round-trips per message (guards against loops). */
const MAX_TOOL_ROUNDS = 4;

/**
 * AgentCore — the shared conversation engine.
 *
 * Runs a user message through the LLM (with site-content tools), optionally
 * synthesizes speech, and records per-turn cost to the Cost Ledger. Provider
 * agnostic: every dependency is injected, so the same engine serves AI Persona
 * and AI Salesperson.
 */
export class AgentCore {
  private readonly deps: AgentDependencies;
  private readonly memory: SessionMemory;
  private readonly sessions = new Map<string, AgentSessionState>();

  constructor(deps: AgentDependencies, memoryMaxMessages = 40) {
    this.deps = deps;
    this.memory = new SessionMemory(memoryMaxMessages);
  }

  /** Register a conversation session with its persona and options. */
  registerSession(state: AgentSessionState): void {
    this.sessions.set(state.sessionId, state);
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  private requireSession(sessionId: string): AgentSessionState {
    const state = this.sessions.get(sessionId);
    if (!state) {
      throw new Error(`unknown_session: ${sessionId}`);
    }
    return state;
  }

  /**
   * Run a single user message through the agent:
   * LLM (with content tools) -> optional TTS -> cost recording.
   * `traceId` (the host request id) is threaded into the provider context so
   * the cost ledger records the same correlation id as the HTTP layer.
   */
  async handleMessage(sessionId: string, userText: string, traceId?: string): Promise<MessageResult> {
    const state = this.requireSession(sessionId);
    const ctx = this.deps.makeContext(state.tenantId, state.sessionId, traceId);

    const history = this.memory.get(sessionId);
    const messages: ChatMessage[] = [
      { role: 'system', content: buildSystemPrompt(state.persona) },
      ...history,
      { role: 'user', content: userText },
    ];

    let llmCost = 0;
    let llmCalls = 0;
    let response: LLMResponse | undefined;

    // Commerce attribution (salesperson): tracked across the tool loop so the
    // host can persist cart_additions / orders_influenced / revenue_influenced.
    let cartAdditions = 0;
    let ordersInfluenced = 0;
    let revenueInfluencedMicroUsd = 0;

    // Salesperson sessions advertise commerce tools; persona sessions advertise
    // site-content tools. The commerce bridge is addressed per session via a
    // ShopContext derived from the persona (multi-tenant).
    const isSalesperson = state.persona.productType === 'salesperson';
    const tools = isSalesperson ? COMMERCE_TOOLS : CONTENT_TOOLS;
    const shop: ShopContext | undefined = isSalesperson
      ? {
          shopUrl: state.persona.shopUrl,
          platform: state.persona.platform,
          currency: state.persona.currency,
          credentials: state.persona.shopCredentials,
        }
      : undefined;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const result = await this.deps.llm.complete(ctx, { messages, tools });
      llmCost += result.cost.costMicroUsd;
      llmCalls++;
      response = result.data;

      const toolCalls = response.toolCalls ?? [];
      if (toolCalls.length === 0) break;

      messages.push({ role: 'assistant', content: response.content });
      for (const call of toolCalls) {
        let toolResult: string;
        if (isSalesperson) {
          toolResult = this.deps.commerce
            ? await executeCommerceTool(this.deps.commerce, call, state.sessionId, shop)
            : JSON.stringify({ error: 'commerce_provider_not_configured' });
          // Attribute the agent's commercial actions to the session.
          if (this.deps.commerce) {
            if (call.name === 'add_to_cart') {
              const cart = JSON.parse(toolResult) as { items?: unknown[] };
              if (Array.isArray(cart.items)) cartAdditions += 1;
            } else if (call.name === 'start_checkout') {
              const checkout = JSON.parse(toolResult) as { checkoutUrl?: string };
              if (checkout.checkoutUrl) {
                ordersInfluenced += 1;
                // The cart is still populated after checkout; read its value to
                // attribute the revenue the agent influenced.
                const cart = await this.deps.commerce.getCart(state.sessionId, shop);
                revenueInfluencedMicroUsd += cart.totalMicroUsd;
              }
            }
          }
        } else {
          toolResult = await executeContentTool(this.deps.content, call, state.persona.siteUrl);
        }
        messages.push({
          role: 'tool',
          content: toolResult,
          toolCallId: call.id,
          toolName: call.name,
        });
      }
    }

    const reply = response?.content ?? '';

    // Persist the exchange to in-session memory.
    this.memory.append(sessionId, { role: 'user', content: userText });
    this.memory.append(sessionId, { role: 'assistant', content: reply });

    // Optional TTS.
    let audio;
    let ttsCost = 0;
    if (state.voiceEnabled && this.deps.tts && reply) {
      const ttsResult = await this.deps.tts.synthesize(ctx, {
        text: reply,
        voiceId: state.voiceId ?? 'default',
        format: 'mp3',
        language: state.persona.language,
      });
      ttsCost = ttsResult.cost.costMicroUsd;
      audio = { bytes: ttsResult.data.audio, mimeType: ttsResult.data.mimeType };
    }

    await this.recordCosts(state, ctx, llmCost, ttsCost);

    const commerce = isSalesperson
      ? { cartAdditions, ordersInfluenced, revenueInfluencedMicroUsd }
      : undefined;

    return { reply, audio, costMicroUsd: llmCost + ttsCost, llmCalls, commerce };
  }

  /**
   * Transcribe an audio buffer to text (STT). Records the STT cost to the
   * ledger and returns the transcript plus the cost (so the host can fold it
   * into the session total). Uses the session's persona language as the hint.
   */
  async transcribe(
    sessionId: string,
    audio: AgentAudio,
    traceId?: string,
  ): Promise<{ transcript: string; sttCost: number }> {
    const state = this.requireSession(sessionId);
    if (!this.deps.stt) {
      throw new Error('stt_provider_not_configured');
    }
    const ctx = this.deps.makeContext(state.tenantId, state.sessionId, traceId);
    const result = await this.deps.stt.transcribe(ctx, {
      mimeType: audio.mimeType,
      audio: audio.bytes,
      language: state.persona.language,
    });
    const sttCost = result.cost.costMicroUsd;
    if (sttCost > 0) {
      await this.deps.ledger.record({
        tenantId: state.tenantId,
        sessionId: state.sessionId,
        providerId: this.deps.stt.id,
        resourceType: 'stt',
        costMicroUsd: sttCost,
        quantity: 1,
        unit: 'request',
        traceId: ctx.traceId,
      });
    }
    return { transcript: result.data.text, sttCost };
  }

  /** Create a realtime avatar session for the conversation. */
  async handleAvatar(sessionId: string): Promise<AvatarResult> {
    const state = this.requireSession(sessionId);
    if (!this.deps.avatar) {
      throw new Error('avatar_provider_not_configured');
    }
    const ctx = this.deps.makeContext(state.tenantId, state.sessionId);
    const result = await this.deps.avatar.createSession(ctx, {
      avatarId: state.avatarId ?? 'default',
      lipSync: true,
      greeting: state.persona.greeting,
    });
    state.activeAvatarSessionId = result.data.sessionId;

    if (result.cost.costMicroUsd > 0) {
      await this.deps.ledger.record({
        tenantId: state.tenantId,
        sessionId: state.sessionId,
        providerId: this.deps.avatar.id,
        resourceType: 'avatar',
        costMicroUsd: result.cost.costMicroUsd,
        quantity: 1,
        unit: 'session',
        traceId: ctx.traceId,
      });
    }

    return {
      streamUrl: result.data.streamUrl,
      clientToken: result.data.clientToken,
      expiresAt: result.data.expiresAt,
      providerId: this.deps.avatar.id,
    };
  }

  /** Stop the avatar session (if any) and drop in-session memory. */
  async closeSession(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    if (state.activeAvatarSessionId && this.deps.avatar) {
      const ctx = this.deps.makeContext(state.tenantId, state.sessionId);
      try {
        await this.deps.avatar.stopSession(ctx, state.activeAvatarSessionId);
      } catch {
        // best-effort: avatar teardown must not block session close
      }
    }
    this.memory.clear(sessionId);
    this.sessions.delete(sessionId);
  }

  private async recordCosts(
    state: AgentSessionState,
    ctx: ProviderContext,
    llmCost: number,
    ttsCost: number,
  ): Promise<void> {
    const events: CostEvent[] = [];
    if (llmCost > 0) {
      events.push({
        tenantId: state.tenantId,
        sessionId: state.sessionId,
        providerId: this.deps.llm.id,
        resourceType: 'llm',
        costMicroUsd: llmCost,
        quantity: 1,
        unit: 'request',
        traceId: ctx.traceId,
      });
    }
    if (ttsCost > 0) {
      events.push({
        tenantId: state.tenantId,
        sessionId: state.sessionId,
        providerId: this.deps.tts!.id,
        resourceType: 'tts',
        costMicroUsd: ttsCost,
        quantity: 1,
        unit: 'request',
        traceId: ctx.traceId,
      });
    }
    if (events.length > 0) {
      await this.deps.ledger.recordBatch(events);
    }
  }
}
