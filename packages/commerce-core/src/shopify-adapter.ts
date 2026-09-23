// ShopifyAdapter — live commerce bridge for Shopify stores.
// Talks to the store's Shopify Admin REST API. The store origin and access
// token are passed per call (ShopContext), so one instance serves all tenants
// (multi-tenant), mirroring the WordPress content bridge.

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

const SHOPIFY_TIMEOUT_MS = 8000;
const API_VERSION = '2024-01';

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

interface SfVariant {
  id: number;
  price: string;
  inventory_quantity?: number;
}

interface SfProduct {
  id: number;
  title: string;
  body_html?: string;
  status?: string;
  product_type?: string;
  image?: { src?: string };
  variants?: SfVariant[];
}

export class ShopifyAdapter implements CommerceToolProvider {
  private readonly cart = new SessionCart();
  private readonly prices = new Map<string, number>();

  private async fetchJson<T>(shop: ShopContext, path: string, extra?: URLSearchParams): Promise<T | null> {
    const params = new URLSearchParams();
    extra?.forEach((v, k) => params.set(k, v));
    const qs = params.toString();
    const url = `${baseUrl(shop.shopUrl!)}/admin/api/${API_VERSION}${path}${qs ? `?${qs}` : ''}`;
    try {
      const res = await fetch(url, {
        headers: { 'X-Shopify-Access-Token': shop.credentials?.access_token ?? '' },
        signal: AbortSignal.timeout(SHOPIFY_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  private toProduct(p: SfProduct, shop?: ShopContext): Product {
    const price = Math.round((parseFloat(p.variants?.[0]?.price ?? '0') || 0) * 1_000_000);
    this.prices.set(String(p.id), price);
    const inStock =
      (p.status ?? 'active') === 'active' && (p.variants?.[0]?.inventory_quantity ?? 0) > 0;
    return {
      id: String(p.id),
      title: p.title,
      description: stripHtml(p.body_html ?? ''),
      priceMicroUsd: price,
      currency: shop?.currency ?? 'USD',
      imageUrl: p.image?.src,
      inStock,
    };
  }

  async searchProducts(query: ProductSearchQuery, shop?: ShopContext): Promise<ProductSearchResult> {
    if (!shop?.shopUrl) return { products: [], total: 0, page: 1, pageSize: 10 };
    const extra = new URLSearchParams({ limit: '10', page: String(query.page ?? 1) });
    if (query.query) extra.set('title', query.query);
    const data = await this.fetchJson<{ products: SfProduct[] }>(shop, '/products.json', extra);
    if (!data) return { products: [], total: 0, page: query.page ?? 1, pageSize: 10 };
    let products = data.products.map((p) => this.toProduct(p, shop));
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
    const data = await this.fetchJson<{ product: SfProduct }>(
      shop,
      `/products/${encodeURIComponent(productId)}.json`,
    );
    return data?.product ? this.toProduct(data.product, shop) : null;
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
    const checkoutId = `sf-checkout-${sessionId}`;
    return {
      checkoutId,
      checkoutUrl: `${baseUrl(shop?.shopUrl ?? '')}/cart`,
      expiresAt: new Date(Date.now() + 1800_000).toISOString(),
    };
  }
}
