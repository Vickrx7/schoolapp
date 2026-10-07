'use server';

import { subPlanEditsSchema, type SubPlanEdits } from '@lynx/domain';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { fail, ok, okVoid, type ActionResult } from '@/lib/action-result';
import { reportError } from '../errors';
import { requireSession } from '../session';
import { createSupabaseServerClient } from '../supabase';
import { parseInput } from './validation';

const planId = z.uuid();
const revision = z.number().int().min(0);

/**
 * Saves the teacher's overlay on a plan (D-048) and returns the new revision. The expected
 * revision makes two devices editing the same plan see each other (`subPlanConflict`);
 * `overwrite` is « Garder ma version » after such a conflict. Pages are not revalidated: this
 * runs every few seconds while she types, and the plan page reads fresh data on each visit.
 */
export async function saveSubPlanEdits(
  rawPlanId: string,
  edits: SubPlanEdits | null,
  expectedRevision: number,
  options: { overwrite?: boolean } = {},
): Promise<ActionResult<{ revision: number; savedAt: string }>> {
  await requireSession();
  const id = planId.safeParse(rawPlanId);
  const rev = revision.safeParse(expectedRevision);
  if (!id.success || !rev.success || typeof options !== 'object' || options === null) {
    return fail('invalid');
  }
  let payload: SubPlanEdits | null = null;
  if (edits !== null) {
    const parsed = parseInput(subPlanEditsSchema, edits);
    if (!parsed.ok) return parsed.result;
    payload = Object.keys(parsed.data).length > 0 ? parsed.data : null;
  }

  const supabase = await createSupabaseServerClient();
  let expected = rev.data;
  if (options.overwrite === true) {
    // « Garder ma version »: save over whatever the other device saved (owner only, RLS).
    const { data } = await supabase
      .from('sub_plans')
      .select('edits_revision')
      .eq('id', id.data)
      .maybeSingle();
    if (!data) return fail('forbidden');
    expected = data.edits_revision;
  }
  const { data, error } = await supabase.rpc('save_sub_plan_edits', {
    p_plan_id: id.data,
    p_edits: payload,
    p_expected_revision: expected,
  });
  if (error) return fail(reportError('saveSubPlanEdits', error));
  return ok({ revision: data, savedAt: new Date().toISOString() });
}

/**
 * « Publier maintenant »: the plan is released before its automatic time (owner, direction or
 * office; audited by the database). Nothing happens if it is already released.
 */
export async function releaseSubPlan(rawPlanId: string): Promise<ActionResult> {
  await requireSession();
  const id = planId.safeParse(rawPlanId);
  if (!id.success) return fail('invalid');
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('release_sub_plan', { p_plan_id: id.data });
  if (error) return fail(reportError('releaseSubPlan', error));
  revalidatePath('/absences', 'layout');
  revalidatePath('/today');
  return okVoid();
}
