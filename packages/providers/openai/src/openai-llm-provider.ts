// OpenAILLMProvider — adapter for OpenAI's chat completions API.

import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMChunk,
  ChatMessage,
  ToolDefinition,
  ToolCall,
  ProviderContext,
  ProviderResult,
  HealthStatus,
  Capabilities,
} from '@ai-platform/contracts';

export interface OpenAIConfig {
  /** OpenAI API key. */
  apiKey: string;
  /** Base URL (default: https://api.openai.com/v1). */
  baseUrl?: string;
  /** Default model (default: gpt-4o). */
  defaultModel?: string;
  /** Cost per 1K input tokens in microdollars. */
  costPer1KInputTokens?: number;
  /** Cost per 1K output tokens in microdollars. */
  costPer1KOutputTokens?: number;
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o';
const DEFAULT_COST_INPUT = 250_000; // $0.25 per 1K tokens
const DEFAULT_COST_OUTPUT = 1_000_000; // $1.00 per 1K tokens

export class OpenAILLMProvider implements LLMProvider {
  readonly id: string;
  readonly name = 'openai';

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly defaultModel: string;
  private readonly costInput: number;
  private readonly costOutput: number;
  private lastLatencyMs = 0;

  constructor(config: OpenAIConfig, id?: string) {
    this.id = id ?? `openai-${config.apiKey.slice(0, 8)}`;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.apiKey = config.apiKey;
    this.defaultModel = config.defaultModel ?? DEFAULT_MODEL;
    this.costInput = config.costPer1KInputTokens ?? DEFAULT_COST_INPUT;
    this.costOutput = config.costPer1KOutputTokens ?? DEFAULT_COST_OUTPUT;
  }

  async getHealth(_ctx: ProviderContext): Promise<HealthStatus> {
    const start = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      this.lastLatencyMs = Date.now() - start;

      if (!res.ok) {
        return {
          status: 'degraded',
          latencyMs: this.lastLatencyMs,
          checkedAt: new Date().toISOString(),
          detail: `HTTP ${res.status}`,
        };
      }

      return {
        status: 'healthy',
        latencyMs: this.lastLatencyMs,
        checkedAt: new Date().toISOString(),
      };
    } catch (err) {
      this.lastLatencyMs = Date.now() - start;
      return {
        status: 'unhealthy',
        latencyMs: this.lastLatencyMs,
        checkedAt: new Date().toISOString(),
        detail: err instanceof Error ? err.message : 'unknown error',
      };
    }
  }

  async getCapabilities(): Promise<Capabilities> {
    return {
      streaming: true,
      languages: ['en', 'it', 'es', 'fr', 'de', 'ja', 'ko', 'zh'],
      maxConcurrentSessions: 500,
      features: {
        'function-calling': true,
        'json-mode': true,
        'vision': true,
      },
    };
  }

  async shutdown(): Promise<void> {}

  async complete(ctx: ProviderContext, request: LLMRequest): Promise<ProviderResult<LLMResponse>> {
    const start = Date.now();
    const model = request.model ?? this.defaultModel;

    const body: Record<string, unknown> = {
      model,
      messages: this.mapMessages(request.messages),
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 1024,
    };

    if (request.stop) body.stop = request.stop;
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new OpenAIError(`Completion failed: HTTP ${res.status} — ${errBody}`, res.status);
    }

    const data = await res.json() as {
      id: string;
      model: string;
      choices: Array<{
        message: { role: string; content: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> };
        finish_reason: string;
      }>;
      usage: { prompt_tokens: number; completion_tokens: number };
    };

    const choice = data.choices[0];
    const durationMs = Date.now() - start;

    const toolCalls: ToolCall[] | undefined = choice.message.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments),
    }));

    const inputTokens = data.usage.prompt_tokens;
    const outputTokens = data.usage.completion_tokens;

    return {
      data: {
        content: choice.message.content ?? '',
        toolCalls,
        finishReason: this.mapFinishReason(choice.finish_reason),
        model: data.model,
      },
      cost: {
        costMicroUsd: Math.ceil((inputTokens / 1000) * this.costInput + (outputTokens / 1000) * this.costOutput),
        breakdown: {
          input: Math.ceil((inputTokens / 1000) * this.costInput),
          output: Math.ceil((outputTokens / 1000) * this.costOutput),
        },
      },
      usage: { durationMs, tokensIn: inputTokens, tokensOut: outputTokens },
      providerId: this.id,
      completedAt: new Date().toISOString(),
    };
  }

  async *stream(ctx: ProviderContext, request: LLMRequest): AsyncIterable<LLMChunk> {
    const model = request.model ?? this.defaultModel;

    const body: Record<string, unknown> = {
      model,
      messages: this.mapMessages(request.messages),
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 1024,
      stream: true,
    };

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new OpenAIError(`Stream failed: HTTP ${res.status}`, res.status);
    }

    if (!res.body) {
      throw new OpenAIError('No response body for stream', 500);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const payload = trimmed.slice(6);
        if (payload === '[DONE]') return;

        try {
          const chunk = JSON.parse(payload) as {
            choices: Array<{
              delta: { content?: string; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> };
              finish_reason: string | null;
            }>;
          };

          const delta = chunk.choices[0]?.delta;
          if (delta?.content) {
            yield { delta: delta.content };
          }
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              yield {
                delta: '',
                toolCallDelta: {
                  id: tc.id,
                  name: tc.function?.name,
                  arguments: tc.function?.arguments ? JSON.parse(tc.function.arguments) : undefined,
                },
              };
            }
          }
          if (chunk.choices[0]?.finish_reason) {
            yield { delta: '', finishReason: this.mapFinishReason(chunk.choices[0].finish_reason) };
          }
        } catch {
          // Skip malformed chunks.
        }
      }
    }
  }

  // --- Private helpers ---

  private mapMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
    return messages.map((m) => {
      const base: Record<string, unknown> = { role: m.role, content: m.content };
      if (m.role === 'tool' && m.toolCallId) {
        base.tool_call_id = m.toolCallId;
      }
      return base;
    });
  }

  private mapFinishReason(reason: string): LLMResponse['finishReason'] {
    const map: Record<string, LLMResponse['finishReason']> = {
      stop: 'stop',
      length: 'length',
      tool_calls: 'tool_calls',
      function_call: 'tool_calls',
      content_filter: 'content_filter',
    };
    return map[reason] ?? 'stop';
  }
}

export class OpenAIError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'OpenAIError';
  }
}
