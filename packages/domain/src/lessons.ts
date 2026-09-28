/**
 * "Where did the class leave off?" Next-lesson selection from a unit's ordered lessons and
 * the recorded progress. This drives the today view and, in Phase 3, the substitute plan.
 */

export type ProgressStatus = 'completed' | 'skipped' | 'pending_confirmation';

export interface LessonRef {
  id: string;
  sequenceNumber: number;
  title: string;
}

export interface NextLessonsResult<L extends LessonRef = LessonRef> {
  /** The highest-sequence lesson marked done. */
  lastDone: L | null;
  /** The next lessons to teach, in order (first not-done lessons in sequence). */
  next: L[];
  /** Lessons left undone before `lastDone` (e.g. forgotten check-offs), in order. */
  gaps: L[];
  /** True when every lesson in the unit is done. */
  unitFinished: boolean;
}

export interface NextLessonsOptions {
  /** How many upcoming lessons to return. Default 1. */
  count?: number;
  /**
   * Whether lessons reported by a substitute but not yet confirmed by the teacher count as
   * done for sequencing. Default true: the class did see them, the record just isn't final.
   */
  pendingCountsAsDone?: boolean;
}

export function isDone(status: ProgressStatus | undefined, pendingCountsAsDone = true): boolean {
  if (status === 'completed' || status === 'skipped') return true;
  return status === 'pending_confirmation' && pendingCountsAsDone;
}

export function nextLessons<L extends LessonRef>(
  lessons: readonly L[],
  progress: ReadonlyMap<string, ProgressStatus>,
  options: NextLessonsOptions = {},
): NextLessonsResult<L> {
  const count = options.count ?? 1;
  const pendingCountsAsDone = options.pendingCountsAsDone ?? true;
  const ordered = [...lessons].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  const done = (l: L) => isDone(progress.get(l.id), pendingCountsAsDone);

  let lastDoneIndex = -1;
  ordered.forEach((l, i) => {
    if (done(l)) lastDoneIndex = i;
  });

  const notDone = ordered.filter((l) => !done(l));
  return {
    lastDone: lastDoneIndex >= 0 ? ordered[lastDoneIndex]! : null,
    next: notDone.slice(0, count),
    gaps: ordered.slice(0, Math.max(lastDoneIndex, 0)).filter((l) => !done(l)),
    unitFinished: ordered.length > 0 && notDone.length === 0,
  };
}

/** A teaching slot: one subject block of one class on one date. */
export interface TeachingSlot {
  slotId: string;
  date: string;
  classId: string;
  subjectId: string;
}

export interface UnitLessons<L extends LessonRef = LessonRef> {
  unitId: string;
  lessons: readonly L[];
}

export interface SlotAssignment<L extends LessonRef = LessonRef> {
  slotId: string;
  unitId: string | null;
  lesson: L | null;
  /**
   * 'taught': the lesson was already checked off on the slot's date.
   * 'assigned': the next lesson to teach.
   * Otherwise why there is no lesson: no active unit for the subject, or it ran out of lessons.
   */
  reason: 'taught' | 'assigned' | 'no_active_unit' | 'unit_finished';
}

/**
 * Assigns lessons to consecutive teaching slots (in the order given: by date, then time).
 * Each slot for a class+subject takes the next not-done lesson of that pair's active unit,
 * so a two-day absence continues the sequence on day two, and two French blocks on the same
 * day get consecutive lessons.
 */
export function assignLessonsToSlots<L extends LessonRef>(
  slots: readonly TeachingSlot[],
  activeUnits: ReadonlyMap<string, UnitLessons<L>>,
  progress: ReadonlyMap<string, ProgressStatus>,
  options: {
    /** Date each lesson was taught, so already-taught lessons stay on their day's slots. */
    taughtOn?: ReadonlyMap<string, string | null>;
    unitKey?: (classId: string, subjectId: string) => string;
  } = {},
): SlotAssignment<L>[] {
  const unitKey = options.unitKey ?? ((c: string, s: string) => `${c}:${s}`);
  const taughtOn = options.taughtOn ?? new Map<string, string | null>();
  const queues = new Map<string, L[]>();
  const taughtQueues = new Map<string, L[]>();

  return slots.map((slot) => {
    const key = unitKey(slot.classId, slot.subjectId);
    const unit = activeUnits.get(key);
    if (!unit) return { slotId: slot.slotId, unitId: null, lesson: null, reason: 'no_active_unit' };

    // Lessons already checked off on this slot's date fill that date's slots first.
    const dayKey = `${key}@${slot.date}`;
    if (!taughtQueues.has(dayKey)) {
      taughtQueues.set(
        dayKey,
        [...unit.lessons]
          .filter((l) => taughtOn.get(l.id) === slot.date && isDone(progress.get(l.id)))
          .sort((a, b) => a.sequenceNumber - b.sequenceNumber),
      );
    }
    const taught = taughtQueues.get(dayKey)!.shift();
    if (taught)
      return { slotId: slot.slotId, unitId: unit.unitId, lesson: taught, reason: 'taught' };

    if (!queues.has(key)) {
      const remaining = nextLessons(unit.lessons, progress, { count: unit.lessons.length }).next;
      queues.set(key, [...remaining]);
    }
    const lesson = queues.get(key)!.shift() ?? null;
    return {
      slotId: slot.slotId,
      unitId: unit.unitId,
      lesson,
      reason: lesson ? 'assigned' : 'unit_finished',
    };
  });
}
