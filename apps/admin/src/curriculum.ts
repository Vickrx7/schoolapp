/**
 * What `pnpm admin import-curriculum` would change (DECISIONS D-070): the file, already validated
 * by `parseCurriculumFile` (@lynx/content), compared with the database's strands and attentes of
 * the same subject and curriculum version. Pure, so the dry run and the import share one plan.
 *
 * - Strands are matched by code, attentes by grade and code. A row is new, changed or unchanged;
 *   rows of that version missing from the file are kept, never deleted.
 * - Sort orders follow the file: strands in file order, attentes in file order within a grade.
 *   A file therefore holds a subject's whole curriculum version.
 * - The database adds three checks the file alone cannot make: the grade exists and is taught
 *   in the subject; an attente never changes kind (its specific attentes would lose their
 *   overall one); a specific attente is in its overall attente's strand.
 */
import type { CurriculumFile, CurriculumImportError } from '@lynx/content';

export type RowChange = 'new' | 'changed' | 'unchanged';
type Kind = 'overall' | 'specific';

export interface ExistingStrand {
  id: string;
  code: string;
  label_fr: string;
  label_en: string | null;
  sort_order: number;
}

export interface ExistingExpectation {
  id: string;
  grade_code: string;
  code: string;
  kind: Kind;
  strand_id: string | null;
  parent_id: string | null;
  text_fr: string;
  text_en: string | null;
  is_verified: boolean;
  source_note: string | null;
  sort_order: number;
}

export interface CurriculumState {
  /** Grade code → ordinal (K1 = -1, K2 = 0, 1re…8e = 1…8). */
  grades: ReadonlyMap<string, number>;
  /** The subject's grade range, as ordinals. */
  subject: { gradeMin: number; gradeMax: number };
  /** The subject's strands and attentes of the file's curriculum version. */
  strands: readonly ExistingStrand[];
  expectations: readonly ExistingExpectation[];
}

export interface PlannedStrand {
  code: string;
  label_fr: string;
  label_en: string | null;
  sort_order: number;
  change: RowChange;
}

export interface PlannedExpectation {
  grade_code: string;
  code: string;
  kind: Kind;
  strandCode: string | null;
  /** Code of the overall attente (same grade), for a specific attente. */
  parentCode: string | null;
  text_fr: string;
  text_en: string | null;
  is_verified: boolean;
  source_note: string | null;
  sort_order: number;
  change: RowChange;
}

export interface CurriculumPlan {
  strands: PlannedStrand[];
  expectations: PlannedExpectation[];
  /** Attentes of this subject and version in the database but not in the file (kept). */
  kept: number;
  errors: CurriculumImportError[];
}

const key = (grade: string, code: string) => `${grade}:${code}`;

export function planCurriculumImport(file: CurriculumFile, state: CurriculumState): CurriculumPlan {
  const errors: CurriculumImportError[] = [];

  const strandById = new Map(state.strands.map((s) => [s.id, s]));
  const strandByCode = new Map(state.strands.map((s) => [s.code, s]));
  const strands = file.strands.map((s, i): PlannedStrand => {
    const row = { code: s.code, label_fr: s.labelFr, label_en: s.labelEn, sort_order: i + 1 };
    const existing = strandByCode.get(s.code);
    const same =
      existing &&
      existing.label_fr === row.label_fr &&
      existing.label_en === row.label_en &&
      existing.sort_order === row.sort_order;
    return { ...row, change: !existing ? 'new' : same ? 'unchanged' : 'changed' };
  });

  const existingById = new Map(state.expectations.map((e) => [e.id, e]));
  const existingByKey = new Map(state.expectations.map((e) => [key(e.grade_code, e.code), e]));
  const inFile = new Map(file.expectations.map((e) => [key(e.grade, e.code), e]));
  const positions = new Map<string, number>();

  const expectations = file.expectations.map((e, i): PlannedExpectation => {
    const at = (field: string) => `expectations.${i}.${field}`;
    const ordinal = state.grades.get(e.grade);
    if (ordinal === undefined) errors.push({ path: at('grade'), message: 'unknownGrade' });
    else if (ordinal < state.subject.gradeMin || ordinal > state.subject.gradeMax) {
      errors.push({ path: at('grade'), message: 'gradeNotInSubject' });
    }
    if (e.parentCode !== null) {
      const parent = inFile.get(key(e.grade, e.parentCode));
      if (parent && parent.strandCode !== e.strandCode) {
        errors.push({ path: at('strandCode'), message: 'strandDiffersFromParent' });
      }
    }

    const position = (positions.get(e.grade) ?? 0) + 1;
    positions.set(e.grade, position);
    const row = {
      grade_code: e.grade,
      code: e.code,
      kind: e.kind,
      strandCode: e.strandCode,
      parentCode: e.parentCode,
      text_fr: e.textFr,
      text_en: e.textEn,
      is_verified: file.verified,
      source_note: file.sourceNote,
      sort_order: position,
    };
    const existing = existingByKey.get(key(e.grade, e.code));
    if (!existing) return { ...row, change: 'new' };
    if (existing.kind !== e.kind) {
      errors.push({ path: at('kind'), message: 'kindChanged' });
    }
    const existingStrand = existing.strand_id ? strandById.get(existing.strand_id) : undefined;
    const existingParent = existing.parent_id ? existingById.get(existing.parent_id) : undefined;
    const same =
      existing.kind === row.kind &&
      (existingStrand?.code ?? null) === row.strandCode &&
      (existingParent?.code ?? null) === row.parentCode &&
      existing.text_fr === row.text_fr &&
      existing.text_en === row.text_en &&
      existing.is_verified === row.is_verified &&
      existing.source_note === row.source_note &&
      existing.sort_order === row.sort_order;
    return { ...row, change: same ? 'unchanged' : 'changed' };
  });

  const kept = state.expectations.filter((e) => !inFile.has(key(e.grade_code, e.code))).length;
  return { strands, expectations, kept, errors };
}

/** Plain-English explanations of the error keys of the file schema and of the plan. */
const MESSAGES: Record<string, string> = {
  invalidJson: 'the file is not valid JSON',
  required: 'required',
  tooLong: 'too long',
  tooMany: 'too many entries',
  invalid: 'invalid',
  invalidGrade: 'not a grade code (K1, K2 or 1 to 8)',
  invalidKind: 'must be "overall" or "specific"',
  duplicateCode: 'this code appears twice',
  unknownStrand: 'no strand with this code in the file',
  overallHasParent: 'an overall attente has no parentCode',
  parentRequired: 'a specific attente needs the parentCode of its overall attente',
  unknownParent: 'no overall attente with this code for the same grade in the file',
  parentNotOverall: 'the parent must be an overall attente',
  unknownGrade: 'no such grade in the database',
  gradeNotInSubject: 'the subject is not taught in this grade',
  strandDiffersFromParent: 'a specific attente must be in the strand of its overall attente',
  kindChanged: 'the database has this attente with the other kind (overall or specific)',
};

/** One line per error (the first 30), for the operator. */
export function formatErrors(errors: readonly CurriculumImportError[]): string {
  const lines = errors
    .slice(0, 30)
    .map((e) => `  ${e.path || '(file)'}: ${MESSAGES[e.message] ?? e.message}`);
  if (errors.length > 30) lines.push(`  …and ${errors.length - 30} more`);
  return lines.join('\n');
}

function counts<T extends { change: RowChange }>(rows: readonly T[]): string {
  const n = (change: RowChange) => rows.filter((r) => r.change === change).length;
  return `${n('new')} new, ${n('changed')} changed, ${n('unchanged')} unchanged`;
}

function codes(rows: readonly PlannedExpectation[], change: RowChange): string | null {
  const picked = rows.filter((r) => r.change === change);
  if (!picked.length) return null;
  const shown = picked.slice(0, 20).map((r) => `${r.grade_code} ${r.code}`);
  return `${shown.join(', ')}${picked.length > 20 ? `, …(${picked.length - 20} more)` : ''}`;
}

/** The dry-run report: what the file holds and what importing it would change. */
export function describePlan(
  file: CurriculumFile,
  subjectLabel: string,
  plan: CurriculumPlan,
): string {
  const grades = [...new Set(file.expectations.map((e) => e.grade))].join(', ');
  const status = [
    file.official ? 'official text' : 'summaries (not the official text)',
    file.verified ? 'verified' : 'unverified, shown as « À vérifier »',
  ].join(', ');
  const lines = [
    `${subjectLabel} (${file.subjectCode}), version ${file.curriculumVersion}: ${status}.`,
    `  Grades: ${grades}.`,
    `  Strands: ${counts(plan.strands)}.`,
    `  Attentes: ${counts(plan.expectations)}.`,
  ];
  const created = codes(plan.expectations, 'new');
  const changed = codes(plan.expectations, 'changed');
  if (created) lines.push(`    New: ${created}`);
  if (changed) lines.push(`    Changed: ${changed}`);
  if (plan.kept) {
    lines.push(
      `  ${plan.kept} attente(s) of this version are not in the file and stay as they are.`,
    );
  }
  return lines.join('\n');
}

/** True when importing the plan writes nothing. */
export function planIsEmpty(plan: CurriculumPlan): boolean {
  return [...plan.strands, ...plan.expectations].every((r) => r.change === 'unchanged');
}
