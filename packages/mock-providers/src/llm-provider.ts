// MockLLMProvider — deterministic LLM responses for local development.

import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMChunk,
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
    const content = this.generateResponse(request);
    const tokensOut = Math.ceil(content.length / 4);

    return {
      data: {
        content,
        finishReason: 'stop',
        model: 'mock-llm-v1',
      },
      cost: { costMicroUsd: tokensOut * this.costPerToken },
      usage: { durationMs: this.latencyMs, tokensIn: this.countInputTokens(request), tokensOut },
      providerId: this.id,
      completedAt: new Date().toISOString(),
    };
  }

  async *stream(ctx: ProviderContext, request: LLMRequest): AsyncIterable<LLMChunk> {
    const content = this.generateResponse(request);
    const words = content.split(' ');

    for (const word of words) {
      yield { delta: word + ' ' };
      await this.delay(10);
    }

    yield { delta: '', finishReason: 'stop' };
  }

  private generateResponse(request: LLMRequest): string {
    const lastUserMsg = [...request.messages].reverse().find((m) => m.role === 'user');
    const input = lastUserMsg?.content ?? '';

    if (request.tools && request.tools.length > 0) {
      return JSON.stringify({ tool_call: request.tools[0].name, args: { query: input } });
    }

    return `[mock-llm] You said: "${input.slice(0, 100)}". This is a deterministic mock response for development.`;
  }

  private countInputTokens(request: LLMRequest): number {
    return request.messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
