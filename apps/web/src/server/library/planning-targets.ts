/**
 * « Ajouter à ma planification » (DECISIONS D-076): the teacher's classes, their units and
 * lessons, and the choices the dialog makes for her. Materials are attached to a lesson (by
 * default the next lesson not yet done that shares an attente with the resource, else the next
 * lesson not yet done); a lesson plan or a project becomes a new lesson, at the end of the unit
 * by default. Pure, so the defaults are unit-tested; the dialog and the server actions use it.
 */
import type { LibraryItemType } from '@lynx/content';

export interface PlanningLesson {
  id: string;
  sequenceNumber: number;
  title: string;
  /** Taught, skipped, or reported by a substitute (pending counts as done, D-010). */
  done: boolean;
  expectationIds: string[];
  /** The resource already attached to the lesson, if the teacher can see it. */
  resource: { id: string; title: string } | null;
  /** A resource is attached that the teacher cannot open any more. */
  hasHiddenResource: boolean;
}

export type UnitStatus = 'active' | 'planned' | 'completed' | 'archived';

export interface PlanningUnit {
  id: string;
  title: string;
  subjectId: string;
  subjectLabel: string;
  status: UnitStatus;
  lessons: PlanningLesson[];
}

export interface PlanningClass {
  id: string;
  name: string;
  gradeCodes: string[];
  units: PlanningUnit[];
}

export interface PlanningTargets {
  classes: PlanningClass[];
  /**
   * The attentes that count as shared with the resource: its own, their overall attentes and
   * their specific attentes (as the library's attente filter matches, D-069).
   */
  relatedExpectationIds: string[];
}

export type PlanningMode = 'attach' | 'new';

/** Materials are attached to a lesson; a lesson plan or a project becomes a lesson (D-076). */
export function defaultMode(type: LibraryItemType): PlanningMode {
  return type === 'lesson_plan' || type === 'project' ? 'new' : 'attach';
}

const STATUS_ORDER: Record<UnitStatus, number> = {
  active: 0,
  planned: 1,
  completed: 2,
  archived: 3,
};

/** The resource's subject first, then active, planned and completed units, then by title. */
export function orderUnits<U extends Pick<PlanningUnit, 'subjectId' | 'status' | 'title'>>(
  units: readonly U[],
  subjectId: string | null,
): U[] {
  return [...units].sort(
    (a, b) =>
      Number(a.subjectId !== subjectId) - Number(b.subjectId !== subjectId) ||
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      a.title.localeCompare(b.title, 'fr-CA'),
  );
}

/** The next lesson not yet done (« prochaine leçon »), or null when the unit is finished. */
export function nextLesson<L extends Pick<PlanningLesson, 'done' | 'sequenceNumber'>>(
  lessons: readonly L[],
): L | null {
  return (
    [...lessons].sort((a, b) => a.sequenceNumber - b.sequenceNumber).find((l) => !l.done) ?? null
  );
}

/**
 * The lesson a material is attached to by default: the next lesson not yet done that shares an
 * attente with the resource, else the next lesson not yet done, else the last lesson.
 */
export function defaultLesson(
  lessons: readonly PlanningLesson[],
  relatedExpectationIds: readonly string[],
): PlanningLesson | null {
  const ordered = [...lessons].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  const related = new Set(relatedExpectationIds);
  return (
    ordered.find((l) => !l.done && l.expectationIds.some((e) => related.has(e))) ??
    nextLesson(ordered) ??
    ordered[ordered.length - 1] ??
    null
  );
}

/** The class to start with: one that has a unit of the resource's subject for one of its grades. */
export function defaultClass(
  classes: readonly PlanningClass[],
  subjectId: string | null,
  gradeCodes: readonly string[],
): PlanningClass | null {
  const hasSubject = (c: PlanningClass) => c.units.some((u) => u.subjectId === subjectId);
  const hasGrade = (c: PlanningClass) => c.gradeCodes.some((g) => gradeCodes.includes(g));
  return (
    classes.find((c) => hasSubject(c) && hasGrade(c)) ??
    classes.find(hasSubject) ??
    classes.find(hasGrade) ??
    classes[0] ??
    null
  );
}

/** The unit to start with: the first in `orderUnits` order (the resource's active unit). */
export function defaultUnit(
  cls: PlanningClass | null,
  subjectId: string | null,
): PlanningUnit | null {
  return cls ? (orderUnits(cls.units, subjectId)[0] ?? null) : null;
}

export type NewLessonPosition =
  | { kind: 'end' }
  | { kind: 'next'; before: PlanningLesson }
  | { kind: 'after'; lesson: PlanningLesson };

/** Where a new lesson can go: « À la fin de l'unité », « Comme prochaine leçon », « Après la leçon N ». */
export function positionChoices(lessons: readonly PlanningLesson[]): NewLessonPosition[] {
  const ordered = [...lessons].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  const next = nextLesson(ordered);
  return [
    { kind: 'end' },
    ...(next ? [{ kind: 'next' as const, before: next }] : []),
    ...ordered
      .filter((l) => l !== ordered[ordered.length - 1])
      .map((lesson) => ({ kind: 'after' as const, lesson })),
  ];
}

/** The `p_position` of `add_library_item_to_unit` (null: at the end). */
export function positionNumber(position: NewLessonPosition): number | null {
  switch (position.kind) {
    case 'end':
      return null;
    case 'next':
      return position.before.sequenceNumber;
    case 'after':
      return position.lesson.sequenceNumber + 1;
  }
}

/** A position as the dialog's `<select>` value, and back. */
export function positionKey(position: NewLessonPosition): string {
  return position.kind === 'end'
    ? 'end'
    : position.kind === 'next'
      ? `next:${position.before.id}`
      : `after:${position.lesson.id}`;
}

/** The planning page of a unit (« Voir la planification »). */
export const unitPlanningHref = (classId: string, unitId: string) =>
  `/classes/${classId}/planning/${unitId}`;
