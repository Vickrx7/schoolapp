import { describe, expect, it } from 'vitest';
import { formatLocalDate, formatTime, formatTimeRange } from './format';

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
