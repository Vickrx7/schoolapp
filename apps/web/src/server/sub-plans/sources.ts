import 'server-only';
import { subPlanSourcesSchema, type LocalDate, type SubPlanSources } from '@lynx/domain';
import { reportError } from '../errors';
import type { createSupabaseServerClient } from '../supabase';

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type SourcesResult =
  | {
      ok: true;
      sources: SubPlanSources;
      /**
       * What the database read, summed up. Sent back with the plans built from it, so a plan
       * built from sources that changed in the meantime stays marked for the worker (D-047).
       */
      fingerprint: string | null;
    }
  | { ok: false; error: string };

/**
 * The library resources of the teacher's open lessons (get_sub_plan_library_sources, D-077), or
 * null when they cannot be read: a plan is then built without them rather than not at all (the
 * worker rebuilds it with them once a source changes).
 */
async function loadLibrarySources(supabase: Supabase, schoolId: string): Promise<unknown> {
  const { data, error } = await supabase.rpc('get_sub_plan_library_sources', {
    p_school_id: schoolId,
  });
  if (error) {
    reportError('loadSubPlanLibrarySources', error);
    return null;
  }
  return data;
}

/**
 * Everything a plan is built from, read as the signed-in teacher (get_sub_plan_sources returns
 * only what RLS already lets her read; DECISIONS D-047). With `absenceId`, the other days of
 * that absence come too, so days that can no longer change are respected.
 *
 * The library resources for her open lessons are read at the same time and merged in
 * (`sources.library`, D-077), except with `withLibrary: false`: the live summary of the absence
 * form counts periods and events only, and rebuilds on every change of the form.
 */
export async function loadSubPlanSources(
  supabase: Supabase,
  schoolId: string,
  from: LocalDate,
  to: LocalDate,
  absenceId?: string,
  options: { withLibrary?: boolean } = {},
): Promise<SourcesResult> {
  const [{ data, error }, library] = await Promise.all([
    supabase.rpc('get_sub_plan_sources', {
      p_school_id: schoolId,
      p_from: from,
      p_to: to,
      ...(absenceId ? { p_absence_id: absenceId } : {}),
    }),
    options.withLibrary === false ? Promise.resolve(null) : loadLibrarySources(supabase, schoolId),
  ]);
  if (error) return { ok: false, error: reportError('loadSubPlanSources', error) };
  const record = data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  const parsed = subPlanSourcesSchema.safeParse(record ? { ...record, library } : data);
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
  const fingerprint = record && typeof record.fingerprint === 'string' ? record.fingerprint : null;
  return { ok: true, sources: parsed.data, fingerprint };
}
