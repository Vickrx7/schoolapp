/**
 * Report periods (DECISIONS D-124): Ontario's three elementary report cards, set by the board
 * for each school year: the Progress Report Card in the fall, then the Provincial Report Card's
 * two terms. Each has an evaluation window and two optional dates, « saisie au plus tard le »
 * (marks due) and « remise aux familles » (sent home).
 */
import { noSchoolEventOn, type CalendarEvent } from '../calendar';
import { addDays, isWeekend, type LocalDate } from '../dates';
import type { DateWindow } from './weeks';

export const REPORT_PERIOD_KINDS = ['progress', 'term1', 'term2'] as const;
export type ReportPeriodKind = (typeof REPORT_PERIOD_KINDS)[number];

export interface ReportPeriodDates {
  startsOn: LocalDate;
  endsOn: LocalDate;
  /** « Saisie au plus tard le » */
  dueOn: LocalDate | null;
  /** « Remise aux familles » */
  issuedOn: LocalDate | null;
}

export interface ReportPeriod extends ReportPeriodDates {
  kind: ReportPeriodKind;
}

const pad = (n: number) => String(n).padStart(2, '0');
const on = (year: number, month: number, day: number): LocalDate =>
  `${year}-${pad(month)}-${pad(day)}`;

/** Whether the board's calendar has school that day (a weekday that is not a PA day or holiday). */
function hasSchool(date: LocalDate, events: readonly CalendarEvent[]): boolean {
  return !isWeekend(date) && noSchoolEventOn(events, date) === null;
}

/** The school day on or before a date, never before `floor` (then `floor` itself). */
function schoolDayOnOrBefore(
  date: LocalDate,
  events: readonly CalendarEvent[],
  floor: LocalDate,
): LocalDate {
  for (let d = date, i = 0; d >= floor && i < 60; d = addDays(d, -1), i++) {
    if (hasSchool(d, events)) return d;
  }
  return floor;
}

/** The school day on or after a date, never after `ceiling` (then `ceiling` itself). */
function schoolDayOnOrAfter(
  date: LocalDate,
  events: readonly CalendarEvent[],
  ceiling: LocalDate,
): LocalDate {
  for (let d = date, i = 0; d <= ceiling && i < 60; d = addDays(d, 1), i++) {
    if (hasSchool(d, events)) return d;
  }
  return ceiling;
}

/**
 * « Préremplir avec les dates habituelles » (Assumption, D-124): the usual Ontario windows for a
 * school year that starts in late summer, each date moved to the board's school day on or before
 * it (`events`: the board's own PA days and holidays):
 * - progress: the year's first day to October 31; saisie November 7; remise November 15;
 * - term 1: the year's first day to January 31; saisie February 7; remise February 15;
 * - term 2: February 1 (the school day on or after it) to June 11; saisie June 16; remise on the
 *   year's last day.
 * Everything stays inside the year; a period that would not fit is left out.
 */
export function typicalReportPeriods(
  year: DateWindow,
  events: readonly CalendarEvent[],
): ReportPeriod[] {
  const start = Number(year.startsOn.slice(0, 4));
  // A year that starts in January to June belongs to the school year begun the summer before.
  const fall = Number(year.startsOn.slice(5, 7)) >= 7 ? start : start - 1;
  const spring = fall + 1;
  const back = (date: LocalDate) => {
    const d = schoolDayOnOrBefore(date, events, year.startsOn);
    return d > year.endsOn ? schoolDayOnOrBefore(year.endsOn, events, year.startsOn) : d;
  };
  const termTwoStart = schoolDayOnOrAfter(on(spring, 2, 1), events, year.endsOn);
  const periods: ReportPeriod[] = [
    {
      kind: 'progress',
      startsOn: year.startsOn,
      endsOn: back(on(fall, 10, 31)),
      dueOn: back(on(fall, 11, 7)),
      issuedOn: back(on(fall, 11, 15)),
    },
    {
      kind: 'term1',
      startsOn: year.startsOn,
      endsOn: back(on(spring, 1, 31)),
      dueOn: back(on(spring, 2, 7)),
      issuedOn: back(on(spring, 2, 15)),
    },
    {
      kind: 'term2',
      startsOn: termTwoStart < year.startsOn ? year.startsOn : termTwoStart,
      endsOn: back(on(spring, 6, 11)),
      dueOn: back(on(spring, 6, 16)),
      issuedOn: back(year.endsOn),
    },
  ];
  // A year that ends before February has no second term.
  if (on(spring, 2, 1) > year.endsOn) periods.pop();
  return periods.filter(
    (p) =>
      p.startsOn >= year.startsOn &&
      p.endsOn <= year.endsOn &&
      p.endsOn >= p.startsOn &&
      (p.dueOn === null || p.dueOn >= p.startsOn) &&
      (p.issuedOn === null || p.issuedOn >= p.startsOn),
  );
}

/** Whether a period's window lies inside its school year (else « Hors de l'année »). */
export function reportPeriodInYear(period: ReportPeriodDates, year: DateWindow): boolean {
  return period.startsOn >= year.startsOn && period.endsOn <= year.endsOn;
}

export type ReportMarkerWhat = 'end' | 'due' | 'issued';

export interface ReportMarker {
  kind: ReportPeriodKind;
  what: ReportMarkerWhat;
  date: LocalDate;
}

/**
 * The report dates to mark on a calendar, in date order: each period's last day of evaluation,
 * its « saisie » and its « remise » when set.
 */
export function reportMarkers(periods: readonly ReportPeriod[]): ReportMarker[] {
  const order: Record<ReportMarkerWhat, number> = { end: 0, due: 1, issued: 2 };
  const markers: ReportMarker[] = [];
  for (const p of periods) {
    markers.push({ kind: p.kind, what: 'end', date: p.endsOn });
    if (p.dueOn) markers.push({ kind: p.kind, what: 'due', date: p.dueOn });
    if (p.issuedOn) markers.push({ kind: p.kind, what: 'issued', date: p.issuedOn });
  }
  return markers.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      REPORT_PERIOD_KINDS.indexOf(a.kind) - REPORT_PERIOD_KINDS.indexOf(b.kind) ||
      order[a.what] - order[b.what],
  );
}
