import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  AiProviderError,
  type AiProvider,
  type ProviderRequest,
  type ProviderResult,
  type TokenUsage,
} from './types';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AnthropicProviderOptions {
  /** Read from ANTHROPIC_API_KEY when omitted. Only the worker ever holds it. */
  apiKey?: string;
  model: string;
  effort: Effort;
  timeoutMs?: number;
}

/**
 * Claude through the Anthropic API. Requests go over HTTPS and carry only the
 * de-identified prompt: no user, school or account identifiers.
 */
export function createAnthropicProvider(options: AnthropicProviderOptions): AiProvider {
  const client = new Anthropic({
    ...(options.apiKey ? { apiKey: options.apiKey } : {}),
    maxRetries: 2,
    timeout: options.timeoutMs ?? 180_000,
  });
  // Haiku 4.5 does not accept an effort level; current Opus and Sonnet models do.
  const supportsEffort = !options.model.startsWith('claude-haiku');

  return {
    name: 'anthropic',
    model: options.model,
    async generate<T>(request: ProviderRequest<T>): Promise<ProviderResult<T>> {
      let response: Anthropic.Message;
      try {
        response = await client.messages.create({
          model: options.model,
          max_tokens: request.maxTokens,
          system: request.system,
          messages: [{ role: 'user', content: request.user }],
          output_config: {
            ...(supportsEffort ? { effort: options.effort } : {}),
            format: zodOutputFormat(request.schema),
          },
        });
      } catch (error) {
        throw toProviderError(error);
      }

      const usage: TokenUsage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
      };
      const base = { model: response.model, requestId: response.id, usage };
      const stopReason = response.stop_reason ?? 'unknown';
      if (stopReason !== 'end_turn') return { ...base, output: null, stopReason };

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return { ...base, output: null, stopReason: 'invalid_json' };
      }
      const parsed = request.schema.safeParse(json);
      return parsed.success
        ? { ...base, output: parsed.data, stopReason }
        : { ...base, output: null, stopReason: 'invalid_schema' };
    },
  };
}

function toProviderError(error: unknown): AiProviderError {
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return new AiProviderError('aiConfig', 'the AI provider rejected the API key');
  }
  if (error instanceof Anthropic.NotFoundError) {
    return new AiProviderError('aiConfig', 'the AI model was not found');
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AiProviderError('aiRateLimited', 'the AI provider is rate limiting requests');
  }
  if (
    error instanceof Anthropic.BadRequestError ||
    error instanceof Anthropic.UnprocessableEntityError
  ) {
    return new AiProviderError('aiError', `the AI provider refused the request: ${error.message}`);
  }
  if (
    error instanceof Anthropic.APIConnectionError ||
    error instanceof Anthropic.InternalServerError
  ) {
    return new AiProviderError('aiUnavailable', 'the AI provider is unavailable');
  }
  if (error instanceof Anthropic.APIError) {
    return new AiProviderError('aiError', `AI provider error ${String(error.status)}`);
  }
  return new AiProviderError('aiError', error instanceof Error ? error.message : String(error));
}

/**
 * A provider that never leaves the machine: answers come from each feature's `fake()`.
 * Used in tests, CI, demos and development without an API key.
 */
export function createFakeProvider(options: { delayMs?: number } = {}): AiProvider {
  return {
    name: 'fake',
    model: 'fake',
    async generate<T>(request: ProviderRequest<T>): Promise<ProviderResult<T>> {
      if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs));
      const output = request.schema.parse(request.fake());
      const outputText = JSON.stringify(output);
      return {
        output,
        stopReason: 'end_turn',
        model: 'fake',
        requestId: null,
        // Roughly four characters per token, so usage and costs look realistic.
        usage: {
          inputTokens: Math.ceil((request.system.length + request.user.length) / 4),
          outputTokens: Math.ceil(outputText.length / 4),
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      };
    },
  };
}
