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
