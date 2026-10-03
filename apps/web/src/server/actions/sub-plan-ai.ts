'use server';

import {
  redactSubPlanInput,
  subPlanAiInputSchema,
  subPlanFeature,
  type SubPlanAiInput,
} from '@lynx/ai/features/sub-plan';
import { Redactor, type Segment } from '@lynx/ai/privacy';
import { buildSubPlanAiInput, composeSubPlan, subPlanAiLayerSchema } from '@lynx/domain';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { fail, ok, okVoid, type ActionResult } from '@/lib/action-result';
import { visiblePeople } from '../ai-people';
import { reportError } from '../errors';
import type { SubPlanAiJobStatus } from '../queries/sub-plan-ai';
import { loadPlanForOwner, type OwnerPlan } from '../queries/sub-plans';
import { aiOn, findSchool, hasModule, hasRole, requireSession } from '../session';
import { describeDropped, segmentsOf, type SubPlanAiNotSent } from '../sub-plans/ai-preview';
import { createSupabaseServerClient, type ServerSupabase } from '../supabase';

// « Consignes détaillées » (DECISIONS D-052): the owner previews exactly what would be sent,
// then asks; the worker runs the request and the database applies its answer to the plan.

const AI_ERRORS: Record<string, string> = {
  LXA01: 'aiDisabled',
  LXA02: 'aiBudgetReached',
  LXA03: 'aiBusy',
};

export interface SubPlanAiPreview {
  /** The plan version the preview shows: sending refuses a plan changed since. */
  contentVersion: number;
  /** The message exactly as it would be sent, split around the names replaced by markers. */
  segments: Segment[];
  replaced: number;
  periods: number;
  /** Fields left out because they hold a personal detail (« Non envoyé »). */
  notSent: SubPlanAiNotSent[];
}

type Prepared =
  | { ok: false; result: ActionResult<never> }
  | { ok: true; owned: OwnerPlan; input: SubPlanAiInput; supabase: ServerSupabase };

/**
 * The request for the plan as its owner sees it now, rebuilt on the server from the stored plan
 * and her edits (never from anything the browser sends).
 */
async function prepare(planId: string): Promise<Prepared> {
  const session = await requireSession();
  if (!z.uuid().safeParse(planId).success) return { ok: false, result: fail('notFound') };
  const owned = await loadPlanForOwner(session, planId);
  if (!owned?.plan) return { ok: false, result: fail('notFound') };
  const school = findSchool(session, owned.absence.schoolId);
  if (!school || !hasModule(school, 'teaching') || !hasRole(school, 'teacher')) {
    return { ok: false, result: fail('forbidden') };
  }
  if (!aiOn(session, school)) return { ok: false, result: fail('aiDisabled') };
  if (!owned.editable) return { ok: false, result: fail('subDayOver') };

  const composed = composeSubPlan(owned.plan, { edits: owned.edits, audience: 'owner' });
  const built = buildSubPlanAiInput(composed, owned.levels);
  if (built.blocks.length === 0) return { ok: false, result: fail('subPlanAiNothing') };
  const parsed = subPlanAiInputSchema.safeParse(built);
  if (!parsed.success) {
    // Never the input itself in the logs: only where it failed.
    reportError('subPlanAiInput', {
      message: parsed.error.issues.map((i) => i.path.join('.')).join(', '),
    });
    return { ok: false, result: fail('invalid') };
  }
  const supabase = await createSupabaseServerClient();
  return { ok: true, owned, input: parsed.data, supabase };
}

/**
 * « Vérifier avant d'envoyer »: the message exactly as it would be sent (names the teacher can
 * see replaced by markers; the worker replaces at least as many), and what is left out.
 */
export async function previewSubPlanAi(planId: string): Promise<ActionResult<SubPlanAiPreview>> {
  const prepared = await prepare(planId);
  if (!prepared.ok) return prepared.result;
  const redactor = new Redactor(await visiblePeople(prepared.supabase));
  const { input, dropped } = redactSubPlanInput(prepared.input, redactor);
  const replacements = redactor.replacements();
  return ok({
    contentVersion: prepared.owned.contentVersion,
    segments: segmentsOf(
      subPlanFeature.buildUserMessage(input),
      replacements.map((r) => r.placeholder),
    ),
    replaced: replacements.length,
    periods: input.blocks.length,
    notSent: dropped.map((d) => describeDropped(d, prepared.input)),
  });
}

/** « Envoyer à l'IA »: only for the plan the teacher previewed (same content version). */
export async function requestSubPlanAi(
  planId: string,
  previewedVersion: number,
): Promise<ActionResult<{ jobId: string }>> {
  if (!Number.isInteger(previewedVersion)) return fail('invalid');
  const prepared = await prepare(planId);
  if (!prepared.ok) return prepared.result;
  if (prepared.owned.contentVersion !== previewedVersion) return fail('subPlanAiStale');
  const { data, error } = await prepared.supabase.rpc('request_sub_plan_ai', {
    p_plan_id: planId,
    p_input: prepared.input,
    // Checked again under the plan's lock: a rebuild or an edit since the preview refuses.
    p_expected_version: previewedVersion,
  });
  if (error) {
    const known = error.code ? AI_ERRORS[error.code] : undefined;
    return fail(known ?? reportError('requestSubPlanAi', error));
  }
  revalidatePath(`/absences/${prepared.owned.absence.id}/plans/${planId}`);
  return ok({ jobId: data });
}

/** Where the plan's latest request is, and whether its answer is the layer shown now. */
export async function getSubPlanAiStatus(
  planId: string,
): Promise<ActionResult<{ status: SubPlanAiJobStatus | 'none'; applied: boolean }>> {
  await requireSession();
  if (!z.uuid().safeParse(planId).success) return fail('notFound');
  const supabase = await createSupabaseServerClient();
  const { data: plan, error } = await supabase
    .from('sub_plans')
    .select('ai, ai_job_id')
    .eq('id', planId)
    .maybeSingle();
  if (error) return fail(reportError('getSubPlanAiStatus', error));
  if (!plan) return fail('notFound');
  if (!plan.ai_job_id) return ok({ status: 'none', applied: false });
  const { data: job } = await supabase
    .from('ai_jobs')
    .select('status')
    .eq('id', plan.ai_job_id)
    .maybeSingle();
  const layer = plan.ai == null ? null : subPlanAiLayerSchema.safeParse(plan.ai);
  return ok({
    status: job?.status ?? 'none',
    applied: !!layer?.success && layer.data.jobId === plan.ai_job_id,
  });
}

/** « Retirer les consignes détaillées »: the plan goes back to the teacher's and the template. */
export async function clearSubPlanAi(planId: string): Promise<ActionResult> {
  await requireSession();
  if (!z.uuid().safeParse(planId).success) return fail('notFound');
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('clear_sub_plan_ai', { p_plan_id: planId });
  if (error) return fail(reportError('clearSubPlanAi', error));
  revalidatePath('/absences', 'layout');
  return okVoid();
}
