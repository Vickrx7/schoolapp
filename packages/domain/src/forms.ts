/**
 * Validation for data users submit. Shared by the web app's server actions (and any future
 * API) so every entry point enforces the same rules. Messages are translation keys.
 */
import { z } from 'zod';
import { isLocalDate, isLocalTime, timeToMinutes } from './dates';
import { MAX_FIRST_NAME_LENGTH } from './roster';

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

export const calendarEventFormSchema = z
  .object({
    schoolId: uuid,
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
  .refine((e) => e.endsOn >= e.startsOn, { message: 'endBeforeStart', path: ['endsOn'] })
  .refine(
    (e) => !e.startTime || !e.endTime || timeToMinutes(e.endTime) > timeToMinutes(e.startTime),
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
