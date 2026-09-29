'use server';

import { localDateSchema, substituteSettingsFormSchema } from '@lynx/domain';
import type { Json } from '@lynx/db';
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

/** Turns AI on or off for a school (direction only; audited by the database). */
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
 * half-day split and what every plan of the school says about arriving and emergencies. The
 * other settings are kept as they are. Plans of upcoming absences are rebuilt (the school's
 * settings are one of their sources).
 */
export async function updateSubstituteSettings(
  input: SubstituteSettingsInput,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = parseInput(substituteSettingsFormSchema, input);
  if (!parsed.ok) return parsed.result;
  const v = parsed.data;
  const school = findSchool(session, v.schoolId);
  // schools_update allows direction (and board admins, who have no page for this yet).
  if (!school || !hasRole(school, 'principal', 'vice_principal')) return fail('forbidden');

  const supabase = await createSupabaseServerClient();
  const { data: current, error: readError } = await supabase
    .from('schools')
    .select('settings')
    .eq('id', v.schoolId)
    .maybeSingle();
  if (readError) return fail(reportError('updateSubstituteSettings', readError));
  if (!current) return fail('forbidden');
  const settings = isObject(current.settings) ? current.settings : {};
  const substitute = isObject(settings.substitute) ? settings.substitute : {};
  const { data, error } = await supabase
    .from('schools')
    .update({
      settings: {
        ...settings,
        substitute: {
          ...substitute,
          accessFrom: v.accessFrom,
          accessUntil: v.accessUntil,
          halfDaySplit: v.halfDaySplit,
          arrivalInstructions: v.arrivalInstructions,
          emergencyInfo: v.emergencyInfo,
        },
      },
    })
    .eq('id', v.schoolId)
    .select('id');
  if (error) return fail(reportError('updateSubstituteSettings', error));
  if (!data?.length) return fail('forbidden');
  revalidatePath('/', 'layout');
  return okVoid();
}

function isObject(value: unknown): value is { [key: string]: Json | undefined } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
