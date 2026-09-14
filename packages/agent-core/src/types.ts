// Agent Core domain types.

import type {
  AvatarProvider,
  LLMProvider,
  ProviderContext,
  SessionId,
  TenantId,
  TTSProvider,
} from '@ai-platform/contracts';
import type { CostLedger } from '@ai-platform/cost-ledger';

/** Persona/session configuration used to build the agent prompt. */
export interface AgentPersona {
  language: string;
  personality: string;
  greeting: string;
  siteName?: string;
  siteDescription?: string;
}

/** Synthesized audio produced for a turn (served by the host backend). */
export interface AgentAudio {
  bytes: Uint8Array;
  mimeType: string;
}

/** Result of running a single user message through the agent. */
export interface MessageResult {
  reply: string;
  /** Present when voice is enabled and TTS succeeded. */
  audio?: AgentAudio;
  /** Total cost of this turn (LLM + TTS) in microdollars. */
  costMicroUsd: number;
  /** Number of LLM round-trips (1 = no tool calls, >1 = tool loop). */
  llmCalls: number;
}

/** Result of creating an avatar session for a conversation. */
export interface AvatarResult {
  streamUrl: string;
  clientToken?: string;
  expiresAt?: string;
  providerId: string;
}

/** A single site content item returned by the content bridge. */
export interface ContentPost {
  id: string;
  title: string;
  excerpt: string;
  content: string;
  url?: string;
}

export interface ContentSearchResult {
  posts: ContentPost[];
}

/**
 * Content tool bridge: lets the agent fetch live site content.
 * The real implementation talks to the WordPress REST API (via the plugin);
 * the mock returns deterministic content so the pipeline is testable offline.
 */
export interface ContentToolProvider {
  searchPosts(query: string): Promise<ContentSearchResult>;
  getPost(postId: string): Promise<ContentPost | null>;
}

/** Everything the AgentCore needs to run. Injected by the host (backend). */
export interface AgentDependencies {
  llm: LLMProvider;
  tts?: TTSProvider;
  avatar?: AvatarProvider;
  content: ContentToolProvider;
  ledger: CostLedger;
  /** Build a ProviderContext for a tenant/session (trace id, etc.). */
  makeContext: (tenantId: TenantId, sessionId: SessionId) => ProviderContext;
}

/** Per-session runtime state held by the AgentCore. */
export interface AgentSessionState {
  tenantId: TenantId;
  sessionId: SessionId;
  persona: AgentPersona;
  voiceEnabled: boolean;
  avatarId?: string;
  /** Voice identity passed to the TTS provider. */
  voiceId?: string;
  /** Active avatar session id (to stop on close). */
  activeAvatarSessionId?: string;
}
