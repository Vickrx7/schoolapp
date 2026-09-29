import { describe, expect, it } from 'vitest';
import { MAX_TEXT_TIMES_LEVELS, type DifferentiateOutput } from '../features/differentiate';
import { libraryItemFeature } from '../features/library-item';
import { libraryLevelsFeature } from '../features/library-levels';
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
import {
  averageSentenceLength,
  checkDifferentiation,
  checkLibraryItem,
  checkLibraryLevels,
  checkSubPlan,
} from './checks';
import { differentiateCases } from './differentiate-cases';
import { libraryItemCases } from './library-item-cases';
import { libraryLevelsCases } from './library-levels-cases';
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

describe('library evaluation (library_item, library_levels)', () => {
  it('has ten cases each, with unique ids', () => {
    expect(libraryItemCases).toHaveLength(10);
    expect(new Set(libraryItemCases.map((c) => c.id)).size).toBe(10);
    expect(libraryLevelsCases).toHaveLength(10);
    expect(new Set(libraryLevelsCases.map((c) => c.id)).size).toBe(10);
  });

  it('ai 10. passes every check with the fake provider', async () => {
    const provider = createFakeProvider();
    const item = await loadPrompt('library_item', 'v1');
    for (const c of libraryItemCases) {
      const run = await runFeature({
        feature: libraryItemFeature,
        provider,
        price: priceFor('fake'),
        systemPrompt: item,
        input: c.input,
        people: c.people ?? [],
      });
      expect(run.status, c.id).toBe('succeeded');
      const failed = checkLibraryItem(run.output!, c.input, c.expect).filter((r) => !r.passed);
      expect(failed, c.id).toEqual([]);
    }
    const levels = await loadPrompt('library_levels', 'v1');
    for (const c of libraryLevelsCases) {
      const run = await runFeature({
        feature: libraryLevelsFeature,
        provider,
        price: priceFor('fake'),
        systemPrompt: levels,
        input: c.input,
        people: c.people ?? [],
      });
      expect(run.status, c.id).toBe('succeeded');
      expect(
        checkLibraryLevels(run.output!, c.input).filter((r) => !r.passed),
        c.id,
      ).toEqual([]);
    }
  });

  it('catches missing levels, long sentences, names, numbers, safety, rubric wording and English', async () => {
    const provider = createFakeProvider();
    const run = async (id: string) => {
      const c = libraryItemCases.find((x) => x.id === id)!;
      const result = await runFeature({
        feature: libraryItemFeature,
        provider,
        price: priceFor('fake'),
        systemPrompt: 'Système.',
        input: c.input,
        people: c.people ?? [],
      });
      return { c, output: result.output! };
    };
    const failing = (results: { name: string; passed: boolean }[]) =>
      results.filter((r) => !r.passed).map((r) => r.name);

    const reading = await run('lecture-3e');
    const broken = structuredClone(reading.output);
    broken.levels = broken.levels.slice(1);
    broken.levels[0]!.content.text =
      'Le castor, qui est le plus grand rongeur que l’on trouve dans les rivières et les lacs du Canada, construit des barrages impressionnants avec des branches qu’il coupe lui-même.';
    expect(failing(checkLibraryItem(broken, reading.c.input, reading.c.expect))).toEqual(
      expect.arrayContaining(['every level asked for, once']),
    );
    const long = structuredClone(reading.output);
    long.levels[0]!.content.text = broken.levels[0]!.content.text;
    expect(failing(checkLibraryItem(long, reading.c.input, reading.c.expect))).toEqual([
      'most accessible level has short sentences (≤ 12 words)',
      'sentences do not get shorter from one level to the next',
    ]);

    const worksheet = await run('fiche-ordonner-3e');
    const named = structuredClone(worksheet.output);
    named.base.content.instructions = 'Liam, compare 1 250 et 980. Aide Élève A.';
    expect(failing(checkLibraryItem(named, worksheet.c.input, worksheet.c.expect))).toEqual(
      expect.arrayContaining([
        'numbers up to 1000',
        'the student named in the note is nowhere in the resource',
        'no person marker',
      ]),
    );

    const experiment = await run('experience-5e');
    const unsafe = structuredClone(experiment.output);
    unsafe.safetyNotes = {
      ...unsafe.safetyNotes!,
      allergyAwareMaterials: 'Des élastiques.',
      supervision: 'close',
    };
    expect(failing(checkLibraryItem(unsafe, experiment.c.input, experiment.c.expect))).toEqual([
      'allergy-aware materials name nut-free or latex-free options',
      'standard supervision (a substitute can run it)',
    ]);

    const rubric = await run('grille-3e');
    const wording = structuredClone(rubric.output);
    const criteria = wording.base.content.criteria as { levels: Record<string, string> }[];
    criteria[1]!.levels.level2 = 'Organise ses idées avec beaucoup d’efficacité.';
    expect(failing(checkLibraryItem(wording, rubric.c.input, rubric.c.expect))).toEqual([
      'achievement-chart wording per level',
    ]);

    const guide = await run('guide-familles-3e');
    const french = structuredClone(guide.output);
    (french.base.content.en as { intro: string }).intro = 'Ce mois-ci, votre enfant apprend.';
    expect(failing(checkLibraryItem(french, guide.c.input, guide.c.expect))).toEqual([
      'the English part is in English',
    ]);

    const pause = await run('pause-active-1re');
    const ball = structuredClone(pause.output);
    ball.base.content.steps = ['Lance le ballon à ton ami.'];
    ball.durationMinutes = 10;
    expect(failing(checkLibraryItem(ball, pause.c.input, pause.c.expect))).toEqual([
      '5 minutes or less',
      'no equipment needed',
    ]);
  });

  it('checks the level set, the questions and the English words for library_levels', async () => {
    const provider = createFakeProvider();
    const c = libraryLevelsCases.find((x) => x.id === 'quiz-avance-enrichi')!;
    expect(c.input.levels.map((l) => [l.key, l.label, l.mostAccessible])).toEqual([
      ['L1', 'Avancé', false],
      ['L2', 'Enrichi', false],
    ]);
    const result = await runFeature({
      feature: libraryLevelsFeature,
      provider,
      price: priceFor('fake'),
      systemPrompt: 'Système.',
      input: c.input,
      people: [],
    });
    const output = structuredClone(result.output!);
    output.levels[0]!.content.questions = (output.levels[0]!.content.questions as unknown[]).slice(
      1,
    );
    output.levels[1]!.content.instructions = 'Pour la fin de semaine… ou le week-end.';
    const failed = checkLibraryLevels(output, c.input)
      .filter((r) => !r.passed)
      .map((r) => r.name);
    expect(failed).toEqual(
      expect.arrayContaining([
        'objective and questions kept in every level',
        'no European French or anglicisms',
        'as many questions as the base in every level',
      ]),
    );
  });
});
