/**
 * « Info-parents » (DECISIONS D-136): the class's list of messages and the weeks it offers
 * to prepare. Pure, so it is unit tested.
 */
import { addDays, isLocalDate, isoWeekday, mondayOf, type LocalDate } from '@lynx/domain';

export interface NewsletterListRow {
  id: string;
  weekOf: LocalDate;
  status: 'draft' | 'sent';
  /** The school-local date it was marked sent, or last edited. */
  sentOn: LocalDate | null;
  updatedOn: LocalDate;
  /** « Mme Tremblay »: who edited it last (null when the account is gone). */
  updatedBy: string | null;
}

/** Whether a week (its Monday) touches a school year: its Friday on or after the first day. */
export function weekInYear(weekOf: LocalDate, year: { startsOn: LocalDate; endsOn: LocalDate }) {
  return addDays(weekOf, 4) >= year.startsOn && weekOf <= year.endsOn;
}

/** A week in an address: a real date, a Monday. */
export function isWeekOf(value: string): value is LocalDate {
  return isLocalDate(value) && isoWeekday(value) === 1;
}

/**
 * « Préparer la semaine du … »: this week and next week (this week's Monday from the school's
 * date; on a weekend, the week that ends), those of the class's year without a message yet.
 */
export function weeksToPrepare(
  today: LocalDate,
  year: { startsOn: LocalDate; endsOn: LocalDate },
  existing: readonly LocalDate[],
): LocalDate[] {
  const monday = mondayOf(today);
  const taken = new Set(existing);
  return [monday, addDays(monday, 7)].filter((w) => weekInYear(w, year) && !taken.has(w));
}

/** Newest week first. */
export function sortNewsletterRows<R extends Pick<NewsletterListRow, 'weekOf'>>(
  rows: readonly R[],
): R[] {
  return [...rows].sort((a, b) => b.weekOf.localeCompare(a.weekOf));
}
