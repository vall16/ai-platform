// CommerceProvider — commerce operations (catalog, cart, checkout).

import type { Provider } from './provider.js';
import type { ProviderContext, ProviderResult } from './types.js';

/** A product in the catalog. */
export interface Product {
  id: string;
  title: string;
  description: string;
  priceMicroUsd: number;
  currency: string;
  imageUrl?: string;
  /** Variant options (size, color, etc.). */
  variants?: Record<string, string[]>;
  inStock: boolean;
}

/** Product search query. */
export interface ProductSearchQuery {
  query: string;
  /** Filter by category. */
  category?: string;
  /** Price range filter. */
  priceMinMicroUsd?: number;
  priceMaxMicroUsd?: number;
  page?: number;
  pageSize?: number;
}

/** Search results. */
export interface ProductSearchResult {
  products: Product[];
  total: number;
  page: number;
  pageSize: number;
}

/** A cart line item. */
export interface CartItem {
  productId: string;
  quantity: number;
  /** Selected variant values. */
  variant?: Record<string, string>;
}

/** Shopping cart state. */
export interface Cart {
  cartId: string;
  items: CartItem[];
  totalMicroUsd: number;
  currency: string;
}

/** Checkout session. */
export interface CheckoutSession {
  checkoutId: string;
  /** URL where the customer completes payment. */
  checkoutUrl: string;
  /** When the session expires (ISO 8601). */
  expiresAt: string;
}

/**
 * Provider for commerce operations.
 * Implementations: ShopifyAdapter, WooCommerceAdapter.
 * The AI agent uses this to search products, manage carts, and initiate checkout.
 */
export interface CommerceProvider extends Provider {
  /** Search the product catalog. */
  searchProducts(ctx: ProviderContext, query: ProductSearchQuery): Promise<ProviderResult<ProductSearchResult>>;

  /** Get a single product by ID. */
  getProduct(ctx: ProviderContext, productId: string): Promise<ProviderResult<Product>>;

  /** Create or update a cart. */
  upsertCart(ctx: ProviderContext, cartId: string, items: CartItem[]): Promise<ProviderResult<Cart>>;

  /** Get current cart state. */
  getCart(ctx: ProviderContext, cartId: string): Promise<ProviderResult<Cart>>;

  /** Initiate a checkout session for a cart. */
  startCheckout(ctx: ProviderContext, cartId: string): Promise<ProviderResult<CheckoutSession>>;
}
