import { describe, expect, it } from 'vitest';
import {
  formatInstantTime,
  formatLocalDate,
  formatShortDate,
  formatTime,
  formatTimeRange,
  instantInZone,
} from './format';

describe('display formatting', () => {
  it('formats times the Canadian French and English ways', () => {
    expect(formatTime('08:45:00')).toBe('8 h 45');
    expect(formatTime('13:00', 'fr-CA')).toBe('13 h');
    expect(formatTime('08:45', 'en-CA')).toMatch(/^8:45\sa\.m\.$/);
    expect(formatTime('13:05', 'en-CA')).toMatch(/^1:05\sp\.m\.$/);
    expect(formatTimeRange('08:55', '09:45')).toBe('8 h 55 – 9 h 45');
  });

  it('formats dates without shifting the day', () => {
    expect(formatLocalDate('2026-10-05', 'fr-CA')).toBe('lundi 5 octobre');
    expect(formatLocalDate('2026-10-05', 'en-CA')).toBe('Monday, October 5');
  });
});

describe('instants on the school clock', () => {
  it('shows a deadline in the school’s time zone, whatever the server’s', () => {
    // 07:30 in Toronto (EDT, UTC-4) on 2026-10-14.
    expect(formatInstantTime('2026-10-14T11:30:00Z', 'America/Toronto')).toBe('7 h 30');
    expect(formatInstantTime('2026-10-14T11:30:00Z', 'America/Toronto', 'en-CA')).toMatch(
      /^7:30\sa\.m\.$/,
    );
    // The same instant is 06:30 in Winnipeg (CDT).
    expect(instantInZone('2026-10-14T11:30:00Z', 'America/Winnipeg')).toEqual({
      date: '2026-10-14',
      time: '06:30',
    });
  });

  it('keeps the local date across midnight UTC and DST', () => {
    // 21:00 on Nov 2 in Toronto (EST after the change) is 02:00 UTC on Nov 3.
    expect(instantInZone('2026-11-03T02:00:00Z', 'America/Toronto')).toEqual({
      date: '2026-11-02',
      time: '21:00',
    });
  });

  it('formats short dates for chips and tabs', () => {
    expect(formatShortDate('2026-10-15', 'fr-CA')).toBe('jeu. 15 oct.');
    expect(formatShortDate('2026-10-15', 'en-CA')).toBe('Thu, Oct 15');
  });
});
