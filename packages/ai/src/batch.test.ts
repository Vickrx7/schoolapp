/**
 * Bulk generation's arithmetic and the fake provider's batches (DECISIONS D-096, D-098): a
 * request's worst case is never below what it can cost, the cap takes a prefix and never goes
 * over, batch prices are half, and a fake batch of every library resource type comes back through
 * the same checks as a streamed call.
 */
import { LIBRARY_ITEM_TYPES, TYPE_INFO, type LibraryItemType } from '@lynx/content';
import { describe, expect, it } from 'vitest';
import {
  countedInputTokens,
  fallbackInputTokens,
  fitWithinCap,
  schemaJsonText,
  totalUsd,
  worstCaseUsd,
} from './batch';
import {
  libraryItemFeature,
  libraryItemInputSchema,
  type LibraryItemAiOutput,
  type LibraryItemInput,
} from './features/library-item';
import { estimateCostUsd, priceFor } from './pricing';
import { loadPrompt } from './prompts';
import { createFakeProvider } from './providers';
import { checkOutput, prepareCall, type PreparedCall } from './run';
import type { BatchItem, BatchItemResult } from './types';

const LEVEL_IDS = [
  'c46ae6a9-da0b-4bcb-ab38-a1761dd9786b',
  '71516dc0-c84c-473f-aa4a-14304a000924',
  '0b7d3c5e-2a41-4f8e-9c6d-5e4f3a2b1c0d',
  '1c8e4d6f-3b52-4a9f-8d7e-6f5a4b3c2d1e',
];

/** A bulk request as `public.library_bulk_plan` builds it: one attente, board levels or none. */
function bulkInput(type: LibraryItemType, levels: boolean): LibraryItemInput {
  const info = TYPE_INFO[type];
  return libraryItemInputSchema.parse({
    itemType: type,
    gradeCodes: ['3'],
    gradeLabels: ['3e année'],
    subjectId: 'ece67150-44d3-4e6e-b772-d9bde2165caf',
    subjectLabel: 'Mathématiques',
    strandLabel: 'Nombres',
    expectations: [
      {
        key: 'E1',
        expectationId: '20000000-0000-4000-8000-000000030b12',
        code: 'B1.2',
        text: "Comparer et ordonner des nombres naturels jusqu'à 1 000.",
      },
    ],
    levels:
      levels && info.levelable
        ? ['Débutant', 'Intermédiaire', 'Avancé', 'Enrichi'].map((label, i) => ({
            key: `L${i + 1}`,
            languageLevelId: LEVEL_IDS[i]!,
            label,
            description: null,
            mostAccessible: i === 0,
          }))
        : [],
    catholic:
      type === 'catholic_reflection'
        ? {
            key: 'R1',
            referenceId: '6ffed8e8-d54d-4ca1-95ad-92d6ac4793d8',
            type: 'virtue',
            title: 'Le respect',
            text: 'Respecter chaque personne.',
          }
        : null,
    durationMinutes: Math.max(5, info.defaultDuration),
    subFriendly: false,
    teacherNote:
      'Automne. Ressources existantes à ne pas reprendre : « Les nombres jusqu’à 1 000 ».',
  });
}

const people = [
  { name: 'Hugo', kind: 'student' as const },
  { name: 'Maëlle', kind: 'student' as const },
  { name: 'Isabelle Tremblay', kind: 'staff' as const },
];

const CASES = LIBRARY_ITEM_TYPES.flatMap((type) =>
  TYPE_INFO[type].levelable
    ? [
        { type, levels: false },
        { type, levels: true },
      ]
    : [{ type, levels: false }],
);

async function preparedItems() {
  const systemPrompt = await loadPrompt('library_item', libraryItemFeature.promptVersion);
  return CASES.map(({ type, levels }, i) => {
    const prepared = prepareCall(libraryItemFeature, bulkInput(type, levels), {
      systemPrompt,
      people,
    });
    if (!prepared.ok) throw new Error(`${type}: ${prepared.errorCode}`);
    const item: BatchItem = {
      customId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      system: prepared.system,
      user: prepared.user,
      schema: prepared.schema,
      maxTokens: prepared.maxTokens,
      fake: () => libraryItemFeature.fake(prepared.input),
    };
    return { type, levels, prepared, item };
  });
}

async function collect(results: AsyncIterable<BatchItemResult>) {
  const out: BatchItemResult[] = [];
  for await (const r of results) out.push(r);
  return out;
}

describe('the worst case of a request (A3)', () => {
  it('is never below what the fake reports, for every type, with and without levels', async () => {
    const provider = createFakeProvider();
    const batch = provider.batch!;
    const items = await preparedItems();
    const results = await collect(
      batch.results('fake-batch', new Map(items.map((x) => [x.item.customId, x.item]))),
    );
    expect(results).toHaveLength(items.length);
    for (const price of [priceFor('fake'), priceFor('claude-opus-5-5')]) {
      for (const { type, levels, item } of items) {
        const result = results.find((r) => r.customId === item.customId)!;
        const counted = countedInputTokens(await batch.countInputTokens(item));
        const worst = worstCaseUsd(counted, item.maxTokens, price);
        const actual = estimateCostUsd(result.usage, price, { batch: true });
        expect(worst, `${type}${levels ? ' with levels' : ''}`).toBeGreaterThanOrEqual(actual);
        // The fallback (when counting fails) covers at least as much input.
        const fallback = fallbackInputTokens(item.system, item.user, schemaJsonText(item.schema));
        expect(fallback).toBeGreaterThanOrEqual(result.usage.inputTokens);
        expect(result.usage.outputTokens).toBeLessThanOrEqual(item.maxTokens);
      }
    }
  });

  it('prices input at the higher of input and cache write, and the answer at max_tokens, halved', () => {
    const price = priceFor('claude-opus-5-5');
    // (10,000 × $5 + 64,000 × $20) / 1e6 × 0.5 = $0.665
    expect(worstCaseUsd(10_000, 64_000, price)).toBe(0.665);
    expect(worstCaseUsd(1, 0, { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 })).toBe(0.000001);
    expect(countedInputTokens(1000)).toBe(1070);
    expect(fallbackInputTokens('é', 'a', '')).toBe(3 + 2000);
  });

  it('writes the output schema of every type as JSON', () => {
    for (const type of LIBRARY_ITEM_TYPES) {
      const text = schemaJsonText(libraryItemFeature.outputSchemaFor!(bulkInput(type, false)));
      expect(text.length, type).toBeGreaterThan(100);
    }
  });
});

describe('fitWithinCap', () => {
  const items = [0.66, 0.66, 0.5, 0.01].map((worstCaseUsd, i) => ({ id: i, worstCaseUsd }));

  it('takes the prefix whose sum stays within the cap, and never goes over', () => {
    expect(fitWithinCap(items, 1.4).fit.map((x) => x.id)).toEqual([0, 1]);
    // A prefix: the cheap last request is not taken past the one that does not fit.
    expect(fitWithinCap(items, 1.4).rest.map((x) => x.id)).toEqual([2, 3]);
    expect(fitWithinCap(items, 1.82).fit.map((x) => x.id)).toEqual([0, 1, 2]);
    expect(fitWithinCap(items, 1.83).fit.map((x) => x.id)).toEqual([0, 1, 2, 3]);
    expect(fitWithinCap(items, 0.5).fit).toEqual([]);
  });

  it('never exceeds the cap, whatever the costs (exact to the micro-dollar)', () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 48271) % 2147483647;
      return seed / 2147483647;
    };
    for (let run = 0; run < 200; run++) {
      const list = Array.from({ length: 1 + Math.floor(random() * 60) }, () => ({
        worstCaseUsd: Math.ceil(random() * 700_000) / 1_000_000,
      }));
      const cap = Math.round(random() * 3000) / 100;
      const { fit, rest } = fitWithinCap(list, cap);
      expect(totalUsd(fit)).toBeLessThanOrEqual(cap);
      expect(fit.length + rest.length).toBe(list.length);
      if (rest.length) expect(totalUsd([...fit, rest[0]!])).toBeGreaterThan(cap);
    }
    // Floating-point sums that would round over: ten times $0.1 fit a $1 cap exactly.
    expect(fitWithinCap(Array(10).fill({ worstCaseUsd: 0.1 }), 1).fit).toHaveLength(10);
  });
});

describe('batch prices (A6)', () => {
  it('are half of the usual price', () => {
    const usage = {
      inputTokens: 12_345,
      outputTokens: 6_789,
      cacheReadTokens: 1_000,
      cacheWriteTokens: 2_000,
    };
    const price = priceFor('claude-opus-5-5');
    const full = estimateCostUsd(usage, price);
    expect(estimateCostUsd(usage, price, { batch: true })).toBeCloseTo(full / 2, 6);
    expect(estimateCostUsd(usage, price, { batch: false })).toBe(full);
  });
});

describe('a fake batch round trip (A5)', () => {
  it('passes checkOutput for every type, with and without levels', async () => {
    const provider = createFakeProvider();
    const batch = provider.batch!;
    const items = await preparedItems();
    const { batchId } = await batch.submit(items.map((x) => x.item));
    expect(batchId).toMatch(/^fake-batch-[0-9a-f-]{36}$/);
    expect(await batch.status(batchId)).toEqual({ state: 'ended' });
    const byId = new Map(items.map((x) => [x.item.customId, x]));
    // Only the pending requests are answered.
    const pending = new Map(items.slice(1).map((x) => [x.item.customId, x.item]));
    const results = await collect(batch.results(batchId, pending));
    expect(results.map((r) => r.customId).sort()).toEqual([...pending.keys()].sort());
    for (const result of results) {
      const { type, prepared } = byId.get(result.customId)!;
      expect(result.stopReason, type).toBe('end_turn');
      const typed = prepared as PreparedCall<LibraryItemInput, LibraryItemAiOutput>;
      const checked = checkOutput(
        libraryItemFeature,
        result.output as LibraryItemAiOutput,
        typed.input,
        typed.redactor,
      );
      expect(checked, type).toMatchObject({ ok: true });
    }
    await expect(batch.cancel(batchId)).resolves.toBeUndefined();
    await expect(batch.remove(batchId)).resolves.toBeUndefined();
  });

  it('answers an item whose fake does not fit its schema as unusable, not as a crash', async () => {
    const batch = createFakeProvider().batch!;
    const [first] = await preparedItems();
    const broken: BatchItem = { ...first!.item, fake: () => ({ title: 1 }) };
    const failing: BatchItem = {
      ...first!.item,
      customId: 'x',
      fake: () => {
        throw new Error('no');
      },
    };
    const results = await collect(
      batch.results(
        'b',
        new Map([
          [broken.customId, broken],
          [failing.customId, failing],
        ]),
      ),
    );
    expect(results.map((r) => [r.output, r.stopReason])).toEqual([
      [null, 'invalid_schema'],
      [null, 'batch_server_error'],
    ]);
  });
});
