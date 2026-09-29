/**
 * Student groups for a substitute, by language level (SPEC 9.4.4, DECISIONS D-032). Groups
 * hold student ids only; first names are joined from the roster when the plan is displayed.
 */
import type { SubPlanSourceLevel, SubPlanSourceStudent } from './sources';
import { compareFr } from './text';

export interface StudentGroup {
  /** G1, G2...: stable for the same input, unique across the plan. */
  key: string;
  classId: string;
  /** Null for the « Sans niveau » group. */
  levelId: string | null;
  studentIds: string[];
}

/**
 * Groups active students per class (in the order of `classIds`, else by class id), then by
 * level in the level's sort order. Students without a level, or with a level the sources don't
 * describe, form a « Sans niveau » group last in their class.
 */
export function groupStudentsByLevel(
  students: readonly Pick<SubPlanSourceStudent, 'id' | 'classId' | 'levelId' | 'active'>[],
  levels: readonly Pick<SubPlanSourceLevel, 'id' | 'labelFr' | 'sortOrder'>[],
  classIds?: readonly string[],
): { groups: StudentGroup[]; withoutLevel: boolean } {
  const levelOrder = [...levels].sort(
    (a, b) =>
      a.sortOrder - b.sortOrder || compareFr(a.labelFr, b.labelFr) || (a.id < b.id ? -1 : 1),
  );
  const known = new Set(levelOrder.map((l) => l.id));
  const active = students.filter((s) => s.active);
  const classes =
    classIds ?? [...new Set(active.map((s) => s.classId))].sort((a, b) => (a < b ? -1 : 1));

  const groups: StudentGroup[] = [];
  let withoutLevel = false;
  for (const classId of classes) {
    const inClass = active
      .filter((s) => s.classId === classId)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const level of levelOrder) {
      const ids = inClass.filter((s) => s.levelId === level.id).map((s) => s.id);
      if (ids.length > 0) groups.push({ key: '', classId, levelId: level.id, studentIds: ids });
    }
    const unleveled = inClass.filter((s) => !s.levelId || !known.has(s.levelId)).map((s) => s.id);
    if (unleveled.length > 0) {
      withoutLevel = true;
      groups.push({ key: '', classId, levelId: null, studentIds: unleveled });
    }
  }
  return { groups: groups.map((g, i) => ({ ...g, key: `G${i + 1}` })), withoutLevel };
}
