// WooCommerceAdapter — live commerce bridge for WooCommerce stores.
// Talks to the store's WooCommerce REST API (wp-json/wc/v3). The store origin
// and credentials are passed per call (ShopContext), so one instance serves all
// tenants (multi-tenant), mirroring the WordPress content bridge.

import type {
  Cart,
  CartItem,
  CheckoutSession,
  Product,
  ProductSearchQuery,
  ProductSearchResult,
} from '@ai-platform/contracts';
import type { CommerceToolProvider, ShopContext } from '@ai-platform/agent-core';
import { SessionCart } from './cart.js';

const WC_TIMEOUT_MS = 8000;

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function baseUrl(shopUrl: string): string {
  return shopUrl.replace(/\/+$/, '');
}

interface WcProduct {
  id: number;
  name: string;
  description?: string;
  short_description?: string;
  price: string;
  categories?: Array<{ id: number; name: string }>;
  stock_status?: string;
  image?: { src?: string };
  permalink?: string;
}

export class WooCommerceAdapter implements CommerceToolProvider {
  private readonly cart = new SessionCart();
  private readonly prices = new Map<string, number>();

  private authParams(shop?: ShopContext): URLSearchParams {
    const params = new URLSearchParams();
    if (shop?.credentials?.consumer_key) params.set('consumer_key', shop.credentials.consumer_key);
    if (shop?.credentials?.consumer_secret) params.set('consumer_secret', shop.credentials.consumer_secret);
    return params;
  }

  private async fetchJson<T>(shop: ShopContext, path: string, extra?: URLSearchParams): Promise<T | null> {
    const params = this.authParams(shop);
    extra?.forEach((v, k) => params.set(k, v));
    const qs = params.toString();
    const url = `${baseUrl(shop.shopUrl!)}/wp-json/wc/v3${path}${qs ? `?${qs}` : ''}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(WC_TIMEOUT_MS) });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  private toProduct(p: WcProduct, shop?: ShopContext): Product {
    const price = Math.round((parseFloat(p.price) || 0) * 1_000_000);
    this.prices.set(String(p.id), price);
    return {
      id: String(p.id),
      title: p.name,
      description: stripHtml(p.short_description || p.description || ''),
      priceMicroUsd: price,
      currency: shop?.currency ?? 'USD',
      imageUrl: p.image?.src,
      inStock: (p.stock_status ?? 'instock') === 'instock',
    };
  }

  async searchProducts(query: ProductSearchQuery, shop?: ShopContext): Promise<ProductSearchResult> {
    if (!shop?.shopUrl) return { products: [], total: 0, page: 1, pageSize: 10 };
    const extra = new URLSearchParams({ per_page: '10', page: String(query.page ?? 1) });
    if (query.query) extra.set('search', query.query);
    const data = await this.fetchJson<WcProduct[]>(shop, '/products', extra);
    if (!data) return { products: [], total: 0, page: query.page ?? 1, pageSize: 10 };
    let products = data.map((p) => this.toProduct(p, shop));
    if (query.priceMinMicroUsd !== undefined) {
      products = products.filter((p) => p.priceMicroUsd >= (query.priceMinMicroUsd ?? 0));
    }
    if (query.priceMaxMicroUsd !== undefined) {
      products = products.filter((p) => p.priceMicroUsd <= (query.priceMaxMicroUsd ?? Infinity));
    }
    return { products, total: products.length, page: query.page ?? 1, pageSize: 10 };
  }

  async getProduct(productId: string, shop?: ShopContext): Promise<Product | null> {
    if (!shop?.shopUrl) return null;
    const data = await this.fetchJson<WcProduct>(shop, `/products/${encodeURIComponent(productId)}`);
    return data ? this.toProduct(data, shop) : null;
  }

  async addToCart(sessionId: string, item: CartItem, shop?: ShopContext): Promise<Cart> {
    this.cart.add(sessionId, item);
    return this.cart.build(sessionId, shop?.currency ?? 'USD', {
      price: (id) => this.prices.get(id) ?? 0,
    });
  }

  async getCart(sessionId: string, shop?: ShopContext): Promise<Cart> {
    return this.cart.build(sessionId, shop?.currency ?? 'USD', {
      price: (id) => this.prices.get(id) ?? 0,
    });
  }

  async startCheckout(sessionId: string, shop?: ShopContext): Promise<CheckoutSession | null> {
    if (this.cart.get(sessionId).length === 0) return null;
    const checkoutId = `wc-checkout-${sessionId}`;
    return {
      checkoutId,
      checkoutUrl: `${baseUrl(shop?.shopUrl ?? '')}/checkout/`,
      expiresAt: new Date(Date.now() + 1800_000).toISOString(),
    };
  }
}
