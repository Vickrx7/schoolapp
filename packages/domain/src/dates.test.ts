import { describe, expect, it } from 'vitest';
import {
  addDays,
  datesInRange,
  daysBetween,
  formatTimeFr,
  isLocalDate,
  isLocalTime,
  isoWeekday,
  localDateIn,
  localMinutesIn,
  minutesToTime,
  normalizeTime,
  timeToMinutes,
} from './dates';

describe('local dates', () => {
  it('validates real calendar dates only', () => {
    expect(isLocalDate('2026-09-28')).toBe(true);
    expect(isLocalDate('2026-02-30')).toBe(false);
    expect(isLocalDate('2026-9-28')).toBe(false);
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('adds days across a daylight-saving change without drifting', () => {
    // DST ends in Ontario on 2026-11-01.
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
  });

  it('computes ISO weekdays', () => {
    expect(isoWeekday('2026-09-28')).toBe(1); // Monday
    expect(isoWeekday('2026-10-02')).toBe(5); // Friday
    expect(isoWeekday('2026-10-04')).toBe(7); // Sunday
  });

  it('counts days and lists ranges inclusively', () => {
    expect(daysBetween('2026-09-28', '2026-10-05')).toBe(7);
    expect(datesInRange('2026-09-30', '2026-10-02')).toEqual([
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
    ]);
  });
});

describe('time zones', () => {
  it('gives the school-local date, not the UTC date', () => {
    // 2026-09-29 02:30 UTC is still the evening of Sept 28 in Toronto.
    const instant = new Date('2026-09-29T02:30:00Z');
    expect(localDateIn('America/Toronto', instant)).toBe('2026-09-28');
    expect(localDateIn('UTC', instant)).toBe('2026-09-29');
  });

  it('handles schools on Central time (northwestern Ontario)', () => {
    // 05:30 UTC = 01:30 in Toronto (next day) but 00:30 in Winnipeg time zone.
    const instant = new Date('2026-09-29T05:30:00Z');
    expect(localDateIn('America/Toronto', instant)).toBe('2026-09-29');
    expect(localDateIn('America/Winnipeg', instant)).toBe('2026-09-29');
    const lateEvening = new Date('2026-09-29T04:30:00Z');
    expect(localDateIn('America/Toronto', lateEvening)).toBe('2026-09-29');
    expect(localDateIn('America/Winnipeg', lateEvening)).toBe('2026-09-28');
  });

  it('gives local minutes of the day on both sides of the DST change', () => {
    expect(localMinutesIn('America/Toronto', new Date('2026-10-30T12:45:00Z'))).toBe(8 * 60 + 45); // EDT
    expect(localMinutesIn('America/Toronto', new Date('2026-11-02T13:45:00Z'))).toBe(8 * 60 + 45); // EST
  });
});

describe('local times', () => {
  it('converts between times and minutes', () => {
    expect(timeToMinutes('08:45')).toBe(525);
    expect(timeToMinutes('08:45:00')).toBe(525);
    expect(minutesToTime(525)).toBe('08:45');
    expect(normalizeTime('13:35:00')).toBe('13:35');
    expect(isLocalTime('24:00')).toBe(false);
  });

  it('formats times the Canadian French way', () => {
    expect(formatTimeFr('08:45')).toBe('8 h 45');
    expect(formatTimeFr('13:00')).toBe('13 h');
    expect(formatTimeFr('09:05')).toBe('9 h 05');
  });
});
