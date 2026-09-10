// @ai-platform/contracts — shared provider interfaces and domain types.

// Shared types
export type {
  TenantId,
  SessionId,
  ProviderId,
  RequestId,
  Timestamp,
  ProviderContext,
  HealthStatus,
  CostInfo,
  UsageMetrics,
  ProviderResult,
  Capabilities,
} from './types.js';

// Base provider
export type { Provider } from './provider.js';

// AI providers
export type {
  AvatarProvider,
  AvatarSessionConfig,
  AvatarSession,
  AvatarGenerationResult,
} from './avatar-provider.js';

export type {
  VoiceProvider,
  VoicePipelineMode,
  VoiceSessionConfig,
  VoiceSession,
  VoiceTurn,
} from './voice-provider.js';

export type {
  STTProvider,
  AudioInput,
  TranscriptionResult,
  STTStream,
} from './stt-provider.js';

export type {
  LLMProvider,
  ChatMessage,
  ToolDefinition,
  LLMRequest,
  ToolCall,
  LLMResponse,
  LLMChunk,
} from './llm-provider.js';

export type {
  TTSProvider,
  TTSRequest,
  TTSResult,
  TTSStream,
} from './tts-provider.js';

// Commerce & Billing
export type {
  CommerceProvider,
  Product,
  ProductSearchQuery,
  ProductSearchResult,
  CartItem,
  Cart,
  CheckoutSession,
} from './commerce-provider.js';

export type {
  BillingProvider,
  PlanId,
  SubscriptionStatus,
  Subscription,
  UsageEvent,
  Balance,
} from './billing-provider.js';
