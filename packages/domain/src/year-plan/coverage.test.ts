import { describe, expect, it } from 'vitest';
import {
  COVERAGE_STATUSES,
  coverageCounts,
  expectationCoverage,
  isCoverageUnit,
  taughtExpectationIds,
  type CoverageExpectation,
  type CoverageInput,
  type CoverageProgress,
  type CoverageUnit,
} from './coverage';

// 3e Français: C1 (overall) with C1.1–C1.3; D1 (overall) with D1.1; E1 (overall, no contenus).
const exp = (id: string, parentId: string | null = null): CoverageExpectation => ({
  id,
  kind: parentId || id.includes('.') ? 'specific' : 'overall',
  parentId,
});
const expectations = [
  exp('C1'),
  exp('C1.1', 'C1'),
  exp('C1.2', 'C1'),
  exp('C1.3', 'C1'),
  exp('D1'),
  exp('D1.1', 'D1'),
  exp('E1'),
];

const unit = (id: string, overrides: Partial<CoverageUnit> = {}): CoverageUnit => ({
  id,
  title: `Unité ${id}`,
  status: 'active',
  startsOn: null,
  endsOn: null,
  expectationIds: [],
  lessons: [],
  ...overrides,
});

const statuses = (input: CoverageInput) =>
  Object.fromEntries([...expectationCoverage(input)].map(([id, c]) => [id, c.status]));

const progress = (entries: Record<string, CoverageProgress>) => new Map(Object.entries(entries));

describe('coverage statuses (D-125)', () => {
  const units = [
    unit('lire', {
      startsOn: '2026-09-08',
      endsOn: '2026-10-16',
      expectationIds: ['C1.1', 'C1.2', 'C1.3', 'D1.1'],
      lessons: [
        { id: 'l1', expectationIds: ['C1.1'] },
        { id: 'l2', expectationIds: ['C1.3'] },
        { id: 'l3', expectationIds: ['C1.2'] },
        { id: 'l4', expectationIds: ['C1.2'] },
      ],
    }),
  ];
  const base: CoverageInput = {
    expectations,
    units,
    progress: progress({
      l1: { status: 'completed', taughtOn: '2026-09-21' },
      l2: { status: 'pending_confirmation', taughtOn: '2026-09-22' },
      l3: { status: 'skipped', taughtOn: null },
    }),
  };

  it('ranks taught, pending, planned and not planned', () => {
    expect(statuses(base)).toEqual({
      C1: 'not_planned',
      'C1.1': 'taught',
      'C1.2': 'planned',
      'C1.3': 'taught_pending',
      D1: 'not_planned',
      'D1.1': 'planned',
      E1: 'not_planned',
    });
    expect(COVERAGE_STATUSES).toEqual([
      'taught',
      'taught_pending',
      'taught_unit',
      'planned',
      'taught_earlier',
      'not_planned',
    ]);
  });

  it('gives the evidence: lessons given, the last day, the units', () => {
    const c = expectationCoverage({
      ...base,
      progress: progress({
        l1: { status: 'completed', taughtOn: '2026-09-21' },
        l3: { status: 'completed', taughtOn: '2026-10-14' },
        l4: { status: 'completed', taughtOn: '2026-10-07' },
      }),
    });
    expect(c.get('C1.2')).toEqual({
      status: 'taught',
      evidence: {
        lessonsTaught: 2,
        lastTaughtOn: '2026-10-14',
        lessonsPending: 0,
        units: [
          {
            id: 'lire',
            title: 'Unité lire',
            status: 'active',
            startsOn: '2026-09-08',
            endsOn: '2026-10-16',
          },
        ],
      },
    });
  });

  it('a skipped lesson counts for nothing', () => {
    const only = [unit('u', { lessons: [{ id: 'l3', expectationIds: ['C1.2'] }] })];
    expect(statuses({ ...base, units: only })['C1.2']).toBe('not_planned');
  });

  it('a finished unit counts its attentes as taught (« Enseignée (unité terminée) »)', () => {
    const done = [
      unit('fini', {
        status: 'completed',
        expectationIds: ['C1.2', 'D1.1'],
        lessons: [{ id: 'l9', expectationIds: ['D1.1'] }],
      }),
    ];
    expect(statuses({ ...base, units: done, progress: new Map() })).toMatchObject({
      'C1.2': 'taught_unit',
      'D1.1': 'taught_unit',
    });
  });

  it('archived units count for nothing', () => {
    const archived = [
      unit('vieux', {
        status: 'archived',
        expectationIds: ['C1.1'],
        lessons: [{ id: 'l1', expectationIds: ['C1.1'] }],
      }),
    ];
    expect(statuses({ ...base, units: archived })['C1.1']).toBe('not_planned');
  });

  it('a planned unit makes its attentes planned', () => {
    const later = [unit('plus-tard', { status: 'planned', expectationIds: ['E1'] })];
    expect(statuses({ ...base, units: later, progress: new Map() }).E1).toBe('planned');
  });
});

describe('coverage within a report period (D-125)', () => {
  const units = [
    unit('automne', {
      status: 'completed',
      startsOn: '2026-09-08',
      endsOn: '2026-10-16',
      expectationIds: ['D1.1'],
      lessons: [
        { id: 'a1', expectationIds: ['C1.1'] },
        { id: 'a2', expectationIds: ['C1.2'] },
      ],
    }),
    unit('hiver', {
      status: 'planned',
      startsOn: '2027-01-11',
      endsOn: '2027-02-05',
      expectationIds: ['C1.3'],
    }),
    unit('sans-dates', { status: 'planned', expectationIds: ['E1'] }),
  ];
  const input: CoverageInput = {
    expectations,
    units,
    progress: progress({
      a1: { status: 'completed', taughtOn: '2026-09-21' },
      a2: { status: 'completed', taughtOn: '2026-11-18' },
    }),
  };
  const term1 = { startsOn: '2026-09-02', endsOn: '2027-01-29' };
  const progressPeriod = { startsOn: '2026-09-02', endsOn: '2026-10-30' };
  const after = { startsOn: '2026-11-02', endsOn: '2027-01-29' };

  it('counts what was taught inside the period, and units whose window overlaps it', () => {
    expect(statuses({ ...input, period: progressPeriod })).toMatchObject({
      'C1.1': 'taught',
      'C1.2': 'not_planned',
      'C1.3': 'not_planned',
      'D1.1': 'taught_unit',
      E1: 'not_planned',
    });
    expect(statuses({ ...input, period: term1 })).toMatchObject({
      'C1.1': 'taught',
      'C1.2': 'taught',
      'C1.3': 'planned',
      'D1.1': 'taught_unit',
    });
  });

  it('says « Enseignée avant la période » for what was done before it only', () => {
    expect(statuses({ ...input, period: after })).toMatchObject({
      'C1.1': 'taught_earlier',
      'C1.2': 'taught',
      'C1.3': 'planned',
      'D1.1': 'taught_earlier',
    });
  });

  it('leaves a unit without a window out of a period, never out of the year', () => {
    expect(statuses({ ...input, period: term1 }).E1).toBe('not_planned');
    expect(statuses(input).E1).toBe('planned');
  });

  it('gives the attentes taught, for the report-card comments', () => {
    expect(taughtExpectationIds(input, progressPeriod).sort()).toEqual(['C1.1', 'D1.1']);
    expect(taughtExpectationIds(input).sort()).toEqual(['C1.1', 'C1.2', 'D1.1']);
  });
});

describe('counting (D-094’s unit)', () => {
  it('counts specific attentes and overall ones without contenus', () => {
    expect(isCoverageUnit('specific', false)).toBe(true);
    expect(isCoverageUnit('overall', false)).toBe(true);
    expect(isCoverageUnit('overall', true)).toBe(false);
  });

  it('sums the statuses; an overall attente with contenus is not counted', () => {
    const units = [
      unit('u', {
        expectationIds: ['C1.2', 'C1'],
        lessons: [{ id: 'l1', expectationIds: ['C1.1', 'C1'] }],
      }),
    ];
    const c = expectationCoverage({
      expectations,
      units,
      progress: progress({ l1: { status: 'completed', taughtOn: '2026-09-21' } }),
    });
    expect(c.get('C1')!.status).toBe('taught');
    expect(coverageCounts(expectations, c)).toEqual({
      total: 5,
      taught: 1,
      planned: 1,
      taughtEarlier: 0,
      notPlanned: 3,
    });
  });

  it('counts a combined 3e/4e class by grade', () => {
    const third = [exp('A3'), exp('A3.1', 'A3'), exp('A3.2', 'A3')];
    const fourth = [exp('A4'), exp('A4.1', 'A4')];
    const units = [unit('u', { expectationIds: ['A3.1', 'A4.1'] })];
    const c = expectationCoverage({
      expectations: [...third, ...fourth],
      units,
      progress: new Map(),
    });
    expect(coverageCounts(third, c)).toMatchObject({ total: 2, planned: 1, notPlanned: 1 });
    expect(coverageCounts(fourth, c)).toMatchObject({ total: 1, planned: 1, notPlanned: 0 });
  });
});
