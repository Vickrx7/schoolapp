import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from './calendar';
import {
  dayKeyFor,
  isInstructionalDay,
  nextInstructionalDays,
  type ScheduleConfig,
} from './schedule';

const event = (overrides: Partial<CalendarEvent>): CalendarEvent => ({
  id: overrides.id ?? 'e',
  eventType: 'pa_day',
  title: 'Journée pédagogique',
  startsOn: '2026-10-09',
  endsOn: '2026-10-09',
  startTime: null,
  endTime: null,
  affectsSchedule: true,
  classId: null,
  ...overrides,
});

const paDay = event({ id: 'pa', startsOn: '2026-10-09', endsOn: '2026-10-09' }); // Friday
const thanksgiving = event({
  id: 'tg',
  eventType: 'holiday',
  startsOn: '2026-10-12',
  endsOn: '2026-10-12',
}); // Monday
const events = [paDay, thanksgiving];

describe('weekly schools', () => {
  const weekly: ScheduleConfig = { type: 'weekly' };

  it('maps weekdays to day keys 1..5', () => {
    expect(dayKeyFor('2026-09-28', weekly, [])).toEqual({ status: 'instructional', dayKey: 1 });
    expect(dayKeyFor('2026-10-02', weekly, [])).toEqual({ status: 'instructional', dayKey: 5 });
  });

  it('has no school on weekends', () => {
    expect(dayKeyFor('2026-10-03', weekly, [])).toMatchObject({
      status: 'no_school',
      reason: 'weekend',
    });
  });

  it('has no school on PA days and holidays', () => {
    expect(dayKeyFor('2026-10-09', weekly, events)).toMatchObject({
      status: 'no_school',
      reason: 'event',
      event: paDay,
    });
    expect(dayKeyFor('2026-10-12', weekly, events)).toMatchObject({
      status: 'no_school',
      event: thanksgiving,
    });
  });

  it('ignores class-only events and informational events when deciding if school is open', () => {
    const classTrip = event({
      id: 'trip',
      eventType: 'holiday',
      classId: 'class-1',
      startsOn: '2026-09-29',
      endsOn: '2026-09-29',
    });
    const info = event({
      id: 'info',
      affectsSchedule: false,
      startsOn: '2026-09-30',
      endsOn: '2026-09-30',
    });
    expect(isInstructionalDay('2026-09-29', [classTrip])).toBe(true);
    expect(isInstructionalDay('2026-09-30', [info])).toBe(true);
  });

  it('covers every day of a multi-day break', () => {
    const winter = event({
      id: 'w',
      eventType: 'holiday',
      startsOn: '2026-12-21',
      endsOn: '2027-01-01',
    });
    expect(isInstructionalDay('2026-12-24', [winter])).toBe(false);
    expect(isInstructionalDay('2027-01-01', [winter])).toBe(false);
    expect(isInstructionalDay('2027-01-04', [winter])).toBe(true);
  });
});

describe('cycle schools', () => {
  const cycle: ScheduleConfig = {
    type: 'cycle',
    cycleLength: 5,
    anchors: [{ anchorDate: '2026-09-02', cycleDay: 1 }], // Wednesday, first day of school
  };

  it('counts instructional days from the anchor', () => {
    expect(dayKeyFor('2026-09-02', cycle, [])).toEqual({ status: 'instructional', dayKey: 1 });
    expect(dayKeyFor('2026-09-03', cycle, [])).toEqual({ status: 'instructional', dayKey: 2 });
    expect(dayKeyFor('2026-09-04', cycle, [])).toEqual({ status: 'instructional', dayKey: 3 });
    // Weekend does not advance the rotation.
    expect(dayKeyFor('2026-09-07', cycle, [])).toEqual({ status: 'instructional', dayKey: 4 });
    expect(dayKeyFor('2026-09-08', cycle, [])).toEqual({ status: 'instructional', dayKey: 5 });
    expect(dayKeyFor('2026-09-09', cycle, [])).toEqual({ status: 'instructional', dayKey: 1 });
  });

  it('skips PA days and holidays in the rotation', () => {
    const anchored: ScheduleConfig = {
      type: 'cycle',
      cycleLength: 5,
      anchors: [{ anchorDate: '2026-10-08', cycleDay: 2 }],
    };
    // Thu 10-08 = Jour 2; Fri 10-09 PA day; Mon 10-12 holiday; Tue 10-13 = Jour 3.
    expect(dayKeyFor('2026-10-09', anchored, events)).toMatchObject({ status: 'no_school' });
    expect(dayKeyFor('2026-10-13', anchored, events)).toEqual({
      status: 'instructional',
      dayKey: 3,
    });
    expect(dayKeyFor('2026-10-14', anchored, events)).toEqual({
      status: 'instructional',
      dayKey: 4,
    });
  });

  it('uses the most recent anchor, so an anchor resets the rotation', () => {
    const reset: ScheduleConfig = {
      type: 'cycle',
      cycleLength: 6,
      anchors: [
        { anchorDate: '2026-09-02', cycleDay: 1 },
        { anchorDate: '2026-09-28', cycleDay: 1 },
      ],
    };
    expect(dayKeyFor('2026-09-25', reset, [])).toEqual({ status: 'instructional', dayKey: 6 });
    expect(dayKeyFor('2026-09-28', reset, [])).toEqual({ status: 'instructional', dayKey: 1 });
    expect(dayKeyFor('2026-09-29', reset, [])).toEqual({ status: 'instructional', dayKey: 2 });
  });

  it('gives an anchor on a non-school day to the next school day', () => {
    const weekendAnchor: ScheduleConfig = {
      type: 'cycle',
      cycleLength: 5,
      anchors: [{ anchorDate: '2026-09-26', cycleDay: 3 }],
    };
    expect(dayKeyFor('2026-09-28', weekendAnchor, [])).toEqual({
      status: 'instructional',
      dayKey: 3,
    });
  });

  it('reports an unknown rotation before the first anchor', () => {
    expect(dayKeyFor('2026-09-01', cycle, [])).toEqual({ status: 'unknown_cycle_day' });
  });
});

describe('nextInstructionalDays', () => {
  it('skips weekends, PA days and holidays', () => {
    expect(nextInstructionalDays('2026-10-08', 3, events)).toEqual([
      '2026-10-08',
      '2026-10-13',
      '2026-10-14',
    ]);
  });
});
