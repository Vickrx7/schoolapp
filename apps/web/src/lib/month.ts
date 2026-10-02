/**
 * Calendar months as `YYYY-MM` (« Utilisation de l'IA », `?month=`). Pure, so it is unit tested.
 */
import { localDateIn } from '@lynx/domain';

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export const isMonth = (value: unknown): value is string =>
  typeof value === 'string' && MONTH.test(value);

/** `?month=YYYY-MM` when valid, else the current month in the given time zone. */
export function monthOrCurrent(requested: unknown, timeZone: string, now = new Date()): string {
  return isMonth(requested) ? requested : localDateIn(timeZone, now).slice(0, 7);
}

/** The month before (-1) or after (1). */
export function shiftMonth(month: string, by: -1 | 1): string {
  const [year, m] = month.split('-').map(Number) as [number, number];
  const index = year * 12 + (m - 1) + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}
