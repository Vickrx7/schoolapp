import { describe, expect, it } from 'vitest';
import {
  calendarEventFormSchema,
  classSubProfileSchema,
  firstNameSchema,
  lessonFormSchema,
  substituteSettingsFormSchema,
  timetableBlockSchema,
} from './forms';
import {
  parseBoardSettings,
  parseSchoolSettings,
  RETENTION_DEFAULTS,
  RETENTION_LIMITS,
} from './settings';

describe('board and school settings', () => {
  it('fills in defaults for an empty object', () => {
    expect(parseBoardSettings({})).toEqual({
      anglaisStartGrade: 4,
      subPlanAutoReleaseTime: '07:30',
      ai: { allowed: true, defaultMonthlyAllowanceUsd: 50, ceilingMultiplier: 2, pooling: true },
      classModeResultsRetentionDays: 365,
      retention: {
        auditDays: 730,
        subPlanDays: 365,
        classDaysAfterYearEnd: 365,
        aiUsageDays: 730,
        feedbackDays: 365,
      },
    });
    expect(parseSchoolSettings(null)).toEqual({
      contact: {},
      dayStart: '08:45',
      dayEnd: '15:20',
      substitute: {
        accessFrom: '05:00',
        accessUntil: '18:00',
        halfDaySplit: null,
        arrivalInstructions: null,
        emergencyInfo: null,
      },
    });
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

  it('falls back field by field in the substitute settings', () => {
    expect(
      parseSchoolSettings({
        substitute: {
          accessFrom: '5h',
          accessUntil: '17:30',
          halfDaySplit: '25:00',
          arrivalInstructions: '  Présentez-vous au secrétariat.  ',
          emergencyInfo: 'x'.repeat(501),
        },
      }).substitute,
    ).toEqual({
      accessFrom: '05:00',
      accessUntil: '17:30',
      halfDaySplit: null,
      arrivalInstructions: 'Présentez-vous au secrétariat.',
      emergencyInfo: null,
    });
    expect(parseSchoolSettings({ substitute: 'oui' }).substitute.accessFrom).toBe('05:00');
    expect(
      parseSchoolSettings({ substitute: { halfDaySplit: '12:55', arrivalInstructions: ' ' } })
        .substitute,
    ).toMatchObject({ halfDaySplit: '12:55', arrivalInstructions: null, accessUntil: '18:00' });
  });

  it('drops an invalid office email instead of failing', () => {
    expect(
      parseSchoolSettings({ contact: { officePhone: '555-0100', officeEmail: 'nope' } }).contact,
    ).toEqual({
      officePhone: '555-0100',
    });
  });
});

describe('retention settings (D-105)', () => {
  const retention = (value: unknown) => parseBoardSettings({ retention: value }).retention;

  it('keeps every value within its bounds', () => {
    expect(
      retention({
        auditDays: 1095,
        subPlanDays: 400,
        classDaysAfterYearEnd: 1095,
        aiUsageDays: 3650,
        feedbackDays: 365,
      }),
    ).toEqual({
      auditDays: 1095,
      subPlanDays: 400,
      classDaysAfterYearEnd: 1095,
      aiUsageDays: 3650,
      feedbackDays: 365,
    });
  });

  it('never goes below a year: a shorter or longer value falls back to the default', () => {
    expect(retention({ auditDays: 30, subPlanDays: 364, feedbackDays: 0 })).toMatchObject({
      auditDays: 730,
      subPlanDays: 365,
      feedbackDays: 365,
    });
    expect(retention({ auditDays: 3651, classDaysAfterYearEnd: 1096 })).toMatchObject({
      auditDays: 730,
      classDaysAfterYearEnd: 365,
    });
    for (const [key, limits] of Object.entries(RETENTION_LIMITS)) {
      expect(limits.min, key).toBe(365);
      expect(limits.default, key).toBeGreaterThanOrEqual(limits.min);
      expect(limits.default, key).toBeLessThanOrEqual(limits.max);
    }
  });

  it('fills a partial object field by field, and ignores what is not a number', () => {
    expect(retention({ auditDays: 1095 })).toEqual({ ...RETENTION_DEFAULTS, auditDays: 1095 });
    expect(retention({ subPlanDays: '400', aiUsageDays: null, unknown: 1 })).toEqual(
      RETENTION_DEFAULTS,
    );
    expect(retention('730')).toEqual(RETENTION_DEFAULTS);
    expect(retention([])).toEqual(RETENTION_DEFAULTS);
  });

  it('rounds as the database reads it (app.retention_days)', () => {
    expect(retention({ auditDays: 800.4, subPlanDays: 400.5 })).toMatchObject({
      auditDays: 800,
      subPlanDays: 401,
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

  it('validates the « Fiche de suppléance »', () => {
    const fiche = classSubProfileSchema.parse({
      classId,
      arrivalNotes: '  Porte 3.  ',
      routinesNotes: '',
      neighbourTeacherId: null,
    });
    expect(fiche).toEqual({
      classId,
      arrivalNotes: 'Porte 3.',
      routinesNotes: null,
      classroomManagementNotes: null,
      dismissalNotes: null,
      fallbackActivities: null,
      neighbourTeacherId: null,
      neighbourNote: null,
    });
    expect(
      classSubProfileSchema.safeParse({ classId, dismissalNotes: 'x'.repeat(2001) }).error
        ?.issues[0]?.message,
    ).toBe('tooLong');
    expect(
      classSubProfileSchema.safeParse({ classId, neighbourNote: 'x'.repeat(201) }).success,
    ).toBe(false);
    expect(classSubProfileSchema.safeParse({ classId, neighbourTeacherId: 'marc' }).success).toBe(
      false,
    );
  });

  it('validates the direction’s substitute settings', () => {
    const base = { schoolId: classId, accessFrom: '05:00', accessUntil: '18:00' };
    expect(substituteSettingsFormSchema.parse({ ...base, halfDaySplit: '' })).toEqual({
      ...base,
      halfDaySplit: null,
      arrivalInstructions: null,
      emergencyInfo: null,
    });
    expect(
      substituteSettingsFormSchema.parse({ ...base, halfDaySplit: '12:55:00' }).halfDaySplit,
    ).toBe('12:55');
    expect(
      substituteSettingsFormSchema.safeParse({ ...base, accessUntil: '05:00' }).error?.issues[0]
        ?.message,
    ).toBe('endBeforeStart');
    expect(substituteSettingsFormSchema.safeParse({ ...base, halfDaySplit: '13h' }).success).toBe(
      false,
    );
    expect(
      substituteSettingsFormSchema.safeParse({ ...base, emergencyInfo: 'x'.repeat(501) }).success,
    ).toBe(false);
  });
});
