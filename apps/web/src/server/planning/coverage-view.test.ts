import {
  expectationCoverage,
  type CoverageProgress,
  type CoverageUnit,
  type ReportPeriod,
} from '@lynx/domain';
import { describe, expect, it } from 'vitest';
import type { CurriculumStrand } from '../curriculum-groups';
import {
  classCoverageHref,
  classCoverageShow,
  coverageOverview,
  coveragePeriod,
  groupClassCoverage,
  orderedPeriods,
  showsStatus,
  type ClassCoverageRow,
  type CoverageCountRow,
} from './coverage-view';

const PERIODS: ReportPeriod[] = [
  {
    kind: 'term1',
    startsOn: '2026-09-02',
    endsOn: '2027-01-29',
    dueOn: '2027-02-05',
    issuedOn: '2027-02-12',
  },
  {
    kind: 'progress',
    startsOn: '2026-09-02',
    endsOn: '2026-10-30',
    dueOn: '2026-11-06',
    issuedOn: '2026-11-13',
  },
];

describe('the address', () => {
  it('reads « Afficher », « Toutes » by default', () => {
    expect(classCoverageShow(undefined)).toBe('all');
    expect(classCoverageShow('nope')).toBe('all');
    expect(classCoverageShow('planned')).toBe('planned');
    expect(classCoverageShow(['not_planned', 'taught'])).toBe('not_planned');
  });

  it('reads the period: a report period the board set, else the whole year', () => {
    expect(coveragePeriod({}, PERIODS)).toEqual({
      choice: 'year',
      window: null,
      from: null,
      to: null,
      invalid: false,
    });
    expect(coveragePeriod({ period: 'progress' }, PERIODS)).toMatchObject({
      choice: 'progress',
      window: { startsOn: '2026-09-02', endsOn: '2026-10-30' },
      invalid: false,
    });
    // The board has not set the second term: the whole year.
    expect(coveragePeriod({ period: 'term2' }, PERIODS)).toMatchObject({
      choice: 'year',
      window: null,
    });
    expect(coveragePeriod({ period: 'term1' }, [])).toMatchObject({ choice: 'year' });
  });

  it('reads « Dates choisies »: two dates in order, else the whole year and a warning', () => {
    expect(coveragePeriod({ period: 'custom', from: '2026-11-02', to: '2026-12-18' }, [])).toEqual({
      choice: 'custom',
      window: { startsOn: '2026-11-02', endsOn: '2026-12-18' },
      from: '2026-11-02',
      to: '2026-12-18',
      invalid: false,
    });
    expect(
      coveragePeriod({ period: 'custom', from: '2026-11-02', to: '2026-11-02' }, []),
    ).toMatchObject({ window: { startsOn: '2026-11-02', endsOn: '2026-11-02' } });
    expect(
      coveragePeriod({ period: 'custom', from: '2026-12-18', to: '2026-11-02' }, []),
    ).toMatchObject({ choice: 'custom', window: null, invalid: true });
    expect(coveragePeriod({ period: 'custom', from: '2026-11-02' }, [])).toMatchObject({
      window: null,
      from: '2026-11-02',
      to: null,
      invalid: true,
    });
    expect(
      coveragePeriod({ period: 'custom', from: 'demain', to: '2026-13-45' }, []),
    ).toMatchObject({ from: null, to: null, invalid: true });
  });

  it('orders the report periods as Ontario does', () => {
    expect(orderedPeriods(PERIODS).map((p) => p.kind)).toEqual(['progress', 'term1']);
  });

  it('writes the address without the defaults', () => {
    expect(classCoverageHref('c1')).toBe('/classes/c1/planning/coverage');
    expect(classCoverageHref('c1', { subject: 'fra' })).toBe(
      '/classes/c1/planning/coverage?subject=fra',
    );
    expect(
      classCoverageHref('c1', { subject: 'fra', grade: '4', period: 'term1', show: 'planned' }),
    ).toBe('/classes/c1/planning/coverage?subject=fra&grade=4&period=term1&show=planned');
    expect(
      classCoverageHref('c1', {
        subject: 'fra',
        period: 'custom',
        from: '2026-11-02',
        to: '2026-12-18',
      }),
    ).toBe('/classes/c1/planning/coverage?subject=fra&period=custom&from=2026-11-02&to=2026-12-18');
    // Dates only go with « Dates choisies ».
    expect(classCoverageHref('c1', { period: 'progress', from: '2026-11-02' })).toBe(
      '/classes/c1/planning/coverage?period=progress',
    );
  });

  it('shows the statuses « Afficher » asks for', () => {
    expect(showsStatus('taught_unit', 'taught')).toBe(true);
    expect(showsStatus('taught_pending', 'taught')).toBe(true);
    expect(showsStatus('taught_earlier', 'taught')).toBe(false);
    expect(showsStatus('planned', 'planned')).toBe(true);
    expect(showsStatus('not_planned', 'planned')).toBe(false);
    expect(showsStatus('not_planned', 'not_planned')).toBe(true);
    expect(showsStatus('taught_earlier', 'all')).toBe(true);
  });
});

// Français, 3e année (shortened, as the demo seed): C1 has three specific attentes, D1 one, A1
// none (an overall attente on its own is a counting unit); one attente without a domaine.
const STRANDS: CurriculumStrand[] = [
  { id: 'sD', code: 'D', label: 'Écriture', sortOrder: 4 },
  { id: 'sC', code: 'C', label: 'Lecture', sortOrder: 3 },
  { id: 'sA', code: 'A', label: 'Littératie', sortOrder: 1 },
];

const row = (
  expectationId: string,
  patch: Partial<ClassCoverageRow> & Pick<ClassCoverageRow, 'kind' | 'code'>,
): ClassCoverageRow => ({
  expectationId,
  parentId: null,
  strandId: null,
  text: `Attente ${patch.code}`,
  verified: true,
  sortOrder: 0,
  ...patch,
});

const ROWS: ClassCoverageRow[] = [
  row('c12', { kind: 'specific', code: 'C1.2', parentId: 'c1', strandId: 'sC', sortOrder: 2 }),
  row('c1', { kind: 'overall', code: 'C1', strandId: 'sC', sortOrder: 1 }),
  row('c11', { kind: 'specific', code: 'C1.1', parentId: 'c1', strandId: 'sC', sortOrder: 1 }),
  row('c13', { kind: 'specific', code: 'C1.3', parentId: 'c1', strandId: 'sC', sortOrder: 3 }),
  row('d1', { kind: 'overall', code: 'D1', strandId: 'sD', sortOrder: 1 }),
  row('d11', { kind: 'specific', code: 'D1.1', parentId: 'd1', strandId: 'sD', sortOrder: 1 }),
  row('a1', { kind: 'overall', code: 'A1', strandId: 'sA', sortOrder: 1, verified: false }),
  row('x1', { kind: 'specific', code: 'X1.1', sortOrder: 1 }),
];

// The seeded unit: C1.1, C1.2, C1.3 and D1.1 at unit level; lessons 2 (C1.3) and 3 (C1.1)
// given, lesson 4 (C1.2) not yet, lesson 7 (D1.1) not yet.
const UNIT: CoverageUnit = {
  id: 'fra',
  title: 'Lire pour s’informer',
  status: 'active',
  startsOn: '2026-09-14',
  endsOn: '2026-10-23',
  expectationIds: ['c11', 'c12', 'c13', 'd11'],
  lessons: [
    { id: 'l1', expectationIds: [] },
    { id: 'l2', expectationIds: ['c13'] },
    { id: 'l3', expectationIds: ['c11'] },
    { id: 'l4', expectationIds: ['c12'] },
    { id: 'l7', expectationIds: ['d11'] },
  ],
};

const PROGRESS = new Map<string, CoverageProgress>([
  ['l1', { status: 'completed', taughtOn: '2026-09-29' }],
  ['l2', { status: 'completed', taughtOn: '2026-09-30' }],
  ['l3', { status: 'completed', taughtOn: '2026-10-01' }],
]);

const coverageOf = (
  units: CoverageUnit[] = [UNIT],
  progress = PROGRESS,
  period: { startsOn: string; endsOn: string } | null = null,
) =>
  expectationCoverage({
    expectations: ROWS.map((r) => ({ id: r.expectationId, kind: r.kind, parentId: r.parentId })),
    units,
    progress,
    period,
  });

const listed = (view: ReturnType<typeof groupClassCoverage>) =>
  view.groups.map((g) => [
    g.strand?.code ?? null,
    g.entries.map((e) => [
      `${e.expectation.code}:${e.expectation.unit ? e.expectation.status : 'heading'}`,
      e.children.map((c) => `${c.code}:${c.status}`),
    ]),
  ]);

describe('groupClassCoverage', () => {
  it('lists the domaines in order, each overall attente a heading for its specific ones', () => {
    const view = groupClassCoverage(ROWS, STRANDS, coverageOf());
    expect(listed(view)).toEqual([
      ['A', [['A1:not_planned', []]]],
      ['C', [['C1:heading', ['C1.1:taught', 'C1.2:planned', 'C1.3:taught']]]],
      ['D', [['D1:heading', ['D1.1:planned']]]],
      [null, [['X1.1:not_planned', []]]],
    ]);
    // « 2 sur 3 enseignées »
    const c1 = view.groups[1]!.entries[0]!;
    expect([c1.childTaught, c1.childCount]).toEqual([2, 3]);
    // Overall attentes with specific ones are not counted (D-094): A1, C1.x, D1.1, X1.1.
    expect(view.counts).toEqual({
      total: 6,
      taught: 2,
      planned: 2,
      taughtEarlier: 0,
      notPlanned: 2,
    });
    expect(view.groups[1]!.counts).toMatchObject({ total: 3, taught: 2, planned: 1 });
    expect(view.unverified).toBe(true);
  });

  it('keeps the evidence: the lessons given, the last date, the units', () => {
    const view = groupClassCoverage(ROWS, STRANDS, coverageOf());
    const c11 = view.groups[1]!.entries[0]!.children[0]!;
    expect(c11.evidence).toEqual({
      lessonsTaught: 1,
      lastTaughtOn: '2026-10-01',
      lessonsPending: 0,
      units: [
        {
          id: 'fra',
          title: 'Lire pour s’informer',
          status: 'active',
          startsOn: '2026-09-14',
          endsOn: '2026-10-23',
        },
      ],
    });
  });

  it('lists only what « Afficher » asks for, under its heading, with the same counts', () => {
    const all = groupClassCoverage(ROWS, STRANDS, coverageOf());
    const planned = groupClassCoverage(ROWS, STRANDS, coverageOf(), 'planned');
    expect(listed(planned)).toEqual([
      ['C', [['C1:heading', ['C1.2:planned']]]],
      ['D', [['D1:heading', ['D1.1:planned']]]],
    ]);
    expect(planned.counts).toEqual(all.counts);
    // The heading still says how many of all its specific attentes are taught.
    expect(planned.groups[0]!.entries[0]!.childTaught).toBe(2);
    expect(listed(groupClassCoverage(ROWS, STRANDS, coverageOf(), 'not_planned'))).toEqual([
      ['A', [['A1:not_planned', []]]],
      [null, [['X1.1:not_planned', []]]],
    ]);
    expect(listed(groupClassCoverage(ROWS, STRANDS, coverageOf(), 'taught'))).toEqual([
      ['C', [['C1:heading', ['C1.1:taught', 'C1.3:taught']]]],
    ]);
  });

  it('follows the lesson given since: C1.2 « Enseignée »', () => {
    const progress = new Map(PROGRESS).set('l4', {
      status: 'completed',
      taughtOn: '2026-10-02',
    });
    const view = groupClassCoverage(ROWS, STRANDS, coverageOf([UNIT], progress));
    expect(view.counts).toMatchObject({ taught: 3, planned: 1 });
  });

  it('with a period: taught earlier, and a finished unit by its window', () => {
    const finished: CoverageUnit = { ...UNIT, status: 'completed' };
    const view = groupClassCoverage(
      ROWS,
      STRANDS,
      coverageOf([finished], PROGRESS, { startsOn: '2026-11-02', endsOn: '2027-01-29' }),
    );
    // The unit ended before the period: what it taught is « Enseignée avant la période ».
    expect(view.counts).toEqual({
      total: 6,
      taught: 0,
      planned: 0,
      taughtEarlier: 4,
      notPlanned: 2,
    });
    const year = groupClassCoverage(ROWS, STRANDS, coverageOf([finished]));
    expect(listed(year)[1]).toEqual([
      'C',
      [['C1:heading', ['C1.1:taught', 'C1.2:taught_unit', 'C1.3:taught']]],
    ]);
  });

  it('says nothing is to verify when every attente is verified', () => {
    const verified = ROWS.map((r) => ({ ...r, verified: true }));
    expect(groupClassCoverage(verified, STRANDS, coverageOf()).unverified).toBe(false);
  });
});

describe('coverageOverview', () => {
  const SUBJECTS = [
    { id: 'fra', label: 'Français' },
    { id: 'mat', label: 'Mathématiques' },
    { id: 'art', label: 'Arts' },
  ];
  const count = (
    expectationId: string,
    subjectId: string,
    gradeCode: string,
    kind: 'overall' | 'specific' = 'specific',
    parentId: string | null = null,
  ): CoverageCountRow => ({ expectationId, subjectId, gradeCode, kind, parentId, verified: true });
  const ROWS_ALL: CoverageCountRow[] = [
    count('f3a', 'fra', '3', 'overall'),
    count('f3a1', 'fra', '3', 'specific', 'f3a'),
    count('f3a2', 'fra', '3', 'specific', 'f3a'),
    count('f4a', 'fra', '4', 'overall'),
    count('m3a', 'mat', '3', 'overall'),
    // Another grade's attente is not the class's.
    count('m5a', 'mat', '5', 'overall'),
  ];
  const UNITS: CoverageUnit[] = [
    {
      id: 'u',
      title: 'Unité',
      status: 'active',
      startsOn: null,
      endsOn: null,
      expectationIds: ['f3a2', 'm3a'],
      lessons: [{ id: 'l', expectationIds: ['f3a1'] }],
    },
  ];
  const coverage = expectationCoverage({
    expectations: ROWS_ALL.map((r) => ({
      id: r.expectationId,
      kind: r.kind,
      parentId: r.parentId,
    })),
    units: UNITS,
    progress: new Map([['l', { status: 'completed', taughtOn: '2026-10-01' }]]),
  });

  it('counts each subject with attentes over the class’s grades, and per grade', () => {
    const overview = coverageOverview(ROWS_ALL, coverage, SUBJECTS, ['3', '4']);
    expect(overview.subjects.map((s) => [s.subject.id, s.counts])).toEqual([
      ['fra', { total: 3, taught: 1, planned: 1, taughtEarlier: 0, notPlanned: 1 }],
      ['mat', { total: 1, taught: 0, planned: 1, taughtEarlier: 0, notPlanned: 0 }],
    ]);
    expect(overview.subjects[0]!.grades.map((g) => [g.gradeCode, g.counts.total])).toEqual([
      ['3', 2],
      ['4', 1],
    ]);
    // Mathématiques has nothing loaded for 4e: one grade line only.
    expect(overview.subjects[1]!.grades.map((g) => g.gradeCode)).toEqual(['3']);
    expect(overview.without.map((s) => s.id)).toEqual(['art']);
  });

  it('lists every subject as without attentes when none are loaded', () => {
    const overview = coverageOverview([], new Map(), SUBJECTS, ['3']);
    expect(overview.subjects).toEqual([]);
    expect(overview.without).toHaveLength(3);
  });
});
