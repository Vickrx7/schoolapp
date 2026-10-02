/**
 * Validation for data users submit. Shared by the web app's server actions (and any future
 * API) so every entry point enforces the same rules. Messages are translation keys.
 */
import { z } from 'zod';
import { isLocalDate, isLocalTime, timeToMinutes } from './dates';
import { MAX_FIRST_NAME_LENGTH } from './roster';
import type { ReportPeriodKind } from './year-plan/report-periods';

const uuid = z.uuid();
const trimmed = (max: number) => z.string().trim().min(1, 'required').max(max, 'tooLong');
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, 'tooLong')
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

export const localTimeSchema = z
  .string()
  .refine(isLocalTime, 'invalidTime')
  .transform((t) => t.slice(0, 5));
export const localDateSchema = z.string().refine(isLocalDate, 'invalidDate');

export const firstNameSchema = z
  .string()
  .transform((v) => v.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1, 'required').max(MAX_FIRST_NAME_LENGTH, 'tooLong'))
  .refine((v) => !v.includes('@'), 'notAName');

export const classFormSchema = z.object({
  name: trimmed(80),
  schoolId: uuid,
  schoolYearId: uuid,
  gradeCodes: z.array(z.string().regex(/^[A-Z0-9]{1,4}$/)).min(1, 'atLeastOneGrade'),
  roomId: uuid
    .nullable()
    .optional()
    .transform((v) => v ?? null),
});

export const studentFormSchema = z.object({
  firstName: firstNameSchema,
  defaultLanguageLevelId: uuid
    .nullable()
    .optional()
    .transform((v) => v ?? null),
});

export const studentImportSchema = z.object({
  classId: uuid,
  firstNames: z.array(firstNameSchema).min(1, 'required').max(60, 'tooMany'),
});

export const blockKinds = [
  'subject',
  'routine',
  'recess',
  'lunch',
  'nutrition_break',
  'prep',
  'duty',
  'other',
] as const;

export const timetableBlockSchema = z
  .object({
    classId: uuid,
    dayKeys: z.array(z.number().int().min(1).max(20)).min(1, 'atLeastOneDay'),
    startTime: localTimeSchema,
    endTime: localTimeSchema,
    kind: z.enum(blockKinds),
    subjectId: uuid
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    title: optionalText(80),
    teacherId: uuid
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    roomId: uuid
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    notes: optionalText(500),
  })
  .refine((b) => timeToMinutes(b.endTime) > timeToMinutes(b.startTime), {
    message: 'endBeforeStart',
    path: ['endTime'],
  })
  .refine((b) => b.kind !== 'subject' || b.subjectId !== null, {
    message: 'subjectRequired',
    path: ['subjectId'],
  });

export const unitFormSchema = z.object({
  classId: uuid,
  subjectId: uuid,
  title: trimmed(120),
  description: optionalText(2000),
});

export const lessonFormSchema = z.object({
  title: trimmed(160),
  objectives: optionalText(4000),
  materials: optionalText(4000),
  content: optionalText(20000),
  subNotes: optionalText(4000),
  durationMinutes: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? null : Number(v)),
    z.number().int().min(1).max(600).nullable(),
  ),
  expectationIds: z.array(uuid).max(20).default([]),
});

export const calendarEventTypes = [
  'pa_day',
  'holiday',
  'early_dismissal',
  'late_start',
  'mass',
  'liturgy',
  'assembly',
  'field_trip',
  'other',
] as const;

/**
 * A calendar event: for the whole board (`boardId`: the board's admins, DECISIONS D-107), or for a
 * school or one of its classes (`schoolId`). Exactly one of the two.
 */
export const calendarEventFormSchema = z
  .object({
    boardId: uuid
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    schoolId: uuid
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    classId: uuid
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    eventType: z.enum(calendarEventTypes),
    title: trimmed(120),
    startsOn: localDateSchema,
    endsOn: localDateSchema,
    startTime: localTimeSchema
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    endTime: localTimeSchema
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    affectsSchedule: z.boolean().default(true),
    notes: optionalText(1000),
  })
  .refine((e) => (e.boardId === null) !== (e.schoolId === null), { message: 'invalid' })
  .refine((e) => e.classId === null || e.schoolId !== null, { message: 'invalid' })
  .refine((e) => e.endsOn >= e.startsOn, { message: 'endBeforeStart', path: ['endsOn'] })
  .refine(
    (e) =>
      !e.startTime ||
      !e.endTime ||
      !isLocalTime(e.startTime) ||
      !isLocalTime(e.endTime) ||
      timeToMinutes(e.endTime) > timeToMinutes(e.startTime),
    { message: 'endBeforeStart', path: ['endTime'] },
  );

export const alertCategories = ['allergy', 'medical', 'safety', 'other'] as const;

export const studentAlertFormSchema = z.object({
  studentId: uuid,
  alertId: uuid
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  category: z.enum(alertCategories),
  text: trimmed(500),
});

/**
 * « Fiche de suppléance » of a class (DECISIONS D-057). No medical details or difficulties tied
 * to a named student: those belong in alerts. The neighbour must be an active teacher at the
 * class's school (checked by the database).
 */
export const classSubProfileSchema = z.object({
  classId: uuid,
  arrivalNotes: optionalText(2000),
  routinesNotes: optionalText(2000),
  classroomManagementNotes: optionalText(2000),
  dismissalNotes: optionalText(2000),
  fallbackActivities: optionalText(2000),
  neighbourTeacherId: uuid
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  neighbourNote: optionalText(200),
});

/** A blank time field means "not set". */
const optionalLocalTime = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  localTimeSchema
    .nullable()
    .optional()
    .transform((v) => v ?? null),
);

/** The direction's « Suppléance » card on the École page (schools.settings.substitute). */
export const substituteSettingsFormSchema = z
  .object({
    schoolId: uuid,
    accessFrom: localTimeSchema,
    accessUntil: localTimeSchema,
    halfDaySplit: optionalLocalTime,
    arrivalInstructions: optionalText(500),
    emergencyInfo: optionalText(500),
  })
  .refine((s) => timeToMinutes(s.accessUntil) > timeToMinutes(s.accessFrom), {
    message: 'endBeforeStart',
    path: ['accessUntil'],
  });

// ---------------------------------------------------------------------------------------
// « Conseil »: what a board's admins enter (DECISIONS D-107, D-108)
// ---------------------------------------------------------------------------------------

/** The roles a board admin hands out (never facilities or parent), as `invite_staff` checks. */
export const staffRoles = [
  'teacher',
  'principal',
  'vice_principal',
  'office_admin',
  'board_admin',
] as const;
export type StaffRole = (typeof staffRoles)[number];

/** As the database checks addresses: no spaces, one @, and a dot after it. */
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** As `staff_invitations.email` requires: lower case, no spaces, one @ and a dot after it. */
const staffEmail = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'required')
  .max(320, 'tooLong')
  .refine((v) => v.length === 0 || EMAIL_PATTERN.test(v), 'invalidEmail');

/**
 * « Inviter une personne »: a board admin has no school (`schoolId` is dropped), every other role
 * has one of the board's schools (the database checks it belongs to the board).
 */
export const staffInviteFormSchema = z
  .object({
    boardId: uuid,
    schoolId: uuid
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    email: staffEmail,
    displayName: trimmed(120),
    honorific: optionalText(20),
    role: z.enum(staffRoles),
  })
  .transform((v) => (v.role === 'board_admin' ? { ...v, schoolId: null } : v))
  .refine((v) => v.role === 'board_admin' || v.schoolId !== null, {
    message: 'required',
    path: ['schoolId'],
  });

/** « Ajouter un rôle »: the same rule for the school. */
export const staffRoleFormSchema = z
  .object({
    role: z.enum(staffRoles),
    schoolId: uuid
      .nullable()
      .optional()
      .transform((v) => v ?? null),
  })
  .transform((v) => (v.role === 'board_admin' ? { ...v, schoolId: null } : v))
  .refine((v) => v.role === 'board_admin' || v.schoolId !== null, {
    message: 'required',
    path: ['schoolId'],
  });

/**
 * « Coordonnées et heures » of a school (`merge_school_settings`): the office's phone (digits,
 * spaces and `+().-`) and e-mail, blank to clear, and the first bell before dismissal.
 */
export const schoolContactFormSchema = z
  .object({
    officePhone: optionalText(40).refine(
      (v) => v === null || /^[0-9 +().-]*$/.test(v),
      'invalidPhone',
    ),
    officeEmail: optionalText(320).refine(
      (v) => v === null || EMAIL_PATTERN.test(v),
      'invalidEmail',
    ),
    dayStart: localTimeSchema,
    dayEnd: localTimeSchema,
  })
  .refine(
    // Compared only once both are times (their own errors come first).
    (v) =>
      !isLocalTime(v.dayStart) ||
      !isLocalTime(v.dayEnd) ||
      timeToMinutes(v.dayEnd) > timeToMinutes(v.dayStart),
    { message: 'endBeforeStart', path: ['dayEnd'] },
  );

/** « Années scolaires »: a name (unique in the board) and its first and last days. */
export const schoolYearFormSchema = z
  .object({
    name: trimmed(40),
    startsOn: localDateSchema,
    endsOn: localDateSchema,
  })
  .refine((v) => !isLocalDate(v.startsOn) || !isLocalDate(v.endsOn) || v.endsOn > v.startsOn, {
    message: 'endBeforeStart',
    path: ['endsOn'],
  });

/** A date that may be left blank (an empty select or field): null then. */
const optionalDate = z
  .union([localDateSchema, z.literal('')])
  .nullable()
  .optional()
  .transform((v) => v || null);

/** The most attentes a unit aims at (`save_unit_plan` refuses more). */
export const UNIT_PLAN_MAX_EXPECTATIONS = 200;

/**
 * « Planification de l'unité » (DECISIONS D-123): its title, description, planned window (both
 * dates or neither, the end not before the start) and the attentes it aims at (at most 200,
 * repeats dropped). The window's dates come from the weeks the teacher picks.
 */
export const unitPlanSchema = z
  .object({
    classId: uuid,
    subjectId: uuid,
    title: trimmed(120),
    description: optionalText(2000),
    startsOn: optionalDate,
    endsOn: optionalDate,
    expectationIds: z
      .array(uuid)
      .default([])
      .transform((ids) => [...new Set(ids)])
      .pipe(z.array(uuid).max(UNIT_PLAN_MAX_EXPECTATIONS, 'tooMany')),
  })
  .refine((v) => (v.startsOn === null) === (v.endsOn === null), {
    message: 'datesBoth',
    path: ['startsOn'],
  })
  .refine((v) => !v.startsOn || !v.endsOn || v.endsOn >= v.startsOn, {
    message: 'endBeforeStart',
    path: ['endsOn'],
  });

/**
 * One report period's dates (DECISIONS D-124): the evaluation window, then « saisie au plus
 * tard le » and « remise aux familles », optional, never before the window starts.
 */
export const reportPeriodDatesSchema = z
  .object({
    startsOn: localDateSchema,
    endsOn: localDateSchema,
    dueOn: optionalDate,
    issuedOn: optionalDate,
  })
  .refine((v) => !isLocalDate(v.startsOn) || !isLocalDate(v.endsOn) || v.endsOn >= v.startsOn, {
    message: 'endBeforeStart',
    path: ['endsOn'],
  })
  .refine((v) => !isLocalDate(v.startsOn) || v.dueOn === null || v.dueOn >= v.startsOn, {
    message: 'beforePeriodStart',
    path: ['dueOn'],
  })
  .refine((v) => !isLocalDate(v.startsOn) || v.issuedOn === null || v.issuedOn >= v.startsOn, {
    message: 'beforePeriodStart',
    path: ['issuedOn'],
  });

/**
 * « Périodes de bulletin » of a school year: each of the three kinds, or null for none (a period
 * left blank is removed). Field errors read `<kind>.<field>`.
 */
export const reportPeriodFormSchema = z.object({
  progress: reportPeriodDatesSchema.nullable(),
  term1: reportPeriodDatesSchema.nullable(),
  term2: reportPeriodDatesSchema.nullable(),
} satisfies Record<ReportPeriodKind, unknown>);
