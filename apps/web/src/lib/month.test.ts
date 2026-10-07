import { describe, expect, it } from 'vitest';
import { isMonth, monthOrCurrent, shiftMonth } from './month';

describe('months (« Utilisation de l’IA »)', () => {
  it('accepts YYYY-MM only', () => {
    expect(isMonth('2026-11')).toBe(true);
    for (const value of ['2026-13', '2026-1', '26-11', '2026-11-01', null, 202611]) {
      expect(isMonth(value), String(value)).toBe(false);
    }
  });

  it('falls back to the current month where the board is', () => {
    // 1 December at 03:00 UTC is still 30 November in Toronto.
    const now = new Date('2026-12-01T03:00:00Z');
    expect(monthOrCurrent(undefined, 'America/Toronto', now)).toBe('2026-11');
    expect(monthOrCurrent('nope', 'America/Toronto', now)).toBe('2026-11');
    expect(monthOrCurrent('2026-09', 'America/Toronto', now)).toBe('2026-09');
  });

  it('steps across years', () => {
    expect(shiftMonth('2026-11', 1)).toBe('2026-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2027-01', -1)).toBe('2026-12');
    expect(shiftMonth('2026-10', -1)).toBe('2026-09');
  });
});
