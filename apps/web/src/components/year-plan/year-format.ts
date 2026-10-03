import type { LocalDate, PlacedUnit } from '@lynx/domain';
import { formatLocalDate } from '@/lib/format';
import type { YearPlanUnit } from '@/server/queries/year-plan';
import type { PlannedUnit } from './unit-plan-dialog';

/** « 11 janv. » / "Jan 11". */
export const shortDate = (date: LocalDate, locale: string) =>
  formatLocalDate(date, locale, { day: 'numeric', month: 'short' });

/** « 11 janvier » / "January 11". */
export const longDate = (date: LocalDate, locale: string) =>
  formatLocalDate(date, locale, { day: 'numeric', month: 'long' });

/** « 11 janv.–5 févr. » (one date when both are the same day). */
export const shortRange = (from: LocalDate, to: LocalDate, locale: string) =>
  from === to ? shortDate(from, locale) : `${shortDate(from, locale)}–${shortDate(to, locale)}`;

/** « Janvier 2027 » / "January 2027". */
export function monthLabel(month: LocalDate, locale: string): string {
  const text = formatLocalDate(month, locale, { month: 'long', year: 'numeric' });
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

/** The message key of a placed unit's status: « Pas encore commencée » once its start passed. */
export const statusKey = (p: PlacedUnit<YearPlanUnit>) =>
  p.lateStart ? ('yearPlan.status.lateStart' as const) : (`units.status.${p.unit.status}` as const);

/**
 * What the planning dialog starts from: the saved window, or, for a unit dated from its lessons,
 * the weeks shown (saved only if the teacher saves).
 */
export function plannedUnitOf(unit: YearPlanUnit, shown?: PlacedUnit<YearPlanUnit>): PlannedUnit {
  return {
    id: unit.id,
    subjectId: unit.subjectId,
    title: unit.title,
    description: unit.description,
    startsOn: unit.plannedStartOn ?? shown?.startsOn ?? null,
    endsOn: unit.plannedEndOn ?? shown?.endsOn ?? null,
    expectationIds: unit.expectationIds,
  };
}
