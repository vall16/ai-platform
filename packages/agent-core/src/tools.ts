import type { ToolCall, ToolDefinition } from '@ai-platform/contracts';
import type { ContentToolProvider } from './types.js';

/** Tool definitions advertised to the LLM. */
export const CONTENT_TOOLS: ToolDefinition[] = [
  {
    name: 'search_posts',
    description: "Search the website's posts and articles by keyword.",
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search keywords.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_post',
    description: 'Fetch the full content of a specific post by its id.',
    parameters: {
      type: 'object',
      properties: {
        post_id: { type: 'string', description: 'The post id.' },
      },
      required: ['post_id'],
    },
  },
];

/**
 * Execute a single tool call against the content bridge.
 * Returns a JSON string to feed back to the LLM as a tool result.
 */
export async function executeContentTool(
  content: ContentToolProvider,
  call: ToolCall,
): Promise<string> {
  const args: Record<string, unknown> = call.arguments ?? {};

  switch (call.name) {
    case 'search_posts': {
      const query = String(args.query ?? '');
      const result = await content.searchPosts(query);
      return JSON.stringify(result.posts);
    }
    case 'get_post': {
      const postId = String(args.post_id ?? '');
      const post = await content.getPost(postId);
      return JSON.stringify(post ?? { error: 'not_found' });
    }
    default:
      return JSON.stringify({ error: `unknown_tool: ${call.name}` });
  }
}
