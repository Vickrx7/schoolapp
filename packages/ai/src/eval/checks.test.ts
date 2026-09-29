import { describe, expect, it } from 'vitest';
import { MAX_TEXT_TIMES_LEVELS, type DifferentiateOutput } from '../features/differentiate';
import {
  SUB_PLAN_LIMITS,
  SUB_PLAN_MAX_BLOCKS,
  subPlanAiInputSchema,
  subPlanFeature,
  type SubPlanAiOutput,
} from '../features/sub-plan';
import { priceFor } from '../pricing';
import { loadPrompt } from '../prompts';
import { createFakeProvider } from '../providers';
import { runFeature } from '../run';
import { averageSentenceLength, checkDifferentiation, checkSubPlan } from './checks';
import { differentiateCases } from './differentiate-cases';
import { subPlanCases } from './sub-plan-cases';

const good: DifferentiateOutput = {
  objective: 'Comprendre comment le castor construit son barrage.',
  versions: [
    {
      level: 'L1',
      title: 'Le castor',
      text: 'Le castor coupe des arbres. Il fait un barrage. Léa regarde le castor.',
      glossary: [
        { term: 'castor', definition: 'un animal' },
        { term: 'barrage', definition: 'un mur de branches' },
      ],
      visualSupports: [],
      questions: ['Que fait le castor ?'],
      teacherNote: 'Phrases courtes.',
    },
    {
      level: 'L2',
      title: 'Le castor, ingénieur',
      text: 'Avec ses dents solides, le castor coupe des arbres près de la rivière pour construire un barrage qui retient l’eau.',
      glossary: [],
      visualSupports: [],
      questions: ['Pourquoi le barrage est-il utile aux autres animaux de l’étang ?'],
      teacherNote: 'Vocabulaire plus riche.',
    },
  ],
};

describe('evaluation checks', () => {
  it('measures sentence length', () => {
    expect(averageSentenceLength('Un deux trois. Quatre cinq.')).toBe(2.5);
    expect(averageSentenceLength('')).toBe(0);
  });

  it('passes a good answer', () => {
    const results = checkDifferentiation(good, {
      levelKeys: ['L1', 'L2'],
      mustKeep: ['castor', 'barrage'],
      people: ['Léa'],
    });
    expect(results.filter((r) => !r.passed)).toEqual([]);
  });

  it('catches missing levels, lost content, anglicisms and leftover markers', () => {
    const bad: DifferentiateOutput = {
      ...good,
      versions: [{ ...good.versions[0]!, text: 'Élève A fait un email pendant le week-end.' }],
    };
    const failed = checkDifferentiation(bad, {
      levelKeys: ['L1', 'L2'],
      mustKeep: ['barrage'],
      people: [],
    })
      .filter((r) => !r.passed)
      .map((r) => r.name);
    expect(failed).toEqual(
      expect.arrayContaining([
        'every level present once',
        'key content kept in every version',
        'no European French or anglicisms',
        'no leftover name markers after restore',
      ]),
    );
  });

  it('has ten sample cases plus the largest request the app accepts, with unique ids', () => {
    expect(differentiateCases).toHaveLength(11);
    expect(new Set(differentiateCases.map((c) => c.id)).size).toBe(11);
    const size = (c: (typeof differentiateCases)[number]) =>
      c.text.length * (c.levels?.length ?? 4);
    expect(differentiateCases.filter((c) => size(c) > MAX_TEXT_TIMES_LEVELS)).toEqual([]);
    const largest = differentiateCases.find((c) => c.levels?.length === 6);
    expect(largest && size(largest)).toBeGreaterThan(0.9 * MAX_TEXT_TIMES_LEVELS);
  });
});

describe('substitute plan evaluation (sub_plan)', () => {
  it('has ten sample cases plus the largest request the app sends, with unique ids', () => {
    expect(subPlanCases).toHaveLength(11);
    expect(new Set(subPlanCases.map((c) => c.id)).size).toBe(11);
    for (const c of subPlanCases)
      expect(subPlanAiInputSchema.safeParse(c.input).success).toBe(true);
    const largest = subPlanCases.at(-1)!.input;
    expect(largest.blocks).toHaveLength(SUB_PLAN_MAX_BLOCKS);
    for (const b of largest.blocks) {
      expect(b.lesson!.content!.length).toBeGreaterThan(0.95 * SUB_PLAN_LIMITS.content);
    }
  });

  // `pnpm ai:eval --feature sub_plan --provider fake` must pass every check (CI runs this).
  it('passes every check with the fake provider', async () => {
    const systemPrompt = await loadPrompt('sub_plan', 'v1');
    for (const c of subPlanCases) {
      const run = await runFeature({
        feature: subPlanFeature,
        provider: createFakeProvider(),
        price: priceFor('fake'),
        systemPrompt,
        input: c.input,
        people: c.people ?? [],
      });
      expect(run.status, c.id).toBe('succeeded');
      const failed = checkSubPlan(run.output!, c.input, c.expect, run).filter((r) => !r.passed);
      expect(failed, c.id).toEqual([]);
    }
  });

  it('catches missing periods, bad minutes, level names, anglicisms, codes and leftover markers', () => {
    const c = subPlanCases.find((x) => x.id === 'histoire-titre-seulement-7e')!;
    const good = subPlanFeature.fake(c.input);
    const block = good.blocks[0]!;
    const bad: SubPlanAiOutput = {
      ...good,
      faithSentence: '',
      blocks: [
        {
          ...block,
          steps: block.steps.map((s) => ({ ...s, minutes: 1, say: s.say ? 'Bonjour.' : '' })),
          differentiation: [],
          activity: { ...block.activity!, title: 'Fiche du groupe Enrichi' },
          ifTimeRemains: 'Travail sur l’attente B2.1 pendant le week-end au CM1, avec Élève D.',
          materialsChecklist: ['Médicaments de la classe'],
        },
      ],
    };
    const failed = checkSubPlan(bad, c.input, {
      rooms: ['Local 204'],
      maxStepMinutes: 8,
    })
      .filter((r) => !r.passed)
      .map((r) => r.name);
    expect(failed).toEqual(
      expect.arrayContaining([
        'steps fit each period (60–110 % of its minutes)',
        'instructions for every group',
        'no level name in what students receive',
        'a faith sentence only when there is a faith moment',
        'no health words the teacher did not write',
        'no European French or anglicisms',
        'no France grade names (CP, CE1, CM2)',
        'no invented curriculum codes',
        '« Dites » lines in guillemets',
        'no leftover name markers after restore',
      ]),
    );
    expect(checkSubPlan({ ...good, blocks: [] }, c.input)[0]).toMatchObject({
      name: 'every period present once',
      passed: false,
    });
  });

  it('checks the rooms named, what was left out and never sent, and names put back', () => {
    const c = subPlanCases.find((x) => x.id === 'eps-rotation-deux-classes')!;
    const good = subPlanFeature.fake(c.input);
    const elsewhere = {
      ...good,
      dayOverview: 'Les élèves vont ensuite au local 112, puis à la cafétéria.',
    };
    expect(
      checkSubPlan(elsewhere, c.input, { rooms: ['Gymnase'] }).find(
        (r) => r.name === 'only rooms that were given',
      ),
    ).toMatchObject({ passed: false, detail: 'local 112, cafeteria' });
    const run = { sentText: 'Appelez le 613-555-0142.', problems: [] };
    const results = checkSubPlan(
      good,
      c.input,
      {
        dropped: ['blocks.B1.lesson.subNotes'],
        neverSent: ['613-555-0142'],
        namesRestored: ['Léa'],
      },
      run,
    );
    expect(results.filter((r) => !r.passed).map((r) => r.name)).toEqual([
      'fields with a personal detail left out',
      'personal details never sent',
      'names restored in the answer',
    ]);
  });
});
