// AvatarProvider — generates and manages conversational avatars.

import type { Provider } from './provider.js';
import type { ProviderContext, ProviderResult } from './types.js';

/** Configuration for creating an avatar session. */
export interface AvatarSessionConfig {
  /** Avatar identity (pre-built or generated). */
  avatarId: string;
  /** Background style. */
  background?: 'studio' | 'transparent' | 'custom';
  /** Video resolution. */
  resolution?: '720p' | '1080p';
  /** Whether lip-sync is enabled. */
  lipSync: boolean;
  /** Greeting text spoken on session start. */
  greeting?: string;
}

/** A live avatar session handle. */
export interface AvatarSession {
  sessionId: string;
  /** WebSocket or WebRTC URL for the client to connect. */
  streamUrl: string;
  /** Token for authenticating the client connection. */
  clientToken: string;
  /** When the session expires (ISO 8601). */
  expiresAt: string;
}

/** Result of a static avatar image/video generation. */
export interface AvatarGenerationResult {
  /** URL or reference to the generated asset. */
  assetUrl: string;
  /** Asset type. */
  type: 'image' | 'video';
  /** Duration in seconds (video only). */
  durationSec?: number;
}

/**
 * Provider for avatar generation and realtime avatar sessions.
 * Implementations: HeyGen, D-ID, SelfHosted (H200), etc.
 */
export interface AvatarProvider extends Provider {
  /** Create a realtime avatar session (streaming video + audio). */
  createSession(ctx: ProviderContext, config: AvatarSessionConfig): Promise<ProviderResult<AvatarSession>>;

  /** Stop an active avatar session. */
  stopSession(ctx: ProviderContext, sessionId: string): Promise<void>;

  /** Generate a static avatar asset (image or short video). */
  generate(ctx: ProviderContext, config: AvatarSessionConfig, script: string): Promise<ProviderResult<AvatarGenerationResult>>;
}
