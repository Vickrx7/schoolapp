import { describe, expect, it } from 'vitest';
import { describeAgo } from './relative-time';

const TZ = 'America/Toronto';
// 2026-11-12 at 10:00 in Toronto (UTC-5).
const now = new Date('2026-11-12T15:00:00Z');

describe('describeAgo (« État du système », D-112)', () => {
  it('says never, or just now', () => {
    expect(describeAgo(null, now, TZ)).toEqual({ kind: 'never' });
    expect(describeAgo('not a date', now, TZ)).toEqual({ kind: 'never' });
    expect(describeAgo('2026-11-12T14:59:30Z', now, TZ)).toEqual({ kind: 'justNow' });
    // A clock a little ahead of the server's.
    expect(describeAgo('2026-11-12T15:00:20Z', now, TZ)).toEqual({ kind: 'justNow' });
  });

  it('counts minutes, then hours the same day', () => {
    expect(describeAgo('2026-11-12T14:59:00Z', now, TZ)).toEqual({ kind: 'minutes', count: 1 });
    expect(describeAgo('2026-11-12T14:01:00Z', now, TZ)).toEqual({ kind: 'minutes', count: 59 });
    expect(describeAgo('2026-11-12T09:00:00Z', now, TZ)).toEqual({ kind: 'hours', count: 6 });
    // 00:30 in Toronto is still today there.
    expect(describeAgo('2026-11-12T05:30:00Z', now, TZ)).toEqual({ kind: 'hours', count: 9 });
  });

  it('says « hier » with the time for last evening, in the board’s time zone', () => {
    // 23:53 in Toronto the day before (04:53 UTC on the 12th).
    expect(describeAgo('2026-11-12T04:53:00Z', now, TZ)).toEqual({
      kind: 'yesterday',
      time: '23:53',
    });
    const earlyMorning = new Date('2026-11-12T07:00:00Z'); // 02:00 in Toronto
    expect(describeAgo('2026-11-12T04:30:00Z', earlyMorning, TZ)).toEqual({
      kind: 'hours',
      count: 2,
    });
  });

  it('gives the date and time for anything older', () => {
    expect(describeAgo('2026-11-09T08:15:00Z', now, TZ)).toEqual({
      kind: 'date',
      date: '2026-11-09',
      time: '03:15',
    });
  });
});
