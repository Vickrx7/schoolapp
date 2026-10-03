/**
 * What the library editor offers (DECISIONS D-061, D-067, D-074): schools, grades, subjects,
 * levels, curated tags, Catholic references and attentes, loaded by
 * `server/queries/library-authoring.ts`. Pure types and helpers (no server-only import), so the
 * client editor uses them.
 */
import type { GradeOption, SubjectOption } from '../queries/library-search';

export interface EditorSchool {
  id: string;
  name: string;
  boardId: string;
}

export interface EditorLevel {
  id: string;
  label: string;
  description: string | null;
  /** One of the user's own levels: versions for it keep the item private (D-066). */
  personal: boolean;
  active: boolean;
}

export interface EditorExpectation {
  id: string;
  gradeCode: string;
  parentId: string | null;
  kind: 'overall' | 'specific';
  code: string;
  text: string;
  /** « À vérifier » while false (D-030). */
  verified: boolean;
  sortOrder: number;
  strand: { id: string; code: string; label: string; sortOrder: number } | null;
}

export interface EditorReference {
  id: string;
  title: string;
  type: 'virtue' | 'graduate_expectation' | 'reflection' | 'prayer' | 'scripture';
  gradeMin: number;
  gradeMax: number;
}

export interface EditorContext {
  /** Device drafts are kept per user (D-044). */
  userId: string;
  /** The user's library schools (a new item is written for one of them). */
  schools: EditorSchool[];
  grades: GradeOption[];
  subjects: SubjectOption[];
  anglaisStartGrade: number;
  /** The grades of the user's classes (offered first). */
  myGrades: string[];
  /** The item board's levels, then the user's own. */
  levels: EditorLevel[];
  tags: { id: string; label: string }[];
  references: EditorReference[];
  /** The attentes of the item's grades and subject when the editor opened. */
  expectations: EditorExpectation[];
}

export interface ExpectationGroup {
  gradeCode: string;
  strand: EditorExpectation['strand'];
  /** Overall attentes, each followed by its specific ones, in curriculum order. */
  expectations: EditorExpectation[];
}

/**
 * Attentes grouped by grade then domaine, each overall attente followed by its specific ones (as
 * « Parcourir le curriculum » shows them).
 */
export function groupExpectations(
  expectations: readonly EditorExpectation[],
  gradeOrder: readonly string[],
): ExpectationGroup[] {
  const groups = new Map<string, ExpectationGroup>();
  const sorted = [...expectations].sort(
    (a, b) =>
      gradeOrder.indexOf(a.gradeCode) - gradeOrder.indexOf(b.gradeCode) ||
      (a.strand?.sortOrder ?? 999) - (b.strand?.sortOrder ?? 999) ||
      a.sortOrder - b.sortOrder ||
      a.code.localeCompare(b.code, 'fr-CA', { numeric: true }),
  );
  for (const e of sorted) {
    const key = `${e.gradeCode}:${e.strand?.id ?? ''}`;
    let group = groups.get(key);
    if (!group) {
      group = { gradeCode: e.gradeCode, strand: e.strand, expectations: [] };
      groups.set(key, group);
    }
    group.expectations.push(e);
  }
  for (const group of groups.values()) {
    const ids = new Set(group.expectations.map((e) => e.id));
    const overall = group.expectations.filter(
      (e) => e.kind === 'overall' || !e.parentId || !ids.has(e.parentId),
    );
    const ordered: EditorExpectation[] = [];
    for (const parent of overall) {
      ordered.push(parent);
      ordered.push(
        ...group.expectations.filter((e) => e.parentId === parent.id && e.kind === 'specific'),
      );
    }
    group.expectations = ordered;
  }
  return [...groups.values()];
}

/** The subjects of some grades (by ordinal), with Anglais from the board's start grade (D-069). */
export function subjectsForGrades(
  context: Pick<EditorContext, 'subjects' | 'grades' | 'anglaisStartGrade'>,
  gradeCodes: readonly string[],
): SubjectOption[] {
  const ordinals = context.grades.filter((g) => gradeCodes.includes(g.code)).map((g) => g.ordinal);
  if (!ordinals.length) return context.subjects;
  return context.subjects.filter((s) =>
    ordinals.some(
      (o) =>
        s.gradeMin <= o && s.gradeMax >= o && (s.code !== 'ang' || o >= context.anglaisStartGrade),
    ),
  );
}
