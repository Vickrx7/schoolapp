'use server';

import {
  differentiateInputSchema,
  differentiateItemTypes,
  MAX_TEXT_TIMES_LEVELS,
  type DifferentiateInput,
} from '@lynx/ai/features/differentiate';
import { Redactor, type BlockedKind, type Segment } from '@lynx/ai/privacy';
import { fromDifferentiation } from '@lynx/content';
import type { Json } from '@lynx/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { fail, ok, okVoid, type ActionResult } from '@/lib/action-result';
import { visiblePeople } from '../ai-people';
import { reportError } from '../errors';
import { aiSchools, requireSession } from '../session';
import { createSupabaseServerClient } from '../supabase';
import { parseInput } from './validation';

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

const formSchema = z
  .object({
    schoolId: z.uuid(),
    title: z.string().trim().min(1, 'required').max(200, 'tooLong'),
    text: z.string().trim().min(20, 'tooShort').max(12_000, 'tooLong'),
    objective: z.string().trim().max(500, 'tooLong'),
    itemType: z.enum(differentiateItemTypes),
    gradeCode: z.string().min(1, 'required'),
    subjectId: z.uuid().nullable(),
    levelIds: z.array(z.uuid()).min(2, 'atLeastTwoLevels').max(6, 'tooMany'),
  })
  .superRefine((form, ctx) => {
    // A long text for many levels would not finish in time (see MAX_TEXT_TIMES_LEVELS).
    if (form.text.length * form.levelIds.length > MAX_TEXT_TIMES_LEVELS) {
      ctx.addIssue({ code: 'custom', path: ['text'], message: 'tooLongForLevels' });
    }
  });
export type DifferentiateForm = z.input<typeof formSchema>;

/** Builds the job input from the form, with labels read from the database. */
async function buildInput(
  supabase: Supabase,
  form: z.infer<typeof formSchema>,
): Promise<DifferentiateInput | null> {
  const [levels, grade, subject] = await Promise.all([
    supabase
      .from('language_levels')
      .select('id, label_fr, description_fr, owner_user_id, sort_order')
      .in('id', form.levelIds)
      .eq('active', true),
    supabase.from('grades').select('label_fr, ordinal').eq('code', form.gradeCode).maybeSingle(),
    form.subjectId
      ? supabase
          .from('subjects')
          .select('label_fr, grade_min, grade_max')
          .eq('id', form.subjectId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const rows = levels.data ?? [];
  if (rows.length !== form.levelIds.length || !grade.data) return null;
  if (form.subjectId && !subject.data) return null;
  // A subject that isn't taught in this grade would mislead the AI and be saved with the text.
  if (
    subject.data &&
    (grade.data.ordinal < subject.data.grade_min || grade.data.ordinal > subject.data.grade_max)
  ) {
    return null;
  }
  rows.sort(
    (a, b) =>
      Number(a.owner_user_id !== null) - Number(b.owner_user_id !== null) ||
      a.sort_order - b.sort_order,
  );
  const input = {
    title: form.title,
    text: form.text,
    objective: form.objective,
    itemType: form.itemType,
    gradeCode: form.gradeCode,
    // The content is French, so the AI gets the French labels.
    gradeLabel: grade.data.label_fr,
    subjectId: form.subjectId,
    subjectLabel: subject.data?.label_fr ?? null,
    levels: rows.map((l, i) => ({
      key: `L${i + 1}`,
      languageLevelId: l.id,
      label: l.label_fr,
      description: l.description_fr,
    })),
  };
  const parsed = differentiateInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export interface PreviewResult {
  title: Segment[];
  objective: Segment[];
  text: Segment[];
  replaced: number;
  blocked: { kind: BlockedKind; match: string }[];
}

async function prepare(raw: DifferentiateForm) {
  const session = await requireSession();
  const parsed = parseInput(formSchema, raw);
  if (!parsed.ok) return { ok: false as const, result: parsed.result };
  if (!aiSchools(session).some((s) => s.id === parsed.data.schoolId)) {
    return { ok: false as const, result: fail('forbidden') };
  }
  const supabase = await createSupabaseServerClient();
  const input = await buildInput(supabase, parsed.data);
  if (!input) return { ok: false as const, result: fail('invalid') };
  const redactor = new Redactor(await visiblePeople(supabase));
  const title = redactor.redact(input.title);
  const objective = redactor.redact(input.objective);
  const text = redactor.redact(input.text);
  const blocked = [...title.blocked, ...objective.blocked, ...text.blocked].map((b) => ({
    kind: b.kind,
    match: b.match,
  }));
  const preview: PreviewResult = {
    title: title.segments,
    objective: objective.segments,
    text: text.segments,
    replaced: redactor.replacements().length,
    blocked,
  };
  return { ok: true as const, supabase, schoolId: parsed.data.schoolId, input, preview };
}

/** Shows the teacher exactly what would be sent, and any personal detail to remove. */
export async function previewDifferentiation(
  raw: DifferentiateForm,
): Promise<ActionResult<PreviewResult>> {
  const prepared = await prepare(raw);
  if (!prepared.ok) return prepared.result;
  return ok(prepared.preview);
}

const AI_ERRORS: Record<string, string> = {
  LXA01: 'aiDisabled',
  LXA02: 'aiBudgetReached',
  LXA03: 'aiBusy',
};

export async function requestDifferentiation(
  raw: DifferentiateForm,
): Promise<ActionResult<{ jobId: string }>> {
  const prepared = await prepare(raw);
  if (!prepared.ok) return prepared.result;
  if (prepared.preview.blocked.length) return fail('personalInfo');
  const { data, error } = await prepared.supabase.rpc('request_ai_job', {
    p_school_id: prepared.schoolId,
    p_feature: 'differentiate',
    p_input: prepared.input,
  });
  if (error) {
    const known = error.code ? AI_ERRORS[error.code] : undefined;
    return fail(known ?? reportError('requestDifferentiation', error));
  }
  revalidatePath('/differentiate');
  return ok({ jobId: data });
}

export async function getAiJobStatus(
  jobId: string,
): Promise<ActionResult<{ status: 'queued' | 'running' | 'succeeded' | 'failed' }>> {
  if (!z.uuid().safeParse(jobId).success) return fail('notFound');
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('ai_jobs')
    .select('status')
    .eq('id', jobId)
    .maybeSingle();
  if (error) return fail(reportError('getAiJobStatus', error));
  if (!data) return fail('notFound');
  return ok({ status: data.status });
}

export async function discardAiJob(jobId: string): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('ai_jobs').delete().eq('id', jobId);
  if (error) return fail(reportError('discardAiJob', error));
  revalidatePath('/differentiate');
  return okVoid();
}

// ---------------------------------------------------------------------------------------
// Saving a result to the library (DECISIONS D-042, D-073)
// ---------------------------------------------------------------------------------------

// Messages are error keys: the editor shows them on the field, with the line they come from.
const line = (max: number) => z.string().trim().min(1, 'required').max(max, 'tooLong');
const versionSchema = z.object({
  languageLevelId: z.uuid(),
  title: z.string().trim().min(1, 'required').max(200, 'tooLong'),
  text: z.string().trim().min(1, 'required').max(40_000, 'tooLong'),
  glossary: z
    .array(z.object({ term: line(80), definition: z.string().trim().max(500, 'tooLong') }))
    .max(30, 'tooMany'),
  visualSupports: z.array(line(300)).max(10, 'tooMany'),
  questions: z.array(line(500)).max(12, 'tooMany'),
  teacherNote: z.string().trim().max(1000, 'tooLong'),
});
const resultSchema = z.object({
  title: z.string().trim().min(1, 'required').max(200, 'tooLong'),
  objective: z.string().trim().max(1000, 'tooLong'),
  versions: z.array(versionSchema).min(1, 'required').max(6, 'tooMany'),
});
export type DifferentiationResult = z.input<typeof resultSchema>;

/**
 * Saves a finished request as a private draft in the library: an ordinary reading passage or
 * worksheet (D-073), the teacher's original text as the base version and one version per level,
 * whose questions become short answers with a key waiting for sample answers
 * (`fromDifferentiation`). It is edited, shared and deleted in the library from then on. A level
 * deleted since the request is left out (`skippedLevels`) rather than making the whole text
 * unsaveable.
 */
export async function saveDifferentiation(
  jobId: string,
  raw: DifferentiationResult,
): Promise<ActionResult<{ itemId: string; skippedLevels: number }>> {
  await requireSession();
  const parsed = parseInput(resultSchema, raw);
  if (!parsed.ok) return parsed.result;
  if (!z.uuid().safeParse(jobId).success) return fail('notFound');
  const supabase = await createSupabaseServerClient();
  const [{ data: job }, { data: levels, error: levelsError }] = await Promise.all([
    supabase.from('ai_jobs').select('input').eq('id', jobId).maybeSingle(),
    supabase
      .from('language_levels')
      .select('id')
      .in(
        'id',
        parsed.data.versions.map((v) => v.languageLevelId),
      ),
  ]);
  const input = differentiateInputSchema.safeParse(job?.input);
  if (!input.success) return fail('notFound');
  if (levelsError) return fail(reportError('saveDifferentiation', levelsError));

  const known = new Set((levels ?? []).map((l) => l.id));
  const kept = parsed.data.versions.filter((v) => known.has(v.languageLevelId));
  if (!kept.length) return fail('notFound');
  const { versions } = fromDifferentiation(
    { title: input.data.title, text: input.data.text, itemType: input.data.itemType },
    { title: parsed.data.title, objective: parsed.data.objective, versions: kept },
  );
  const { data, error } = await supabase.rpc('save_ai_job_to_library', {
    p_job_id: jobId,
    p_type: input.data.itemType,
    p_title: parsed.data.title,
    p_versions: versions.map((v) => ({
      language_level_id: v.languageLevelId,
      content: v.content,
      answer_key: v.answerKey,
    })) as unknown as Json,
    p_grade_code: input.data.gradeCode,
    ...(input.data.subjectId ? { p_subject_id: input.data.subjectId } : {}),
  });
  if (error) return fail(reportError('saveDifferentiation', error));
  revalidatePath('/differentiate');
  revalidatePath('/library/mine');
  return ok({ itemId: data, skippedLevels: parsed.data.versions.length - kept.length });
}
