// Base interface that all providers must implement.

import type {
  Capabilities,
  HealthStatus,
  ProviderId,
  ProviderContext,
} from './types.js';

/**
 * Base provider interface.
 * Every concrete provider (avatar, voice, STT, LLM, TTS, commerce, billing)
 * extends this to get health, capabilities, and tenant-aware context.
 */
export interface Provider {
  readonly id: ProviderId;
  readonly name: string;

  /** Check provider health. Used by the router for failover decisions. */
  getHealth(ctx: ProviderContext): Promise<HealthStatus>;

  /** Advertise what this provider can do. */
  getCapabilities(): Promise<Capabilities>;

  /** Gracefully shut down, releasing resources. */
  shutdown(): Promise<void>;
}
