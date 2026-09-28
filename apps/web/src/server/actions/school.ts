'use server';

import { localDateSchema } from '@lynx/domain';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { fail, okVoid, type ActionResult } from '@/lib/action-result';
import { reportError } from '../errors';
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
