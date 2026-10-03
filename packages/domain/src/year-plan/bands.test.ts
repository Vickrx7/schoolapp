import { describe, expect, it } from 'vitest';
import { liturgicalBands } from './bands';
import { YEAR } from './test-calendar';

describe('the liturgical seasons over the year (D-126)', () => {
  it('has Advent, Christmas, Lent and Easter in 2026-2027, Ordinary Time left out', () => {
    expect(liturgicalBands(YEAR.startsOn, YEAR.endsOn)).toEqual([
      { season: 'avent', from: '2026-11-29', to: '2026-12-24' },
      { season: 'noel', from: '2026-12-25', to: '2027-01-10' },
      { season: 'careme', from: '2027-02-10', to: '2027-03-27' },
      { season: 'paques', from: '2027-03-28', to: '2027-05-16' },
    ]);
  });

  it('has nothing in September', () => {
    expect(liturgicalBands('2026-09-01', '2026-09-30')).toEqual([]);
  });

  it('cuts a season at the dates asked', () => {
    expect(liturgicalBands('2026-12-01', '2026-12-31')).toEqual([
      { season: 'avent', from: '2026-12-01', to: '2026-12-24' },
      { season: 'noel', from: '2026-12-25', to: '2026-12-31' },
    ]);
  });
});
