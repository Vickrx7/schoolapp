import { formatTimeFr, normalizeTime, timeToMinutes, type LocalDate } from '@lynx/domain';

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
