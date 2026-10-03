import type { z } from 'zod';
import type { BlockedFinding, Redactor } from './privacy';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export const emptyUsage = (): TokenUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

export interface ProviderRequest<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens: number;
  /** Deterministic answer for the fake provider (tests, demos, CI). */
  fake: () => T;
  /** Aborts the call when the request's time is up (see RunOptions.timeoutMs). */
  signal?: AbortSignal;
}

export interface ProviderResult<T> {
  /** Null when the answer was refused, cut off or did not match the schema. */
  output: T | null;
  /** 'end_turn', 'refusal', 'max_tokens', 'invalid_json', ... */
  stopReason: string;
  model: string;
  requestId: string | null;
  usage: TokenUsage;
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  generate<T>(request: ProviderRequest<T>): Promise<ProviderResult<T>>;
  /**
   * The Message Batches API (bulk generation, DECISIONS D-098), when the provider has it. Its
   * requests are prepared and their answers checked by the same code as `generate`'s
   * (`prepareCall` and `checkOutput` in run.ts).
   */
  readonly batch?: AiBatchProvider;
}

/** One request of a batch, as `prepareCall` built it (already de-identified and checked). */
export interface BatchItem {
  /** The request's id (`library_bulk_requests.id`, a uuid): nothing else identifies it. */
  customId: string;
  system: string;
  user: string;
  schema: z.ZodType<unknown>;
  maxTokens: number;
  /** Deterministic answer for the fake provider (tests, demos, CI). */
  fake: () => unknown;
}

/** A batch's processing state, as the provider reports it. */
export interface BatchStatus {
  state: 'in_progress' | 'canceling' | 'ended';
}

/**
 * One answer of an ended batch. On failure `output` is null and `stopReason` says why: the
 * reasons of a streamed call (`refusal`, `max_tokens`, `invalid_json`, `invalid_schema`…), or
 * `batch_invalid_request`, `batch_server_error`, `batch_expired` and `batch_canceled`.
 */
export interface BatchItemResult extends ProviderResult<unknown> {
  customId: string;
}

/**
 * Bulk requests through the provider's batch API (D-095 to D-098): one batch per bulk run,
 * submitted once and never retried, read when it has ended, then deleted from the provider.
 */
export interface AiBatchProvider {
  /** Input tokens of one request exactly as `submit` would send it (free to ask). */
  countInputTokens(item: BatchItem): Promise<number>;
  /** Sends every item as one batch. Never retried: a failure may still have created it. */
  submit(items: readonly BatchItem[]): Promise<{ batchId: string }>;
  status(batchId: string): Promise<BatchStatus>;
  /**
   * The answers of an ended batch, for the requests in `pending` (by `customId`; other ids are
   * ignored), each checked against its item's schema. In any order.
   */
  results(batchId: string, pending: ReadonlyMap<string, BatchItem>): AsyncIterable<BatchItemResult>;
  /** Asks the provider to stop; requests already answered are still billed. A 404 is ignored. */
  cancel(batchId: string): Promise<void>;
  /** Deletes the batch and its results at the provider (only once it has ended). A 404 is ignored. */
  remove(batchId: string): Promise<void>;
}

/** Error codes shown to staff; translated in the web app under `ai.errors`. */
export type AiErrorCode =
  | 'invalidInput'
  | 'personalInfo'
  | 'aiUnavailable'
  | 'aiConfig'
  | 'aiRateLimited'
  | 'aiRefused'
  | 'aiTooLong'
  | 'invalidOutput'
  | 'timeout'
  | 'aiError';

export class AiProviderError extends Error {
  /** The provider's id for the failed request, for support and billing reconciliation. */
  readonly requestId: string | null;
  /** Tokens the provider reported before the call failed: a broken stream is still billed. */
  readonly usage: TokenUsage | null;

  constructor(
    readonly code: AiErrorCode,
    message: string,
    details: { requestId?: string | null; usage?: TokenUsage | null } = {},
  ) {
    super(message);
    this.name = 'AiProviderError';
    this.requestId = details.requestId ?? null;
    this.usage = details.usage ?? null;
  }
}

/** One AI feature: its input, prompt, output schema and checks. */
export interface FeatureDefinition<I, O> {
  name: string;
  promptVersion: string;
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  maxTokens: number;
  /**
   * De-identifies every free-text field of the input with the request's redactor. A personal
   * detail in `blocked` refuses the whole request. A feature may instead leave a field out (sent
   * empty) and list its path in `dropped`: paths only, never content, since they are logged.
   */
  redactInput(
    input: I,
    redactor: Redactor,
  ): { input: I; blocked: BlockedFinding[]; dropped?: string[] };
  buildUserMessage(input: I): string;
  /**
   * The feature's own part of the last check before sending (D-139): findings in the message
   * (de-identified, as it would be sent) refuse the request (`personalInfo`), as
   * `assertSafeOutbound`'s do. « Traduire en anglais (IA) » refuses a title before a name the app
   * does not know there.
   */
  outboundFindings?(message: string): BlockedFinding[];
  /** Problems with an answer that matched the schema (missing levels, empty text...). */
  validate(output: O, input: I): string[];
  /** A plausible answer without calling a model, built from the de-identified input. */
  fake(input: I): O;
  /**
   * The output schema for this input (D-080), when it depends on it: a library resource's
   * schema is its type's. Defaults to `outputSchema`, which then only types the answer.
   */
  outputSchemaFor?(input: I): z.ZodType<O>;
  /**
   * Fixes the form of an answer for free before it is validated (D-080): canonical shapes,
   * typography, ordering left in answer order. Pure, and must never throw; what it cannot fix is
   * left for `validate`, which reports it (and the answer is retried).
   */
  normalize?(output: O, input: I): O;
  /**
   * The system prompt for this input: e.g. the prompt file's common part plus only the section
   * for the requested type (`selectPromptSections`). Defaults to the whole file.
   */
  systemPrompt?(prompt: string, input: I): string;
}
