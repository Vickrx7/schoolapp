import 'server-only';
import { subPlanSourcesSchema, type LocalDate, type SubPlanSources } from '@lynx/domain';
import { reportError } from '../errors';
import type { createSupabaseServerClient } from '../supabase';

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type SourcesResult = { ok: true; sources: SubPlanSources } | { ok: false; error: string };

/**
 * Everything a plan is built from, read as the signed-in teacher (get_sub_plan_sources returns
 * only what RLS already lets her read; DECISIONS D-047). With `absenceId`, the other days of
 * that absence come too, so days that can no longer change are respected.
 */
export async function loadSubPlanSources(
  supabase: Supabase,
  schoolId: string,
  from: LocalDate,
  to: LocalDate,
  absenceId?: string,
): Promise<SourcesResult> {
  const { data, error } = await supabase.rpc('get_sub_plan_sources', {
    p_school_id: schoolId,
    p_from: from,
    p_to: to,
    ...(absenceId ? { p_absence_id: absenceId } : {}),
  });
  if (error) return { ok: false, error: reportError('loadSubPlanSources', error) };
  const parsed = subPlanSourcesSchema.safeParse(data);
  if (!parsed.success) {
    // Paths only: the sources hold lesson text.
    console.error(
      JSON.stringify({
        level: 'error',
        context: 'loadSubPlanSources',
        message: 'unexpected sources shape',
        paths: parsed.error.issues.slice(0, 5).map((i) => i.path.join('.')),
      }),
    );
    return { ok: false, error: 'unexpected' };
  }
  return { ok: true, sources: parsed.data };
}
