// CommerceBridge — composite commerce bridge. Uses the live platform adapter
// (Shopify / WooCommerce) when the session carries a shop config (shopUrl),
// otherwise falls back to the mock provider (offline dev). Mirrors the
// ContentBridge used for the AI Persona.

import type {
  Cart,
  CartItem,
  CheckoutSession,
  Product,
  ProductSearchQuery,
  ProductSearchResult,
} from '@ai-platform/contracts';
import type { CommerceToolProvider, ShopContext } from '@ai-platform/agent-core';

export class CommerceBridge implements CommerceToolProvider {
  constructor(
    private readonly shopify: CommerceToolProvider,
    private readonly woocommerce: CommerceToolProvider,
    private readonly fallback: CommerceToolProvider,
  ) {}

  private live(shop?: ShopContext): CommerceToolProvider | null {
    if (!shop?.shopUrl) return null;
    if (shop.platform === 'shopify') return this.shopify;
    if (shop.platform === 'woocommerce') return this.woocommerce;
    // Unknown platform with a shopUrl: try WooCommerce (most common self-hosted).
    return this.woocommerce;
  }

  async searchProducts(query: ProductSearchQuery, shop?: ShopContext): Promise<ProductSearchResult> {
    const live = this.live(shop);
    return live ? live.searchProducts(query, shop) : this.fallback.searchProducts(query, shop);
  }

  async getProduct(productId: string, shop?: ShopContext): Promise<Product | null> {
    const live = this.live(shop);
    return live ? live.getProduct(productId, shop) : this.fallback.getProduct(productId, shop);
  }

  async addToCart(sessionId: string, item: CartItem, shop?: ShopContext): Promise<Cart> {
    const live = this.live(shop);
    return live ? live.addToCart(sessionId, item, shop) : this.fallback.addToCart(sessionId, item, shop);
  }

  async getCart(sessionId: string, shop?: ShopContext): Promise<Cart> {
    const live = this.live(shop);
    return live ? live.getCart(sessionId, shop) : this.fallback.getCart(sessionId, shop);
  }

  async startCheckout(sessionId: string, shop?: ShopContext): Promise<CheckoutSession | null> {
    const live = this.live(shop);
    return live ? live.startCheckout(sessionId, shop) : this.fallback.startCheckout(sessionId, shop);
  }
}
