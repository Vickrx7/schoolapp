import { describe, expect, it } from 'vitest';
import { parseCli } from '../args';
import { CliError, createContext } from '../context';
import {
  COVERAGE_CSV_HEADER,
  coverageCommands,
  coverageCsv,
  coverageLevel,
  coverageText,
  orderCoverage,
  parseMin,
  summaryCsv,
  summaryText,
  type CoverageLine,
  type StrandInfo,
} from './coverage';

const line = (
  expectationId: string,
  patch: Partial<CoverageLine> & Pick<CoverageLine, 'kind' | 'code'>,
): CoverageLine => ({
  expectationId,
  parentId: null,
  strandId: null,
  text: `Attente ${patch.code}`,
  verified: true,
  sortOrder: 0,
  hasChildren: false,
  approved: 0,
  inReview: 0,
  types: [],
  ...patch,
});

const strands: StrandInfo[] = [
  { id: 'sC', code: 'C', label: 'Algèbre', sortOrder: 3 },
  { id: 'sB', code: 'B', label: 'Nombres', sortOrder: 2 },
];

// Mathématiques, 3e année (shortened): B1 has two specific attentes, C1 none.
const lines: CoverageLine[] = [
  line('b12', { kind: 'specific', code: 'B1.2', parentId: 'b1', strandId: 'sB', sortOrder: 2 }),
  line('c1', {
    kind: 'overall',
    code: 'C1',
    strandId: 'sC',
    sortOrder: 1,
    approved: 1,
    verified: false,
    text: 'Résoudre, « modéliser »,\nexpliquer',
  }),
  line('b1', {
    kind: 'overall',
    code: 'B1',
    strandId: 'sB',
    sortOrder: 1,
    hasChildren: true,
    approved: 4,
  }),
  line('b11', {
    kind: 'specific',
    code: 'B1.1',
    parentId: 'b1',
    strandId: 'sB',
    sortOrder: 1,
    approved: 3,
    inReview: 2,
    types: ['quiz', 'worksheet'],
  }),
  line('x1', { kind: 'overall', code: 'X1', sortOrder: 1, text: 'Un texte avec "guillemets"' }),
];

const meta = { board: 'Conseil de démo', grade: '3e année', subject: 'Mathématiques', min: 2 };

/** A small RFC 4180 reader, to prove the output is valid CSV. */
function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  expect(quoted).toBe(false);
  row.push(cell);
  rows.push(row);
  return rows;
}

describe('coverage options', () => {
  it('read the threshold', () => {
    expect(parseMin(undefined)).toBe(2);
    expect(parseMin('1')).toBe(1);
    expect(parseMin('5')).toBe(5);
    for (const bad of ['0', '6', '2.5', 'deux', ''])
      expect(() => parseMin(bad)).toThrow(/--min must be a whole number from 1 to 5/);
  });

  it('check every option before reaching the database', async () => {
    // No settings are needed: the context would read them only for the database.
    const run = (...args: string[]) =>
      coverageCommands.coverage!(createContext(parseCli(['coverage', ...args]).values));
    await expect(run()).rejects.toThrow(/--board is required/);
    await expect(run('--board', 'csc-demo', '--grade', '3')).rejects.toThrow(
      /--grade and --subject go together/,
    );
    await expect(run('--board', 'csc-demo', '--subject', 'mat')).rejects.toThrow(CliError);
    await expect(
      run('--board', 'csc-demo', '--grade', '3', '--subject', 'mat', '--min', '9'),
    ).rejects.toThrow(/--min/);
  });

  it('level an attente as the app does', () => {
    expect(coverageLevel(0, 2)).toBe('none');
    expect(coverageLevel(1, 2)).toBe('few');
    expect(coverageLevel(2, 2)).toBe('covered');
    expect(coverageLevel(1, 1)).toBe('covered');
  });
});

describe('coverage report', () => {
  const groups = orderCoverage(lines, strands);

  it('lists attentes by domaine, each overall attente followed by its specific ones', () => {
    expect(
      groups.map((g) => [
        g.strand?.code ?? null,
        g.lines.map((l) => [l.line.code, l.depth, l.unit]),
      ]),
    ).toEqual([
      [
        'B',
        [
          ['B1', 0, false],
          ['B1.1', 1, true],
          ['B1.2', 1, true],
        ],
      ],
      ['C', [['C1', 0, true]]],
      [null, [['X1', 0, true]]],
    ]);
  });

  it('prints the totals, the domaines and each attente', () => {
    const text = coverageText(meta, groups);
    const out = text.split('\n');
    expect(out[0]).toBe(
      'Curriculum coverage: Conseil de démo, 3e année, Mathématiques (threshold 2)',
    );
    // Units: B1.1 (3), B1.2 (0), C1 (1), X1 (0).
    expect(out[1]).toBe(
      '2 of 4 expectations have at least one approved resource: 2 with none, 1 with fewer than 2, 1 with 2 or more.',
    );
    expect(text).toContain('\nB · Nombres: 1 of 2\n');
    expect(text).toContain(
      '  B1       overall  4 approved with its specific expectations | Attente B1',
    );
    expect(text).toContain(
      '    B1.1   covered  3 approved · 2 in review · quiz, worksheet | Attente B1.1',
    );
    expect(text).toContain('    B1.2   none     0 approved | Attente B1.2');
    expect(text).toContain(
      '  C1       few      1 approved · to verify | Résoudre, « modéliser », expliquer',
    );
    expect(text).toContain('\nOther expectations: 0 of 1\n');
  });

  it('says when nothing is loaded', () => {
    expect(coverageText(meta, [])).toContain('No expectations are loaded');
  });

  it('writes valid CSV, one row per attente', () => {
    const rows = readCsv(coverageCsv(meta, groups));
    expect(rows[0]).toEqual([...COVERAGE_CSV_HEADER]);
    expect(rows).toHaveLength(6);
    for (const row of rows) expect(row).toHaveLength(COVERAGE_CSV_HEADER.length);
    const byCode = new Map(rows.slice(1).map((r) => [r[3], r]));
    expect(byCode.get('B1.1')).toEqual([
      '3e année',
      'Mathématiques',
      'B',
      'B1.1',
      'specific',
      'B1',
      'true',
      'covered',
      '3',
      '2',
      'quiz;worksheet',
      'true',
      'Attente B1.1',
    ]);
    expect(byCode.get('B1')!.slice(6, 8)).toEqual(['false', '']);
    expect(byCode.get('C1')!.at(-1)).toBe('Résoudre, « modéliser », expliquer');
    expect(byCode.get('X1')!.at(-1)).toBe('Un texte avec "guillemets"');
    expect(byCode.get('X1')![2]).toBe('');
  });
});

describe('coverage summary', () => {
  const summary = [
    { grade: '3e année', subject: 'Français', units: 32, none: 23, few: 7, covered: 2 },
    { grade: '3e année', subject: 'Mathématiques', units: 36, none: 25, few: 8, covered: 3 },
  ];

  it('prints one line per grade and subject', () => {
    const text = summaryText('Conseil de démo', 2, summary);
    expect(text.split('\n')).toEqual([
      'Curriculum coverage: Conseil de démo, every grade and subject (threshold 2)',
      '  3e année  Français       9 of 32 with at least one approved resource (23 with none, 7 with fewer than 2, 2 with 2 or more)',
      '  3e année  Mathématiques  11 of 36 with at least one approved resource (25 with none, 8 with fewer than 2, 3 with 2 or more)',
    ]);
    expect(summaryText('Conseil de démo', 2, [])).toContain('No expectations are loaded');
  });

  it('writes valid CSV', () => {
    expect(readCsv(summaryCsv(2, summary))).toEqual([
      ['grade', 'subject', 'units', 'none', 'few', 'covered', 'with_any', 'threshold'],
      ['3e année', 'Français', '32', '23', '7', '2', '9', '2'],
      ['3e année', 'Mathématiques', '36', '25', '8', '3', '11', '2'],
    ]);
  });
});
