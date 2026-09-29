import 'server-only';
import { composeSubPlan, subPlanAiBlocks, subPlanAiLayerSchema } from '@lynx/domain';
import { aiOn, findSchool, hasModule, hasRole, type SessionContext } from '../session';
import type { ServerSupabase } from '../supabase';
import { loadSubAccess } from './sub-access';
import type { OwnerPlan } from './sub-plans';

export type SubPlanAiJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

/** What the plan page's « Consignes détaillées (IA) » panel shows (DECISIONS D-052). */
export interface SubPlanAiState {
  /** The school's AI is on (its direction's switch and the board's permission). */
  aiOn: boolean;
  /** The owner may still change the plan: published, and the day is not over. */
  editable: boolean;
  /** A substitute already opened the plan: no new request (their plan stays as they read it). */
  inUse: boolean;
  /** Teaching periods the AI would detail. */
  periods: number;
  /** The AI layer on the plan now. `sentText`: what was sent for it, while its job is kept. */
  applied: { appliedAt: string | null; sentText: string | null } | null;
  /** The plan's latest request (ai_jobs keeps it 30 days). */
  job: {
    id: string;
    status: SubPlanAiJobStatus;
    errorCode: string | null;
    createdAt: string;
    /** Its answer is the layer shown now. */
    applied: boolean;
  } | null;
}

/**
 * The panel's state for the owner of a plan, or null when there is nothing to show: not a
 * teacher at a school with the Teaching module, or the plan can no longer change and has no AI
 * layer, or AI is off and was never used on it.
 */
export async function loadSubPlanAiState(
  supabase: ServerSupabase,
  session: SessionContext,
  owned: OwnerPlan,
): Promise<SubPlanAiState | null> {
  const school = findSchool(session, owned.absence.schoolId);
  if (!school || !owned.plan || !hasModule(school, 'teaching') || !hasRole(school, 'teacher')) {
    return null;
  }
  const layer = owned.ai == null ? null : subPlanAiLayerSchema.safeParse(owned.ai);
  const on = aiOn(session, school);
  if (!layer?.success && ((!on && !owned.aiJobId) || !owned.editable)) return null;

  const [job, access] = await Promise.all([
    owned.aiJobId
      ? supabase
          .from('ai_jobs')
          .select('id, status, error_code, created_at, sent_text')
          .eq('id', owned.aiJobId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    loadSubAccess(supabase, owned.id),
  ]);
  const layerJobId = layer?.success ? (layer.data.jobId ?? null) : null;
  const current = job.data;
  // An earlier layer's own request, for « Voir exactement ce qui a été envoyé ».
  const layerJob =
    layerJobId && layerJobId !== current?.id
      ? (await supabase.from('ai_jobs').select('sent_text').eq('id', layerJobId).maybeSingle()).data
      : current;

  return {
    aiOn: on,
    editable: owned.editable,
    inUse: (access?.sessions.length ?? 0) > 0,
    periods: subPlanAiBlocks(composeSubPlan(owned.plan, { edits: owned.edits, audience: 'owner' }))
      .length,
    applied: layer?.success
      ? { appliedAt: layer.data.appliedAt ?? null, sentText: layerJob?.sent_text ?? null }
      : null,
    job: current
      ? {
          id: current.id,
          status: current.status,
          errorCode: current.error_code,
          createdAt: current.created_at,
          applied: layerJobId === current.id,
        }
      : null,
  };
}
