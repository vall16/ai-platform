import type { AgentPersona } from './types.js';

/** Build the system prompt that defines the persona and tool usage. */
export function buildSystemPrompt(persona: AgentPersona): string {
  const lines: string[] = [];

  if (persona.productType === 'salesperson') {
    lines.push(`You are the AI salesperson for ${persona.shopName ?? 'an online store'}.`);
    if (persona.siteDescription) {
      lines.push(`About the store: ${persona.siteDescription}`);
    }
    if (persona.personality) {
      lines.push(`Personality: ${persona.personality}`);
    }
    lines.push(`Always respond in ${persona.language}.`);
    lines.push(
      'You help customers find and buy products. Use the available commerce tools ' +
        '(search_products, get_product, add_to_cart, start_checkout) to look up the ' +
        'catalog, manage the cart, and start checkout. Ground every product detail ' +
        '(name, price, availability) in the tool results and never invent products, ' +
        'prices, or stock that the tools did not return.',
    );
    lines.push(
      'When a customer wants to buy, add the product to the cart and, when they are ' +
        'ready, start the checkout and share the checkout URL. Be helpful and ' +
        'concise (1-3 short paragraphs).',
    );
    return lines.join('\n');
  }

  lines.push(`You are the AI persona for ${persona.siteName ?? 'a website'}.`);
  if (persona.siteDescription) {
    lines.push(`About the site: ${persona.siteDescription}`);
  }
  if (persona.personality) {
    lines.push(`Personality: ${persona.personality}`);
  }
  lines.push(`Always respond in ${persona.language}.`);
  lines.push(
    "You can look up the site's own content using the available tools " +
      '(search_posts, get_post). Use them when the user asks about the site, ' +
      'its products, or its articles. Ground your answers in the tool results ' +
      'and never invent content the tools did not return.',
  );
  lines.push('Keep replies concise and conversational (1-3 short paragraphs).');
  return lines.join('\n');
}
