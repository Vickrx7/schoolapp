'use server';

import {
  ABSENCE_MAX_DAYS,
  absenceFormSchema,
  absenceParts,
  daysBetween,
  localDateSchema,
} from '@lynx/domain';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { fail, ok, okVoid, type ActionResult } from '@/lib/action-result';
import { reportError } from '../errors';
import { requireSession, teachingSchools } from '../session';
import { buildForAbsence, plansPayload } from '../sub-plans/build';
import { loadSubPlanSources } from '../sub-plans/sources';
import { summarizeAbsence, type AbsenceSummary } from '../sub-plans/summary';
import { createSupabaseServerClient } from '../supabase';
import { parseInput } from './validation';

export type AbsenceFormInput = z.input<typeof absenceFormSchema>;

function refreshPages(absenceId?: string) {
  revalidatePath('/absences');
  if (absenceId) revalidatePath(`/absences/${absenceId}`, 'layout');
  revalidatePath('/today');
}

/** The preview writes nothing, so it needs no request id. */
const PREVIEW_REQUEST_ID = '00000000-0000-4000-8000-000000000000';
export type AbsencePreviewInput = Omit<AbsenceFormInput, 'clientRequestId'>;

/**
 * The live summary under « Signaler une absence »: builds the plans as publishing would (without
 * library resources, which change no count), and returns counts and event titles per day.
 * Writes nothing.
 */
export async function previewAbsence(
  input: AbsencePreviewInput,
): Promise<ActionResult<AbsenceSummary>> {
  const session = await requireSession();
  if (typeof input !== 'object' || input === null) return fail('invalid');
  const parsed = parseInput(absenceFormSchema, { ...input, clientRequestId: PREVIEW_REQUEST_ID });
  if (!parsed.ok) return parsed.result;
  const v = parsed.data;
  if (!teachingSchools(session).some((s) => s.id === v.schoolId)) return fail('forbidden');

  const supabase = await createSupabaseServerClient();
  const loaded = await loadSubPlanSources(supabase, v.schoolId, v.startsOn, v.endsOn, undefined, {
    withLibrary: false,
  });
  if (!loaded.ok) return fail(loaded.error);
  const result = buildForAbsence(loaded.sources, {
    startsOn: v.startsOn,
    endsOn: v.endsOn,
    part: v.part,
    catholicConnection: v.catholicConnection,
  });
  return ok(summarizeAbsence(result));
}

/**
 * « Envoyer »: builds every school day's plan in this request and publishes the absence with
 * them in one transaction (D-047), so the plan exists before the page even loads. A retried tap
 * with the same request id and the same dates returns the absence already published; the same
 * id with other dates is refused (`absenceRequestReused`: the form then takes a new id).
 */
export async function publishAbsence(
  input: AbsenceFormInput,
): Promise<ActionResult<{ absenceId: string }>> {
  const session = await requireSession();
  const parsed = parseInput(absenceFormSchema, input);
  if (!parsed.ok) return parsed.result;
  const v = parsed.data;
  // Licensing is checked here and again by the database (D-060).
  if (!teachingSchools(session).some((s) => s.id === v.schoolId)) return fail('forbidden');

  const supabase = await createSupabaseServerClient();
  const loaded = await loadSubPlanSources(supabase, v.schoolId, v.startsOn, v.endsOn);
  if (!loaded.ok) return fail(loaded.error);
  const result = buildForAbsence(loaded.sources, {
    startsOn: v.startsOn,
    endsOn: v.endsOn,
    part: v.part,
    catholicConnection: v.catholicConnection,
  });

  const { data, error } = await supabase.rpc('publish_absence', {
    p_school_id: v.schoolId,
    p_starts_on: v.startsOn,
    p_ends_on: v.endsOn,
    p_part: v.part,
    p_note: v.note ?? '',
    p_catholic_connection: v.catholicConnection,
    p_client_request_id: v.clientRequestId,
    p_plans: plansPayload(result),
    ...(loaded.fingerprint ? { p_sources_fingerprint: loaded.fingerprint } : {}),
  });
  if (error || !data) return fail(reportError('publishAbsence', error));
  refreshPages(data);
  return ok({ absenceId: data });
}

type OwnAbsence = {
  id: string;
  school_id: string;
  starts_on: string;
  ends_on: string;
  part: (typeof absenceParts)[number];
  note: string | null;
  catholic_connection: boolean;
  status: string;
};

/** The signed-in teacher's own published absence, or an error key. */
async function ownAbsence(absenceId: string): Promise<
  | {
      ok: true;
      absence: OwnAbsence;
      supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
    }
  | { ok: false; result: ActionResult<never> }
> {
  const session = await requireSession();
  if (!z.uuid().safeParse(absenceId).success) return { ok: false, result: fail('invalid') };
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('absences')
    .select(
      'id, teacher_id, school_id, starts_on, ends_on, part, note, catholic_connection, status',
    )
    .eq('id', absenceId)
    .maybeSingle();
  if (!data || data.teacher_id !== session.userId) return { ok: false, result: fail('forbidden') };
  if (data.status !== 'published') return { ok: false, result: fail('invalid') };
  if (!teachingSchools(session).some((s) => s.id === data.school_id)) {
    return { ok: false, result: fail('forbidden') };
  }
  return { ok: true, absence: data, supabase };
}

const updateSchema = z
  .object({
    /** The start never changes: cancel and publish again instead. */
    endsOn: localDateSchema,
    part: z.enum(absenceParts),
    note: z
      .string()
      .trim()
      .max(1000, 'tooLong')
      .nullable()
      .optional()
      .transform((v) => (v ? v : null)),
    catholicConnection: z.boolean(),
  })
  .strict();
export type AbsenceUpdateInput = z.input<typeof updateSchema>;

/**
 * « Modifier / Je reviens plus tôt »: a new last day, morning or afternoon for a single day, the
 * note and the faith moment. The plans are rebuilt in the same request; days that can no longer
 * change (released today, or a substitute signed in) are kept as they are.
 */
export async function updateAbsence(
  absenceId: string,
  input: AbsenceUpdateInput,
): Promise<ActionResult> {
  const parsed = parseInput(updateSchema, input);
  if (!parsed.ok) return parsed.result;
  const v = parsed.data;
  const own = await ownAbsence(absenceId);
  if (!own.ok) return own.result;
  const { absence, supabase } = own;

  // The same rules as the form, against the absence's own first day.
  if (v.endsOn < absence.starts_on) return fail('invalid', { endsOn: 'endBeforeStart' });
  if (v.part !== 'full_day' && v.endsOn !== absence.starts_on) {
    return fail('invalid', { part: 'halfDaySingleDay' });
  }
  if (daysBetween(absence.starts_on, v.endsOn) >= ABSENCE_MAX_DAYS) {
    return fail('invalid', { endsOn: 'absenceTooLong' });
  }

  const loaded = await loadSubPlanSources(
    supabase,
    absence.school_id,
    absence.starts_on,
    v.endsOn,
    absence.id,
  );
  if (!loaded.ok) return fail(loaded.error);
  const result = buildForAbsence(
    loaded.sources,
    {
      startsOn: absence.starts_on,
      endsOn: v.endsOn,
      part: v.part,
      catholicConnection: v.catholicConnection,
    },
    { absenceId: absence.id },
  );
  const { error } = await supabase.rpc('update_absence', {
    p_absence_id: absence.id,
    p_ends_on: v.endsOn,
    p_part: v.part,
    p_note: v.note ?? '',
    p_catholic_connection: v.catholicConnection,
    p_plans: plansPayload(result),
    ...(loaded.fingerprint ? { p_sources_fingerprint: loaded.fingerprint } : {}),
  });
  if (error) return fail(reportError('updateAbsence', error));
  refreshPages(absence.id);
  return okVoid();
}

/**
 * « Mettre à jour le plan »: rebuilds now from the current sources (the worker does the same
 * on its own when a source changes). Fixed days are left as they are.
 */
export async function refreshAbsencePlans(absenceId: string): Promise<ActionResult> {
  const own = await ownAbsence(absenceId);
  if (!own.ok) return own.result;
  const { absence, supabase } = own;
  const loaded = await loadSubPlanSources(
    supabase,
    absence.school_id,
    absence.starts_on,
    absence.ends_on,
    absence.id,
  );
  if (!loaded.ok) return fail(loaded.error);
  const result = buildForAbsence(
    loaded.sources,
    {
      startsOn: absence.starts_on,
      endsOn: absence.ends_on,
      part: absence.part,
      catholicConnection: absence.catholic_connection,
    },
    { absenceId: absence.id },
  );
  const { error } = await supabase.rpc('refresh_sub_plans', {
    p_absence_id: absence.id,
    p_plans: plansPayload(result),
    ...(loaded.fingerprint ? { p_sources_fingerprint: loaded.fingerprint } : {}),
  });
  if (error) return fail(reportError('refreshAbsencePlans', error));
  refreshPages(absence.id);
  return okVoid();
}

/** « Annuler l'absence »: refused once a substitute has used one of its plans. */
export async function cancelAbsence(absenceId: string): Promise<ActionResult> {
  await requireSession();
  if (!z.uuid().safeParse(absenceId).success) return fail('invalid');
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('cancel_absence', { p_absence_id: absenceId });
  if (error) return fail(reportError('cancelAbsence', error));
  refreshPages(absenceId);
  return okVoid();
}

/** Polled by the absence page while its plans are being rebuilt. */
export async function getAbsenceStatus(
  absenceId: string,
): Promise<ActionResult<{ refreshing: boolean; versions: Record<string, number> }>> {
  await requireSession();
  if (!z.uuid().safeParse(absenceId).success) return fail('invalid');
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('absences')
    .select('sources_changed_at, sub_plans(id, content_version)')
    .eq('id', absenceId)
    .maybeSingle();
  if (error) return fail(reportError('getAbsenceStatus', error));
  if (!data) return fail('notFound');
  return ok({
    refreshing: data.sources_changed_at !== null,
    versions: Object.fromEntries(data.sub_plans.map((p) => [p.id, p.content_version])),
  });
}
