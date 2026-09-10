// MockCommerceProvider — in-memory product catalog for development.

import type {
  CommerceProvider,
  Product,
  ProductSearchQuery,
  ProductSearchResult,
  CartItem,
  Cart,
  CheckoutSession,
  ProviderContext,
  ProviderResult,
  HealthStatus,
  Capabilities,
} from '@ai-platform/contracts';

const MOCK_PRODUCTS: Product[] = [
  {
    id: 'prod-001',
    title: 'Wireless Headphones Pro',
    description: 'Premium noise-cancelling wireless headphones with 30h battery life.',
    priceMicroUsd: 199_990_000,
    currency: 'USD',
    imageUrl: 'https://mock.local/img/headphones.jpg',
    variants: { color: ['black', 'white', 'silver'] },
    inStock: true,
  },
  {
    id: 'prod-002',
    title: 'Smart Watch Series 5',
    description: 'Fitness tracking, heart rate monitor, GPS, 7-day battery.',
    priceMicroUsd: 349_000_000,
    currency: 'USD',
    imageUrl: 'https://mock.local/img/watch.jpg',
    variants: { size: ['41mm', '45mm'], band: ['sport', 'leather'] },
    inStock: true,
  },
  {
    id: 'prod-003',
    title: 'USB-C Hub 8-in-1',
    description: 'HDMI 4K, 3x USB-A, USB-C PD 100W, SD card reader.',
    priceMicroUsd: 59_990_000,
    currency: 'USD',
    imageUrl: 'https://mock.local/img/hub.jpg',
    inStock: true,
  },
  {
    id: 'prod-004',
    title: 'Mechanical Keyboard RGB',
    description: 'Hot-swappable switches, PBT keycaps, USB-C detachable cable.',
    priceMicroUsd: 129_000_000,
    currency: 'USD',
    imageUrl: 'https://mock.local/img/keyboard.jpg',
    variants: { switch: ['brown', 'blue', 'red'] },
    inStock: false,
  },
];

export class MockCommerceProvider implements CommerceProvider {
  readonly id = 'mock-commerce-1';
  readonly name = 'mock-commerce';

  private carts = new Map<string, CartItem[]>();

  constructor(private readonly latencyMs = 50) {}

  async getHealth(_ctx: ProviderContext): Promise<HealthStatus> {
    return { status: 'healthy', latencyMs: this.latencyMs, checkedAt: new Date().toISOString() };
  }

  async getCapabilities(): Promise<Capabilities> {
    return { streaming: false, features: { 'product-search': true, 'cart': true, 'checkout': true } };
  }

  async shutdown(): Promise<void> {
    this.carts.clear();
  }

  async searchProducts(_ctx: ProviderContext, query: ProductSearchQuery): Promise<ProviderResult<ProductSearchResult>> {
    let results = MOCK_PRODUCTS;

    if (query.query) {
      const q = query.query.toLowerCase();
      results = results.filter(
        (p) => p.title.toLowerCase().includes(q) || p.description.toLowerCase().includes(q),
      );
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
      data: {
        products: results.slice(start, start + pageSize),
        total: results.length,
        page,
        pageSize,
      },
      cost: { costMicroUsd: 0 },
      usage: { durationMs: this.latencyMs },
      providerId: this.id,
      completedAt: new Date().toISOString(),
    };
  }

  async getProduct(_ctx: ProviderContext, productId: string): Promise<ProviderResult<Product>> {
    const product = MOCK_PRODUCTS.find((p) => p.id === productId);
    if (!product) {
      throw new Error(`Product not found: ${productId}`);
    }

    return {
      data: product,
      cost: { costMicroUsd: 0 },
      usage: { durationMs: this.latencyMs },
      providerId: this.id,
      completedAt: new Date().toISOString(),
    };
  }

  async upsertCart(_ctx: ProviderContext, cartId: string, items: CartItem[]): Promise<ProviderResult<Cart>> {
    this.carts.set(cartId, items);
    const total = items.reduce((sum, item) => {
      const product = MOCK_PRODUCTS.find((p) => p.id === item.productId);
      return sum + (product ? product.priceMicroUsd * item.quantity : 0);
    }, 0);

    return {
      data: { cartId, items, totalMicroUsd: total, currency: 'USD' },
      cost: { costMicroUsd: 0 },
      usage: { durationMs: this.latencyMs },
      providerId: this.id,
      completedAt: new Date().toISOString(),
    };
  }

  async getCart(_ctx: ProviderContext, cartId: string): Promise<ProviderResult<Cart>> {
    const items = this.carts.get(cartId) ?? [];
    const total = items.reduce((sum, item) => {
      const product = MOCK_PRODUCTS.find((p) => p.id === item.productId);
      return sum + (product ? product.priceMicroUsd * item.quantity : 0);
    }, 0);

    return {
      data: { cartId, items, totalMicroUsd: total, currency: 'USD' },
      cost: { costMicroUsd: 0 },
      usage: { durationMs: this.latencyMs },
      providerId: this.id,
      completedAt: new Date().toISOString(),
    };
  }

  async startCheckout(_ctx: ProviderContext, cartId: string): Promise<ProviderResult<CheckoutSession>> {
    const checkoutId = `mock-checkout-${Date.now()}`;

    return {
      data: {
        checkoutId,
        checkoutUrl: `https://mock.local/checkout/${checkoutId}`,
        expiresAt: new Date(Date.now() + 1800_000).toISOString(),
      },
      cost: { costMicroUsd: 0 },
      usage: { durationMs: this.latencyMs },
      providerId: this.id,
      completedAt: new Date().toISOString(),
    };
  }
}
