'use server';

import { composeSubPlan, reportableLessons } from '@lynx/domain';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { fail, ok, okVoid, type ActionResult } from '@/lib/action-result';
import { reportError } from '../errors';
import { loadPlanForOwner } from '../queries/sub-plans';
import { requireSession } from '../session';
import { createSupabaseServerClient } from '../supabase';
import { parseInput } from './validation';

// The absent teacher's side of the substitute's report (DECISIONS D-054): confirming it is the
// one path from what the substitute reported to completed lessons.

const decisionsSchema = z
  .array(
    z.object({
      lessonId: z.uuid(),
      decision: z.enum(['completed', 'not_completed', 'skipped']),
    }),
  )
  .max(40, 'tooMany');

export type ConfirmDecisionsInput = z.input<typeof decisionsSchema>;

function refresh() {
  revalidatePath('/today');
  revalidatePath('/absences', 'layout');
  revalidatePath('/classes', 'layout');
}

/**
 * « Confirmer le suivi »: « Confirmer » marks the lesson completed, « Pas terminée » makes it the
 * next lesson again, « Sautée » marks it skipped. Lessons the substitute marked done and that
 * are not listed are confirmed as done. Owner only (checked by confirm_sub_report); confirming
 * twice does nothing.
 */
export async function confirmSubReport(
  reportId: string,
  decisions: ConfirmDecisionsInput,
): Promise<ActionResult> {
  await requireSession();
  if (!z.uuid().safeParse(reportId).success) return fail('invalid');
  const parsed = parseInput(decisionsSchema, decisions);
  if (!parsed.ok) return parsed.result;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('confirm_sub_report', {
    p_report_id: reportId,
    p_decisions: parsed.data,
  });
  if (error) return fail(reportError('confirmSubReport', error));
  refresh();
  return okVoid();
}

/**
 * « Aucun suivi reçu » → « Marquer les leçons prévues comme données »: the lessons the plan
 * asked the substitute to teach are checked off as taught on the plan date, as the teacher
 * would herself (mark_lesson_taught, RLS). Only once the day's access has ended and no report
 * arrived; lessons that already have a record keep it.
 */
export async function markPlannedLessonsTaught(
  planId: string,
): Promise<ActionResult<{ marked: number }>> {
  const session = await requireSession();
  if (!z.uuid().safeParse(planId).success) return fail('invalid');
  const owned = await loadPlanForOwner(session, planId);
  if (!owned) return fail('forbidden');
  if (!owned.plan) return fail('invalid');

  const supabase = await createSupabaseServerClient();
  const [ended, report] = await Promise.all([
    supabase.rpc('sub_plan_access_ended', { p_plan_id: planId }),
    supabase.from('sub_reports').select('id').eq('sub_plan_id', planId).maybeSingle(),
  ]);
  if (ended.error) return fail(reportError('markPlannedLessonsTaught', ended.error));
  if (ended.data !== true) return fail('subReportPending');
  // A report arrived (or a draft is readable): confirm it instead.
  if (report.data) return fail('subReportExists');

  const planned = reportableLessons(
    composeSubPlan(owned.plan, { edits: owned.edits, audience: 'owner' }),
  );
  if (planned.length === 0) return ok({ marked: 0 });
  const { data: recorded, error: readError } = await supabase
    .from('lesson_progress')
    .select('lesson_id')
    .in(
      'lesson_id',
      planned.map((l) => l.lessonId),
    );
  if (readError) return fail(reportError('markPlannedLessonsTaught', readError));
  const done = new Set((recorded ?? []).map((r) => r.lesson_id));

  let marked = 0;
  for (const lesson of planned) {
    if (done.has(lesson.lessonId)) continue;
    const { error } = await supabase.rpc('mark_lesson_taught', {
      p_lesson_id: lesson.lessonId,
      p_taught_on: owned.planDate,
    });
    if (error) return fail(reportError('markPlannedLessonsTaught', error));
    marked += 1;
  }
  refresh();
  return ok({ marked });
}
