'use server';

import { unitPlanSchema } from '@lynx/domain';
import { getLocale } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { fail, ok, type ActionResult } from '@/lib/action-result';
import { reportError } from '../errors';
import { loadClass } from '../queries/classes';
import { loadExpectationChoices, type ExpectationChoice } from '../queries/year-plan';
import { requireSession } from '../session';
import { createSupabaseServerClient } from '../supabase';
import { parseInput } from './validation';

/**
 * « Mon année » (DECISIONS D-123): planning a unit, its window and the attentes it aims at.
 * Every action gates through the session first (D-109); row level security and the database's
 * checks (`save_unit_plan`, LXY01, LXY02) decide in the end. Titles and attentes are never logged.
 */

const uuid = z.uuid();

const refresh = (classId: string, unitId?: string) => {
  revalidatePath(`/classes/${classId}/planning`, 'layout');
  if (unitId) revalidatePath(`/classes/${classId}/planning/${unitId}`);
  revalidatePath('/today');
};

export type UnitPlanInput = z.input<typeof unitPlanSchema>;

/** Creates (`unitId` null: « À venir ») or changes a unit's plan. */
export async function saveUnitPlan(
  unitId: string | null,
  input: UnitPlanInput,
): Promise<ActionResult<{ id: string }>> {
  await requireSession();
  if (unitId !== null && !uuid.safeParse(unitId).success) return fail('invalid');
  const parsed = parseInput(unitPlanSchema, input);
  if (!parsed.ok) return parsed.result;
  const v = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('save_unit_plan', {
    // Nullable arguments are typed as strings by the generator.
    p_unit_id: unitId as string,
    p_class_id: v.classId,
    p_subject_id: v.subjectId,
    p_title: v.title,
    p_description: v.description as string,
    p_starts_on: v.startsOn as string,
    p_ends_on: v.endsOn as string,
    p_expectation_ids: v.expectationIds,
  });
  if (error || !data) return fail(reportError('saveUnitPlan', error));
  refresh(v.classId, data);
  return ok({ id: data });
}

/**
 * The attentes the planning dialog offers for a subject: the curriculum's, for the class's
 * grades. Loaded when the dialog opens or the subject changes, not with the page.
 */
export async function loadExpectationOptions(
  classId: string,
  subjectId: string,
): Promise<ActionResult<ExpectationChoice[]>> {
  const session = await requireSession();
  if (!uuid.safeParse(classId).success || !uuid.safeParse(subjectId).success) {
    return fail('invalid');
  }
  const cls = await loadClass(session, classId);
  if (!cls?.myRole) return fail('forbidden');
  return ok(await loadExpectationChoices(subjectId, cls.gradeCodes, await getLocale()));
}
