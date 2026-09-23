// MockCommerceToolProvider — deterministic in-memory catalog + per-session cart
// for the agent-facing CommerceToolProvider (salesperson pipeline). Mirrors
// MockContentToolProvider: lets the AI Salesperson flow run offline.

import type {
  Cart,
  CartItem,
  CheckoutSession,
  Product,
  ProductSearchQuery,
  ProductSearchResult,
} from '@ai-platform/contracts';
import type { CommerceToolProvider, ShopContext } from '@ai-platform/agent-core';
import { MOCK_PRODUCTS } from './commerce-provider.js';

function priceOf(productId: string): number {
  return MOCK_PRODUCTS.find((p) => p.id === productId)?.priceMicroUsd ?? 0;
}

function sameVariant(
  a?: Record<string, string>,
  b?: Record<string, string>,
): boolean {
  const ka = Object.keys(a ?? {}).sort().join(',');
  const kb = Object.keys(b ?? {}).sort().join(',');
  if (ka !== kb) return false;
  for (const k of ka.split(',').filter(Boolean)) {
    if ((a?.[k] ?? '') !== (b?.[k] ?? '')) return false;
  }
  return true;
}

export class MockCommerceToolProvider implements CommerceToolProvider {
  private readonly carts = new Map<string, CartItem[]>();

  async searchProducts(query: ProductSearchQuery, shop?: ShopContext): Promise<ProductSearchResult> {
    let results = MOCK_PRODUCTS;
    if (query.query) {
      const q = query.query.toLowerCase();
      results = results.filter(
        (p) => p.title.toLowerCase().includes(q) || p.description.toLowerCase().includes(q),
      );
    }
    if (query.category) {
      // The mock catalog has no categories; ignore the filter.
    }
    if (query.priceMinMicroUsd !== undefined) {
      results = results.filter((p) => p.priceMicroUsd >= (query.priceMinMicroUsd ?? 0));
    }
    if (query.priceMaxMicroUsd !== undefined) {
      results = results.filter((p) => p.priceMicroUsd <= (query.priceMaxMicroUsd ?? Infinity));
    }
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const start = (page - 1) * pageSize;
    return {
      products: results.slice(start, start + pageSize),
      total: results.length,
      page,
      pageSize,
    };
  }

  async getProduct(productId: string, _shop?: ShopContext): Promise<Product | null> {
    return MOCK_PRODUCTS.find((p) => p.id === productId) ?? null;
  }

  async addToCart(sessionId: string, item: CartItem, shop?: ShopContext): Promise<Cart> {
    const items = this.carts.get(sessionId) ?? [];
    const existing = items.find(
      (i) => i.productId === item.productId && sameVariant(i.variant, item.variant),
    );
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      items.push({ ...item, variant: item.variant ? { ...item.variant } : undefined });
    }
    this.carts.set(sessionId, items);
    return this.buildCart(sessionId, shop);
  }

  async getCart(sessionId: string, shop?: ShopContext): Promise<Cart> {
    return this.buildCart(sessionId, shop);
  }

  async startCheckout(sessionId: string, shop?: ShopContext): Promise<CheckoutSession | null> {
    const items = this.carts.get(sessionId) ?? [];
    if (items.length === 0) return null;
    const checkoutId = `mock-checkout-${sessionId}`;
    return {
      checkoutId,
      checkoutUrl: `https://mock.local/checkout/${checkoutId}`,
      expiresAt: new Date(Date.now() + 1800_000).toISOString(),
    };
  }

  private buildCart(sessionId: string, shop?: ShopContext): Cart {
    const items = this.carts.get(sessionId) ?? [];
    const totalMicroUsd = items.reduce((sum, i) => sum + priceOf(i.productId) * i.quantity, 0);
    return {
      cartId: sessionId,
      items,
      totalMicroUsd,
      currency: shop?.currency ?? 'USD',
    };
  }
}
