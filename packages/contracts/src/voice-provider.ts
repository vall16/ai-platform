// VoiceProvider — high-level voice pipeline (realtime or STT→LLM→TTS).

import type { Provider } from './provider.js';
import type { ProviderContext, ProviderResult } from './types.js';

/** Pipeline mode for voice processing. */
export type VoicePipelineMode = 'realtime' | 'stt-llm-tts';

/** Configuration for a voice session. */
export interface VoiceSessionConfig {
  pipeline: VoicePipelineMode;
  /** Voice identity (timbre, style). */
  voiceId: string;
  /** Language code (BCP 47). */
  language: string;
  /** Whether barge-in (interruption) is supported. */
  bargeIn: boolean;
  /** Max session duration in seconds. */
  maxDurationSec: number;
}

/** A live voice session. */
export interface VoiceSession {
  sessionId: string;
  /** Inbound audio stream URL (client → server). */
  inputUrl: string;
  /** Outbound audio stream URL (server → client). */
  outputUrl: string;
  /** When the session expires (ISO 8601). */
  expiresAt: string;
}

/** Transcript of a voice interaction turn. */
export interface VoiceTurn {
  role: 'user' | 'assistant';
  text: string;
  audioDurationSec: number;
  timestamp: string;
}

/**
 * Provider for the full voice pipeline.
 * Orchestrates STT → LLM → TTS or a unified realtime model.
 * Implementations: Deepgram realtime, OpenAI realtime, custom pipeline.
 */
export interface VoiceProvider extends Provider {
  /** Start a voice session. */
  startSession(ctx: ProviderContext, config: VoiceSessionConfig): Promise<ProviderResult<VoiceSession>>;

  /** Stop a voice session and return the full transcript. */
  stopSession(ctx: ProviderContext, sessionId: string): Promise<ProviderResult<VoiceTurn[]>>;

  /** Send a text message into an active voice session (hybrid input). */
  sendText(ctx: ProviderContext, sessionId: string, text: string): Promise<void>;
}
