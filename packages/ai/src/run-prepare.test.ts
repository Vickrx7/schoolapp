/**
 * The two halves of a call that the streamed path (`runFeature`) and the batch path (bulk
 * generation) share (DECISIONS D-098): `prepareCall` refuses exactly what `runFeature` refuses,
 * before anything is sent, and `checkOutput` normalizes, validates, then puts names back.
 */
import { describe, expect, it, vi } from 'vitest';
import { differentiateFeature, type DifferentiateInput } from './features/differentiate';
import { priceFor } from './pricing';
import { createFakeProvider } from './providers';
import { checkOutput, prepareCall, runFeature, sentHash } from './run';
import type { AiProvider, FeatureDefinition, ProviderRequest } from './types';

const NOW = new Date('2026-09-28T12:00:00Z');

const input: DifferentiateInput = {
  title: 'Le castor de Léa',
  text: 'Léa observe un castor près de la rivière. Mme Tremblay explique pourquoi les castors sont importants.',
  objective: '',
  itemType: 'reading_passage',
  gradeCode: '3',
  gradeLabel: '3e année',
  subjectId: null,
  subjectLabel: 'Sciences et technologie',
  levels: [
    {
      key: 'L1',
      languageLevelId: '11111111-1111-4111-8111-111111111111',
      label: 'Débutant',
      description: 'Phrases courtes.',
    },
    {
      key: 'L2',
      languageLevelId: '22222222-2222-4222-8222-222222222222',
      label: 'Enrichi',
      description: null,
    },
  ],
};

const people = [
  { name: 'Léa', kind: 'student' as const },
  { name: 'Isabelle Tremblay', kind: 'staff' as const },
];
const options = { systemPrompt: 'Système.', people, now: NOW };

function spyProvider() {
  const requests: ProviderRequest<unknown>[] = [];
  const fake = createFakeProvider();
  const provider: AiProvider = {
    name: 'spy',
    model: 'fake',
    async generate<T>(request: ProviderRequest<T>) {
      requests.push(request as ProviderRequest<unknown>);
      return fake.generate(request);
    },
  };
  return { provider, requests };
}

/** Inputs the old `runFeature` refused, and why. */
const REFUSED: { name: string; input: unknown; code: 'invalidInput' | 'personalInfo' }[] = [
  {
    name: 'a phone number',
    input: { ...input, text: `${input.text} Appelez sa mère au 613-555-0123.` },
    code: 'personalInfo',
  },
  { name: 'invalid input', input: { ...input, levels: [] }, code: 'invalidInput' },
  { name: 'not even an object', input: 'Léa', code: 'invalidInput' },
  {
    name: 'a name left in a field that is not redacted',
    input: { ...input, subjectLabel: 'Sciences avec Léa' },
    code: 'personalInfo',
  },
];

describe('prepareCall', () => {
  it.each(REFUSED)(
    'refuses $name exactly as runFeature does, and nothing is sent',
    async ({ input: raw, code }) => {
      const prepared = prepareCall(differentiateFeature, raw, options);
      expect(prepared).toMatchObject({ ok: false, errorCode: code });

      const { provider, requests } = spyProvider();
      const run = await runFeature({
        feature: differentiateFeature,
        provider,
        price: priceFor('fake'),
        input: raw,
        ...options,
      });
      expect(run).toMatchObject({ status: 'failed', errorCode: code, sentText: null });
      expect(run.problems).toEqual(prepared.ok ? [] : prepared.problems);
      expect(requests).toHaveLength(0);
    },
  );

  it('refuses a known name in the system prompt', () => {
    const prepared = prepareCall(differentiateFeature, input, {
      ...options,
      systemPrompt: 'Exemple : Léa lit un texte.',
    });
    expect(prepared).toMatchObject({
      ok: false,
      errorCode: 'personalInfo',
      problems: ['outbound name'],
    });
  });

  it('prepares exactly what runFeature sends, with a stable hash of it', async () => {
    const prepared = prepareCall(differentiateFeature, input, options);
    if (!prepared.ok) throw new Error('refused');
    const { provider, requests } = spyProvider();
    await runFeature({
      feature: differentiateFeature,
      provider,
      price: priceFor('fake'),
      input,
      ...options,
    });
    expect(requests[0]).toMatchObject({
      system: prepared.system,
      user: prepared.user,
      maxTokens: prepared.maxTokens,
    });
    expect(`${prepared.system}\n${prepared.user}`).not.toMatch(/Léa|Tremblay/);
    expect(prepared.sentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(prepared.sentSha256).toBe(sentHash(prepared.system, prepared.user));
    // Same input, same people: the same text and hash (a batch's answers are checked with it).
    const again = prepareCall(differentiateFeature, input, options);
    expect(again.ok && again.sentSha256).toBe(prepared.sentSha256);
    // The same people in another order: the same markers.
    const reordered = prepareCall(differentiateFeature, input, {
      ...options,
      people: [...people].reverse(),
    });
    expect(reordered.ok && reordered.sentSha256).toBe(prepared.sentSha256);
    // Someone left the roster: what would be sent differs, and so does the hash.
    const changed = prepareCall(differentiateFeature, input, {
      ...options,
      people: [{ name: 'Isabelle Tremblay', kind: 'staff' as const }],
    });
    expect(changed.ok).toBe(true);
    expect(changed.ok && changed.sentSha256).not.toBe(prepared.sentSha256);
  });
});

describe('checkOutput', () => {
  it('normalizes, then validates, then puts the names back', () => {
    const calls: string[] = [];
    const feature: FeatureDefinition<DifferentiateInput, { text: string }> = {
      ...(differentiateFeature as unknown as FeatureDefinition<
        DifferentiateInput,
        { text: string }
      >),
      normalize: vi.fn((output: { text: string }) => {
        calls.push('normalize');
        return { text: `${output.text.trim()}.` };
      }),
      validate: vi.fn((output: { text: string }) => {
        calls.push(`validate ${output.text}`);
        return [];
      }),
    };
    const prepared = prepareCall(feature, input, options);
    if (!prepared.ok) throw new Error('refused');
    const marker = prepared.user.match(/Élève [A-Z]/)?.[0];
    expect(marker).toBeDefined();
    const result = checkOutput(
      feature,
      { text: `  ${marker} lit` },
      prepared.input,
      prepared.redactor,
    );
    expect(calls).toEqual([`normalize`, `validate ${marker} lit.`]);
    expect(result).toEqual({ ok: true, output: { text: 'Léa lit.' } });
  });

  it('reports what validation finds, and a normalize that throws, without names', () => {
    const feature: FeatureDefinition<DifferentiateInput, { text: string }> = {
      ...(differentiateFeature as unknown as FeatureDefinition<
        DifferentiateInput,
        { text: string }
      >),
      normalize: (output) => {
        if (output.text === 'boom') throw new Error('Léa');
        return output;
      },
      validate: (output) => (output.text ? [] : ['text: required']),
    };
    const prepared = prepareCall(feature, input, options);
    if (!prepared.ok) throw new Error('refused');
    expect(checkOutput(feature, { text: '' }, prepared.input, prepared.redactor)).toEqual({
      ok: false,
      problems: ['text: required'],
    });
    expect(checkOutput(feature, { text: 'boom' }, prepared.input, prepared.redactor)).toEqual({
      ok: false,
      problems: ['normalize failed'],
    });
  });
});
