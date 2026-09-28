import { formatTimeFr, normalizeTime, type LocalDate } from '@lynx/domain';

/** Formats a school-local date for display, e.g. "lundi 28 septembre". */
export function formatLocalDate(
  date: LocalDate,
  locale: string,
  options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' },
): string {
  // Noon UTC with timeZone UTC: the displayed day can never shift.
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

/** "8 h 45" from '08:45:00' or '08:45'. */
export function formatTime(time: string): string {
  return formatTimeFr(normalizeTime(time));
}

export function formatTimeRange(start: string, end: string): string {
  return `${formatTime(start)} – ${formatTime(end)}`;
}
