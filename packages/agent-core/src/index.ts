// @ai-platform/agent-core — the shared conversation engine (persona + salesperson).

export type {
  AgentPersona,
  AgentAudio,
  MessageResult,
  CommerceAttribution,
  AvatarResult,
  ContentPost,
  ContentSearchResult,
  ContentToolProvider,
  ShopContext,
  CommerceToolProvider,
  AgentDependencies,
  AgentSessionState,
} from './types.js';

export { AgentCore } from './core.js';
export { SessionMemory } from './memory.js';
export { buildSystemPrompt } from './prompt.js';
export { CONTENT_TOOLS, executeContentTool } from './tools.js';
export { COMMERCE_TOOLS, executeCommerceTool } from './commerce-tools.js';
