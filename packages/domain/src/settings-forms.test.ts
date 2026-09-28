import { describe, expect, it } from 'vitest';
import {
  calendarEventFormSchema,
  firstNameSchema,
  lessonFormSchema,
  timetableBlockSchema,
} from './forms';
import { parseBoardSettings, parseSchoolSettings } from './settings';

describe('board and school settings', () => {
  it('fills in defaults for an empty object', () => {
    expect(parseBoardSettings({})).toEqual({
      anglaisStartGrade: 4,
      subPlanAutoReleaseTime: '07:30',
      ai: { allowed: true, defaultMonthlyAllowanceUsd: 50, ceilingMultiplier: 2, pooling: true },
      classModeResultsRetentionDays: 365,
    });
    expect(parseSchoolSettings(null)).toEqual({ contact: {}, dayStart: '08:45', dayEnd: '15:20' });
  });

  it('keeps valid values and replaces invalid ones with defaults', () => {
    const s = parseBoardSettings({
      anglaisStartGrade: 1,
      subPlanAutoReleaseTime: 'tomorrow',
      unknownKey: true,
    });
    expect(s.anglaisStartGrade).toBe(1);
    expect(s.subPlanAutoReleaseTime).toBe('07:30');
    expect(s).not.toHaveProperty('unknownKey');
  });

  it('drops an invalid office email instead of failing', () => {
    expect(
      parseSchoolSettings({ contact: { officePhone: '555-0100', officeEmail: 'nope' } }).contact,
    ).toEqual({
      officePhone: '555-0100',
    });
  });
});

describe('form schemas', () => {
  const classId = '6f1c3b5e-4d2a-4e8b-9c1d-2a3b4c5d6e7f';
  const subjectId = '7a1c3b5e-4d2a-4e8b-9c1d-2a3b4c5d6e7f';

  it('validates first names', () => {
    expect(firstNameSchema.parse('  Zoé ')).toBe('Zoé');
    expect(firstNameSchema.safeParse('').success).toBe(false);
    expect(firstNameSchema.safeParse('zoe@ecole.ca').success).toBe(false);
  });

  it('requires a subject for subject blocks and a sensible time range', () => {
    const base = {
      classId,
      dayKeys: [1, 2],
      startTime: '08:55',
      endTime: '09:45',
      kind: 'subject',
      subjectId,
    };
    expect(timetableBlockSchema.parse(base)).toMatchObject({ startTime: '08:55', title: null });
    expect(timetableBlockSchema.safeParse({ ...base, subjectId: null }).success).toBe(false);
    expect(timetableBlockSchema.safeParse({ ...base, endTime: '08:00' }).success).toBe(false);
    expect(
      timetableBlockSchema.safeParse({ ...base, kind: 'recess', subjectId: null }).success,
    ).toBe(true);
    expect(timetableBlockSchema.safeParse({ ...base, dayKeys: [] }).success).toBe(false);
  });

  it('turns empty optional lesson fields into null', () => {
    expect(
      lessonFormSchema.parse({ title: 'Leçon', objectives: '  ', durationMinutes: '' }),
    ).toMatchObject({
      title: 'Leçon',
      objectives: null,
      durationMinutes: null,
      expectationIds: [],
    });
  });

  it('rejects calendar events that end before they start', () => {
    const base = {
      schoolId: classId,
      eventType: 'mass',
      title: 'Messe',
      startsOn: '2026-10-08',
      endsOn: '2026-10-08',
    };
    expect(calendarEventFormSchema.safeParse(base).success).toBe(true);
    expect(calendarEventFormSchema.safeParse({ ...base, endsOn: '2026-10-07' }).success).toBe(
      false,
    );
    expect(
      calendarEventFormSchema.safeParse({ ...base, startTime: '10:00', endTime: '09:00' }).success,
    ).toBe(false);
  });
});
