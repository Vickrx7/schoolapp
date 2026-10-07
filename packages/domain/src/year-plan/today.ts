/**
 * « Aujourd'hui » and the year plan (DECISIONS D-123, D-126): the planned unit due to start for
 * a class and subject. Units never start by themselves (Assumption): the page offers
 * « Commencer l'unité ».
 */
import { addDays, type LocalDate } from '../dates';
import type { YearPlanUnitStatus } from './placement';
import { mondayOf } from './weeks';

export interface TodayPlanUnit {
  id: string;
  classId: string;
  subjectId: string;
  title: string;
  status: YearPlanUnitStatus;
  plannedStartOn: LocalDate | null;
  plannedEndOn: LocalDate | null;
}

/**
 * The class and subject's planned unit whose window starts by the Friday of the date's week and
 * has not ended; the earliest one (then by title).
 */
export function plannedUnitFor<U extends TodayPlanUnit>(input: {
  units: readonly U[];
  classId: string;
  subjectId: string;
  date: LocalDate;
}): U | null {
  const friday = addDays(mondayOf(input.date), 4);
  const due = input.units.filter(
    (u) =>
      u.classId === input.classId &&
      u.subjectId === input.subjectId &&
      u.status === 'planned' &&
      u.plannedStartOn !== null &&
      u.plannedEndOn !== null &&
      u.plannedStartOn <= friday &&
      u.plannedEndOn >= input.date,
  );
  due.sort(
    (a, b) =>
      a.plannedStartOn!.localeCompare(b.plannedStartOn!) || a.title.localeCompare(b.title, 'fr-CA'),
  );
  return due[0] ?? null;
}
