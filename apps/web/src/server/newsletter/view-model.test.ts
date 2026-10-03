import { describe, expect, it } from 'vitest';
import { isWeekOf, sortNewsletterRows, weekInYear, weeksToPrepare } from './view-model';

const YEAR = { startsOn: '2026-09-01', endsOn: '2027-06-30' };

describe('« Préparer la semaine du … » (D-136)', () => {
  it('offers this week and the next, those without a message', () => {
    expect(weeksToPrepare('2026-10-08', YEAR, [])).toEqual(['2026-10-05', '2026-10-12']);
    expect(weeksToPrepare('2026-10-08', YEAR, ['2026-10-05'])).toEqual(['2026-10-12']);
    // On a weekend, the week that ends.
    expect(weeksToPrepare('2026-10-04', YEAR, [])).toEqual(['2026-09-28', '2026-10-05']);
  });

  it('only weeks of the class’s school year', () => {
    // The year starts on a Tuesday: its first week counts.
    expect(weeksToPrepare('2026-08-28', YEAR, [])).toEqual(['2026-08-31']);
    expect(weeksToPrepare('2027-06-30', YEAR, [])).toEqual(['2027-06-28']);
    expect(weekInYear('2026-08-24', YEAR)).toBe(false);
    expect(weekInYear('2027-07-05', YEAR)).toBe(false);
  });

  it('takes a Monday as a week, nothing else', () => {
    expect(isWeekOf('2026-10-05')).toBe(true);
    expect(isWeekOf('2026-10-06')).toBe(false);
    expect(isWeekOf('2026-02-30')).toBe(false);
    expect(isWeekOf('lundi')).toBe(false);
  });

  it('lists the newest week first', () => {
    expect(
      sortNewsletterRows([
        { weekOf: '2026-09-28' },
        { weekOf: '2026-10-12' },
        { weekOf: '2026-10-05' },
      ]),
    ).toEqual([{ weekOf: '2026-10-12' }, { weekOf: '2026-10-05' }, { weekOf: '2026-09-28' }]);
  });
});
