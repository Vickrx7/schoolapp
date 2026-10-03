/**
 * « Signaler une absence »: the form's rules and its default date (DECISIONS D-055). Messages
 * are translation keys. Starting today or later is checked by the database, which knows the
 * school's date.
 */
import { z } from 'zod';
import type { CalendarEvent } from '../calendar';
import {
  addDays,
  daysBetween,
  localDateIn,
  localMinutesIn,
  timeToMinutes,
  type LocalDate,
  type LocalTime,
} from '../dates';
import { localDateSchema } from '../forms';
import { isInstructionalDay, nextInstructionalDays } from '../schedule';
import { absenceParts } from './schema';

/** Longest absence, in calendar days; long-term assignments are out of scope. */
export const ABSENCE_MAX_DAYS = 14;

export const absenceFormSchema = z
  .object({
    schoolId: z.uuid(),
    startsOn: localDateSchema,
    endsOn: localDateSchema,
    part: z.enum(absenceParts).default('full_day'),
    note: z
      .string()
      .trim()
      .max(1000, 'tooLong')
      .transform((v) => (v.length === 0 ? null : v))
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    catholicConnection: z.boolean().default(true),
    /** Makes a retried « Envoyer » idempotent. */
    clientRequestId: z.uuid(),
  })
  .refine((a) => a.endsOn >= a.startsOn, { message: 'endBeforeStart', path: ['endsOn'] })
  .refine((a) => a.part === 'full_day' || a.endsOn === a.startsOn, {
    message: 'halfDaySingleDay',
    path: ['part'],
  })
  .refine((a) => a.endsOn < a.startsOn || daysBetween(a.startsOn, a.endsOn) < ABSENCE_MAX_DAYS, {
    message: 'absenceTooLong',
    path: ['endsOn'],
  });

export type AbsenceForm = z.infer<typeof absenceFormSchema>;

/**
 * The date the form preselects: today when it is a school day and school isn't over yet
 * (local time before `dayEnd`), otherwise the next school day.
 */
export function defaultAbsenceDate(input: {
  now: Date;
  timezone: string;
  dayEnd: LocalTime;
  events: readonly CalendarEvent[];
}): LocalDate {
  const today = localDateIn(input.timezone, input.now);
  if (
    isInstructionalDay(today, input.events) &&
    localMinutesIn(input.timezone, input.now) < timeToMinutes(input.dayEnd)
  ) {
    return today;
  }
  const tomorrow = addDays(today, 1);
  return nextInstructionalDays(tomorrow, 1, input.events)[0] ?? tomorrow;
}
