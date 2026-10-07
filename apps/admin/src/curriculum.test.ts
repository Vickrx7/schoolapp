import { parseCurriculumFile, type CurriculumFile } from '@lynx/content';
import { describe, expect, it } from 'vitest';
import {
  describePlan,
  formatErrors,
  planCurriculumImport,
  planIsEmpty,
  type CurriculumState,
  type ExistingExpectation,
} from './curriculum';

const GRADES = new Map([
  ['K1', -1],
  ['K2', 0],
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n): [string, number] => [String(n), n]),
]);

function file(overrides: Partial<Record<string, unknown>> = {}): CurriculumFile {
  const parsed = parseCurriculumFile({
    official: false,
    verified: false,
    subjectCode: 'fra',
    curriculumVersion: 'fra-2023',
    sourceNote: 'Résumé à vérifier contre le document officiel.',
    strands: [
      { code: 'C', labelFr: 'Compréhension' },
      { code: 'D', labelFr: 'Composition' },
    ],
    expectations: [
      {
        grade: '4',
        code: 'C1',
        kind: 'overall',
        strandCode: 'C',
        parentCode: null,
        textFr: 'Lire.',
      },
      {
        grade: '4',
        code: 'C1.2',
        kind: 'specific',
        strandCode: 'C',
        parentCode: 'C1',
        textFr: 'Dégager l’idée principale.',
      },
      {
        grade: '5',
        code: 'D1',
        kind: 'overall',
        strandCode: 'D',
        parentCode: null,
        textFr: 'Écrire.',
      },
    ],
    ...overrides,
  });
  if (!parsed.data) throw new Error(JSON.stringify(parsed.errors));
  return parsed.data;
}

/** The database state after importing `file()` as it is. */
function imported(): CurriculumState {
  const expectation = (
    id: string,
    grade: string,
    code: string,
    kind: 'overall' | 'specific',
    strand: string,
    parent: string | null,
    text: string,
    sortOrder: number,
  ): ExistingExpectation => ({
    id,
    grade_code: grade,
    code,
    kind,
    strand_id: strand,
    parent_id: parent,
    text_fr: text,
    text_en: null,
    is_verified: false,
    source_note: 'Résumé à vérifier contre le document officiel.',
    sort_order: sortOrder,
  });
  return {
    grades: GRADES,
    subject: { gradeMin: -1, gradeMax: 8 },
    strands: [
      { id: 's-c', code: 'C', label_fr: 'Compréhension', label_en: null, sort_order: 1 },
      { id: 's-d', code: 'D', label_fr: 'Composition', label_en: null, sort_order: 2 },
    ],
    expectations: [
      expectation('e1', '4', 'C1', 'overall', 's-c', null, 'Lire.', 1),
      expectation('e2', '4', 'C1.2', 'specific', 's-c', 'e1', 'Dégager l’idée principale.', 2),
      expectation('e3', '5', 'D1', 'overall', 's-d', null, 'Écrire.', 1),
    ],
  };
}

const empty = (): CurriculumState => ({ ...imported(), strands: [], expectations: [] });
const changes = (rows: { change: string }[]) => rows.map((r) => r.change);

describe('planCurriculumImport', () => {
  it('imports everything as new into an empty version, with sort orders from the file', () => {
    const plan = planCurriculumImport(file(), empty());
    expect(plan.errors).toEqual([]);
    expect(changes(plan.strands)).toEqual(['new', 'new']);
    expect(plan.strands.map((s) => s.sort_order)).toEqual([1, 2]);
    expect(changes(plan.expectations)).toEqual(['new', 'new', 'new']);
    // Positions count within each grade.
    expect(plan.expectations.map((e) => `${e.grade_code} ${e.code} ${e.sort_order}`)).toEqual([
      '4 C1 1',
      '4 C1.2 2',
      '5 D1 1',
    ]);
    expect(plan.expectations[1]).toMatchObject({
      parentCode: 'C1',
      strandCode: 'C',
      is_verified: false,
      source_note: 'Résumé à vérifier contre le document officiel.',
    });
    expect(planIsEmpty(plan)).toBe(false);
  });

  it('finds nothing to do when the database already matches (re-running is safe)', () => {
    const plan = planCurriculumImport(file(), imported());
    expect(plan.errors).toEqual([]);
    expect(changes([...plan.strands, ...plan.expectations])).toEqual(Array(5).fill('unchanged'));
    expect(plan.kept).toBe(0);
    expect(planIsEmpty(plan)).toBe(true);
  });

  it('marks a row changed for its text, strand label, order, parent or verification', () => {
    const state = imported();
    const text = file();
    text.expectations[1]!.textFr = 'Dégager l’idée principale et les détails.';
    expect(changes(planCurriculumImport(text, state).expectations)).toEqual([
      'unchanged',
      'changed',
      'unchanged',
    ]);

    const label = file({
      strands: [
        { code: 'C', labelFr: 'Compréhension de textes' },
        { code: 'D', labelFr: 'Composition' },
      ],
    });
    expect(changes(planCurriculumImport(label, state).strands)).toEqual(['changed', 'unchanged']);

    const reordered = file({
      strands: [
        { code: 'D', labelFr: 'Composition' },
        { code: 'C', labelFr: 'Compréhension' },
      ],
    });
    expect(changes(planCurriculumImport(reordered, state).strands)).toEqual(['changed', 'changed']);

    // Verified text (with the licence confirmed) marks every attente as verified.
    const verified = parseCurriculumFile({ ...file(), verified: true }, { confirmLicence: true });
    expect(changes(planCurriculumImport(verified.data!, state).expectations)).toEqual(
      Array(3).fill('changed'),
    );

    // The specific attente moves under another overall attente of the same grade.
    const moved = file();
    moved.expectations.splice(1, 0, {
      grade: '4',
      code: 'C2',
      kind: 'overall',
      strandCode: 'C',
      parentCode: null,
      textFr: 'Réagir.',
      textEn: null,
    });
    moved.expectations[2]!.parentCode = 'C2';
    const plan = planCurriculumImport(moved, state);
    expect(plan.errors).toEqual([]);
    expect(plan.expectations.map((e) => `${e.code}:${e.change}`)).toEqual([
      'C1:unchanged',
      'C2:new',
      'C1.2:changed', // new parent, and now third in its grade
      'D1:unchanged',
    ]);
  });

  it('keeps attentes of the version that the file leaves out, and counts them', () => {
    const partial = file();
    partial.expectations.pop();
    const plan = planCurriculumImport(partial, imported());
    expect(plan.kept).toBe(1);
    expect(plan.expectations).toHaveLength(2);
  });

  it('refuses an unknown grade and a grade the subject is not taught in', () => {
    const state = { ...empty(), subject: { gradeMin: 1, gradeMax: 6 } };
    const grades = file();
    grades.expectations[2]!.grade = '7';
    expect(planCurriculumImport(grades, state).errors).toEqual([
      { path: 'expectations.2.grade', message: 'gradeNotInSubject' },
    ]);
    const unknown = planCurriculumImport(grades, { ...state, grades: new Map([['4', 4]]) });
    expect(unknown.errors).toEqual([{ path: 'expectations.2.grade', message: 'unknownGrade' }]);
  });

  it('refuses a kind change and a specific attente outside its overall attente’s strand', () => {
    const state = imported();
    state.expectations[2]!.kind = 'specific';
    expect(planCurriculumImport(file(), state).errors).toEqual([
      { path: 'expectations.2.kind', message: 'kindChanged' },
    ]);

    const strand = file();
    strand.expectations[1]!.strandCode = 'D';
    expect(planCurriculumImport(strand, imported()).errors).toEqual([
      { path: 'expectations.1.strandCode', message: 'strandDiffersFromParent' },
    ]);
  });
});

describe('the report', () => {
  it('says what the file holds and what would change', () => {
    // D1 is not in the database yet; C9 is, and not in the file.
    const base = imported();
    const [c1, c12] = base.expectations;
    const state = { ...base, expectations: [c1!, c12!, { ...c1!, id: 'e9', code: 'C9' }] };
    const changed = file();
    changed.expectations[1]!.textFr = 'Autre texte.';
    const report = describePlan(changed, 'Français', planCurriculumImport(changed, state));
    expect(report).toContain('Français (fra), version fra-2023');
    expect(report).toContain('summaries (not the official text), unverified');
    expect(report).toContain('Grades: 4, 5.');
    expect(report).toContain('Strands: 0 new, 0 changed, 2 unchanged.');
    expect(report).toContain('Attentes: 1 new, 1 changed, 1 unchanged.');
    expect(report).toContain('New: 5 D1');
    expect(report).toContain('Changed: 4 C1.2');
    expect(report).toContain('1 attente(s) of this version are not in the file');
  });

  it('explains error keys and shortens long lists', () => {
    const text = formatErrors([
      { path: 'expectations.1.parentCode', message: 'unknownParent' },
      { path: '', message: 'invalidJson' },
      { path: 'expectations.2.grade', message: 'Invalid input: something Zod said' },
    ]);
    expect(text.split('\n')).toEqual([
      '  expectations.1.parentCode: no overall attente with this code for the same grade in the file',
      '  (file): the file is not valid JSON',
      '  expectations.2.grade: Invalid input: something Zod said',
    ]);
    const many = formatErrors(
      Array.from({ length: 35 }, (_, i) => ({
        path: `expectations.${i}.code`,
        message: 'required',
      })),
    );
    expect(many.split('\n')).toHaveLength(31);
    expect(many).toContain('…and 5 more');
  });
});
