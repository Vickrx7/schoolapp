import { describe, expect, it } from 'vitest';
import { buildCurriculumTree, type ExpectationRow, type StrandRow } from './curriculum-tree';

const STRANDS: StrandRow[] = [
  { id: 'd', code: 'D', label: 'Composition', sortOrder: 4 },
  { id: 'c', code: 'C', label: 'Compréhension', sortOrder: 3 },
  { id: 'a', code: 'A', label: 'Liens et applications', sortOrder: 1 },
];

const row = (
  id: string,
  code: string,
  strandId: string | null,
  parentId: string | null,
  sortOrder: number,
): ExpectationRow => ({
  id,
  code,
  strandId,
  parentId,
  kind: parentId === null ? 'overall' : 'specific',
  text: `Texte ${code}`,
  verified: code === 'D1',
  sortOrder,
});

const EXPECTATIONS: ExpectationRow[] = [
  row('c12', 'C1.2', 'c', 'c1', 3),
  row('d1', 'D1', 'd', null, 5),
  row('c1', 'C1', 'c', null, 1),
  row('c11', 'C1.1', 'c', 'c1', 2),
  row('c10', 'C1.10', 'c', 'c1', 3),
  row('x1', 'X1', null, null, 1),
];

describe('the curriculum tree', () => {
  it('groups attentes by domaine in order, each overall attente with its specific ones', () => {
    const tree = buildCurriculumTree(STRANDS, EXPECTATIONS, new Map());
    // Domaine A has no attente for this grade: it is left out. Attentes without one come last.
    expect(tree.map((s) => s.code)).toEqual(['C', 'D', null]);
    expect(tree[0]!.expectations.map((e) => e.code)).toEqual(['C1']);
    // By their order, then by code in numeric order (C1.2 before C1.10).
    expect(tree[0]!.expectations[0]!.children.map((e) => e.code)).toEqual([
      'C1.1',
      'C1.2',
      'C1.10',
    ]);
    expect(tree[1]!.expectations.map((e) => [e.code, e.verified, e.children.length])).toEqual([
      ['D1', true, 0],
    ]);
    expect(tree[2]!.expectations.map((e) => e.code)).toEqual(['X1']);
  });

  it('shows the counts of each attente, zero when it has no resource', () => {
    const tree = buildCurriculumTree(
      STRANDS,
      EXPECTATIONS,
      new Map([
        ['c1', { itemCount: 5, approvedCount: 4 }],
        ['c12', { itemCount: 3, approvedCount: 2 }],
      ]),
    );
    const c1 = tree[0]!.expectations[0]!;
    expect([c1.itemCount, c1.approvedCount]).toEqual([5, 4]);
    expect(c1.children.map((e) => [e.code, e.itemCount, e.approvedCount])).toEqual([
      ['C1.1', 0, 0],
      ['C1.2', 3, 2],
      ['C1.10', 0, 0],
    ]);
  });

  it('keeps a specific attente whose overall attente is missing, at the top of its domaine', () => {
    const tree = buildCurriculumTree(STRANDS, [row('c12', 'C1.2', 'c', 'gone', 1)], new Map());
    expect(tree.map((s) => [s.code, s.expectations.map((e) => e.code)])).toEqual([['C', ['C1.2']]]);
  });

  it('puts a specific attente under its overall attente even when their domaines differ', () => {
    const tree = buildCurriculumTree(
      STRANDS,
      [row('c1', 'C1', 'c', null, 1), row('d11', 'D1.1', 'd', 'c1', 1)],
      new Map(),
    );
    expect(tree.map((s) => s.code)).toEqual(['C']);
    expect(tree[0]!.expectations[0]!.children.map((e) => e.code)).toEqual(['D1.1']);
  });

  it('lists attentes of an unknown domaine with those that have none', () => {
    const tree = buildCurriculumTree([], [row('c1', 'C1', 'c', null, 1)], new Map());
    expect(tree).toEqual([
      {
        id: null,
        code: null,
        label: null,
        expectations: [expect.objectContaining({ code: 'C1', children: [] })],
      },
    ]);
  });
});
