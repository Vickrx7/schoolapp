/**
 * Calendar-date and wall-clock helpers.
 *
 * School logic works in local dates ('YYYY-MM-DD') and local times ('HH:MM') of the school's
 * time zone, never in UTC instants, so daylight-saving changes cannot shift a school day.
 */

export type LocalDate = string; // YYYY-MM-DD
export type LocalTime = string; // HH:MM (24 h)

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;

export function isLocalDate(value: string): value is LocalDate {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === value;
}

export function isLocalTime(value: string): value is LocalTime {
  return TIME_RE.test(value);
}

function toUtcDate(date: LocalDate): Date {
  if (!isLocalDate(date)) throw new RangeError(`invalid local date: ${date}`);
  return new Date(`${date}T00:00:00Z`);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const d = toUtcDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(date: LocalDate): number {
  const day = toUtcDate(date).getUTCDay();
  return day === 0 ? 7 : day;
}

export function isWeekend(date: LocalDate): boolean {
  return isoWeekday(date) >= 6;
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  return Math.round((toUtcDate(b).getTime() - toUtcDate(a).getTime()) / 86_400_000);
}

/** Inclusive list of dates from `start` to `end`. */
export function datesInRange(start: LocalDate, end: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The local calendar date of an instant in a time zone, e.g. todayIn('America/Toronto'). */
export function localDateIn(timeZone: string, instant: Date = new Date()): LocalDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Minutes since local midnight of an instant in a time zone. */
export function localMinutesIn(timeZone: string, instant: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

export function timeToMinutes(time: LocalTime): number {
  const m = TIME_RE.exec(time);
  if (!m) throw new RangeError(`invalid local time: ${time}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function minutesToTime(minutes: number): LocalTime {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 24 * 60) {
    throw new RangeError(`invalid minutes: ${minutes}`);
  }
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Normalizes 'HH:MM:SS' (as returned by Postgres) to 'HH:MM'. */
export function normalizeTime(time: string): LocalTime {
  return minutesToTime(timeToMinutes(time));
}

/** Canadian French clock format: "8 h 45", "13 h". */
export function formatTimeFr(time: LocalTime): string {
  const minutes = timeToMinutes(time);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}
