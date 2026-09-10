// LLMProvider — language model inference.

import type { Provider } from './provider.js';
import type { ProviderContext, ProviderResult } from './types.js';

/** A chat message. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Tool call results (role=tool only). */
  toolCallId?: string;
  /** Name of the tool (role=tool only). */
  toolName?: string;
}

/** Tool/function definition for function calling. */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool parameters. */
  parameters: Record<string, unknown>;
}

/** LLM request. */
export interface LLMRequest {
  messages: ChatMessage[];
  /** Available tools for function calling. */
  tools?: ToolDefinition[];
  /** Sampling temperature. */
  temperature?: number;
  /** Max tokens to generate. */
  maxTokens?: number;
  /** Stop sequences. */
  stop?: string[];
  /** Model identifier (provider-specific). */
  model?: string;
}

/** A tool call requested by the LLM. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** LLM response. */
export interface LLMResponse {
  content: string;
  /** Tool calls requested by the model. */
  toolCalls?: ToolCall[];
  /** Finish reason. */
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  /** Model that actually served the request. */
  model: string;
}

/** A chunk in a streaming response. */
export interface LLMChunk {
  /** Delta text content. */
  delta: string;
  /** Tool call delta (partial). */
  toolCallDelta?: Partial<ToolCall>;
  /** Present on the final chunk. */
  finishReason?: LLMResponse['finishReason'];
}

/**
 * Provider for LLM inference.
 * Implementations: OpenAI, Anthropic, Mistral, self-hosted, etc.
 */
export interface LLMProvider extends Provider {
  /** Single-shot completion. */
  complete(ctx: ProviderContext, request: LLMRequest): Promise<ProviderResult<LLMResponse>>;

  /** Streaming completion. Yields chunks as they arrive. */
  stream(ctx: ProviderContext, request: LLMRequest): AsyncIterable<LLMChunk>;
}
