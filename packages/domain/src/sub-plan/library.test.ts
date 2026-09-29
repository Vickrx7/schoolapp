/**
 * Library resources in substitute plans (DECISIONS D-077; plan tests domain 3–11). The fixtures
 * are the demo resources of content/library/demo, as the loader sends them.
 */
import { describe, expect, it } from 'vitest';
import { buildSubPlanAiInput } from './ai-input';
import { buildAbsencePlans, type AbsenceInput } from './build';
import { composeSubPlan, type SubPlanAudience } from './compose';
import {
  MAX_LIBRARY_PLAN_BYTES,
  chooseLibraryItem,
  libraryStepText,
  librarySnapshot,
  rankLibraryCandidates,
  type LibraryChoiceInput,
} from './library';
import { subPlanEditsSchema, subPlanV1Schema, type SubPlanAiLayer, type SubPlanV1 } from './schema';
import { subPlanSourcesSchema, type SubPlanSourceLibraryItem } from './sources';
import {
  C3,
  DEBUTANTS_3E,
  LEVEL,
  NOW,
  WEEK,
  block,
  demoItemId,
  demoLibraryItem,
  isabelleLibrary,
  isabelleSources,
  lesson,
  parse,
  type RawLibraryItem,
} from './test-fixtures';

const HUARD = demoItemId('huard-oiseau-des-lacs');
const LESSON_PLAN = demoItemId('idee-principale-paragraphe');
const ORDONNER = demoItemId('ordonner-nombres-1000');
const KEY_SENTINEL = 'SENTINELLE-CORRIGE';
/** The Débutant version of « Le huard » starts this way; the others do not. */
const HUARD_DEBUTANT = 'Le huard est un grand oiseau. Il vit sur les lacs.';

type Raw = ReturnType<typeof isabelleSources>;
type RawLibrary = ReturnType<typeof isabelleLibrary>;

const thursday = (overrides: Partial<AbsenceInput> = {}): AbsenceInput => ({
  startsOn: WEEK.thu,
  endsOn: WEEK.thu,
  part: 'full_day',
  catholicConnection: false,
  ...overrides,
});

function build(library: unknown = isabelleLibrary(), raw: Raw = isabelleSources(), a = thursday()) {
  return buildAbsencePlans(parse({ ...raw, library }), a, { now: NOW }).plans;
}

const frenchKey = (day = 4) => block(C3, day, '08:55');
const mathKey = (day = 4) => block(C3, day, '09:45');

/** Parsed library items, as the builder gets them. */
function libraryItems(items: RawLibraryItem[]): SubPlanSourceLibraryItem[] {
  return parse({ ...isabelleSources(), library: { lessonCandidates: [], items } }).library.items;
}

function choiceInput(
  items: RawLibraryItem[],
  candidates: LibraryChoiceInput['candidates'],
  blockMinutes = 50,
  used: ReadonlySet<string> = new Set(),
): LibraryChoiceInput {
  return { blockMinutes, candidates, items: libraryItems(items), used };
}

/** A demo resource made into another one: another id, type, duration or level versions. */
function variant(
  slug: string,
  id: string,
  overrides: Partial<RawLibraryItem> = {},
): RawLibraryItem {
  return { ...demoLibraryItem(slug), id, ...overrides };
}

const ID = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('choosing a resource (domain 3, 4)', () => {
  it('takes the lesson’s own resource first, whatever the others offer', () => {
    const choice = chooseLibraryItem(
      choiceInput(
        [demoLibraryItem('huard-oiseau-des-lacs'), demoLibraryItem('ordonner-nombres-1000')],
        [
          { itemId: HUARD, reason: 'expectation', overlap: 3 },
          { itemId: ORDONNER, reason: 'linked', overlap: 0 },
        ],
      ),
    );
    expect(choice).toMatchObject({ item: { id: ORDONNER }, reason: 'linked' });
  });

  it('prefers a student sheet to a lesson plan, even one that fits the period better', () => {
    // The lesson plan lasts 50 minutes like the period; the huard 30.
    const choice = chooseLibraryItem(
      choiceInput(
        [demoLibraryItem('idee-principale-paragraphe'), demoLibraryItem('huard-oiseau-des-lacs')],
        [
          { itemId: LESSON_PLAN, reason: 'expectation', overlap: 1 },
          { itemId: HUARD, reason: 'expectation', overlap: 1 },
        ],
      ),
    );
    expect(choice?.item.id).toBe(HUARD);
  });

  it('then more attentes in common, then fitting the period, then the closest duration', () => {
    const sheets = [
      variant('huard-oiseau-des-lacs', ID(1), { durationMinutes: 30 }),
      variant('huard-oiseau-des-lacs', ID(2), { durationMinutes: 45 }),
      variant('huard-oiseau-des-lacs', ID(3), { durationMinutes: 70 }),
      variant('huard-oiseau-des-lacs', ID(4), { durationMinutes: 30, usageCount: 5 }),
    ];
    const all = (overlap: (n: number) => number) =>
      sheets.map((s, i) => ({ itemId: s.id, reason: 'expectation' as const, overlap: overlap(i) }));

    const ranked = (blockMinutes: number, overlap: (n: number) => number) =>
      rankLibraryCandidates(choiceInput(sheets, all(overlap), blockMinutes)).map((c) => c.item.id);

    // More attentes in common first.
    expect(ranked(50, (i) => (i === 2 ? 2 : 1))[0]).toBe(ID(3));
    // Same overlap, 50-minute period: 45 minutes is closest; 70 does not fit (over by 20).
    expect(ranked(50, () => 1)).toEqual([ID(2), ID(4), ID(1), ID(3)]);
    // A 35-minute period: 30 minutes is closest, and the more used one first; 45 still fits.
    expect(ranked(35, () => 1)).toEqual([ID(4), ID(1), ID(2), ID(3)]);
  });

  it('never offers a resource twice, one that is not sub-friendly, or one only reviewed for an attente', () => {
    const items = [
      demoLibraryItem('huard-oiseau-des-lacs'),
      { ...demoLibraryItem('idee-principale-paragraphe'), subFriendly: false },
      variant('huard-oiseau-des-lacs', ID(5), { status: 'teacher_reviewed' }),
      variant('ordonner-nombres-1000', ID(6), { status: 'teacher_reviewed' }),
    ];
    const candidates = [
      { itemId: HUARD, reason: 'expectation' as const, overlap: 1 },
      { itemId: LESSON_PLAN, reason: 'expectation' as const, overlap: 1 },
      { itemId: ID(5), reason: 'expectation' as const, overlap: 1 },
      { itemId: ID(6), reason: 'linked' as const, overlap: 0 },
      { itemId: ID(7), reason: 'expectation' as const, overlap: 1 },
    ];
    expect(
      rankLibraryCandidates(choiceInput(items, candidates, 50, new Set([ID(6)]))).map(
        (c) => c.item.id,
      ),
    ).toEqual([HUARD]);
    // The teacher's own reviewed resource is fine when it is the lesson's link.
    expect(chooseLibraryItem(choiceInput(items, candidates))?.item.id).toBe(ID(6));
  });

  it('uses each resource once per absence (domain 4)', () => {
    // The huard is offered for both Français lessons of the day (L4 at 8 h 55, L5 at 11 h 15).
    const library: RawLibrary = isabelleLibrary();
    library.lessonCandidates.push({
      lessonId: lesson('fra3', 5),
      candidates: [{ itemId: HUARD, reason: 'expectation', overlap: 1 }],
    });
    const [day] = build(library);
    const plan = day!.plan;
    expect(plan.blocks.find((b) => b.key === frenchKey())?.library?.itemId).toBe(HUARD);
    const second = plan.blocks.find((b) => b.key === block(C3, 4, '11:15'))!;
    expect(second.lesson?.lessonId).toBe(lesson('fra3', 5));
    expect(second.library).toBeNull();

    // Over two days too: Friday's lesson 6 would get it, but Thursday already has it.
    library.lessonCandidates.push({
      lessonId: lesson('fra3', 6),
      candidates: [
        { itemId: HUARD, reason: 'expectation', overlap: 1 },
        { itemId: LESSON_PLAN, reason: 'expectation', overlap: 1 },
      ],
    });
    const days = build(library, isabelleSources(), thursday({ endsOn: WEEK.fri }));
    const uses = days.flatMap((d) =>
      d.plan.blocks.filter((b) => b.library).map((b) => b.library!.itemId),
    );
    expect(uses.filter((id) => id === HUARD)).toHaveLength(1);
    expect(uses).toContain(LESSON_PLAN);
  });

  it('keeps a lesson’s own resource for it when an earlier lesson shares its attente', () => {
    // Lesson 5 (11 h 15) links the huard; lesson 4 (8 h 55) comes first and has the huard as
    // its best candidate for their shared attente. Lesson 4 takes its next candidate instead.
    const library: RawLibrary = isabelleLibrary();
    library.lessonCandidates.push({
      lessonId: lesson('fra3', 5),
      candidates: [{ itemId: HUARD, reason: 'linked', overlap: 1 }],
    });
    const plan = build(library)[0]!.plan;
    const first = plan.blocks.find((b) => b.key === frenchKey())!;
    const second = plan.blocks.find((b) => b.key === block(C3, 4, '11:15'))!;
    expect(second.lesson?.lessonId).toBe(lesson('fra3', 5));
    expect(second.library).toMatchObject({ itemId: HUARD, reason: 'linked' });
    expect(first.library).toMatchObject({ itemId: LESSON_PLAN, reason: 'expectation' });

    // Only lessons the absence assigns keep a resource: lesson 6 (Friday) is not in this one.
    const later: RawLibrary = isabelleLibrary();
    later.lessonCandidates.push({
      lessonId: lesson('fra3', 6),
      candidates: [{ itemId: HUARD, reason: 'linked', overlap: 1 }],
    });
    const thursdayOnly = build(later)[0]!.plan;
    expect(thursdayOnly.blocks.find((b) => b.key === frenchKey())?.library?.itemId).toBe(HUARD);
  });
});

describe('librarySnapshot (domain 5, 6)', () => {
  const groups = [
    { key: 'G1', levelId: LEVEL.debutant },
    { key: 'G2', levelId: LEVEL.intermediaire },
    { key: 'G3', levelId: LEVEL.avance },
    { key: 'G4', levelId: LEVEL.enrichi },
    { key: 'G5', levelId: null },
  ];

  it('gives each group the version of its level, else the base version, one document per version', () => {
    const [huard] = libraryItems([demoLibraryItem('huard-oiseau-des-lacs')]);
    const snapshot = librarySnapshot(huard!, groups, { reason: 'expectation' })!;
    expect(snapshot.studentDocs.map((d) => d.groupKeys)).toEqual([
      ['G1'],
      ['G2'],
      ['G3'],
      ['G4'],
      ['G5'],
    ]);
    const text = (i: number) => JSON.stringify(snapshot.studentDocs[i]!.doc);
    expect(text(0)).toContain(HUARD_DEBUTANT);
    expect(text(4)).not.toContain(HUARD_DEBUTANT);

    // Only a Débutant version: the other groups share the base version's document.
    const [debutantOnly] = libraryItems([
      demoLibraryItem('huard-oiseau-des-lacs', { levels: ['debutant'] }),
    ]);
    const shared = librarySnapshot(debutantOnly!, groups, { reason: 'expectation' })!;
    expect(shared.studentDocs.map((d) => d.groupKeys)).toEqual([['G1'], ['G2', 'G3', 'G4', 'G5']]);

    // A class without groups (no students) still gets the base version, for everyone.
    const alone = librarySnapshot(huard!, [], { reason: 'expectation' })!;
    expect(alone.studentDocs.map((d) => d.groupKeys)).toEqual([[]]);
  });

  it('prints no version number and no level name on student documents', () => {
    const [huard] = libraryItems([demoLibraryItem('huard-oiseau-des-lacs')]);
    const snapshot = librarySnapshot(huard!, groups, { reason: 'expectation' })!;
    for (const { doc } of snapshot.studentDocs) {
      expect(doc.kind).toBe('student');
      expect(doc.number).toBeNull();
      expect(JSON.stringify(doc)).not.toMatch(/Débutant|Intermédiaire|Avancé|Enrichi/);
    }
    expect(snapshot.teacherDoc.kind).toBe('teacher');
  });

  it('has no student documents for a lesson plan, only its guide', () => {
    const [plan] = libraryItems([demoLibraryItem('idee-principale-paragraphe')]);
    const snapshot = librarySnapshot(plan!, groups, { reason: 'expectation' })!;
    expect(snapshot.studentDocs).toEqual([]);
    expect(snapshot.teacherDoc.blocks.length).toBeGreaterThan(0);
    expect(libraryStepText(snapshot)).toBe(
      'Suivez la ressource « Trouver l’idée principale d’un paragraphe » : voir « Guide de la ressource ».',
    );
  });

  it('never holds an answer key, and says one exists (domain 6)', () => {
    // A key sent by mistake with the resource is dropped when the sources are read.
    const raw = demoLibraryItem('huard-oiseau-des-lacs');
    const withKeys = {
      ...raw,
      answerKey: { solution: KEY_SENTINEL },
      versions: raw.versions.map((v) => ({
        ...v,
        answerKey: { answers: [{ sampleAnswer: KEY_SENTINEL }], solution: KEY_SENTINEL },
      })),
    };
    const library = { ...isabelleLibrary(), items: [withKeys] };
    const [day] = build(library);
    const french = day!.plan.blocks.find((b) => b.key === frenchKey())!;
    expect(french.library?.hasAnswerKey).toBe(true);
    expect(JSON.stringify(day!.plan)).not.toContain(KEY_SENTINEL);
    // Nor anything shaped like a key or an answer block of the key document.
    expect(JSON.stringify(day!.plan)).not.toMatch(
      /"(answerKey|answers|sampleAnswer|acceptableAnswers|correctChoiceIds|solution)"|"type":"answer"/,
    );
  });

  it('returns null for a resource without a base version', () => {
    const raw = demoLibraryItem('huard-oiseau-des-lacs');
    const [item] = libraryItems([{ ...raw, versions: raw.versions.filter((v) => v.levelId) }]);
    expect(librarySnapshot(item!, groups, { reason: 'expectation' })).toBeNull();
  });
});

describe('plans with resources (domain 7, 8, 10)', () => {
  it('puts the huard on a 3e Thursday’s Français period, with its step and no thin_lesson (domain 8)', () => {
    // Lesson 4 made thin: without a resource, the period is flagged.
    const raw = isabelleSources();
    raw.units = raw.units!.map((u) => ({
      ...u,
      lessons: u.lessons!.map((l) =>
        l.id === lesson('fra3', 4) ? { ...l, objectives: null, materials: null, content: null } : l,
      ),
    }));
    const without = build(null, raw)[0]!.plan.blocks.find((b) => b.key === frenchKey())!;
    expect(without.library).toBeNull();
    expect(without.warnings).toContain('thin_lesson');

    const plan = build(isabelleLibrary(), raw)[0]!.plan;
    expect(subPlanV1Schema.parse(plan)).toEqual(plan);
    const french = plan.blocks.find((b) => b.key === frenchKey())!;
    expect(french.lesson?.lessonId).toBe(lesson('fra3', 4));
    expect(french.library).toMatchObject({
      itemId: HUARD,
      title: 'Le huard, oiseau des lacs',
      type: 'reading_passage',
      boardApproved: true,
      reason: 'expectation',
      durationMinutes: 30,
    });
    expect(french.warnings).not.toContain('thin_lesson');
    const texts = french.steps.map((s) => s.text);
    const step = 'Distribuez « Le huard, oiseau des lacs » : voir « Matériel pour les élèves ».';
    expect(texts).toContain(step);
    // Handed out once the lesson is introduced, just before its main (longest) step.
    const at = texts.indexOf(step);
    expect(at).toBeGreaterThan(0);
    expect(french.steps[at]!.minutes).toBeNull();
    expect(french.steps[at + 1]!.minutes).toBe(
      Math.max(...french.steps.map((s) => s.minutes ?? 0)),
    );
    // The Débutant group gets the Débutant text.
    const debutants = plan.groups.find((g) => g.levelId === LEVEL.debutant)!;
    expect(debutants.studentIds).toEqual(expect.arrayContaining(DEBUTANTS_3E));
    const debutantDoc = french.library!.studentDocs.find((d) =>
      d.groupKeys.includes(debutants.key),
    )!;
    expect(JSON.stringify(debutantDoc.doc)).toContain(HUARD_DEBUTANT);

    // Mathématiques lesson 5 links its worksheet.
    const math = plan.blocks.find((b) => b.key === mathKey())!;
    expect(math.library).toMatchObject({ itemId: ORDONNER, reason: 'linked' });
    // Periods whose lesson was taught, routines and other subjects get nothing.
    expect(plan.blocks.filter((b) => b.library).map((b) => b.key)).toEqual([
      frenchKey(),
      mathKey(),
    ]);
  });

  it('takes resources off the last periods first when the plan grows too large (domain 7)', () => {
    // A huge text in every version: each snapshot is about 90 KB.
    const big = (id: string): RawLibraryItem => {
      const raw = variant('huard-oiseau-des-lacs', id);
      return {
        ...raw,
        versions: raw.versions.map((v) => ({
          ...v,
          content: { ...(v.content as object), text: 'Le huard plonge. '.repeat(1000) },
        })),
      };
    };
    const library = {
      lessonCandidates: [
        {
          lessonId: lesson('fra3', 4),
          candidates: [{ itemId: ID(11), reason: 'expectation', overlap: 1 }],
        },
        {
          lessonId: lesson('mat3', 5),
          candidates: [{ itemId: ID(12), reason: 'linked', overlap: 1 }],
        },
        {
          lessonId: lesson('fra3', 5),
          candidates: [{ itemId: ID(13), reason: 'expectation', overlap: 1 }],
        },
      ],
      items: [big(ID(11)), big(ID(12)), big(ID(13))],
    };
    const plan = build(library)[0]!.plan;
    const bytes = new TextEncoder().encode(JSON.stringify(plan)).length;
    expect(bytes).toBeLessThanOrEqual(MAX_LIBRARY_PLAN_BYTES);
    const withLibrary = plan.blocks.filter((b) => b.library).map((b) => b.key);
    expect(withLibrary).toEqual([frenchKey()]);
    expect(plan.warnings).toContainEqual({ code: 'library_trimmed', blockKey: null });
    // A period that lost its resource loses its step too.
    const math = plan.blocks.find((b) => b.key === mathKey())!;
    expect(math.steps.some((s) => s.text.startsWith('Distribuez'))).toBe(false);
  });

  it('still reads a Phase 3 plan without resources (domain 10)', () => {
    const plan = build(null)[0]!.plan;
    const phase3 = JSON.parse(JSON.stringify(plan)) as Record<string, unknown> & {
      blocks: Record<string, unknown>[];
    };
    for (const b of phase3.blocks) delete b.library;
    const parsed = subPlanV1Schema.parse(phase3);
    expect(parsed.blocks.every((b) => b.library === null)).toBe(true);
    expect(parsed).toEqual(plan);
  });

  it('reads the library part leniently: a bad resource is left out, a bad part is empty', () => {
    const raw = isabelleSources();
    const library = isabelleLibrary();
    const sources = subPlanSourcesSchema.parse({
      ...raw,
      library: {
        ...library,
        items: [...library.items, { id: ID(20), type: 'unknown_type', title: 'X' }],
      },
    });
    expect(sources.library.items.map((i) => i.id)).toEqual([HUARD, LESSON_PLAN, ORDONNER]);
    expect(subPlanSourcesSchema.parse({ ...raw, library: 'nonsense' }).library).toEqual({
      lessonCandidates: [],
      items: [],
    });
    expect(subPlanSourcesSchema.parse(raw).library.items).toEqual([]);
  });
});

describe('hiding a resource (domain 9) and the AI request (domain 11)', () => {
  const plan: SubPlanV1 = build()[0]!.plan;
  const french = plan.blocks.find((b) => b.key === frenchKey())!;
  const hide = subPlanEditsSchema.parse({
    blocks: { [frenchKey()]: { forLessonId: lesson('fra3', 4), hideLibrary: true } },
  });
  const step = libraryStepText(french.library!);

  it('takes the resource and its step out for every audience', () => {
    const audiences: SubPlanAudience[] = ['owner', 'staff', 'office', 'substitute', 'pdf'];
    for (const audience of audiences) {
      const composed = composeSubPlan(plan, { edits: hide, audience });
      const block = composed.blocks.find((b) => b.key === frenchKey())!;
      expect(block.library).toBeNull();
      expect(block.steps.map((s) => s.text)).not.toContain(step);
      expect(JSON.stringify(composed)).not.toContain(HUARD_DEBUTANT);
      // Only the owner learns what was hidden, to bring it back.
      expect(block.hiddenLibrary).toEqual(
        audience === 'owner'
          ? { itemId: HUARD, title: 'Le huard, oiseau des lacs', stepText: step }
          : null,
      );
    }
    // Without the edit, everyone sees it.
    const shown = composeSubPlan(plan, { audience: 'substitute' });
    const block = shown.blocks.find((b) => b.key === frenchKey())!;
    expect(block.library?.itemId).toBe(HUARD);
    expect(block.steps.map((s) => s.text)).toContain(step);
    expect(block.hiddenLibrary).toBeNull();
  });

  it('takes its step out of the teacher’s own steps and the AI’s too', () => {
    // She edited the steps first (the editor starts from the composed ones, step included).
    const edited = subPlanEditsSchema.parse({
      blocks: {
        [frenchKey()]: {
          forLessonId: lesson('fra3', 4),
          hideLibrary: true,
          steps: [
            { minutes: 5, text: 'Rappel de la leçon.' },
            { minutes: null, text: step },
            { minutes: 30, text: 'Lecture en équipes.' },
          ],
        },
      },
    });
    const composed = composeSubPlan(plan, { edits: edited, audience: 'substitute' });
    expect(composed.blocks.find((b) => b.key === frenchKey())!.steps.map((s) => s.text)).toEqual([
      'Rappel de la leçon.',
      'Lecture en équipes.',
    ]);

    const ai: SubPlanAiLayer = {
      jobId: 'job',
      appliedAt: NOW.toISOString(),
      refs: [{ key: 'B1', ref: { blockKey: frenchKey(), lessonId: lesson('fra3', 4) } }],
      result: {
        dayOverview: '',
        blocks: [
          {
            key: 'B1',
            overview: 'Aperçu',
            steps: [
              { minutes: 2, instruction: step, say: '' },
              { minutes: 20, instruction: 'Lecture guidée.', say: '' },
            ],
            differentiation: [],
            ifTimeRemains: '',
            materialsChecklist: [],
            activity: null,
          },
        ],
        faithSentence: '',
      },
    };
    const withAi = composeSubPlan(plan, { edits: hide, ai, audience: 'substitute' });
    expect(withAi.blocks.find((b) => b.key === frenchKey())!.steps.map((s) => s.text)).toEqual([
      'Lecture guidée.',
    ]);
  });

  it('applies only while the block keeps its lesson, and shows no detached edit', () => {
    const stale = subPlanEditsSchema.parse({
      blocks: { [frenchKey()]: { forLessonId: lesson('fra3', 5), hideLibrary: true } },
    });
    const composed = composeSubPlan(plan, { edits: stale, audience: 'owner' });
    expect(composed.blocks.find((b) => b.key === frenchKey())!.library?.itemId).toBe(HUARD);
    expect(composed.detachedEdits).toEqual([]);
  });

  it('asks the AI for no activity in a period with a resource, and names it (domain 11)', () => {
    const levels = isabelleSources().levels!.map((l) => ({
      id: l.id,
      labelFr: l.labelFr,
      descriptionFr: l.descriptionFr ?? null,
    }));
    const input = buildSubPlanAiInput(composeSubPlan(plan, { audience: 'owner' }), levels);
    const b = input.blocks.find((x) => x.ref.blockKey === frenchKey())!;
    expect(b.needsActivity).toBe(false);
    expect(b.lesson?.subNotes).toContain(
      'Activité prévue : « Le huard, oiseau des lacs » (Texte de lecture).',
    );
    // The teacher's own note stays first.
    expect(b.lesson?.subNotes?.startsWith('Les élèves au niveau Débutant')).toBe(true);
    expect(JSON.stringify(input)).not.toContain(HUARD_DEBUTANT);

    // Hidden: the period is back to its own lesson.
    const hidden = buildSubPlanAiInput(
      composeSubPlan(plan, { edits: hide, audience: 'owner' }),
      levels,
    );
    const again = hidden.blocks.find((x) => x.ref.blockKey === frenchKey())!;
    expect(again.lesson?.subNotes).not.toContain('Activité prévue');
  });
});
