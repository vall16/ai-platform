// SessionCart — in-memory per-session cart shared by the live commerce
// adapters. Neither Shopify nor WooCommerce expose a simple server-side cart
// API that is safe to drive from an agent, so the cart is tracked per session
// here and resolved against live product data at read time.

import type { Cart, CartItem } from '@ai-platform/contracts';

export interface CartPriceResolver {
  /** Resolve the current price (micro units of the store currency) for a product id. */
  price(productId: string): number;
}

function sameVariant(a?: Record<string, string>, b?: Record<string, string>): boolean {
  const ka = Object.keys(a ?? {}).sort().join(',');
  const kb = Object.keys(b ?? {}).sort().join(',');
  if (ka !== kb) return false;
  for (const k of ka.split(',').filter(Boolean)) {
    if ((a?.[k] ?? '') !== (b?.[k] ?? '')) return false;
  }
  return true;
}

export class SessionCart {
  private readonly items = new Map<string, CartItem[]>();

  add(sessionId: string, item: CartItem): CartItem[] {
    const list = this.items.get(sessionId) ?? [];
    const existing = list.find(
      (i) => i.productId === item.productId && sameVariant(i.variant, item.variant),
    );
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      list.push({ ...item, variant: item.variant ? { ...item.variant } : undefined });
    }
    this.items.set(sessionId, list);
    return list;
  }

  get(sessionId: string): CartItem[] {
    return this.items.get(sessionId) ?? [];
  }

  build(sessionId: string, currency: string, price: CartPriceResolver): Cart {
    const list = this.get(sessionId);
    const totalMicroUsd = list.reduce((sum, i) => sum + price.price(i.productId) * i.quantity, 0);
    return { cartId: sessionId, items: list, totalMicroUsd, currency };
  }

  clear(sessionId: string): void {
    this.items.delete(sessionId);
  }
}
