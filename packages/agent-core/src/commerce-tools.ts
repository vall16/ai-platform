import type { ToolCall, ToolDefinition } from '@ai-platform/contracts';
import type { CommerceToolProvider, ShopContext } from './types.js';

/** Commerce tool definitions advertised to the LLM for salesperson sessions. */
export const COMMERCE_TOOLS: ToolDefinition[] = [
  {
    name: 'search_products',
    description: 'Search the store catalog for products by keyword, category, or price range.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search keywords (may be empty to list products).' },
        category: { type: 'string', description: 'Optional category filter.' },
        price_min: { type: 'number', description: 'Optional minimum price (in the store currency).' },
        price_max: { type: 'number', description: 'Optional maximum price (in the store currency).' },
      },
      required: [],
    },
  },
  {
    name: 'get_product',
    description: 'Fetch the full details of a specific product by its id.',
    parameters: {
      type: 'object',
      properties: {
        product_id: { type: 'string', description: 'The product id.' },
      },
      required: ['product_id'],
    },
  },
  {
    name: 'add_to_cart',
    description: 'Add a product to the customer\'s cart (or increase its quantity).',
    parameters: {
      type: 'object',
      properties: {
        product_id: { type: 'string', description: 'The product id to add.' },
        quantity: { type: 'number', description: 'Quantity to add (default 1).' },
        variant: {
          type: 'object',
          description: 'Optional selected variant values, e.g. {"size":"M","color":"blue"}.',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['product_id'],
    },
  },
  {
    name: 'start_checkout',
    description: 'Start a checkout for the current cart and return the checkout URL.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

/**
 * Execute a single commerce tool call against the commerce bridge.
 * Returns a JSON string to feed back to the LLM as a tool result.
 */
export async function executeCommerceTool(
  commerce: CommerceToolProvider,
  call: ToolCall,
  sessionId: string,
  shop?: ShopContext,
): Promise<string> {
  const args: Record<string, unknown> = call.arguments ?? {};

  switch (call.name) {
    case 'search_products': {
      const result = await commerce.searchProducts(
        {
          query: String(args.query ?? ''),
          category: typeof args.category === 'string' ? args.category : undefined,
          priceMinMicroUsd:
            typeof args.price_min === 'number' ? Math.round(args.price_min * 1_000_000) : undefined,
          priceMaxMicroUsd:
            typeof args.price_max === 'number' ? Math.round(args.price_max * 1_000_000) : undefined,
        },
        shop,
      );
      return JSON.stringify(result);
    }
    case 'get_product': {
      const productId = String(args.product_id ?? '');
      const product = await commerce.getProduct(productId, shop);
      return JSON.stringify(product ?? { error: 'not_found' });
    }
    case 'add_to_cart': {
      const productId = String(args.product_id ?? '');
      const quantity = typeof args.quantity === 'number' && args.quantity > 0 ? Math.floor(args.quantity) : 1;
      const variant =
        args.variant && typeof args.variant === 'object'
          ? (args.variant as Record<string, string>)
          : undefined;
      const cart = await commerce.addToCart(sessionId, { productId, quantity, variant }, shop);
      return JSON.stringify(cart);
    }
    case 'start_checkout': {
      const checkout = await commerce.startCheckout(sessionId, shop);
      return JSON.stringify(checkout ?? { error: 'empty_cart' });
    }
    default:
      return JSON.stringify({ error: `unknown_tool: ${call.name}` });
  }
}
