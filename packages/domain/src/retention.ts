/**
 * When the nightly retention job (DECISIONS D-105; `app.retention_maintenance()`, worker task
 * `retention_maintenance`) removes what teachers can see coming: a class's students after its
 * school year, and a sample class (D-109). Pure, so the screens' notices and the job agree, and
 * tested.
 *
 * Dates are the school's local dates. The job runs once a night and compares with the school's
 * local date:
 *
 * - a class's students go once `school year end + classDaysAfterYearEnd` is before today, so on
 *   the day after (`studentPurgeDate`). Units, lessons, timetable and progress stay;
 * - a sample class goes once it is `SAMPLE_CLASS_DAYS` old (`samplePurgeDate`).
 *
 * Teachers are told `PURGE_NOTICE_DAYS` before, on the class page and on « Aujourd'hui ».
 */
import { addDays, daysBetween, type LocalDate } from './dates';
import type { BoardSettings } from './settings';

/** A sample class is deleted this many days after it was created (D-109). */
export const SAMPLE_CLASS_DAYS = 60;

/** How long before a purge its notice shows (D-105). */
export const PURGE_NOTICE_DAYS = 60;

/**
 * The first day a class's students are gone: the day after its school year's end plus the
 * board's `classDaysAfterYearEnd` (the job purges when that date is before the school's today).
 */
export function studentPurgeDate(
  yearEndsOn: LocalDate,
  settings: Pick<BoardSettings, 'retention'>,
): LocalDate {
  return addDays(yearEndsOn, settings.retention.classDaysAfterYearEnd + 1);
}

/** The day a sample class created on `createdOn` is deleted. */
export function samplePurgeDate(createdOn: LocalDate): LocalDate {
  return addDays(createdOn, SAMPLE_CLASS_DAYS);
}

/** Whether a purge on `purgeOn` is announced on `today`: within the notice window, not after. */
export function showsPurgeNotice(today: LocalDate, purgeOn: LocalDate): boolean {
  const daysLeft = daysBetween(today, purgeOn);
  return daysLeft >= 0 && daysLeft <= PURGE_NOTICE_DAYS;
}
