/**
 * « Mon année » (DECISIONS D-123, D-126): the school year as weeks, Monday to Friday, each with
 * its school days, its days off and its other events. A unit's planned window is saved as the
 * first and last weekday of the weeks the teacher picks, clamped to the school year.
 */
import { eventsOn, noSchoolEventOn, type CalendarEvent, type CalendarEventType } from '../calendar';
import { addDays, isoWeekday, type LocalDate } from '../dates';

/** A calendar event with its school (null: the whole board), as the year view reads them. */
export interface YearCalendarEvent extends CalendarEvent {
  schoolId: string | null;
}

export interface DayOff {
  date: LocalDate;
  title: string;
  type: CalendarEventType;
}

export interface SchoolWeek {
  /** The week's Monday, even when the year starts later in that week. */
  monday: LocalDate;
  /** Its weekdays inside the school year. */
  days: LocalDate[];
  /** How many of them have school. */
  schoolDays: number;
  /** The weekdays without school (PA days, holidays), with the event that closes them. */
  daysOff: DayOff[];
  /** The week's other events (masses, assemblies, a class's own events…), first day first. */
  events: CalendarEvent[];
}

export interface DateWindow {
  startsOn: LocalDate;
  endsOn: LocalDate;
}

/** The Monday of a date's week. */
export function mondayOf(date: LocalDate): LocalDate {
  return addDays(date, 1 - isoWeekday(date));
}

/**
 * The events that concern a class: the board's, its school's and its own. Other schools' events
 * and other classes' events are left out.
 */
export function classEvents(
  events: readonly YearCalendarEvent[],
  schoolId: string,
  classId: string,
): YearCalendarEvent[] {
  return events.filter(
    (e) =>
      (e.schoolId === null || e.schoolId === schoolId) &&
      (e.classId === null || e.classId === classId),
  );
}

/**
 * The weeks of a school year (Monday to Friday). A day has school unless it is a weekend or a
 * board or school PA day or holiday (`noSchoolEventOn`); a class's own event never closes the
 * school.
 */
export function schoolWeeks(input: {
  startsOn: LocalDate;
  endsOn: LocalDate;
  events: readonly YearCalendarEvent[];
  schoolId: string;
  classId: string;
}): SchoolWeek[] {
  const { startsOn, endsOn } = input;
  if (endsOn < startsOn) return [];
  const events = classEvents(input.events, input.schoolId, input.classId);
  const weeks: SchoolWeek[] = [];
  for (let monday = mondayOf(startsOn); monday <= endsOn; monday = addDays(monday, 7)) {
    const days: LocalDate[] = [];
    const daysOff: DayOff[] = [];
    const closures = new Set<string>();
    const others = new Map<string, CalendarEvent>();
    for (let i = 0; i < 5; i++) {
      const date = addDays(monday, i);
      if (date < startsOn || date > endsOn) continue;
      days.push(date);
      const closure = noSchoolEventOn(events, date);
      if (closure) {
        daysOff.push({ date, title: closure.title, type: closure.eventType });
        closures.add(closure.id);
      }
      for (const e of eventsOn(events, date, input.classId)) others.set(e.id, e);
    }
    weeks.push({
      monday,
      days,
      schoolDays: days.length - daysOff.length,
      daysOff,
      events: [...others.values()]
        .filter((e) => !closures.has(e.id))
        .sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.title.localeCompare(b.title)),
    });
  }
  return weeks;
}

/**
 * The window of the weeks from `fromMonday` to `toMonday` (inclusive): Monday of the first to
 * Friday of the last, clamped to the school year (a year that starts on a Wednesday starts the
 * window on that Wednesday, or the database refuses it: LXY01). Null when the weeks are in the
 * wrong order or outside the year.
 */
export function weekWindow(
  fromMonday: LocalDate,
  toMonday: LocalDate,
  year: DateWindow,
): DateWindow | null {
  const from = mondayOf(fromMonday);
  const to = addDays(mondayOf(toMonday), 4);
  if (to < from) return null;
  const startsOn = from < year.startsOn ? year.startsOn : from;
  const endsOn = to > year.endsOn ? year.endsOn : to;
  return endsOn < startsOn ? null : { startsOn, endsOn };
}

/** The weeks a window touches. */
export function weeksOf<W extends Pick<SchoolWeek, 'days'>>(
  window: DateWindow,
  weeks: readonly W[],
): W[] {
  return weeks.filter((w) => w.days.some((d) => d >= window.startsOn && d <= window.endsOn));
}

/** The school days inside a window. */
export function unitSchoolDays(
  window: DateWindow,
  weeks: readonly Pick<SchoolWeek, 'days' | 'daysOff'>[],
): number {
  let count = 0;
  for (const week of weeks) {
    const off = new Set(week.daysOff.map((d) => d.date));
    for (const day of week.days) {
      if (day >= window.startsOn && day <= window.endsOn && !off.has(day)) count += 1;
    }
  }
  return count;
}
