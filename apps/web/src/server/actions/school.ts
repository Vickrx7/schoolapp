'use server';

import {
  localDateSchema,
  schoolContactFormSchema,
  substituteSettingsFormSchema,
} from '@lynx/domain';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { fail, okVoid, type ActionResult } from '@/lib/action-result';
import { reportError } from '../errors';
import { findSchool, hasRole, requireSession } from '../session';
import { createSupabaseServerClient } from '../supabase';
import { parseInput } from './validation';

const scheduleSchema = z
  .object({
    scheduleType: z.enum(['weekly', 'cycle']),
    cycleLength: z.number().int().min(2).max(20).nullable(),
    studentAlertsEnabled: z.boolean(),
  })
  .refine((s) => s.scheduleType === 'weekly' || s.cycleLength !== null, {
    message: 'required',
    path: ['cycleLength'],
  });

export async function updateSchoolSettings(
  schoolId: string,
  input: z.input<typeof scheduleSchema>,
): Promise<ActionResult> {
  const parsed = parseInput(scheduleSchema, input);
  if (!parsed.ok) return parsed.result;
  const v = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('schools')
    .update({
      schedule_type: v.scheduleType,
      cycle_length: v.scheduleType === 'cycle' ? v.cycleLength : null,
      student_alerts_enabled: v.studentAlertsEnabled,
    })
    .eq('id', schoolId)
    .select('id');
  if (error) return fail(reportError('updateSchoolSettings', error));
  if (!data?.length) return fail('forbidden');
  revalidatePath('/', 'layout');
  return okVoid();
}

const anchorSchema = z.object({
  anchorDate: localDateSchema,
  cycleDay: z.number().int().min(1).max(20),
});

export async function addCycleAnchor(
  schoolId: string,
  input: z.input<typeof anchorSchema>,
): Promise<ActionResult> {
  const parsed = parseInput(anchorSchema, input);
  if (!parsed.ok) return parsed.result;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('school_cycle_anchors')
    .upsert(
      { school_id: schoolId, anchor_date: parsed.data.anchorDate, cycle_day: parsed.data.cycleDay },
      { onConflict: 'school_id,anchor_date' },
    );
  if (error) return fail(reportError('addCycleAnchor', error));
  revalidatePath('/school');
  revalidatePath('/today');
  return okVoid();
}

export async function deleteCycleAnchor(anchorId: string): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('school_cycle_anchors')
    .delete()
    .eq('id', anchorId)
    .select('id');
  if (error) return fail(reportError('deleteCycleAnchor', error));
  if (!data?.length) return fail('forbidden');
  revalidatePath('/school');
  revalidatePath('/today');
  return okVoid();
}

/**
 * Turns AI on or off for a school: its direction, or the board's admins (D-108, an Assumption for
 * schools without a direction account); audited by the database.
 */
export async function setSchoolAi(schoolId: string, enabled: boolean): Promise<ActionResult> {
  if (typeof enabled !== 'boolean') return fail('invalid');
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('schools')
    .update({ ai_enabled: enabled })
    .eq('id', schoolId)
    .select('id');
  if (error) return fail(reportError('setSchoolAi', error));
  if (!data?.length) return fail('forbidden');
  revalidatePath('/', 'layout');
  return okVoid();
}

export type SubstituteSettingsInput = z.input<typeof substituteSettingsFormSchema>;

/**
 * The direction's « Suppléance » card (schools.settings.substitute): the code window, the
 * half-day split and what every plan of the school says about arriving and emergencies. Merged
 * by `merge_school_settings` under a row lock, so no other setting is lost and two saves cannot
 * overwrite each other (D-108); the database refuses anyone but the school's direction. Plans of
 * upcoming absences are rebuilt (the school's settings are one of their sources).
 */
export async function updateSubstituteSettings(
  input: SubstituteSettingsInput,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = parseInput(substituteSettingsFormSchema, input);
  if (!parsed.ok) return parsed.result;
  const v = parsed.data;
  const school = findSchool(session, v.schoolId);
  if (!school || !hasRole(school, 'principal', 'vice_principal')) return fail('forbidden');

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('merge_school_settings', {
    p_school_id: v.schoolId,
    p_patch: {
      substitute: {
        accessFrom: v.accessFrom,
        accessUntil: v.accessUntil,
        halfDaySplit: v.halfDaySplit,
        arrivalInstructions: v.arrivalInstructions,
        emergencyInfo: v.emergencyInfo,
      },
    },
  });
  if (error) return fail(reportError('updateSubstituteSettings', error));
  revalidatePath('/', 'layout');
  return okVoid();
}

export type SchoolContactInput = z.input<typeof schoolContactFormSchema>;

/**
 * « Coordonnées et heures » (D-108): the office's phone and e-mail (blank clears them) and the
 * first bell and dismissal, merged into the school's settings. The school's direction and the
 * board's admins may (the database checks); the phone appears in substitute plans.
 */
export async function updateSchoolContact(
  schoolId: string,
  input: SchoolContactInput,
): Promise<ActionResult> {
  if (!z.uuid().safeParse(schoolId).success) return fail('invalid');
  const parsed = parseInput(schoolContactFormSchema, input);
  if (!parsed.ok) return parsed.result;
  const v = parsed.data;
  await requireSession();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('merge_school_settings', {
    p_school_id: schoolId,
    p_patch: {
      contact: { officePhone: v.officePhone, officeEmail: v.officeEmail },
      dayStart: v.dayStart,
      dayEnd: v.dayEnd,
    },
  });
  if (error) return fail(reportError('updateSchoolContact', error));
  revalidatePath('/', 'layout');
  return okVoid();
}
