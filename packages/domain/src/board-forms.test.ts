import { describe, expect, it } from 'vitest';
import {
  calendarEventFormSchema,
  reportPeriodFormSchema,
  schoolContactFormSchema,
  schoolYearFormSchema,
  staffInviteFormSchema,
  staffRoleFormSchema,
  unitPlanSchema,
} from './forms';

const board = '0b000000-0000-4000-8000-000000000001';
const school = '0c000000-0000-4000-8000-000000000001';
const klass = '0e000000-0000-4000-8000-000000000001';

const issues = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) => (result.error?.issues ?? []).map((i) => `${i.path.join('.') || 'form'}:${i.message}`);

describe('calendar events: one scope, the board or a school (D-107)', () => {
  const base = {
    eventType: 'pa_day',
    title: 'Journée pédagogique',
    startsOn: '2026-11-20',
    endsOn: '2026-11-20',
  };

  it('takes a board-wide event', () => {
    expect(calendarEventFormSchema.parse({ ...base, boardId: board })).toMatchObject({
      boardId: board,
      schoolId: null,
      classId: null,
    });
  });

  it('takes a school or class event, as before', () => {
    expect(calendarEventFormSchema.parse({ ...base, schoolId: school })).toMatchObject({
      boardId: null,
      schoolId: school,
    });
    expect(
      calendarEventFormSchema.safeParse({ ...base, schoolId: school, classId: klass }).success,
    ).toBe(true);
  });

  it('refuses no scope, both scopes, or a class without its school', () => {
    expect(issues(calendarEventFormSchema.safeParse(base))).toContain('form:invalid');
    expect(
      issues(calendarEventFormSchema.safeParse({ ...base, boardId: board, schoolId: school })),
    ).toContain('form:invalid');
    expect(
      issues(calendarEventFormSchema.safeParse({ ...base, boardId: board, classId: klass })),
    ).toContain('form:invalid');
  });
});

describe('« Inviter une personne » (D-107)', () => {
  const base = {
    boardId: board,
    schoolId: school,
    email: '  Isabelle.Nouvelle@Exemple.CA ',
    displayName: ' Isabelle Nouvelle ',
    role: 'teacher',
  };

  it('normalizes the address and the name, and drops a blank title', () => {
    expect(staffInviteFormSchema.parse({ ...base, honorific: '  ' })).toEqual({
      boardId: board,
      schoolId: school,
      email: 'isabelle.nouvelle@exemple.ca',
      displayName: 'Isabelle Nouvelle',
      honorific: null,
      role: 'teacher',
    });
  });

  it('gives a board admin no school, and every other role one', () => {
    expect(staffInviteFormSchema.parse({ ...base, role: 'board_admin' }).schoolId).toBeNull();
    expect(issues(staffInviteFormSchema.safeParse({ ...base, schoolId: null }))).toEqual([
      'schoolId:required',
    ]);
  });

  it('refuses addresses the database would refuse, roles a board does not hand out, long names', () => {
    for (const email of ['isabelle', 'isabelle@exemple', 'isa belle@exemple.ca', 'a@b@c.ca']) {
      expect(issues(staffInviteFormSchema.safeParse({ ...base, email })), email).toEqual([
        'email:invalidEmail',
      ]);
    }
    expect(issues(staffInviteFormSchema.safeParse({ ...base, email: '' }))).toEqual([
      'email:required',
    ]);
    for (const role of ['parent', 'facilities', 'admin']) {
      expect(staffInviteFormSchema.safeParse({ ...base, role }).success, role).toBe(false);
    }
    expect(
      issues(staffInviteFormSchema.safeParse({ ...base, displayName: 'x'.repeat(121) })),
    ).toEqual(['displayName:tooLong']);
    expect(issues(staffInviteFormSchema.safeParse({ ...base, honorific: 'x'.repeat(21) }))).toEqual(
      ['honorific:tooLong'],
    );
  });

  it('applies the same school rule when adding a role', () => {
    expect(staffRoleFormSchema.parse({ role: 'board_admin', schoolId: school })).toEqual({
      role: 'board_admin',
      schoolId: null,
    });
    expect(issues(staffRoleFormSchema.safeParse({ role: 'principal' }))).toEqual([
      'schoolId:required',
    ]);
  });
});

describe('« Coordonnées et heures » (D-108)', () => {
  const base = {
    officePhone: '613 555-0100 poste 2',
    officeEmail: '',
    dayStart: '08:45',
    dayEnd: '15:20',
  };

  it('takes the characters merge_school_settings takes, and clears blanks', () => {
    expect(schoolContactFormSchema.safeParse(base).success).toBe(false);
    expect(
      schoolContactFormSchema.parse({
        ...base,
        officePhone: '+1 (613) 555-0100',
        officeEmail: ' secretariat@ecole.ca ',
      }),
    ).toEqual({
      officePhone: '+1 (613) 555-0100',
      officeEmail: 'secretariat@ecole.ca',
      dayStart: '08:45',
      dayEnd: '15:20',
    });
    expect(
      schoolContactFormSchema.parse({ ...base, officePhone: ' ', officeEmail: null }),
    ).toMatchObject({
      officePhone: null,
      officeEmail: null,
    });
  });

  it('names what is wrong', () => {
    expect(issues(schoolContactFormSchema.safeParse(base))).toEqual(['officePhone:invalidPhone']);
    expect(
      issues(
        schoolContactFormSchema.safeParse({
          ...base,
          officePhone: null,
          officeEmail: 'secretariat',
        }),
      ),
    ).toEqual(['officeEmail:invalidEmail']);
    expect(
      issues(
        schoolContactFormSchema.safeParse({
          ...base,
          officePhone: null,
          dayStart: '15:20',
          dayEnd: '08:45',
        }),
      ),
    ).toEqual(['dayEnd:endBeforeStart']);
    expect(
      issues(schoolContactFormSchema.safeParse({ ...base, officePhone: null, dayStart: '25:00' })),
    ).toEqual(['dayStart:invalidTime']);
  });
});

describe('« Années scolaires »', () => {
  it('needs a name and a last day after the first', () => {
    expect(
      schoolYearFormSchema.parse({
        name: ' 2027-2028 ',
        startsOn: '2027-09-01',
        endsOn: '2028-06-28',
      }),
    ).toEqual({
      name: '2027-2028',
      startsOn: '2027-09-01',
      endsOn: '2028-06-28',
    });
    expect(
      issues(
        schoolYearFormSchema.safeParse({ name: '', startsOn: '2027-09-01', endsOn: '2027-09-01' }),
      ),
    ).toEqual(['name:required', 'endsOn:endBeforeStart']);
    expect(
      issues(
        schoolYearFormSchema.safeParse({
          name: 'x'.repeat(41),
          startsOn: 'demain',
          endsOn: '2028-06-28',
        }),
      ),
    ).toEqual(['name:tooLong', 'startsOn:invalidDate']);
  });
});

describe('« Périodes de bulletin » (D-124)', () => {
  const progress = {
    startsOn: '2026-09-02',
    endsOn: '2026-10-30',
    dueOn: '2026-11-06',
    issuedOn: '',
  };

  it('takes each kind, or null for none; blank optional dates are null', () => {
    expect(reportPeriodFormSchema.parse({ progress, term1: null, term2: null })).toEqual({
      progress: { ...progress, issuedOn: null },
      term1: null,
      term2: null,
    });
  });

  it('needs both window dates, the end not before the start, and later dates after the start', () => {
    expect(
      issues(
        reportPeriodFormSchema.safeParse({
          progress: { startsOn: '2026-10-30', endsOn: '2026-09-02', dueOn: '2026-09-01' },
          term1: { startsOn: '', endsOn: '2027-01-29' },
          term2: { startsOn: '2027-02-01', endsOn: '2027-06-11', issuedOn: '2027-01-31' },
        }),
      ),
    ).toEqual([
      'progress.endsOn:endBeforeStart',
      'progress.dueOn:beforePeriodStart',
      'term1.startsOn:invalidDate',
      'term2.issuedOn:beforePeriodStart',
    ]);
  });

  it('knows only the three kinds', () => {
    expect(reportPeriodFormSchema.safeParse({ progress: null, term1: null }).success).toBe(false);
  });
});

describe('« Planification de l’unité » (D-123)', () => {
  const base = {
    classId: klass,
    subjectId: '0f000000-0000-4000-8000-000000000001',
    title: '  Les fractions ',
    description: '',
    startsOn: '2027-01-11',
    endsOn: '2027-02-05',
    expectationIds: [
      '20000000-0000-4000-8000-000000030b11',
      '20000000-0000-4000-8000-000000030b12',
      '20000000-0000-4000-8000-000000030b11',
    ],
  };

  it('takes a title, a window and attentes, repeats dropped', () => {
    expect(unitPlanSchema.parse(base)).toEqual({
      ...base,
      title: 'Les fractions',
      description: null,
      expectationIds: [
        '20000000-0000-4000-8000-000000030b11',
        '20000000-0000-4000-8000-000000030b12',
      ],
    });
  });

  it('takes no dates at all', () => {
    expect(unitPlanSchema.parse({ ...base, startsOn: '', endsOn: null })).toMatchObject({
      startsOn: null,
      endsOn: null,
    });
  });

  it('needs both dates or neither, the end not before the start', () => {
    expect(issues(unitPlanSchema.safeParse({ ...base, endsOn: '' }))).toEqual([
      'startsOn:datesBoth',
    ]);
    expect(
      issues(unitPlanSchema.safeParse({ ...base, startsOn: '2027-02-08', endsOn: '2027-02-05' })),
    ).toEqual(['endsOn:endBeforeStart']);
  });

  it('takes at most 200 attentes, and needs a title', () => {
    const many = Array.from(
      { length: 201 },
      (_, i) => `20000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    expect(issues(unitPlanSchema.safeParse({ ...base, title: ' ', expectationIds: many }))).toEqual(
      ['title:required', 'expectationIds:tooMany'],
    );
    expect(unitPlanSchema.safeParse({ ...base, expectationIds: many.slice(0, 200) }).success).toBe(
      true,
    );
  });
});
