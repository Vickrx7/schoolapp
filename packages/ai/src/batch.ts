/**
 * The cost cap of a bulk run (DECISIONS D-096): each request's worst case, and the requests a
 * run sends. A run is one batch sized to its worst case, never an estimate: `max_tokens` bounds
 * the answer (thinking included) and the input is counted before sending, so a run cannot cost
 * more than the sum of its requests' worst cases as long as the price table is right.
 *
 * Pure: the worker (apps/worker/src/library-bulk.ts) and the operator's CLI (`pnpm admin
 * bulk-plan`) use the same arithmetic.
 */
import { z } from 'zod';
import { BATCH_PRICE_FACTOR, type ModelPrice } from './pricing';

/** Micro-dollars: sums are exact in whole numbers. */
const MICRO = 1_000_000;

/**
 * The input tokens to plan for, from the provider's count of the request as it will be sent: 2 %
 * and 50 tokens more, in case the count and the billing differ a little.
 */
export function countedInputTokens(counted: number): number {
  return Math.ceil(Math.max(0, counted) * 1.02) + 50;
}

const utf8Bytes = (text: string) => new TextEncoder().encode(text).length;

/**
 * The input tokens to plan for when the provider could not count them: every UTF-8 byte of the
 * system prompt, the message and the output schema as a token (a token always covers at least a
 * byte), plus 2,000 for the request's framing.
 */
export function fallbackInputTokens(system: string, user: string, schemaJson: string): number {
  return utf8Bytes(system) + utf8Bytes(user) + utf8Bytes(schemaJson) + 2000;
}

/** The JSON schema of an output schema, as text (empty when it cannot be written as one). */
export function schemaJsonText(schema: z.ZodType<unknown>): string {
  try {
    return JSON.stringify(z.toJSONSchema(schema, { unrepresentable: 'any' }));
  } catch {
    return '';
  }
}

/**
 * The most one batch request can cost, in US dollars, rounded up to the micro-dollar: every
 * input token at the higher of the input and cache-write prices (a cached system prompt is
 * written at most once per request), plus `max_tokens` of output, at the batch price.
 */
export function worstCaseUsd(inputTokens: number, maxTokens: number, price: ModelPrice): number {
  const perMillion =
    Math.max(0, inputTokens) * Math.max(price.input, price.cacheWrite) +
    Math.max(0, maxTokens) * price.output;
  // Rounded to whole micro-dollars first, so floating-point noise never adds one.
  const micros = Math.round(perMillion * BATCH_PRICE_FACTOR * 1000) / 1000;
  return Math.ceil(micros) / MICRO;
}

/**
 * The requests a run sends: the longest prefix, in order, whose worst cases add up to at most
 * the cap; the rest are left out (`skipped/cost_cap`). A prefix, not the cheapest subset: running
 * the same plan again later picks up where this run stopped.
 */
export function fitWithinCap<T extends { worstCaseUsd: number }>(
  items: readonly T[],
  capUsd: number,
): { fit: T[]; rest: T[] } {
  const cap = Math.floor(Math.round(capUsd * MICRO * 1000) / 1000);
  let total = 0;
  let count = 0;
  for (const item of items) {
    const cost = Math.ceil(Math.round(item.worstCaseUsd * MICRO * 1000) / 1000);
    if (total + cost > cap) break;
    total += cost;
    count++;
  }
  return { fit: items.slice(0, count), rest: items.slice(count) };
}

/** The sum of worst cases, exact to the micro-dollar. */
export function totalUsd(items: readonly { worstCaseUsd: number }[]): number {
  const micros = items.reduce(
    (sum, item) => sum + Math.ceil(Math.round(item.worstCaseUsd * MICRO * 1000) / 1000),
    0,
  );
  return micros / MICRO;
}
