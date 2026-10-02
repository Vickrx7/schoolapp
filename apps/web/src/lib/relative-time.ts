/**
 * « il y a 1 min », « il y a 6 h », « hier 23 h 53 »: how long ago something happened, for the
 * « État du système » card (DECISIONS D-112). Pure: the caller gives the time zone (the board's)
 * and the clock, and turns the result into words with its messages.
 */
import { addDays, localDateIn, type LocalDate } from '@lynx/domain';

export type Ago =
  | { kind: 'never' }
  | { kind: 'justNow' }
  | { kind: 'minutes'; count: number }
  | { kind: 'hours'; count: number }
  /** Yesterday (school-local), at this local time (HH:MM). */
  | { kind: 'yesterday'; time: string }
  | { kind: 'date'; date: LocalDate; time: string };

function localTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
}

export function describeAgo(at: string | Date | null, now: Date, timeZone: string): Ago {
  if (at === null) return { kind: 'never' };
  const instant = typeof at === 'string' ? new Date(at) : at;
  if (Number.isNaN(instant.getTime())) return { kind: 'never' };
  const minutes = Math.floor((now.getTime() - instant.getTime()) / 60_000);
  if (minutes < 1) return { kind: 'justNow' };
  if (minutes < 60) return { kind: 'minutes', count: minutes };
  const day = localDateIn(timeZone, instant);
  const today = localDateIn(timeZone, now);
  const hours = Math.floor(minutes / 60);
  if (day === today) return { kind: 'hours', count: hours };
  // Last night reads better as « hier 23 h 53 » than as « il y a 9 h ».
  if (day === addDays(today, -1)) {
    return hours < 6
      ? { kind: 'hours', count: hours }
      : { kind: 'yesterday', time: localTime(instant, timeZone) };
  }
  return { kind: 'date', date: day, time: localTime(instant, timeZone) };
}
