/**
 * Which lesson each teaching block of an absence gets (SPEC 9.4.2, DECISIONS D-010, D-055).
 * One `assignLessonsToSlots` queue runs over every built day, by date then time, so a
 * multi-day absence continues the sequence day by day.
 */
import { timeToMinutes, type LocalDate } from '../dates';
import {
  assignLessonsToSlots,
  isDone,
  type ProgressStatus,
  type SlotAssignment,
  type TeachingSlot,
  type UnitLessons,
} from '../lessons';
import { isTeachable, type ResolvedBlock } from '../school-day';
import type { DayCoverage } from './coverage';
import type { SubPlanSourceLesson, SubPlanSourceUnit, SubPlanSources } from './sources';

export interface AbsenceSlotAssignment {
  date: LocalDate;
  blockId: string;
  unit: SubPlanSourceUnit | null;
  lesson: SubPlanSourceLesson | null;
  reason: SlotAssignment['reason'];
  /**
   * For a lesson that was skipped over (a later lesson of its unit is already done): the
   * first of those later lessons. The lesson is still assigned first (D-010).
   */
  gapBefore: SubPlanSourceLesson | null;
}

/** Timetable blocks repeat every week, so a slot is a block on a date. */
export function slotKey(date: LocalDate, blockId: string): string {
  return `${date}:${blockId}`;
}

/**
 * Assigns lessons to the teacher's teaching blocks of the given days.
 *
 * - Progress comes from the sources (`pending_confirmation` counts as done), and lessons
 *   already checked off stay on the date they were taught.
 * - `assumeDone`: lessons a fixed earlier day of the absence assigned and nobody has reported
 *   on yet; they count as done so later days don't repeat them.
 * - On a half day, the teacher's blocks outside the part are sequenced too (and left out of
 *   the plan): the teacher teaches them, so the substitute continues after them.
 * - Replaced and cancelled blocks get nothing; the lesson moves to the next teachable slot.
 */
export function assignAbsenceLessons(input: {
  days: readonly DayCoverage[];
  sources: SubPlanSources;
  assumeDone: ReadonlySet<string>;
}): Map<string, AbsenceSlotAssignment> {
  const { sources, assumeDone } = input;

  const progress = new Map<string, ProgressStatus>(
    sources.progress.map((p) => [p.lessonId, p.status]),
  );
  for (const lessonId of assumeDone) {
    if (!progress.has(lessonId)) progress.set(lessonId, 'completed');
  }
  const taughtOn = new Map(sources.progress.map((p) => [p.lessonId, p.taughtOn]));

  const units = new Map<string, SubPlanSourceUnit>();
  const activeUnits = new Map<string, UnitLessons<SubPlanSourceLesson>>();
  for (const unit of sources.units) {
    const key = `${unit.classId}:${unit.subjectId}`;
    if (activeUnits.has(key)) continue; // one active unit per class and subject (D-011)
    units.set(unit.id, unit);
    activeUnits.set(key, { unitId: unit.id, lessons: unit.lessons });
  }

  const slots: TeachingSlot[] = [];
  const slotBlocks = new Map<string, { date: LocalDate; blockId: string }>();
  const days = [...input.days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const day of days) {
    const blocks: ResolvedBlock[] = [...day.covered, ...day.outsidePart]
      .filter((b) => isTeachable(b) && b.subjectId !== null)
      .sort(
        (a, b) =>
          timeToMinutes(a.effectiveStart) - timeToMinutes(b.effectiveStart) ||
          (a.classId < b.classId ? -1 : a.classId > b.classId ? 1 : 0) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
    for (const b of blocks) {
      const slotId = slotKey(day.date, b.id);
      slots.push({ slotId, date: day.date, classId: b.classId, subjectId: b.subjectId! });
      slotBlocks.set(slotId, { date: day.date, blockId: b.id });
    }
  }

  const out = new Map<string, AbsenceSlotAssignment>();
  for (const a of assignLessonsToSlots(slots, activeUnits, progress, { taughtOn })) {
    const unit = a.unitId ? (units.get(a.unitId) ?? null) : null;
    let gapBefore: SubPlanSourceLesson | null = null;
    if (a.reason === 'assigned' && a.lesson && unit) {
      const seq = a.lesson.sequenceNumber;
      gapBefore =
        [...unit.lessons]
          .filter((l) => l.sequenceNumber > seq && isDone(progress.get(l.id)))
          .sort((x, y) => x.sequenceNumber - y.sequenceNumber)[0] ?? null;
    }
    out.set(a.slotId, {
      ...slotBlocks.get(a.slotId)!,
      unit,
      lesson: a.lesson,
      reason: a.reason,
      gapBefore,
    });
  }
  return out;
}
