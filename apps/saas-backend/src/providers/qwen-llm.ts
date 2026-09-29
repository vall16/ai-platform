// Qwen LLM Provider — connects to Alibaba Cloud DashScope (OpenAI-compatible mode).
//
// Env:
//   DASHSCOPE_API_KEY  — API key from https://dashscope.console.aliyun.com
//   QWEN_MODEL         — model id (default: qwen-plus)
//   QWEN_BASE_URL      — override base URL (default: https://dashscope.aliyuncs.com/compatible-mode/v1)

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

export class QwenLLMProvider implements LLMProvider {
  readonly id = 'qwen-1';
  readonly name = 'qwen';
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;

  constructor(opts: { apiKey: string; baseUrl?: string; model?: string }) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    this.defaultModel = opts.model ?? 'qwen-plus';
  }

  async complete(ctx: ProviderContext, req: LLMRequest): Promise<ProviderResult<LLMResponse>> {
    const start = Date.now();
    const body: Record<string, unknown> = {
      model: req.model ?? this.defaultModel,
      messages: req.messages,
      temperature: req.temperature ?? 0.7,
      max_tokens: req.maxTokens ?? 2048,
    };
    if (req.stop) body.stop = req.stop;
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Qwen API ${res.status}: ${text}`);
    }

    const data = await res.json();
    const choice = data.choices[0];
    const msg = choice.message;

    return {
      data: {
        content: msg.content ?? '',
        toolCalls: msg.tool_calls?.map((tc: { id: string; function: { name: string; arguments: string } }) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments),
        })),
        finishReason: choice.finish_reason as LLMResponse['finishReason'],
        model: data.model,
      },
      cost: { costMicroUsd: 0 },
      usage: {
        durationMs: Date.now() - start,
        tokensIn: data.usage?.prompt_tokens,
        tokensOut: data.usage?.completion_tokens,
      },
      providerId: this.id,
      completedAt: new Date().toISOString(),
    };
  }

  async *stream(ctx: ProviderContext, req: LLMRequest): AsyncIterable<LLMChunk> {
    const body: Record<string, unknown> = {
      model: req.model ?? this.defaultModel,
      messages: req.messages,
      temperature: req.temperature ?? 0.7,
      max_tokens: req.maxTokens ?? 2048,
      stream: true,
    };
    if (req.stop) body.stop = req.stop;

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Qwen API ${res.status}: ${text}`);
    }

    const reader = res.body?.getReader();
    if (!reader) return;

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
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') return;

        try {
          const chunk = JSON.parse(payload);
          const delta = chunk.choices?.[0]?.delta?.content;
          const finishReason = chunk.choices?.[0]?.finish_reason;
          if (delta) yield { delta };
          if (finishReason) yield { delta: '', finishReason: finishReason as LLMChunk['finishReason'] };
        } catch {
          // skip malformed lines
        }
      }
    }
  }

  async getHealth(_ctx: ProviderContext): Promise<HealthStatus> {
    try {
      const start = Date.now();
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      const latency = Date.now() - start;
      return {
        status: res.ok ? 'healthy' : 'degraded',
        latency_ms: latency,
        checked_at: new Date().toISOString(),
        detail: res.ok ? undefined : `HTTP ${res.status}`,
      };
    } catch (e) {
      return { status: 'unhealthy', latency_ms: 0, checked_at: new Date().toISOString(), detail: String(e) };
    }
  }

  async getCapabilities(): Promise<Capabilities> {
    return { streaming: true, functionCalling: true, maxContextTokens: 131072 };
  }

  async shutdown() {
    // No persistent connections to clean up.
  }
}
