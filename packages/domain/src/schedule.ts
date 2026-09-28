/**
 * Which timetable "day" applies on a date.
 *
 * Weekly schools repeat Monday..Friday (day key 1..5). Cycle schools rotate Jour 1..N over
 * instructional days only: weekends, PA days and holidays do not advance the rotation.
 * Anchors ("on this date it is Jour N") set or reset the rotation.
 */
import { noSchoolEventOn, type CalendarEvent } from './calendar';
import { addDays, isoWeekday, isWeekend, type LocalDate } from './dates';

export interface CycleAnchor {
  anchorDate: LocalDate;
  cycleDay: number;
}

export type ScheduleConfig =
  { type: 'weekly' } | { type: 'cycle'; cycleLength: number; anchors: readonly CycleAnchor[] };

/** Upper bound on how far we walk from an anchor (a school year is ~190 school days). */
const MAX_WALK_DAYS = 800;

export function isInstructionalDay(date: LocalDate, events: readonly CalendarEvent[]): boolean {
  return !isWeekend(date) && noSchoolEventOn(events, date) === null;
}

export type DayKeyResult =
  | { status: 'instructional'; dayKey: number }
  | { status: 'no_school'; reason: 'weekend' | 'event'; event: CalendarEvent | null }
  /** Cycle school with no anchor on or before the date: the rotation is unknown. */
  | { status: 'unknown_cycle_day' };

export function dayKeyFor(
  date: LocalDate,
  schedule: ScheduleConfig,
  events: readonly CalendarEvent[],
): DayKeyResult {
  if (isWeekend(date)) return { status: 'no_school', reason: 'weekend', event: null };
  const closure = noSchoolEventOn(events, date);
  if (closure) return { status: 'no_school', reason: 'event', event: closure };

  if (schedule.type === 'weekly') {
    return { status: 'instructional', dayKey: isoWeekday(date) };
  }

  const anchor = [...schedule.anchors]
    .filter((a) => a.anchorDate <= date)
    .sort((a, b) => (a.anchorDate < b.anchorDate ? 1 : -1))[0];
  if (!anchor) return { status: 'unknown_cycle_day' };

  // The anchor's cycle day belongs to the first instructional day on or after the anchor.
  let current = anchor.anchorDate;
  let steps = 0;
  while (!isInstructionalDay(current, events)) {
    current = addDays(current, 1);
    if (++steps > MAX_WALK_DAYS) return { status: 'unknown_cycle_day' };
  }
  let instructionalDaysSince = 0;
  while (current < date) {
    current = addDays(current, 1);
    if (isInstructionalDay(current, events)) instructionalDaysSince += 1;
    if (++steps > MAX_WALK_DAYS) return { status: 'unknown_cycle_day' };
  }

  const zeroBased = (anchor.cycleDay - 1 + instructionalDaysSince) % schedule.cycleLength;
  return { status: 'instructional', dayKey: zeroBased + 1 };
}

/** The next `count` instructional dates starting at `from` (inclusive). */
export function nextInstructionalDays(
  from: LocalDate,
  count: number,
  events: readonly CalendarEvent[],
): LocalDate[] {
  const out: LocalDate[] = [];
  let date = from;
  let guard = 0;
  while (out.length < count && guard++ < MAX_WALK_DAYS) {
    if (isInstructionalDay(date, events)) out.push(date);
    date = addDays(date, 1);
  }
  return out;
}
