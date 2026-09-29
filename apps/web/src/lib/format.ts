import {
  formatTimeFr,
  localDateIn,
  localMinutesIn,
  minutesToTime,
  normalizeTime,
  timeToMinutes,
  type LocalDate,
  type LocalTime,
} from '@lynx/domain';

/** Formats a school-local date for display, e.g. "lundi 28 septembre" / "Monday, September 28". */
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

/** A short date for chips and tabs: « lun. 5 oct. » / "Mon, Oct 5". */
export function formatShortDate(date: LocalDate, locale: string): string {
  return formatLocalDate(date, locale, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** "8 h 45" in French, "8:45 a.m." in English, from '08:45:00' or '08:45'. */
export function formatTime(time: string, locale = 'fr-CA'): string {
  const hhmm = normalizeTime(time);
  if (!locale.startsWith('en')) return formatTimeFr(hhmm);
  const minutes = timeToMinutes(hhmm);
  return new Intl.DateTimeFormat('en-CA', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2000, 0, 1, Math.floor(minutes / 60), minutes % 60)));
}

export function formatTimeRange(start: string, end: string, locale = 'fr-CA'): string {
  return `${formatTime(start, locale)} – ${formatTime(end, locale)}`;
}

/**
 * The school-local date and time of an instant computed by the database (a release deadline,
 * a save time). For display only: instants are never computed in TypeScript (D-009).
 */
export function instantInZone(
  instant: string | Date,
  timeZone: string,
): { date: LocalDate; time: LocalTime } {
  const at = typeof instant === 'string' ? new Date(instant) : instant;
  return { date: localDateIn(timeZone, at), time: minutesToTime(localMinutesIn(timeZone, at)) };
}

/** "7 h 30" / "7:30 a.m." for an instant, on the school's clock. */
export function formatInstantTime(instant: string | Date, timeZone: string, locale = 'fr-CA') {
  return formatTime(instantInZone(instant, timeZone).time, locale);
}
