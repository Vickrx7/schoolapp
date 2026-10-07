import { describe, expect, it } from 'vitest';
import { CLASS, SCHOOL, YEAR, event, seededDaysOff } from './test-calendar';
import { classEvents, mondayOf, schoolWeeks, unitSchoolDays, weekWindow, weeksOf } from './weeks';

const OTHER_SCHOOL = 'c0000000-0000-4000-8000-000000000099';
const OTHER_CLASS = 'e0000000-0000-4000-8000-000000000099';

const events = [
  ...seededDaysOff(),
  event('mass', { eventType: 'mass', title: 'Messe', startsOn: '2026-10-08', schoolId: SCHOOL }),
  event('other-school-pa', {
    eventType: 'pa_day',
    title: 'PA ailleurs',
    startsOn: '2026-10-06',
    schoolId: OTHER_SCHOOL,
  }),
  event('class-trip', {
    eventType: 'pa_day',
    title: 'Sortie de la classe',
    startsOn: '2026-10-07',
    schoolId: SCHOOL,
    classId: CLASS,
  }),
  event('other-class', {
    eventType: 'field_trip',
    title: 'Sortie d’une autre classe',
    startsOn: '2026-10-07',
    schoolId: SCHOOL,
    classId: OTHER_CLASS,
  }),
];
const weeks = schoolWeeks({ ...YEAR, events, schoolId: SCHOOL, classId: CLASS });
const week = (monday: string) => {
  const w = weeks.find((x) => x.monday === monday);
  if (!w) throw new Error(`no week of ${monday}`);
  return w;
};

describe('the weeks of 2026-2027 (D-126)', () => {
  it('runs from the week of the first day to the week of the last', () => {
    expect(weeks[0]!.monday).toBe('2026-08-31');
    expect(weeks[weeks.length - 1]!.monday).toBe('2027-06-21');
    expect(weeks).toHaveLength(43);
    expect(weeks.every((w) => w.days.length > 0 && w.days.length <= 5)).toBe(true);
  });

  it('starts on Wednesday 2 September: a first week of 3 days', () => {
    expect(week('2026-08-31')).toMatchObject({
      days: ['2026-09-02', '2026-09-03', '2026-09-04'],
      schoolDays: 3,
      daysOff: [],
    });
  });

  it('counts a PA day and Thanksgiving: two weeks of 4 days', () => {
    expect(week('2026-10-05')).toMatchObject({
      schoolDays: 4,
      daysOff: [{ date: '2026-10-09', title: 'Journée pédagogique', type: 'pa_day' }],
    });
    expect(week('2026-10-12')).toMatchObject({
      schoolDays: 4,
      daysOff: [{ date: '2026-10-12', title: 'Action de grâce', type: 'holiday' }],
    });
    expect(week('2026-11-16')).toMatchObject({
      schoolDays: 4,
      daysOff: [{ date: '2026-11-20', title: 'Journée pédagogique', type: 'pa_day' }],
    });
  });

  it('has two weeks without school for the « Congé des Fêtes », and March break', () => {
    for (const monday of ['2026-12-21', '2026-12-28']) {
      expect(week(monday).schoolDays).toBe(0);
      expect(new Set(week(monday).daysOff.map((d) => d.title))).toEqual(
        new Set(['Congé des Fêtes']),
      );
    }
    expect(week('2027-03-15')).toMatchObject({ schoolDays: 0 });
    expect(week('2027-03-15').daysOff.map((d) => d.title)).toEqual(Array(5).fill('Congé de mars'));
    // Good Friday and Easter Monday: two short weeks.
    expect(week('2027-03-22').schoolDays).toBe(4);
    expect(week('2027-03-29').schoolDays).toBe(4);
  });

  it('ignores another school’s events; a class’s own event is shown, never a day off', () => {
    const w = week('2026-10-05');
    expect(w.daysOff.map((d) => d.date)).toEqual(['2026-10-09']);
    expect(w.events.map((e) => e.id)).toEqual(['class-trip', 'mass']);
  });

  it('keeps the board’s, the school’s and the class’s own events only', () => {
    expect(classEvents(events, SCHOOL, CLASS).map((e) => e.id)).not.toContain('other-school-pa');
    expect(classEvents(events, SCHOOL, CLASS).map((e) => e.id)).not.toContain('other-class');
    expect(classEvents(events, SCHOOL, CLASS).map((e) => e.id)).toContain('class-trip');
  });

  it('ends on Friday 25 June 2027', () => {
    expect(week('2027-06-21').days).toEqual([
      '2027-06-21',
      '2027-06-22',
      '2027-06-23',
      '2027-06-24',
      '2027-06-25',
    ]);
    expect(mondayOf('2027-06-25')).toBe('2027-06-21');
  });
});

describe('a planned window from weeks (D-123)', () => {
  it('runs from the Monday of the first week to the Friday of the last', () => {
    expect(weekWindow('2027-01-11', '2027-02-01', YEAR)).toEqual({
      startsOn: '2027-01-11',
      endsOn: '2027-02-05',
    });
  });

  it('is clamped to the school year', () => {
    expect(weekWindow('2026-08-31', '2026-09-14', YEAR)).toEqual({
      startsOn: '2026-09-02',
      endsOn: '2026-09-18',
    });
    expect(
      weekWindow('2027-06-14', '2027-06-21', { startsOn: YEAR.startsOn, endsOn: '2027-06-23' }),
    ).toEqual({ startsOn: '2027-06-14', endsOn: '2027-06-23' });
  });

  it('takes any day of a week, and refuses weeks in the wrong order or outside the year', () => {
    expect(weekWindow('2027-01-13', '2027-01-13', YEAR)).toEqual({
      startsOn: '2027-01-11',
      endsOn: '2027-01-15',
    });
    expect(weekWindow('2027-02-01', '2027-01-11', YEAR)).toBeNull();
    expect(weekWindow('2027-08-02', '2027-08-09', YEAR)).toBeNull();
  });

  it('counts its weeks and school days', () => {
    const first = weekWindow('2026-08-31', '2026-09-14', YEAR)!;
    expect(weeksOf(first, weeks)).toHaveLength(3);
    expect(unitSchoolDays(first, weeks)).toBe(13);
    const fetes = weekWindow('2026-12-14', '2027-01-04', YEAR)!;
    expect(weeksOf(fetes, weeks)).toHaveLength(4);
    expect(unitSchoolDays(fetes, weeks)).toBe(10);
  });
});
