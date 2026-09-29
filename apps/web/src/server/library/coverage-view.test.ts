import { describe, expect, it } from 'vitest';
import {
  coverageFilter,
  coverageLevel,
  coverageMin,
  groupCoverage,
  type CoverageRow,
  type CoverageStrand,
} from './coverage-view';

const row = (
  expectationId: string,
  patch: Partial<CoverageRow> & Pick<CoverageRow, 'kind' | 'code'>,
): CoverageRow => ({
  expectationId,
  parentId: null,
  strandId: null,
  text: `Attente ${patch.code}`,
  verified: true,
  sortOrder: 0,
  hasChildren: false,
  approvedCount: 0,
  inReviewCount: null,
  approvedTypes: [],
  ...patch,
});

const strands: CoverageStrand[] = [
  { id: 'sC', code: 'C', label: 'Sens de l’algèbre', sortOrder: 3 },
  { id: 'sB', code: 'B', label: 'Sens du nombre', sortOrder: 2 },
];

// Mathématiques, 3e année (shortened): B1 has three specific attentes, C1 none, C2 one.
const rows: CoverageRow[] = [
  row('b12', { kind: 'specific', code: 'B1.2', parentId: 'b1', strandId: 'sB', sortOrder: 2 }),
  row('b1', { kind: 'overall', code: 'B1', strandId: 'sB', sortOrder: 1, hasChildren: true }),
  row('b11', {
    kind: 'specific',
    code: 'B1.1',
    parentId: 'b1',
    strandId: 'sB',
    sortOrder: 1,
    approvedCount: 3,
    approvedTypes: ['worksheet', 'quiz'],
  }),
  row('b110', {
    kind: 'specific',
    code: 'B1.10',
    parentId: 'b1',
    strandId: 'sB',
    sortOrder: 10,
    approvedCount: 1,
    verified: false,
  }),
  row('c1', { kind: 'overall', code: 'C1', strandId: 'sC', sortOrder: 1, approvedCount: 2 }),
  row('c2', { kind: 'overall', code: 'C2', strandId: 'sC', sortOrder: 2, hasChildren: true }),
  row('c21', {
    kind: 'specific',
    code: 'C2.1',
    parentId: 'c2',
    strandId: 'sC',
    sortOrder: 1,
    approvedCount: 1,
  }),
  // No domaine: listed last.
  row('x1', { kind: 'overall', code: 'X1', sortOrder: 1 }),
];

const codes = (view: ReturnType<typeof groupCoverage>) =>
  view.groups.map((g) => [
    g.strand?.code ?? null,
    g.entries.map((e) => [e.expectation.code, e.children.map((c) => c.code)]),
  ]);

describe('coverageLevel (W6)', () => {
  it('is none at 0, few below the threshold, covered from it', () => {
    expect(coverageLevel(0, 2)).toBe('none');
    expect(coverageLevel(1, 2)).toBe('few');
    expect(coverageLevel(2, 2)).toBe('covered');
    expect(coverageLevel(7, 2)).toBe('covered');
    expect(coverageLevel(0, 1)).toBe('none');
    expect(coverageLevel(1, 1)).toBe('covered');
    expect(coverageLevel(4, 5)).toBe('few');
    expect(coverageLevel(1)).toBe('few'); // default threshold 2
  });

  it('keeps the threshold between 1 and 5', () => {
    expect(coverageLevel(1, 0)).toBe('covered');
    expect(coverageLevel(5, 9)).toBe('covered');
    expect(coverageLevel(4, 9)).toBe('few');
    expect(coverageLevel(1, Number.NaN)).toBe('few');
    expect(coverageLevel(-1, 2)).toBe('none');
  });

  it('reads the page parameters', () => {
    expect(coverageMin('3')).toBe(3);
    expect(coverageMin(['1', '4'])).toBe(1);
    expect(coverageMin(undefined)).toBe(2);
    expect(coverageMin('6')).toBe(2);
    expect(coverageMin('0')).toBe(2);
    expect(coverageMin('2.5')).toBe(2);
    expect(coverageMin('abc')).toBe(2);
    expect(coverageFilter('none')).toBe('none');
    expect(coverageFilter(['few'])).toBe('few');
    expect(coverageFilter('toutes')).toBe('all');
    expect(coverageFilter(undefined)).toBe('all');
  });
});

describe('groupCoverage (W6)', () => {
  it('lists attentes by domaine, overall then specific, in curriculum order', () => {
    const view = groupCoverage(rows, strands);
    expect(codes(view)).toEqual([
      ['B', [['B1', ['B1.1', 'B1.2', 'B1.10']]]],
      [
        'C',
        [
          ['C1', []],
          ['C2', ['C2.1']],
        ],
      ],
      [null, [['X1', []]]],
    ]);
  });

  it('counts specific attentes and overall attentes without children as units', () => {
    const view = groupCoverage(rows, strands, { min: 2 });
    const b = view.groups[0]!;
    expect(b.entries[0]!.expectation).toMatchObject({ unit: false, level: 'none' });
    expect(b.entries[0]!.children.map((c) => [c.code, c.level])).toEqual([
      ['B1.1', 'covered'],
      ['B1.2', 'none'],
      ['B1.10', 'few'],
    ]);
    expect(b.counts).toEqual({ units: 3, none: 1, few: 1, covered: 1 });
    expect(view.groups[1]!.counts).toEqual({ units: 2, none: 0, few: 1, covered: 1 });
    // B1.1, B1.2, B1.10, C1, C2.1 and X1.
    expect(view.counts).toEqual({ units: 6, none: 2, few: 2, covered: 2 });
  });

  it('moves attentes between levels with the threshold', () => {
    expect(groupCoverage(rows, strands, { min: 1 }).counts).toEqual({
      units: 6,
      none: 2,
      few: 0,
      covered: 4,
    });
    expect(groupCoverage(rows, strands, { min: 3 }).counts).toEqual({
      units: 6,
      none: 2,
      few: 3,
      covered: 1,
    });
  });

  it('filters the list but not the counts', () => {
    const none = groupCoverage(rows, strands, { show: 'none' });
    expect(codes(none)).toEqual([
      ['B', [['B1', ['B1.2']]]],
      [null, [['X1', []]]],
    ]);
    expect(none.counts.units).toBe(6);

    const few = groupCoverage(rows, strands, { show: 'few' });
    expect(codes(few)).toEqual([
      ['B', [['B1', ['B1.2', 'B1.10']]]],
      ['C', [['C2', ['C2.1']]]],
      [null, [['X1', []]]],
    ]);
    expect(few.groups[0]!.counts).toEqual({ units: 3, none: 1, few: 1, covered: 1 });
  });

  it('keeps what reviewers see and the « À vérifier » flag', () => {
    const view = groupCoverage(
      rows.map((r) => ({ ...r, inReviewCount: r.code === 'B1.2' ? 2 : 0 })),
      strands,
    );
    const b1 = view.groups[0]!.entries[0]!;
    expect(b1.children[1]).toMatchObject({ code: 'B1.2', inReviewCount: 2 });
    expect(b1.children[2]).toMatchObject({ code: 'B1.10', verified: false });
    expect(b1.children[0]!.approvedTypes).toEqual(['worksheet', 'quiz']);
  });

  it('lists a specific attente on its own when its overall attente is missing', () => {
    const view = groupCoverage(
      [
        row('b21', { kind: 'specific', code: 'B2.1', parentId: 'gone', strandId: 'sB' }),
        row('y1', { kind: 'overall', code: 'Y1', strandId: 'unknown-strand' }),
      ],
      strands,
    );
    expect(codes(view)).toEqual([
      ['B', [['B2.1', []]]],
      [null, [['Y1', []]]],
    ]);
    expect(view.counts).toEqual({ units: 2, none: 2, few: 0, covered: 0 });
  });

  it('has nothing to show for a subject without attentes', () => {
    expect(groupCoverage([], strands)).toEqual({
      groups: [],
      counts: { units: 0, none: 0, few: 0, covered: 0 },
    });
  });
});
