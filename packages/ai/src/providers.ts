import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
import {
  AiProviderError,
  emptyUsage,
  type AiBatchProvider,
  type AiErrorCode,
  type AiProvider,
  type BatchItem,
  type BatchItemResult,
  type ProviderRequest,
  type ProviderResult,
  type TokenUsage,
} from './types';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** The longest one call may take when the caller sets no limit. */
export const DEFAULT_CALL_TIMEOUT_MS = 10 * 60_000;

/**
 * For a call abandoned before the API counted its output (see abandonedUsage): an output speed
 * and a number of characters per token, both chosen so that the estimate errs on the high side.
 */
const ABANDONED_OUTPUT_TOKENS_PER_SECOND = 100;
const ABANDONED_CHARS_PER_TOKEN = 3;

export interface AnthropicProviderOptions {
  /** Read from ANTHROPIC_API_KEY when omitted. Only the worker ever holds it. */
  apiKey?: string;
  model: string;
  effort: Effort;
  /** The longest one call may take, whole answer included. */
  timeoutMs?: number;
  /** For tests: replaces the network, so nothing leaves the machine. */
  fetch?: typeof globalThis.fetch;
}

/**
 * Claude through the Anthropic API. Requests go over HTTPS and carry only the
 * de-identified prompt: no user, school or account identifiers.
 *
 * Answers are streamed: a long answer (adaptive thinking plus one version per level) can take
 * several minutes, longer than the SDK allows for a single non-streamed request.
 */
export function createAnthropicProvider(options: AnthropicProviderOptions): AiProvider {
  const client = new Anthropic({
    ...(options.apiKey ? { apiKey: options.apiKey } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
    // The SDK retries connection errors, 429 and 5xx only until the answer starts streaming,
    // when nothing has been generated yet. A stream that breaks or runs out of time is never
    // sent again: that would pay for the same long answer twice.
    maxRetries: 2,
  });
  // Haiku 4.5 does not accept an effort level; current Opus and Sonnet models do.
  const supportsEffort = !options.model.startsWith('claude-haiku');
  const timeoutMs = options.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;

  return {
    name: 'anthropic',
    model: options.model,
    async generate<T>(request: ProviderRequest<T>): Promise<ProviderResult<T>> {
      const deadline = AbortSignal.timeout(timeoutMs);
      // Only the JSON schema is sent. With the SDK's parser attached, the stream would throw
      // on a cut-off or invalid answer instead of reporting it, and the runner could no
      // longer tell a refusal from an answer worth retrying.
      const { type, schema } = zodOutputFormat(request.schema);
      const stream = client.messages.stream(
        {
          model: options.model,
          max_tokens: request.maxTokens,
          system: request.system,
          messages: [{ role: 'user', content: request.user }],
          output_config: {
            ...(supportsEffort ? { effort: options.effort } : {}),
            format: { type, schema },
          },
        },
        { signal: request.signal ? AbortSignal.any([deadline, request.signal]) : deadline },
      );
      // When the answer started: generation time counts for a call abandoned mid-answer.
      let startedAt: number | null = null;
      stream.on('streamEvent', (event) => {
        if (event.type === 'message_start') startedAt = Date.now();
      });
      let response: Anthropic.Message;
      try {
        response = await stream.finalMessage();
      } catch (error) {
        const partial = stream.currentMessage;
        throw toProviderError(error, {
          requestId: stream.request_id ?? partial?.id ?? null,
          usage: partial ? abandonedUsage(partial, startedAt, request.maxTokens) : null,
        });
      }

      const base = {
        model: response.model,
        // The API's request id (req_…) is what Anthropic support and the console logs use.
        requestId: stream.request_id ?? response.id,
        usage: toUsage(response.usage),
      };
      return { ...base, ...parseMessage(response, request.schema) };
    },
    batch: createAnthropicBatch(client, options.model, supportsEffort ? options.effort : null),
  };
}

/**
 * The answer of a finished message, checked against the schema: null with the reason when it was
 * refused, cut off (`max_tokens`), not JSON (`invalid_json`) or not the schema's shape
 * (`invalid_schema`). Shared by streamed calls and batch results.
 */
export function parseMessage<T>(
  message: Anthropic.Message,
  schema: z.ZodType<T>,
): { output: T | null; stopReason: string } {
  const stopReason = message.stop_reason ?? 'unknown';
  if (stopReason !== 'end_turn') return { output: null, stopReason };
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { output: null, stopReason: 'invalid_json' };
  }
  const parsed = schema.safeParse(json);
  return parsed.success
    ? { output: parsed.data, stopReason }
    : { output: null, stopReason: 'invalid_schema' };
}

/**
 * The Message Batches API (DECISIONS D-095 to D-098): the same request as a streamed call (model,
 * `max_tokens`, effort, the JSON schema of the output), with the system prompt marked for caching
 * (best effort inside a batch: requests of one type share it). Every token costs half.
 *
 * A batch is created once: the SDK's automatic retries are off for `create`, since a retry after
 * a lost answer would create (and bill) a second batch. Its other calls only read, cancel or
 * delete, and are retried as usual.
 */
function createAnthropicBatch(
  client: Anthropic,
  model: string,
  effort: Effort | null,
): AiBatchProvider {
  const params = (item: BatchItem): Anthropic.MessageCreateParamsNonStreaming => {
    const { type, schema } = zodOutputFormat(item.schema);
    return {
      model,
      max_tokens: item.maxTokens,
      system: [{ type: 'text', text: item.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: item.user }],
      output_config: { ...(effort ? { effort } : {}), format: { type, schema } },
    };
  };
  const call = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      throw toProviderError(error, { requestId: null, usage: null });
    }
  };
  // Cancelling or deleting a batch that is already gone is not an error.
  const unlessGone = async (run: () => Promise<unknown>): Promise<void> => {
    try {
      await run();
    } catch (error) {
      if (error instanceof Anthropic.NotFoundError) return;
      throw toProviderError(error, { requestId: null, usage: null });
    }
  };

  return {
    async countInputTokens(item) {
      const p = params(item);
      const counted = await call(() =>
        client.messages.countTokens({
          model: p.model,
          system: p.system,
          messages: p.messages,
          ...(p.output_config ? { output_config: p.output_config } : {}),
        }),
      );
      return counted.input_tokens;
    },
    async submit(items) {
      const batch = await call(() =>
        client.messages.batches.create(
          { requests: items.map((item) => ({ custom_id: item.customId, params: params(item) })) },
          { maxRetries: 0 },
        ),
      );
      return { batchId: batch.id };
    },
    async status(batchId) {
      const batch = await call(() => client.messages.batches.retrieve(batchId));
      return { state: batch.processing_status };
    },
    async *results(batchId, pending) {
      const lines = await call(() => client.messages.batches.results(batchId));
      for await (const line of lines) {
        const item = pending.get(line.custom_id);
        if (item) yield batchResult(line, item, model);
      }
    },
    async cancel(batchId) {
      await unlessGone(() => client.messages.batches.cancel(batchId));
    },
    async remove(batchId) {
      await unlessGone(() => client.messages.batches.delete(batchId));
    },
  };
}

/** One line of a batch's results, as the runner reads a streamed call's answer. */
function batchResult(
  line: Anthropic.Messages.MessageBatchIndividualResponse,
  item: BatchItem,
  model: string,
): BatchItemResult {
  const failed = (stopReason: string, requestId: string | null = null): BatchItemResult => ({
    customId: line.custom_id,
    output: null,
    stopReason,
    model,
    requestId,
    usage: emptyUsage(),
  });
  switch (line.result.type) {
    case 'succeeded': {
      const message = line.result.message;
      return {
        customId: line.custom_id,
        ...parseMessage(message, item.schema),
        model: message.model,
        requestId: message.id,
        usage: toUsage(message.usage),
      };
    }
    case 'errored':
      // A request the API refused (a bad schema, too long) is never worth sending again as is.
      return failed(
        line.result.error.error.type === 'invalid_request_error'
          ? 'batch_invalid_request'
          : 'batch_server_error',
        line.result.error.request_id ?? null,
      );
    case 'expired':
      return failed('batch_expired');
    case 'canceled':
      return failed('batch_canceled');
    default:
      return failed('batch_server_error');
  }
}

function toUsage(usage: Anthropic.Usage): TokenUsage {
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

/**
 * Usage of a call that broke or was abandoned mid-answer, which is billed all the same. The API
 * counts output tokens only at the end of the answer (message_delta): before that, the stream
 * reports about one. So unless the count arrived, output is estimated as the larger of the text
 * received and the time spent generating (thinking is billed but not streamed by default), within
 * max_tokens.
 */
function abandonedUsage(
  message: Anthropic.Message,
  startedAt: number | null,
  maxTokens: number,
): TokenUsage {
  const usage = toUsage(message.usage);
  if (message.stop_reason !== null) return usage;
  let chars = 0;
  for (const block of message.content) {
    if (block.type === 'text') chars += block.text.length;
    else if (block.type === 'thinking') chars += block.thinking.length;
  }
  const seconds = startedAt === null ? 0 : (Date.now() - startedAt) / 1000;
  const estimate = Math.max(
    Math.ceil(chars / ABANDONED_CHARS_PER_TOKEN),
    Math.ceil(seconds * ABANDONED_OUTPUT_TOKENS_PER_SECOND),
  );
  return {
    ...usage,
    outputTokens: Math.max(usage.outputTokens, Math.min(estimate, maxTokens)),
  };
}

/** Error types the API sends inside a stream that has already started. */
const STREAM_ERRORS: Partial<Record<string, AiErrorCode>> = {
  overloaded_error: 'aiUnavailable',
  api_error: 'aiUnavailable',
  rate_limit_error: 'aiRateLimited',
  timeout_error: 'timeout',
};

function toProviderError(
  error: unknown,
  details: { requestId: string | null; usage: TokenUsage | null },
): AiProviderError {
  const make = (code: AiErrorCode, message: string) =>
    new AiProviderError(code, message, {
      requestId:
        error instanceof Anthropic.APIError
          ? (error.requestID ?? details.requestId)
          : details.requestId,
      usage: details.usage,
    });
  // Our own deadline (or the caller's) aborts the call; the SDK's timeout covers the time
  // until the answer starts. Both are checked before the generic connection error.
  if (
    error instanceof Anthropic.APIUserAbortError ||
    error instanceof Anthropic.APIConnectionTimeoutError
  ) {
    return make('timeout', 'the AI provider took too long to answer');
  }
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return make('aiConfig', 'the AI provider rejected the API key');
  }
  if (error instanceof Anthropic.NotFoundError) {
    return make('aiConfig', 'the AI model was not found');
  }
  if (error instanceof Anthropic.RateLimitError) {
    return make('aiRateLimited', 'the AI provider is rate limiting requests');
  }
  if (
    error instanceof Anthropic.BadRequestError ||
    error instanceof Anthropic.UnprocessableEntityError
  ) {
    return make('aiError', `the AI provider refused the request: ${error.message}`);
  }
  if (
    error instanceof Anthropic.APIConnectionError ||
    error instanceof Anthropic.InternalServerError
  ) {
    return make('aiUnavailable', 'the AI provider is unavailable');
  }
  if (error instanceof Anthropic.APIError) {
    const code = (error.type && STREAM_ERRORS[error.type]) || 'aiError';
    return make(code, `AI provider error ${error.type ?? String(error.status)}`);
  }
  return make('aiError', error instanceof Error ? error.message : String(error));
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
      if (request.signal?.aborted) {
        throw new AiProviderError('timeout', 'the AI provider took too long to answer');
      }
      const output = request.schema.parse(request.fake());
      return {
        output,
        stopReason: 'end_turn',
        model: 'fake',
        requestId: null,
        usage: fakeUsage(request, output),
      };
    },
    batch: fakeBatch,
  };
}

/** Roughly four characters per token, so usage and costs look realistic. */
function fakeUsage(request: { system: string; user: string }, output: unknown): TokenUsage {
  return {
    inputTokens: Math.ceil((request.system.length + request.user.length) / 4),
    outputTokens: Math.ceil(JSON.stringify(output).length / 4),
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

/**
 * The fake provider's batches: counted as one token per four bytes (never fewer than `generate`
 * reports), ended as soon as they are sent, and answered with each item's `fake()`, with the same
 * usage as `generate`. Nothing is kept: `results` answers the pending items it is given.
 */
const fakeBatch: AiBatchProvider = {
  async countInputTokens(item) {
    const bytes = new TextEncoder().encode(item.system + item.user).length;
    return Math.ceil(bytes / 4);
  },
  async submit() {
    return { batchId: `fake-batch-${globalThis.crypto.randomUUID()}` };
  },
  async status() {
    return { state: 'ended' };
  },
  async *results(_batchId, pending) {
    for (const item of pending.values()) {
      let answer: unknown;
      try {
        answer = item.fake();
      } catch {
        yield {
          customId: item.customId,
          output: null,
          stopReason: 'batch_server_error',
          model: 'fake',
          requestId: null,
          usage: emptyUsage(),
        };
        continue;
      }
      const parsed = item.schema.safeParse(answer);
      yield {
        customId: item.customId,
        output: parsed.success ? parsed.data : null,
        stopReason: parsed.success ? 'end_turn' : 'invalid_schema',
        model: 'fake',
        requestId: null,
        usage: fakeUsage(item, answer),
      };
    }
  },
  async cancel() {},
  async remove() {},
};
