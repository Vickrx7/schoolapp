import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../calendar';
import { absenceFormSchema, defaultAbsenceDate } from './absence-form';

// 2026-10-21 is a Wednesday; Toronto is UTC-4 in October.
const at = (iso: string, events: CalendarEvent[] = []) =>
  defaultAbsenceDate({ now: new Date(iso), timezone: 'America/Toronto', dayEnd: '15:20', events });

const paDay: CalendarEvent = {
  id: 'pa',
  eventType: 'pa_day',
  title: 'Journée pédagogique',
  startsOn: '2026-10-23',
  endsOn: '2026-10-23',
  startTime: null,
  endTime: null,
  affectsSchedule: true,
  classId: null,
};

describe('defaultAbsenceDate', () => {
  it('is today on a school day before dismissal', () => {
    expect(at('2026-10-21T10:00:00Z')).toBe('2026-10-21'); // 6:00 in Toronto
    expect(at('2026-10-21T19:19:00Z')).toBe('2026-10-21'); // 15:19
  });

  it('is the next school day after dismissal', () => {
    expect(at('2026-10-21T19:20:00Z')).toBe('2026-10-22'); // 15:20
    expect(at('2026-10-22T03:30:00Z')).toBe('2026-10-22'); // 23:30 on Wednesday
  });

  it('is Monday on a weekend', () => {
    expect(at('2026-10-24T14:00:00Z')).toBe('2026-10-26'); // Saturday
    expect(at('2026-10-23T21:00:00Z')).toBe('2026-10-26'); // Friday after school
  });

  it('skips a PA day', () => {
    expect(at('2026-10-22T20:00:00Z', [paDay])).toBe('2026-10-26'); // Thursday after school
    expect(at('2026-10-23T11:00:00Z', [paDay])).toBe('2026-10-26'); // on the PA day itself
  });
});

describe('absenceFormSchema', () => {
  const base = {
    schoolId: 'c0000000-0000-4000-8000-000000000001',
    startsOn: '2026-10-21',
    endsOn: '2026-10-21',
    clientRequestId: '0b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  };
  const errors = (value: object) =>
    absenceFormSchema.safeParse({ ...base, ...value }).error?.issues.map((i) => i.message) ?? [];

  it('fills in defaults and turns a blank note into null', () => {
    expect(absenceFormSchema.parse({ ...base, note: '   ' })).toEqual({
      ...base,
      part: 'full_day',
      note: null,
      catholicConnection: true,
    });
  });

  it('refuses a half day spanning two dates', () => {
    expect(errors({ part: 'am' })).toEqual([]);
    expect(errors({ part: 'pm', endsOn: '2026-10-22' })).toEqual(['halfDaySingleDay']);
  });

  it('refuses more than 14 days and an end before the start', () => {
    expect(errors({ endsOn: '2026-11-03' })).toEqual([]); // 14 days
    expect(errors({ endsOn: '2026-11-04' })).toEqual(['absenceTooLong']);
    expect(errors({ endsOn: '2026-10-20' })).toEqual(['endBeforeStart']);
    expect(errors({ note: 'x'.repeat(1001) })).toEqual(['tooLong']);
    expect(errors({ clientRequestId: undefined }).length).toBe(1);
  });
});
