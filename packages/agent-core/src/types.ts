// Agent Core domain types.

import type {
  AvatarProvider,
  Cart,
  CartItem,
  CheckoutSession,
  LLMProvider,
  Product,
  ProductSearchQuery,
  ProductSearchResult,
  ProviderContext,
  SessionId,
  STTProvider,
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
  /**
   * Origin of the host site (e.g. "https://example.com"). When present, the
   * content bridge fetches live content from this site's WordPress REST API;
   * when absent, the mock content is used.
   */
  siteUrl?: string;
  /**
   * Product type. 'persona' (default) uses site-content tools; 'salesperson'
   * uses commerce tools (catalog, cart, checkout).
   */
  productType?: 'persona' | 'salesperson';
  /** Store name (salesperson). */
  shopName?: string;
  /**
   * Origin of the store (e.g. "https://shop.example.com"). When present, the
   * commerce bridge talks to the live platform API; when absent, the mock
   * catalog is used.
   */
  shopUrl?: string;
  /** Commerce platform backing the store. */
  platform?: 'shopify' | 'woocommerce';
  /** ISO currency code for the store (e.g. "EUR"). */
  currency?: string;
  /** Platform credentials (WooCommerce consumer key/secret, Shopify token). */
  shopCredentials?: Record<string, string>;
}

/** Synthesized audio produced for a turn (served by the host backend). */
export interface AgentAudio {
  bytes: Uint8Array;
  mimeType: string;
}

/** Commerce attribution for a turn (salesperson sessions only). */
export interface CommerceAttribution {
  /** Number of add-to-cart actions the agent performed this turn. */
  cartAdditions: number;
  /** Number of checkouts the agent started this turn. */
  ordersInfluenced: number;
  /** Cart value (micro USD) at the time of each checkout started this turn. */
  revenueInfluencedMicroUsd: number;
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
  /** Commerce attribution (salesperson sessions only). */
  commerce?: CommerceAttribution;
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
  searchPosts(query: string, siteUrl?: string): Promise<ContentSearchResult>;
  getPost(postId: string, siteUrl?: string): Promise<ContentPost | null>;
}

/**
 * Per-session commerce context, derived from the session persona. Carries the
 * store origin + platform + credentials so one provider instance can serve all
 * tenants (multi-tenant), mirroring how `siteUrl` is passed to the content
 * bridge.
 */
export interface ShopContext {
  shopUrl?: string;
  platform?: 'shopify' | 'woocommerce';
  currency?: string;
  credentials?: Record<string, string>;
}

/**
 * Commerce tool bridge: lets the agent search the catalog, manage the
 * per-session cart, and start checkout. The real implementation talks to the
 * store's platform API (Shopify / WooCommerce); the mock returns a
 * deterministic catalog so the pipeline is testable offline.
 *
 * The cart is tracked per session id by the provider.
 */
export interface CommerceToolProvider {
  searchProducts(query: ProductSearchQuery, shop?: ShopContext): Promise<ProductSearchResult>;
  getProduct(productId: string, shop?: ShopContext): Promise<Product | null>;
  addToCart(sessionId: string, item: CartItem, shop?: ShopContext): Promise<Cart>;
  getCart(sessionId: string, shop?: ShopContext): Promise<Cart>;
  startCheckout(sessionId: string, shop?: ShopContext): Promise<CheckoutSession | null>;
}

/** Everything the AgentCore needs to run. Injected by the host (backend). */
export interface AgentDependencies {
  llm: LLMProvider;
  tts?: TTSProvider;
  stt?: STTProvider;
  avatar?: AvatarProvider;
  content: ContentToolProvider;
  /** Commerce bridge (salesperson). Optional; used when a session is a salesperson. */
  commerce?: CommerceToolProvider;
  ledger: CostLedger;
  /**
   * Build a ProviderContext for a tenant/session (trace id, etc.).
   * `traceId` is the host's request id, passed so logs, response headers and
   * the cost ledger all share one correlation id end-to-end.
   */
  makeContext: (tenantId: TenantId, sessionId: SessionId, traceId?: string) => ProviderContext;
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
