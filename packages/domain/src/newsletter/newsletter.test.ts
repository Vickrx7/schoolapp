import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../calendar';
import type { ProgressStatus } from '../lessons';
import type { TimetableBlock } from '../school-day';
import { buildNewsletterDraft, type NewsletterPhrases } from './build';
import {
  emptyNewsletterContent,
  englishState,
  fixTypography,
  mergeRefill,
  needsEnglish,
  newsletterContentSchema,
  newsletterItemId,
  newsletterWordNotes,
  typedItem,
  withTeacherEnglish,
  type NewsletterContent,
  type NewsletterItem,
} from './content';
import {
  newsletterDatesWindow,
  newsletterFacts,
  type NewsletterFactsInput,
  type NewsletterGuide,
  type NewsletterReference,
  type NewsletterUnit,
} from './facts';
import { NEWSLETTER_LIST_SECTIONS, newsletterParagraph, newsletterPlainText } from './text';

// ---------------------------------------------------------------------------------------
// Fixtures: a 3e année class, Monday 5 October 2026, prepared on Thursday the 8th.
// ---------------------------------------------------------------------------------------

const CLASS = 'c1';
const ME = 't1';
const COLLEAGUE = 't2';
const MAT = 'mat';
const FRA = 'fra';
const EPS = 'eps';

const block = (
  id: string,
  dayKey: number,
  startTime: string,
  subjectId: string,
  teacherId: string | null = null,
): TimetableBlock => ({
  id,
  classId: CLASS,
  dayKey,
  startTime,
  endTime: `${String(Number(startTime.slice(0, 2)) + 1).padStart(2, '0')}:00`,
  kind: 'subject',
  subjectId,
  title: null,
  teacherId,
  roomId: null,
});

const BLOCKS: TimetableBlock[] = [1, 2, 3, 4, 5].flatMap((d) => [
  block(`mat${d}`, d, '09:00', MAT),
  block(`fra${d}`, d, '10:00', FRA),
  ...(d === 2 ? [block('eps2', 2, '13:00', EPS, COLLEAGUE)] : []),
]);

const lessons = (unit: string, n: number, extra: Partial<NewsletterUnit['lessons'][number]> = {}) =>
  Array.from({ length: n }, (_, i) => ({
    id: `${unit}-l${i + 1}`,
    sequenceNumber: i + 1,
    title: `${unit} leçon ${i + 1}`,
    expectationIds: [],
    libraryItemId: null,
    ...extra,
  }));

const UNITS: NewsletterUnit[] = [
  {
    id: 'u-mat',
    subjectId: MAT,
    title: 'Les nombres jusqu’à 1 000',
    status: 'active',
    plannedStartOn: null,
    plannedEndOn: null,
    expectationIds: [],
    lessons: lessons('u-mat', 8).map((l) =>
      l.sequenceNumber === 5 ? { ...l, expectationIds: ['b1.2'] } : l,
    ),
  },
  {
    id: 'u-fra',
    subjectId: FRA,
    title: 'Lire pour s’informer',
    status: 'active',
    plannedStartOn: null,
    plannedEndOn: null,
    expectationIds: [],
    lessons: lessons('u-fra', 12),
  },
  {
    id: 'u-eps',
    subjectId: EPS,
    title: 'Les sports d’équipe',
    status: 'active',
    plannedStartOn: null,
    plannedEndOn: null,
    expectationIds: [],
    lessons: lessons('u-eps', 6),
  },
  {
    id: 'u-mat2',
    subjectId: MAT,
    title: 'L’addition et la soustraction',
    status: 'planned',
    plannedStartOn: '2026-10-13',
    plannedEndOn: '2026-11-06',
    expectationIds: [],
    lessons: [],
  },
];

const event = (
  e: Partial<CalendarEvent> & Pick<CalendarEvent, 'id' | 'eventType' | 'startsOn'>,
): CalendarEvent => ({
  title: e.eventType,
  endsOn: e.startsOn,
  startTime: null,
  endTime: null,
  affectsSchedule: true,
  classId: null,
  ...e,
});

const EVENTS: CalendarEvent[] = [
  event({ id: 'pa', eventType: 'pa_day', title: 'Journée pédagogique', startsOn: '2026-10-09' }),
  event({ id: 'thanks', eventType: 'holiday', title: 'Action de grâce', startsOn: '2026-10-12' }),
  event({
    id: 'mass',
    eventType: 'mass',
    title: 'Messe de l’Action de grâce',
    startsOn: '2026-10-08',
    startTime: '10:00',
    endTime: '11:00',
    affectsSchedule: false,
  }),
  event({
    id: 'assembly',
    eventType: 'assembly',
    title: 'Rassemblement : collecte d’aliments',
    startsOn: '2026-10-14',
    startTime: '12:05',
    endTime: '12:30',
    affectsSchedule: false,
  }),
  event({
    id: 'early',
    eventType: 'early_dismissal',
    title: 'Rencontres parents-enseignants',
    startsOn: '2026-10-22',
    startTime: '13:35',
  }),
  event({
    id: 'staff',
    eventType: 'other',
    title: 'Réunion du personnel',
    startsOn: '2026-10-15',
    affectsSchedule: false,
  }),
  event({
    id: 'other-class',
    eventType: 'field_trip',
    title: 'Sortie de l’autre classe',
    startsOn: '2026-10-15',
    classId: 'c2',
  }),
  event({
    id: 'trip',
    eventType: 'field_trip',
    title: 'Sortie au musée',
    startsOn: '2026-10-21',
    startTime: '09:00',
    classId: CLASS,
    affectsSchedule: false,
  }),
];

const progress = new Map<string, ProgressStatus>([
  ['u-mat-l1', 'completed'],
  ['u-mat-l2', 'pending_confirmation'],
  ['u-mat-l3', 'skipped'],
  ['u-fra-l1', 'completed'],
  ['u-eps-l1', 'completed'],
]);
const taughtOn = new Map<string, string | null>([
  ['u-mat-l1', '2026-10-05'],
  ['u-mat-l2', '2026-10-06'],
  ['u-mat-l3', '2026-10-07'],
  ['u-fra-l1', '2026-09-30'],
  ['u-eps-l1', '2026-10-06'],
]);

const REFS: NewsletterReference[] = [
  {
    id: 'r-respect',
    boardId: 'b1',
    type: 'virtue',
    title: 'Le respect',
    textFr: 'Je traite les autres comme j’aimerais être traité.',
    textEn: 'I treat others the way I would like to be treated.',
    gradeMin: -1,
    gradeMax: 8,
    liturgicalSeason: null,
    tags: ['respect'],
  },
  {
    id: 'r-merci',
    boardId: 'b1',
    type: 'reflection',
    title: 'Dire merci',
    textFr: 'Nomme trois personnes pour lesquelles tu veux dire merci.',
    textEn: null,
    gradeMin: -1,
    gradeMax: 8,
    liturgicalSeason: 'temps_ordinaire',
    tags: ['gratitude', 'action de grâce'],
  },
  {
    id: 'r-avent',
    boardId: 'b1',
    type: 'prayer',
    title: 'Prière de l’Avent',
    textFr: 'Seigneur, rends nos cœurs prêts. Amen.',
    textEn: 'Lord, make our hearts ready. Amen.',
    gradeMin: -1,
    gradeMax: 8,
    liturgicalSeason: 'avent',
    tags: ['avent'],
  },
];

const guide = (id: string, expectationIds: string[], n = 5): NewsletterGuide => ({
  id,
  title: `Guide ${id}`,
  expectationIds,
  atHomeFr: Array.from({ length: n }, (_, i) => `conseil ${id} ${i + 1}`),
  atHomeEn: Array.from({ length: n - 1 }, (_, i) => `tip ${id} ${i + 1}`),
});

function input(overrides: Partial<NewsletterFactsInput> = {}): NewsletterFactsInput {
  return {
    classId: CLASS,
    weekOf: '2026-10-05',
    preparedOn: '2026-10-08',
    year: { startsOn: '2026-09-01', endsOn: '2027-06-30' },
    schedule: { type: 'weekly' },
    events: EVENTS,
    blocks: BLOCKS,
    units: UNITS,
    progress,
    taughtOn,
    periods: [
      {
        kind: 'progress',
        startsOn: '2026-09-01',
        endsOn: '2026-10-30',
        dueOn: '2026-11-06',
        issuedOn: '2026-10-20',
      },
      {
        kind: 'term1',
        startsOn: '2026-09-01',
        endsOn: '2027-01-29',
        dueOn: null,
        issuedOn: '2027-02-12',
      },
    ],
    subjects: new Map([
      [MAT, { fr: 'Mathématiques', en: 'Mathematics' }],
      [FRA, { fr: 'Français', en: 'French' }],
      [EPS, { fr: 'Éducation physique et santé', en: 'Health and Physical Education' }],
    ]),
    teacherId: ME,
    homeroom: true,
    includeColleagues: false,
    refs: REFS,
    gradeOrdinals: [3],
    boardId: 'b1',
    guides: [],
    expectationParents: new Map(),
    ...overrides,
  };
}

const titles = (line: { lessons: { title: string }[] }) => line.lessons.map((l) => l.title);

// ---------------------------------------------------------------------------------------
// The content
// ---------------------------------------------------------------------------------------

const app = (fr: string, en = `EN ${fr}`): NewsletterItem => ({
  id: newsletterItemId(),
  fr,
  en,
  enFrom: fr,
  enBy: 'app',
  from: { kind: 'lesson' },
});

function contentWith(items: Partial<Record<string, NewsletterItem[]>>): NewsletterContent {
  const content = emptyNewsletterContent('Mme Tremblay');
  return {
    ...content,
    sections: content.sections.map((s) => ({ ...s, items: items[s.key] ?? [] })),
  };
}

describe('newsletterContentSchema (D-137)', () => {
  it('takes every section once, in order, with unique paragraph ids', () => {
    const content = contentWith({ message: [typedItem('abcd1234', 'Bonjour')] });
    expect(newsletterContentSchema.safeParse(content).success).toBe(true);
    const swapped = {
      ...content,
      sections: [content.sections[1]!, content.sections[0]!, ...content.sections.slice(2)],
    };
    expect(newsletterContentSchema.safeParse(swapped).success).toBe(false);
    expect(
      newsletterContentSchema.safeParse({ ...content, sections: content.sections.slice(1) })
        .success,
    ).toBe(false);
    const twice = contentWith({
      message: [typedItem('abcd1234', 'Un')],
      reminders: [typedItem('abcd1234', 'Deux')],
    });
    expect(newsletterContentSchema.safeParse(twice).success).toBe(false);
    expect(
      newsletterContentSchema.safeParse(contentWith({ message: [typedItem('ABCD1234', 'x')] }))
        .success,
    ).toBe(false);
  });

  it('limits the texts, the paragraphs and the size', () => {
    const tooLong = contentWith({ message: [typedItem('abcd1234', 'é'.repeat(1001))] });
    const result = newsletterContentSchema.safeParse(tooLong);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('tooLong');
    expect(
      newsletterContentSchema.safeParse(
        contentWith({ message: [typedItem('abcd1234', 'é'.repeat(1000))] }),
      ).success,
    ).toBe(true);
    const thirteen = Array.from({ length: 13 }, () => typedItem(newsletterItemId(), 'x'));
    expect(newsletterContentSchema.safeParse(contentWith({ reminders: thirteen })).success).toBe(
      false,
    );
    const many = Object.fromEntries(
      ['message', 'thisWeek', 'nextWeek', 'dates', 'reminders', 'atHome'].map((k) => [
        k,
        Array.from({ length: 11 }, () => typedItem(newsletterItemId(), 'x')),
      ]),
    );
    expect(newsletterContentSchema.safeParse(contentWith(many)).success).toBe(false);
    const heavy = Object.fromEntries(
      ['message', 'thisWeek', 'nextWeek', 'dates'].map((k) => [
        k,
        Array.from({ length: 10 }, () =>
          withTeacherEnglish(typedItem(newsletterItemId(), 'é'.repeat(900)), 'e'.repeat(1400)),
        ),
      ]),
    );
    expect(newsletterContentSchema.safeParse(contentWith(heavy)).error?.issues[0]?.message).toBe(
      'tooLong',
    );
    expect(
      newsletterContentSchema.safeParse({ ...contentWith({}), signature: 'x'.repeat(121) }).success,
    ).toBe(false);
  });

  it('gives new paragraphs eight lowercase letters or digits', () => {
    expect(newsletterItemId()).toMatch(/^[a-z0-9]{8}$/);
    expect(newsletterItemId(() => 0)).toBe('aaaaaaaa');
  });
});

describe('the English of a paragraph', () => {
  it('says where each paragraph’s English stands', () => {
    const line = app('Mathématiques : « Comparer des nombres »');
    expect(englishState(line)).toBe('app');
    expect(englishState({ ...line, enBy: 'ai' })).toBe('ai');
    expect(englishState({ ...line, fr: `${line.fr}, « Ordonner »` })).toBe('stale');
    // Only spaces or apostrophes changed: still the same French.
    expect(englishState({ ...line, fr: line.fr.replace(' :', '\u00a0:') })).toBe('app');
    expect(englishState(typedItem('abcd1234', 'Bravo!'))).toBe('missing');
    expect(englishState(typedItem('abcd1234', 'Bravo!', 'Well done!'))).toBe('teacher');
    expect(englishState(typedItem('abcd1234'))).toBe('none');
    expect(needsEnglish(typedItem('abcd1234', 'Bravo!'))).toBe(true);
    expect(needsEnglish({ ...line, fr: 'Autre chose' })).toBe(true);
    expect(needsEnglish(line)).toBe(false);
    expect(needsEnglish(typedItem('abcd1234'))).toBe(false);
  });

  it('makes English typed by the teacher hers, for the French as it is now', () => {
    const edited = { ...app('Avant'), fr: 'Après' };
    expect(englishState(edited)).toBe('stale');
    const written = withTeacherEnglish(edited, 'After');
    expect(written).toMatchObject({ en: 'After', enFrom: 'Après', enBy: 'teacher' });
    expect(englishState(written)).toBe('teacher');
    expect(withTeacherEnglish(written, '  ')).toMatchObject({ enFrom: null, enBy: null });
  });
});

describe('mergeRefill (« Préremplir à nouveau »)', () => {
  it('replaces the app’s paragraphs and keeps the typed ones in their place', () => {
    const greeting = { ...app('Bonjour'), from: { kind: 'greeting' as const } };
    const mine = typedItem('mine0001', 'Bravo à tous!');
    const closingNote = typedItem('mine0002', 'Merci!');
    const current = contentWith({
      message: [greeting, mine],
      thisWeek: [app('Vieille ligne')],
      closing: [closingNote, { ...app('Bonne fin de semaine!'), from: { kind: 'closing' } }],
    });
    current.sections[6] = { ...current.sections[6]!, off: true };
    const fresh = contentWith({
      message: [{ ...app('Bonjour chères familles,'), from: { kind: 'greeting' } }],
      thisWeek: [app('Nouvelle ligne 1'), app('Nouvelle ligne 2')],
      closing: [{ ...app('Bonne semaine!'), from: { kind: 'closing' } }],
    });
    const merged = mergeRefill({ ...current, signature: 'M. B.' }, fresh);
    const fr = (key: string) => merged.sections.find((s) => s.key === key)!.items.map((i) => i.fr);
    expect(fr('message')).toEqual(['Bonjour chères familles,', 'Bravo à tous!']);
    expect(fr('thisWeek')).toEqual(['Nouvelle ligne 1', 'Nouvelle ligne 2']);
    expect(fr('closing')).toEqual(['Merci!', 'Bonne semaine!']);
    expect(merged.signature).toBe('M. B.');
    expect(merged.sections[6]!.off).toBe(true);
    expect(newsletterContentSchema.safeParse(merged).success).toBe(true);
  });
});

describe('« Corriger la typographie » (D-140)', () => {
  it('fixes the French only, and keeps an English written for it up to date', () => {
    const line = withTeacherEnglish(
      typedItem('abcd1234', "L'école : c'est la 3ème semaine !"),
      'Week 3!',
    );
    const fixed = fixTypography(contentWith({ message: [line] })).sections[0]!.items[0]!;
    expect(fixed.fr).toBe('L’école\u00a0: c’est la 3e semaine!');
    expect(fixed.en).toBe('Week 3!');
    expect(englishState(fixed)).toBe('teacher');
    expect(fixTypography(fixTypography(contentWith({ message: [line] })))).toEqual(
      fixTypography(contentWith({ message: [line] })),
    );
    expect(
      fixTypography(contentWith({ message: [typedItem('abcd1234', 'Pause ; reprise « oui »')] }))
        .sections[0]!.items[0]!.fr,
    ).toBe('Pause\u202f; reprise «\u00a0oui\u00a0»');
  });

  it('points out words to change by hand', () => {
    const content = contentWith({
      message: [typedItem('abcd1234', 'Bon week-end et bon Week-end!')],
    });
    expect(newsletterWordNotes(content)).toEqual([{ itemId: 'abcd1234', word: 'week-end' }]);
  });
});

// ---------------------------------------------------------------------------------------
// The facts
// ---------------------------------------------------------------------------------------

describe('newsletterFacts: the lessons (D-137)', () => {
  it('this week: the lessons taught or reported, then the timetable’s until Friday', () => {
    const facts = newsletterFacts(input());
    // French: lesson 1 was taught the week before, lesson 2 comes on Thursday.
    expect(facts.thisWeek.map((l) => l.subjectId)).toEqual([FRA, MAT]);
    expect(titles(facts.thisWeek[0]!)).toEqual(['u-fra leçon 2']);
    // Lesson 1 completed, 2 reported by a substitute, 3 skipped (left out), 4 on Thursday; Friday
    // is a PA day.
    expect(titles(facts.thisWeek[1]!)).toEqual(['u-mat leçon 1', 'u-mat leçon 2', 'u-mat leçon 4']);
    expect(facts.thisWeek[1]).toMatchObject({
      unitId: 'u-mat',
      unitTitle: 'Les nombres jusqu’à 1 000',
      subject: { fr: 'Mathématiques', en: 'Mathematics' },
    });
  });

  it('next week: the sequence carries on across the PA day and the holiday', () => {
    const facts = newsletterFacts(input());
    const mat = facts.nextWeek.find((l) => l.subjectId === MAT)!;
    // Monday is Thanksgiving: Tuesday to Friday.
    expect(titles(mat)).toEqual([
      'u-mat leçon 5',
      'u-mat leçon 6',
      'u-mat leçon 7',
      'u-mat leçon 8',
    ]);
    const fra = facts.nextWeek.find((l) => l.subjectId === FRA)!;
    // French on Thursday (lesson 2), then Tuesday to Friday next week.
    expect(titles(fra)).toEqual([
      'u-fra leçon 3',
      'u-fra leçon 4',
      'u-fra leçon 5',
      'u-fra leçon 6',
    ]);
    expect(facts.nextLessonsOnly).toBe(false);
  });

  it('leaves out a colleague’s subjects unless asked', () => {
    const mine = newsletterFacts(input());
    expect([...mine.thisWeek, ...mine.nextWeek].some((l) => l.subjectId === EPS)).toBe(false);
    const all = newsletterFacts(input({ includeColleagues: true }));
    expect(all.thisWeek.map((l) => l.subjectId)).toEqual([EPS, FRA, MAT]);
    expect(titles(all.nextWeek.find((l) => l.subjectId === EPS)!)).toEqual(['u-eps leçon 2']);
    // The colleague gets her own subject only.
    const hers = newsletterFacts(input({ teacherId: COLLEAGUE, homeroom: false }));
    expect(hers.thisWeek.map((l) => l.subjectId)).toEqual([EPS]);
    expect(hers.nextWeek.map((l) => l.subjectId)).toEqual([EPS]);
    expect(hers.unitStarts).toEqual([]);
  });

  it('a cycle school without an anchor: the next lessons of each unit', () => {
    const facts = newsletterFacts(
      input({ schedule: { type: 'cycle', cycleLength: 6, anchors: [] } }),
    );
    expect(facts.nextLessonsOnly).toBe(true);
    expect(titles(facts.nextWeek.find((l) => l.subjectId === MAT)!)).toEqual([
      'u-mat leçon 4',
      'u-mat leçon 5',
      'u-mat leçon 6',
    ]);
    // This week: what was taught only.
    expect(facts.thisWeek.map((l) => l.subjectId)).toEqual([MAT]);
    expect(titles(facts.thisWeek[0]!)).toEqual(['u-mat leçon 1', 'u-mat leçon 2']);
  });

  it('a planned unit starting next week (« Mon année »)', () => {
    expect(newsletterFacts(input()).unitStarts).toEqual([
      {
        subjectId: MAT,
        subject: { fr: 'Mathématiques', en: 'Mathematics' },
        unitId: 'u-mat2',
        title: 'L’addition et la soustraction',
        startsOn: '2026-10-13',
      },
    ]);
    // Prepared a week earlier, it is not next week’s yet.
    expect(
      newsletterFacts(input({ weekOf: '2026-09-28', preparedOn: '2026-10-01' })).unitStarts,
    ).toEqual([]);
  });
});

describe('newsletterFacts: prepared ahead, and the school year’s edges (post-MVP review)', () => {
  // Mathématiques every day at 9:00, a unit of 40 lessons.
  const daily: NewsletterFactsInput['blocks'] = [1, 2, 3, 4, 5].map((day) => ({
    id: `mat-${day}`,
    classId: CLASS,
    dayKey: day,
    startTime: '09:00',
    endTime: '10:00',
    kind: 'subject' as const,
    subjectId: MAT,
    title: null,
    teacherId: null,
    roomId: null,
  }));
  const lessons = Array.from({ length: 40 }, (_, i) => ({
    id: `l${i + 1}`,
    sequenceNumber: i + 1,
    title: `Leçon ${i + 1}`,
    expectationIds: [],
    libraryItemId: null,
  }));
  const unit = {
    id: 'u-daily',
    subjectId: MAT,
    title: 'Nombres',
    status: 'active' as const,
    plannedStartOn: null,
    plannedEndOn: null,
    expectationIds: [],
    lessons,
  };
  const daysOf = (overrides: Partial<NewsletterFactsInput>) => {
    const facts = newsletterFacts(
      input({
        events: [],
        blocks: daily,
        units: [unit],
        progress: new Map(),
        taughtOn: new Map(),
        ...overrides,
      }),
    );
    return {
      thisWeek: facts.thisWeek.flatMap(titles),
      nextWeek: facts.nextWeek.flatMap(titles),
    };
  };

  it('prepared during the week before: that week’s lessons stay in it', () => {
    // Lessons 1 and 2 given Monday and Tuesday 5 and 6 October; prepared on Wednesday the 7th.
    const given = {
      progress: new Map([
        ['l1', 'completed' as const],
        ['l2', 'completed' as const],
      ]),
      taughtOn: new Map([
        ['l1', '2026-10-05'],
        ['l2', '2026-10-06'],
      ]),
    };
    const ahead = daysOf({ ...given, weekOf: '2026-10-12', preparedOn: '2026-10-07' });
    // Wednesday to Friday take lessons 3 to 5: the week of the 12th starts at lesson 6.
    expect(ahead.thisWeek).toEqual(['Leçon 6', 'Leçon 7', 'Leçon 8', 'Leçon 9', 'Leçon 10']);
    expect(ahead.nextWeek).toEqual(['Leçon 11', 'Leçon 12', 'Leçon 13', 'Leçon 14', 'Leçon 15']);
    // The same day, this week's message: what was given, then the rest of the week.
    const current = daysOf({ ...given, weekOf: '2026-10-05', preparedOn: '2026-10-07' });
    expect(current.thisWeek).toEqual(['Leçon 1', 'Leçon 2', 'Leçon 3', 'Leçon 4', 'Leçon 5']);
    expect(current.nextWeek).toEqual(['Leçon 6', 'Leçon 7', 'Leçon 8', 'Leçon 9', 'Leçon 10']);
  });

  it('gives no lesson before the year starts or after it ends', () => {
    const year = { startsOn: '2026-09-02', endsOn: '2027-06-25' };
    // The year starts on a Wednesday: three lessons that week.
    expect(daysOf({ year, weekOf: '2026-08-31', preparedOn: '2026-08-28' }).thisWeek).toEqual([
      'Leçon 1',
      'Leçon 2',
      'Leçon 3',
    ]);
    // The last week: nothing « la semaine prochaine ».
    const last = daysOf({ year, weekOf: '2027-06-21', preparedOn: '2027-06-21' });
    expect(last.thisWeek).toEqual(['Leçon 1', 'Leçon 2', 'Leçon 3', 'Leçon 4', 'Leçon 5']);
    expect(last.nextWeek).toEqual([]);
  });
});

describe('newsletterFacts: the dates to remember', () => {
  it('from the day after the preparation to the Friday two weeks later', () => {
    expect(newsletterDatesWindow('2026-10-05', '2026-10-08')).toEqual({
      startsOn: '2026-10-09',
      endsOn: '2026-10-23',
    });
    // A week still to come: from its Monday.
    expect(newsletterDatesWindow('2026-10-12', '2026-10-08')).toEqual({
      startsOn: '2026-10-12',
      endsOn: '2026-10-30',
    });
  });

  it('days off, times, events of the class, the report going home; never another class’s or a staff event', () => {
    const dates = newsletterFacts(input()).dates;
    expect(dates).toEqual([
      {
        kind: 'dayOff',
        id: 'pa',
        from: '2026-10-09',
        to: '2026-10-09',
        title: 'Journée pédagogique',
        type: 'pa_day',
      },
      {
        kind: 'dayOff',
        id: 'thanks',
        from: '2026-10-12',
        to: '2026-10-12',
        title: 'Action de grâce',
        type: 'holiday',
      },
      {
        kind: 'event',
        id: 'assembly',
        from: '2026-10-14',
        to: '2026-10-14',
        time: '12:05',
        title: 'Rassemblement : collecte d’aliments',
        type: 'assembly',
      },
      { kind: 'report', from: '2026-10-20', period: 'progress' },
      {
        kind: 'event',
        id: 'trip',
        from: '2026-10-21',
        to: '2026-10-21',
        time: '09:00',
        title: 'Sortie au musée',
        type: 'field_trip',
      },
      {
        kind: 'earlyDismissal',
        id: 'early',
        from: '2026-10-22',
        time: '13:35',
        title: 'Rencontres parents-enseignants',
        type: 'early_dismissal',
      },
    ]);
  });

  it('a liturgical season starting: Advent on 29 November 2026', () => {
    const dates = newsletterFacts(input({ weekOf: '2026-11-23', preparedOn: '2026-11-20' })).dates;
    expect(dates.filter((d) => d.kind === 'season')).toEqual([
      { kind: 'season', from: '2026-11-29', season: 'avent' },
    ]);
  });

  it('a holiday over several days is one line, cut to the window', () => {
    const dates = newsletterFacts(
      input({
        weekOf: '2026-12-14',
        preparedOn: '2026-12-17',
        events: [
          event({
            id: 'xmas',
            eventType: 'holiday',
            title: 'Congé des Fêtes',
            startsOn: '2026-12-21',
            endsOn: '2027-01-01',
          }),
        ],
      }),
    ).dates;
    expect(dates.filter((d) => d.kind === 'dayOff')).toEqual([
      {
        kind: 'dayOff',
        id: 'xmas',
        from: '2026-12-21',
        to: '2027-01-01',
        title: 'Congé des Fêtes',
        type: 'holiday',
      },
    ]);
  });
});

describe('newsletterFacts: the guides and the faith moment', () => {
  it('guides a lesson uses, then those about an attente of the units (D-069), at most 2 × 3 tips', () => {
    const units = UNITS.map((u) =>
      u.id === 'u-fra'
        ? {
            ...u,
            lessons: u.lessons.map((l) =>
              l.sequenceNumber === 9 ? { ...l, libraryItemId: 'g-linked' } : l,
            ),
          }
        : u,
    );
    const facts = newsletterFacts(
      input({
        units,
        guides: [
          guide('g-other', ['c9']),
          guide('g-parent', ['b1']),
          guide('g-linked', []),
          guide('g-exact', ['b1.2']),
        ],
        // B1.2 is a specific attente of B1.
        expectationParents: new Map([
          ['b1.2', 'b1'],
          ['b1', null],
          ['c9', null],
        ]),
      }),
    );
    expect(facts.guides.map((g) => g.id)).toEqual(['g-linked', 'g-parent']);
    expect(facts.guides[1]!.tips).toEqual([
      { fr: 'conseil g-parent 1', en: 'tip g-parent 1' },
      { fr: 'conseil g-parent 2', en: 'tip g-parent 2' },
      { fr: 'conseil g-parent 3', en: 'tip g-parent 3' },
    ]);
    // A tip without its English keeps an empty English.
    const short = newsletterFacts(
      input({ guides: [guide('g-exact', ['b1.2'], 2)], expectationParents: new Map() }),
    );
    expect(short.guides[0]!.tips).toEqual([
      { fr: 'conseil g-exact 1', en: 'tip g-exact 1' },
      { fr: 'conseil g-exact 2', en: '' },
    ]);
    expect(newsletterFacts(input()).guides).toEqual([]);
  });

  it('the faith moment follows the week’s season and words, the same each time', () => {
    // Thanksgiving week, Ordinary Time: « Dire merci » matches the holiday and the mass.
    const october = newsletterFacts(input());
    expect(october.faith?.id).toBe('r-merci');
    expect(newsletterFacts(input()).faith?.id).toBe('r-merci');
    const advent = newsletterFacts(input({ weekOf: '2026-11-30', preparedOn: '2026-12-03' }));
    expect(advent.faith?.id).not.toBe('r-merci');
    expect(newsletterFacts(input({ refs: [] })).faith).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------
// The draft and the text
// ---------------------------------------------------------------------------------------

function stub(lang: 'fr' | 'en'): NewsletterPhrases {
  const q = (s: string) => (lang === 'fr' ? `« ${s} »` : `“${s}”`);
  return {
    greeting: lang === 'fr' ? 'Bonjour chères familles,' : 'Dear families,',
    closing: lang === 'fr' ? 'Bonne fin de semaine!' : 'Have a good weekend!',
    lessons: (l) => `${l.subject} (${q(l.unit)}): ${l.lessons.map(q).join(', ')}`,
    nextLessons: (l) => `${l.subject} next: ${l.lessons.map(q).join(', ')}`,
    unitStart: (s) => `${s.subject}: ${q(s.title)} ${s.date}`,
    dayOff: (d) => `${d.from}–${d.to}: ${lang} no school (${d.title})`,
    earlyDismissal: (d) => `${d.date}: ${lang} early ${d.time}`,
    lateStart: (d) => `${d.date}: ${lang} late ${d.time}`,
    event: (d) => `${d.from} ${d.time}: ${lang} ${d.type} ${q(d.title)}`,
    report: (d) => `${d.date}: ${lang} report ${d.period}`,
    season: (d) => `${d.date}: ${lang} ${d.season}`,
    tip: (t) => `${t[0]!.toUpperCase()}${t.slice(1)}.`,
    faith: (r) => `${lang} ${r.type}: ${r.text}`,
  };
}

let counter = 0;
const ids = () => `id${String(counter++).padStart(6, '0')}`;

describe('buildNewsletterDraft (D-137)', () => {
  const facts = newsletterFacts(
    input({
      guides: [guide('g-exact', ['b1.2'], 2)],
      expectationParents: new Map(),
    }),
  );
  const draft = buildNewsletterDraft(
    facts,
    { fr: stub('fr'), en: stub('en') },
    { signature: 'Mme Tremblay', faith: true, guides: true },
    ids,
  );
  const section = (key: string) => draft.sections.find((s) => s.key === key)!;

  it('writes every line in both languages, the app’s English up to date', () => {
    expect(newsletterContentSchema.safeParse(draft).error?.issues).toBeUndefined();
    expect(draft.signature).toBe('Mme Tremblay');
    expect(section('message').items).toMatchObject([
      {
        fr: 'Bonjour chères familles,',
        en: 'Dear families,',
        enBy: 'app',
        from: { kind: 'greeting' },
      },
    ]);
    const mat = section('thisWeek').items[1]!;
    // The app's typography: no-break spaces in « » and before the colon.
    expect(mat.fr).toBe(
      'Mathématiques («\u00a0Les nombres jusqu’à 1 000\u00a0»)\u00a0: «\u00a0u-mat leçon 1\u00a0», «\u00a0u-mat leçon 2\u00a0», «\u00a0u-mat leçon 4\u00a0»',
    );
    expect(mat.en).toBe(
      'Mathematics (“Les nombres jusqu’à 1 000”): “u-mat leçon 1”, “u-mat leçon 2”, “u-mat leçon 4”',
    );
    expect(mat).toMatchObject({
      enFrom: mat.fr,
      enBy: 'app',
      from: { kind: 'lesson', ref: 'u-mat' },
    });
    expect(englishState(mat)).toBe('app');
    expect(section('nextWeek').items.at(-1)).toMatchObject({
      fr: 'Mathématiques\u00a0: «\u00a0L’addition et la soustraction\u00a0» 2026-10-13',
      from: { kind: 'unitStart', ref: 'u-mat2' },
    });
    expect(section('dates').items.map((i) => i.from.kind)).toEqual([
      'dayOff',
      'dayOff',
      'event',
      'report',
      'event',
      'event',
    ]);
    expect(section('reminders').items).toEqual([]);
    expect(section('closing').items[0]).toMatchObject({
      fr: 'Bonne fin de semaine!',
      en: 'Have a good weekend!',
    });
  });

  it('tips and the faith moment: the English when there is one', () => {
    expect(section('atHome').items).toMatchObject([
      {
        fr: 'Conseil g-exact 1.',
        en: 'Tip g-exact 1.',
        enBy: 'app',
        from: { kind: 'guide', ref: 'g-exact' },
      },
      { fr: 'Conseil g-exact 2.', en: '', enFrom: null, enBy: null },
    ]);
    // « Dire merci » has no English: the teacher writes it (or the AI, slice S3).
    expect(section('faith').items).toMatchObject([
      {
        fr: 'fr reflection\u00a0: Nomme trois personnes pour lesquelles tu veux dire merci.',
        en: '',
        enBy: null,
      },
    ]);
    expect(englishState(section('faith').items[0]!)).toBe('missing');
  });

  it('quotes the staff’s titles with the app’s typography', () => {
    const typed = buildNewsletterDraft(
      {
        ...facts,
        thisWeek: [
          {
            ...facts.thisWeek[0]!,
            unitTitle: "Lire pour s'informer",
            lessons: [{ id: 'l1', title: "Qu'est-ce qu'un texte informatif?" }],
          },
        ],
      },
      { fr: stub('fr'), en: stub('en') },
      { signature: '', faith: false, guides: false },
      ids,
    );
    const line = typed.sections.find((s) => s.key === 'thisWeek')!.items[0]!;
    expect(line.fr).toContain('Lire pour s’informer');
    expect(line.fr).toContain('«\u00a0Qu’est-ce qu’un texte informatif?\u00a0»');
    expect(line.en).toContain('“Qu’est-ce qu’un texte informatif?”');
    expect(englishState(line)).toBe('app');
  });

  it('without the faith moment or the tips, their sections are removed', () => {
    const plain = buildNewsletterDraft(
      facts,
      { fr: stub('fr'), en: stub('en') },
      { signature: '', faith: false, guides: false },
      ids,
    );
    const faith = plain.sections.find((s) => s.key === 'faith')!;
    const atHome = plain.sections.find((s) => s.key === 'atHome')!;
    expect(faith).toMatchObject({ off: true, items: [] });
    expect(atHome).toMatchObject({ off: true, items: [] });
  });
});

describe('newsletterPlainText (« Copier »)', () => {
  const headings = {
    fr: {
      message: 'Message',
      thisWeek: 'Cette semaine en classe',
      nextWeek: 'La semaine prochaine',
      dates: 'Dates à retenir',
      reminders: 'Rappels',
      atHome: 'Pour aider à la maison',
      faith: 'Moment de foi',
      closing: '',
    },
    en: {
      message: 'Message',
      thisWeek: 'This week in class',
      nextWeek: 'Next week',
      dates: 'Dates to remember',
      reminders: 'Reminders',
      atHome: 'Helping at home',
      faith: 'Faith moment',
      closing: '',
    },
  };
  const header = {
    fr: 'École · 3e année · Semaine du 5 octobre 2026',
    en: 'École · 3e année · Week of October 5, 2026',
  };
  const content = contentWith({
    message: [
      { ...app('Bonjour chères familles,', 'Dear families,'), from: { kind: 'greeting' } },
      typedItem('typed001', 'Bravo à Samuel!'),
    ],
    thisWeek: [app('Mathématiques : « Comparer »', 'Mathematics: “Comparer”')],
    dates: [{ ...app('Ancien', 'Old'), fr: 'Vendredi : pas d’école' }],
    reminders: [],
    faith: [app('Prière', 'Prayer')],
    closing: [
      { ...app('Bonne fin de semaine!', 'Have a good weekend!'), from: { kind: 'closing' } },
    ],
  });
  content.sections[6] = { ...content.sections[6]!, off: true };

  it('French: header, greeting without a heading, lists, no removed or empty section, signature', () => {
    expect(newsletterPlainText(content, { lang: 'fr', header, headings })).toBe(
      [
        'École · 3e année · Semaine du 5 octobre 2026',
        'Bonjour chères familles,',
        'Bravo à Samuel!',
        'Cette semaine en classe\n• Mathématiques : « Comparer »',
        'Dates à retenir\n• Vendredi : pas d’école',
        'Bonne fin de semaine!',
        'Mme Tremblay',
      ].join('\n\n'),
    );
  });

  it('English: a paragraph without an up-to-date English version stays in French', () => {
    const text = newsletterPlainText(content, { lang: 'en', header, headings });
    expect(text).toContain('Dear families,\n\nBravo à Samuel!');
    expect(text).toContain('This week in class\n• Mathematics: “Comparer”');
    expect(text).toContain('Dates to remember\n• Vendredi : pas d’école');
    expect(text).not.toContain('Old');
    expect(text).not.toContain('Prayer');
  });

  it('both: the French, then the English', () => {
    const text = newsletterPlainText(content, { lang: 'both', header, headings });
    expect(text.indexOf('Semaine du 5 octobre')).toBeLessThan(text.indexOf('Week of October 5'));
    expect(text).toContain('Mme Tremblay\n\n* * *\n\nÉcole · 3e année · Week of October 5, 2026');
  });

  it('newsletterParagraph: what copying and printing show of a paragraph, in each language', () => {
    const [greeting, typed] = content.sections[0]!.items;
    const stale = content.sections[3]!.items[0]!;
    expect(newsletterParagraph(greeting!, 'fr')).toEqual({
      text: 'Bonjour chères familles,',
      inFrench: false,
    });
    expect(newsletterParagraph(greeting!, 'en')).toEqual({
      text: 'Dear families,',
      inFrench: false,
    });
    // No English yet, or English for an older French: the French, marked as such.
    expect(newsletterParagraph(typed!, 'en')).toEqual({ text: 'Bravo à Samuel!', inFrench: true });
    expect(newsletterParagraph(stale, 'en')).toEqual({
      text: 'Vendredi : pas d’école',
      inFrench: true,
    });
    // English the teacher wrote for an empty French: shown in English only.
    const englishOnly = {
      ...typedItem('typed002'),
      en: '  Thank you!  ',
      enFrom: '',
      enBy: 'teacher' as const,
    };
    expect(newsletterParagraph(englishOnly, 'en')).toEqual({ text: 'Thank you!', inFrench: false });
    expect(newsletterParagraph(englishOnly, 'fr')).toEqual({ text: '', inFrench: false });
    expect(NEWSLETTER_LIST_SECTIONS.has('dates')).toBe(true);
    expect(NEWSLETTER_LIST_SECTIONS.has('faith')).toBe(false);
  });
});
