import { describe, expect, it } from 'vitest';
import { plannedUnitFor, type TodayPlanUnit } from './today';

const CLASS = 'class-3';
const MAT = 'mat';

const unit = (id: string, overrides: Partial<TodayPlanUnit> = {}): TodayPlanUnit => ({
  id,
  classId: CLASS,
  subjectId: MAT,
  title: id,
  status: 'planned',
  plannedStartOn: '2027-01-11',
  plannedEndOn: '2027-02-05',
  ...overrides,
});

const pick = (units: TodayPlanUnit[], date: string) =>
  plannedUnitFor({ units, classId: CLASS, subjectId: MAT, date })?.id ?? null;

describe('the planned unit due on « Aujourd’hui » (D-123)', () => {
  it('is due from the week its window starts, until it ends', () => {
    const units = [unit('fractions')];
    expect(pick(units, '2027-01-06')).toBeNull(); // the week before
    expect(pick(units, '2027-01-11')).toBe('fractions');
    // Starting on a Thursday: shown from that week's Monday.
    expect(pick([unit('t', { plannedStartOn: '2027-01-14' })], '2027-01-11')).toBe('t');
    expect(pick(units, '2027-02-05')).toBe('fractions');
    expect(pick(units, '2027-02-08')).toBeNull();
  });

  it('takes the earliest of the class and subject’s planned units', () => {
    const units = [
      unit('later', { plannedStartOn: '2027-01-13' }),
      unit('first'),
      unit('active', { status: 'active' }),
      unit('other-subject', { subjectId: 'fra', plannedStartOn: '2027-01-04' }),
      unit('other-class', { classId: 'class-5', plannedStartOn: '2027-01-04' }),
      unit('no-dates', { plannedStartOn: null, plannedEndOn: null }),
    ];
    expect(pick(units, '2027-01-12')).toBe('first');
  });
});
