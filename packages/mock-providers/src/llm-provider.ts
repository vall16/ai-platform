// MockLLMProvider — deterministic LLM responses for local development.

import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMChunk,
  ToolCall,
  ProviderContext,
  ProviderResult,
  HealthStatus,
  Capabilities,
} from '@ai-platform/contracts';

export class MockLLMProvider implements LLMProvider {
  readonly id = 'mock-llm-1';
  readonly name = 'mock-llm';

  constructor(
    private readonly costPerToken = 50, // microdollars per token
    private readonly latencyMs = 200,
  ) {}

  async getHealth(_ctx: ProviderContext): Promise<HealthStatus> {
    return { status: 'healthy', latencyMs: this.latencyMs, checkedAt: new Date().toISOString() };
  }

  async getCapabilities(): Promise<Capabilities> {
    return {
      streaming: true,
      languages: ['en', 'it'],
      maxConcurrentSessions: 100,
      features: { 'function-calling': true },
    };
  }

  async shutdown(): Promise<void> {}

  async complete(ctx: ProviderContext, request: LLMRequest): Promise<ProviderResult<LLMResponse>> {
    const { content, toolCalls } = this.generateResponse(request);
    const hasTools = toolCalls && toolCalls.length > 0;
    const tokensOut = Math.ceil(content.length / 4);

    return {
      data: {
        content,
        toolCalls: hasTools ? toolCalls : undefined,
        finishReason: hasTools ? 'tool_calls' : 'stop',
        model: 'mock-llm-v1',
      },
      cost: { costMicroUsd: tokensOut * this.costPerToken },
      usage: { durationMs: this.latencyMs, tokensIn: this.countInputTokens(request), tokensOut },
      providerId: this.id,
      completedAt: new Date().toISOString(),
    };
  }

  async *stream(ctx: ProviderContext, request: LLMRequest): AsyncIterable<LLMChunk> {
    const { content } = this.generateResponse(request);
    const words = content.split(' ');

    for (const word of words) {
      yield { delta: word + ' ' };
      await this.delay(10);
    }

    yield { delta: '', finishReason: 'stop' };
  }

  /**
   * Deterministic tool-calling behavior:
   * - If tools are offered and no tool result is in the history yet, emit a
   *   single tool call (search_posts) for the user's input.
   * - Once a tool result is present, produce the final natural-language answer.
   */
  private generateResponse(request: LLMRequest): { content: string; toolCalls?: ToolCall[] } {
    const lastUserMsg = [...request.messages].reverse().find((m) => m.role === 'user');
    const input = lastUserMsg?.content ?? '';
    const hasToolResult = request.messages.some((m) => m.role === 'tool');

    if (request.tools && request.tools.length > 0 && !hasToolResult) {
      const tool = request.tools[0];
      return {
        content: '',
        toolCalls: [
          {
            id: `call_${Math.random().toString(36).slice(2, 10)}`,
            name: tool.name,
            arguments: { query: input },
          },
        ],
      };
    }

    return {
      content: `[mock-llm] You said: "${input.slice(0, 100)}". This is a deterministic mock response for development.`,
    };
  }

  private countInputTokens(request: LLMRequest): number {
    return request.messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
