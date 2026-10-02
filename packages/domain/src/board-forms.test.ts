import { describe, expect, it } from 'vitest';
import {
  calendarEventFormSchema,
  schoolContactFormSchema,
  schoolYearFormSchema,
  staffInviteFormSchema,
  staffRoleFormSchema,
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
