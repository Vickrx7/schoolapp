import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from './calendar';
import {
  findOverlaps,
  isTeachable,
  isTeachersBlock,
  resolveSchoolDay,
  type TimetableBlock,
} from './school-day';

const CLASS = 'class-3e';

let n = 0;
const block = (
  dayKey: number,
  start: string,
  end: string,
  overrides: Partial<TimetableBlock> = {},
): TimetableBlock => ({
  id: `b${++n}`,
  classId: CLASS,
  dayKey,
  startTime: start,
  endTime: end,
  kind: 'subject',
  subjectId: 'fra',
  title: null,
  teacherId: null,
  roomId: null,
  ...overrides,
});

const event = (overrides: Partial<CalendarEvent>): CalendarEvent => ({
  id: overrides.id ?? 'e',
  eventType: 'mass',
  title: 'Messe',
  startsOn: '2026-09-28',
  endsOn: '2026-09-28',
  startTime: null,
  endTime: null,
  affectsSchedule: true,
  classId: null,
  ...overrides,
});

// Monday 2026-09-28 is day key 1 in a weekly school.
const monday = [
  block(1, '08:45', '08:55', { kind: 'routine', subjectId: null, title: 'Entrée et prière' }),
  block(1, '08:55', '09:45', { subjectId: 'fra' }),
  block(1, '09:45', '10:35', { subjectId: 'mat' }),
  block(1, '10:35', '11:15', { kind: 'nutrition_break', subjectId: null }),
  block(1, '11:15', '12:05', { subjectId: 'fra' }),
  block(1, '13:35', '14:25', { subjectId: 'sci' }),
  block(1, '14:25', '15:15', { subjectId: 'art' }),
];
const tuesday = [block(2, '08:55', '09:45', { subjectId: 'mat' })];
const blocks = [...monday, ...tuesday];

const resolve = (events: CalendarEvent[], date = '2026-09-28') =>
  resolveSchoolDay({ date, classId: CLASS, schedule: { type: 'weekly' }, events, blocks });

describe('resolveSchoolDay', () => {
  it("returns the day's blocks in time order on a normal day", () => {
    const day = resolve([]);
    expect(day.day).toEqual({ status: 'instructional', dayKey: 1 });
    expect(day.blocks.map((b) => b.startTime)).toEqual([
      '08:45',
      '08:55',
      '09:45',
      '10:35',
      '11:15',
      '13:35',
      '14:25',
    ]);
    expect(day.blocks.every((b) => b.status === 'normal')).toBe(true);
  });

  it('uses the right day key for other weekdays', () => {
    expect(resolve([], '2026-09-29').blocks).toHaveLength(1);
  });

  it('has no blocks on a PA day', () => {
    const day = resolve([event({ eventType: 'pa_day', title: 'Journée pédagogique' })]);
    expect(day.day).toMatchObject({ status: 'no_school', reason: 'event' });
    expect(day.blocks).toEqual([]);
  });

  it('cancels and shortens blocks on an early dismissal', () => {
    const day = resolve([event({ eventType: 'early_dismissal', startTime: '13:50' })]);
    const byStart = Object.fromEntries(day.blocks.map((b) => [b.startTime, b]));
    expect(byStart['13:35']).toMatchObject({
      status: 'shortened',
      effectiveStart: '13:35',
      effectiveEnd: '13:50',
    });
    expect(byStart['14:25']).toMatchObject({ status: 'cancelled' });
    expect(byStart['11:15']).toMatchObject({ status: 'normal' });
  });

  it('cancels and shortens blocks on a late start', () => {
    const day = resolve([event({ eventType: 'late_start', endTime: '09:15' })]);
    const byStart = Object.fromEntries(day.blocks.map((b) => [b.startTime, b]));
    expect(byStart['08:45']).toMatchObject({ status: 'cancelled' });
    expect(byStart['08:55']).toMatchObject({
      status: 'shortened',
      effectiveStart: '09:15',
      effectiveEnd: '09:45',
    });
    expect(byStart['09:45']).toMatchObject({ status: 'normal' });
  });

  it('marks blocks a mass fully covers as replaced and partial overlaps as interrupted', () => {
    const mass = event({ eventType: 'mass', startTime: '09:30', endTime: '10:40' });
    const day = resolve([mass]);
    const byStart = Object.fromEntries(day.blocks.map((b) => [b.startTime, b]));
    expect(byStart['08:55']).toMatchObject({ status: 'interrupted', affectedBy: mass });
    expect(byStart['09:45']).toMatchObject({ status: 'replaced', affectedBy: mass });
    expect(byStart['10:35']).toMatchObject({ status: 'interrupted' });
    expect(byStart['11:15']).toMatchObject({ status: 'normal', affectedBy: null });
  });

  it('treats blocks that only touch an event as unaffected', () => {
    const day = resolve([event({ eventType: 'assembly', startTime: '09:45', endTime: '10:35' })]);
    const byStart = Object.fromEntries(day.blocks.map((b) => [b.startTime, b]));
    expect(byStart['08:55']!.status).toBe('normal');
    expect(byStart['09:45']!.status).toBe('replaced');
    expect(byStart['10:35']!.status).toBe('normal');
  });

  it('lets the strongest effect win when events overlap', () => {
    const day = resolve([
      event({ id: 'a', eventType: 'assembly', startTime: '14:00', endTime: '15:15' }),
      event({ id: 'd', eventType: 'early_dismissal', startTime: '14:00' }),
    ]);
    const last = day.blocks.find((b) => b.startTime === '14:25')!;
    expect(last.status).toBe('cancelled');
  });

  it('applies class-level events only to that class', () => {
    const trip = event({ eventType: 'field_trip', classId: CLASS, title: 'Sortie' });
    expect(resolve([trip]).blocks.every((b) => b.status === 'replaced')).toBe(true);
    const otherTrip = event({ eventType: 'field_trip', classId: 'other-class' });
    expect(resolve([otherTrip]).blocks.every((b) => b.status === 'normal')).toBe(true);
  });

  it('lists informational events without changing the schedule', () => {
    const pyjama = event({ eventType: 'other', title: 'Journée pyjama', affectsSchedule: false });
    const day = resolve([pyjama]);
    expect(day.events).toEqual([pyjama]);
    expect(day.blocks.every((b) => b.status === 'normal')).toBe(true);
  });

  it('works for cycle schools', () => {
    const day = resolveSchoolDay({
      date: '2026-09-29',
      classId: CLASS,
      schedule: {
        type: 'cycle',
        cycleLength: 6,
        anchors: [{ anchorDate: '2026-09-28', cycleDay: 2 }],
      },
      events: [],
      blocks: [block(3, '08:55', '09:45', { subjectId: 'sci' })],
    });
    expect(day.day).toEqual({ status: 'instructional', dayKey: 3 });
    expect(day.blocks).toHaveLength(1);
  });
});

describe('block helpers', () => {
  it('knows which blocks can still hold a lesson', () => {
    const day = resolve([event({ eventType: 'early_dismissal', startTime: '14:25' })]);
    const teachable = day.blocks.filter(isTeachable).map((b) => b.subjectId);
    expect(teachable).toEqual(['fra', 'mat', 'fra', 'sci']);
  });

  it('assigns unassigned blocks to homeroom teachers and assigned blocks to their teacher', () => {
    const homeroom = new Set([CLASS]);
    expect(isTeachersBlock({ teacherId: null, classId: CLASS }, 't-home', homeroom)).toBe(true);
    expect(isTeachersBlock({ teacherId: 't-eps', classId: CLASS }, 't-home', homeroom)).toBe(false);
    expect(isTeachersBlock({ teacherId: 't-eps', classId: CLASS }, 't-eps', new Set())).toBe(true);
    expect(isTeachersBlock({ teacherId: null, classId: CLASS }, 't-eps', new Set())).toBe(false);
  });

  it('finds overlapping blocks on the same day only', () => {
    const a = block(1, '09:00', '10:00');
    const b = block(1, '09:30', '10:30');
    const c = block(1, '10:30', '11:00');
    const d = block(2, '09:30', '10:30');
    expect(findOverlaps([a, b, c, d])).toEqual([[a.id, b.id]]);
  });
});
