import { PrivacyViolation, Redactor, type KnownPerson } from './privacy';
import { estimateCostUsd, type ModelPrice } from './pricing';
import {
  AiProviderError,
  emptyUsage,
  type AiErrorCode,
  type AiProvider,
  type FeatureDefinition,
  type TokenUsage,
} from './types';

export interface RunOptions<I, O> {
  feature: FeatureDefinition<I, O>;
  provider: AiProvider;
  price: ModelPrice;
  /** The system prompt for `feature.promptVersion` (see prompts.ts). */
  systemPrompt: string;
  /** Raw input from the request; validated here. */
  input: unknown;
  /**
   * Everyone whose name must not leave: students and staff of every school the requester
   * works in (never fewer people than the requester's preview used).
   */
  people: readonly KnownPerson[];
  maxAttempts?: number;
  /**
   * The longest the whole request may take, every attempt included. A call still running
   * then is abandoned (error 'timeout') and not retried.
   */
  timeoutMs?: number;
  now?: Date;
}

export interface RunResult<O> {
  status: 'succeeded' | 'failed' | 'invalid_output';
  errorCode: AiErrorCode | null;
  /** The answer with names put back. */
  output: O | null;
  /** Exactly what was sent (de-identified), or null if nothing was sent. */
  sentText: string | null;
  model: string;
  providerRequestIds: string[];
  attempts: number;
  usage: TokenUsage;
  costUsd: number;
  latencyMs: number;
  /** For logs only: never contains the input or the answer. */
  problems: string[];
}

function addUsage(total: TokenUsage, more: TokenUsage) {
  total.inputTokens += more.inputTokens;
  total.outputTokens += more.outputTokens;
  total.cacheReadTokens += more.cacheReadTokens;
  total.cacheWriteTokens += more.cacheWriteTokens;
}

/**
 * Runs one AI feature request end to end: validate, de-identify, check, call the provider
 * (retrying answers that fail validation), and put names back.
 */
export async function runFeature<I, O>(options: RunOptions<I, O>): Promise<RunResult<O>> {
  const { feature, provider } = options;
  const started = Date.now();
  const usage = emptyUsage();
  const requestIds: string[] = [];
  const result = (
    status: RunResult<O>['status'],
    errorCode: AiErrorCode | null,
    extra: Partial<RunResult<O>> = {},
  ): RunResult<O> => ({
    status,
    errorCode,
    output: null,
    sentText: null,
    model: provider.model,
    providerRequestIds: requestIds,
    attempts: 0,
    usage,
    costUsd: estimateCostUsd(usage, options.price),
    latencyMs: Date.now() - started,
    problems: [],
    ...extra,
  });

  const parsed = feature.inputSchema.safeParse(options.input);
  if (!parsed.success) return result('failed', 'invalidInput');

  const redactor = new Redactor(options.people, options.now);
  const { input, blocked } = feature.redactInput(parsed.data, redactor);
  if (blocked.length) {
    return result('failed', 'personalInfo', { problems: blocked.map((b) => `blocked ${b.kind}`) });
  }

  const user = feature.buildUserMessage(input);
  try {
    redactor.assertSafeOutbound(`${options.systemPrompt}\n${user}`);
  } catch (error) {
    if (error instanceof PrivacyViolation) {
      return result('failed', 'personalInfo', {
        problems: error.findings.map((f) => `outbound ${f.kind}`),
      });
    }
    throw error;
  }

  const maxAttempts = options.maxAttempts ?? 3;
  const signal =
    options.timeoutMs === undefined ? undefined : AbortSignal.timeout(options.timeoutMs);
  const problems: string[] = [];
  let model = provider.model;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) {
      return result('failed', 'timeout', {
        sentText: attempt > 1 ? user : null,
        attempts: attempt - 1,
        model,
        problems: [...problems, 'no time left for another attempt'],
      });
    }
    let response;
    try {
      response = await provider.generate({
        system: options.systemPrompt,
        user,
        schema: feature.outputSchema,
        maxTokens: feature.maxTokens,
        fake: () => feature.fake(input),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      // The call may have failed after the provider started (a broken or timed-out stream):
      // keep what it reported, since it is billed. Timeouts are not retried either.
      const code = error instanceof AiProviderError ? error.code : 'aiError';
      if (error instanceof AiProviderError) {
        if (error.usage) addUsage(usage, error.usage);
        if (error.requestId) requestIds.push(error.requestId);
      }
      return result('failed', code, {
        sentText: user,
        attempts: attempt,
        model,
        problems: [...problems, error instanceof Error ? error.message : String(error)],
      });
    }
    model = response.model;
    addUsage(usage, response.usage);
    if (response.requestId) requestIds.push(response.requestId);

    if (response.stopReason === 'refusal') {
      return result('failed', 'aiRefused', { sentText: user, attempts: attempt, model, problems });
    }
    if (
      response.stopReason === 'max_tokens' ||
      response.stopReason === 'model_context_window_exceeded'
    ) {
      return result('failed', 'aiTooLong', { sentText: user, attempts: attempt, model, problems });
    }
    if (!response.output) {
      problems.push(`attempt ${attempt}: ${response.stopReason}`);
      continue;
    }
    const issues = feature.validate(response.output, input);
    if (issues.length) {
      problems.push(...issues.map((i) => `attempt ${attempt}: ${i}`));
      continue;
    }
    return result('succeeded', null, {
      output: redactor.restore(response.output),
      sentText: user,
      attempts: attempt,
      model,
      problems,
    });
  }
  return result('invalid_output', 'invalidOutput', {
    sentText: user,
    attempts: maxAttempts,
    model,
    problems,
  });
}
