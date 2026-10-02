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

/**
 * A date formatted by `format`, with French's « 1er » for the first of a month written out
 * (« 1er décembre 2026 », « mardi 1er déc. »), which Intl never writes. Every date the app
 * shows in words goes through here.
 */
export function formatDateWith(format: Intl.DateTimeFormat, at: Date, locale: string): string {
  const parts = format.formatToParts(at);
  const monthInWords = parts.some((p) => p.type === 'month' && !/^\d+$/.test(p.value));
  if (!locale.startsWith('fr') || !monthInWords) return format.format(at);
  return parts.map((p) => (p.type === 'day' && p.value === '1' ? '1er' : p.value)).join('');
}

/** Formats a school-local date for display, e.g. "lundi 28 septembre" / "Monday, September 28". */
export function formatLocalDate(
  date: LocalDate,
  locale: string,
  options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' },
): string {
  // Noon UTC with timeZone UTC: the displayed day can never shift.
  return formatDateWith(
    new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }),
    new Date(`${date}T12:00:00Z`),
    locale,
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
