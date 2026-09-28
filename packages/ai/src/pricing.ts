import type { TokenUsage } from './types';

/** US dollars per million tokens. */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

// Anthropic first-party API list prices. Thinking tokens are billed as output tokens.
const PRICES: Record<string, ModelPrice> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  // The fake provider has a nominal price so usage screens and caps can be demonstrated.
  fake: { input: 1, output: 5, cacheRead: 0, cacheWrite: 0 },
};

export class UnknownModelPriceError extends Error {}

/**
 * The price for a model. `override` (from configuration) wins, so a new model or a board's
 * negotiated rate works without a code change. Unknown models are an error: costs must never
 * silently count as zero.
 */
export function priceFor(model: string, override?: Partial<ModelPrice>): ModelPrice {
  const base = PRICES[model];
  if (override?.input !== undefined && override.output !== undefined) {
    return {
      input: override.input,
      output: override.output,
      cacheRead: override.cacheRead ?? override.input * 0.1,
      cacheWrite: override.cacheWrite ?? override.input * 1.25,
    };
  }
  if (!base) {
    throw new UnknownModelPriceError(
      `no price known for model "${model}"; set AI_PRICE_INPUT_PER_MTOK and AI_PRICE_OUTPUT_PER_MTOK`,
    );
  }
  return base;
}

export function estimateCostUsd(usage: TokenUsage, price: ModelPrice): number {
  const cost =
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheReadTokens * price.cacheRead +
      usage.cacheWriteTokens * price.cacheWrite) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
