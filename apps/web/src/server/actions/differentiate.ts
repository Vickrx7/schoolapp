'use server';

import {
  differentiateInputSchema,
  differentiateItemTypes,
  MAX_TEXT_TIMES_LEVELS,
  type DifferentiateInput,
} from '@lynx/ai/features/differentiate';
import { Redactor, type BlockedKind, type Segment } from '@lynx/ai/privacy';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { fail, ok, okVoid, type ActionResult } from '@/lib/action-result';
import { visiblePeople } from '../ai-people';
import { reportError } from '../errors';
import type { VersionContent } from '../queries/differentiate';
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
// Saving and editing results
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

function toContent(objective: string, v: z.infer<typeof versionSchema>): VersionContent {
  return {
    schema: 'differentiated_text/v1',
    objective,
    title: v.title,
    text: v.text,
    glossary: v.glossary,
    visualSupports: v.visualSupports,
    questions: v.questions,
    teacherNote: v.teacherNote,
  };
}

/**
 * Saves a finished request as a private draft in the library. A level deleted since the
 * request is left out (`skippedLevels`) rather than making the whole text unsaveable.
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
  const objective = parsed.data.objective;
  const versions = parsed.data.versions.filter((v) => known.has(v.languageLevelId));
  if (!versions.length) return fail('notFound');
  const { data, error } = await supabase.rpc('save_ai_job_to_library', {
    p_job_id: jobId,
    p_type: input.data.itemType,
    p_title: parsed.data.title,
    p_versions: [
      // The teacher's original text, kept as the base version.
      {
        language_level_id: null,
        content: {
          schema: 'differentiated_text/v1',
          original: true,
          objective,
          title: input.data.title,
          text: input.data.text,
        },
      },
      ...versions.map((v) => ({
        language_level_id: v.languageLevelId,
        content: toContent(objective, v),
      })),
    ],
    p_grade_code: input.data.gradeCode,
    ...(input.data.subjectId ? { p_subject_id: input.data.subjectId } : {}),
  });
  if (error) return fail(reportError('saveDifferentiation', error));
  revalidatePath('/differentiate');
  return ok({ itemId: data, skippedLevels: parsed.data.versions.length - versions.length });
}

export async function updateSavedDifferentiation(
  itemId: string,
  raw: DifferentiationResult,
): Promise<ActionResult> {
  await requireSession();
  const parsed = parseInput(resultSchema, raw);
  if (!parsed.ok) return parsed.result;
  if (!z.uuid().safeParse(itemId).success) return fail('notFound');
  const supabase = await createSupabaseServerClient();
  // Library content is written only through save_library_item (D-063), which replaces the whole
  // item: what this editor does not show (other versions, keys, links, flags) is sent back as it is.
  const { data: item, error: readError } = await supabase
    .from('library_items')
    .select(
      'board_id, school_id, type, summary, licence, subject_id, duration_minutes, materials, keywords, is_printable, is_projectable, is_interactive, sub_friendly, safety_notes, faith_content, faith_on_student_sheet, catholic_connection, catholic_reference_id, content_revision, library_item_grades(grade_code), library_item_expectations(expectation_id), library_item_tags(tag_id), library_item_versions(language_level_id, content, library_item_answer_keys(answer_key))',
    )
    .eq('id', itemId)
    .eq('source', 'ai_generated')
    .maybeSingle();
  if (readError) return fail(reportError('updateSavedDifferentiation', readError));
  if (!item) return fail('forbidden');
  const edited = new Map(parsed.data.versions.map((v) => [v.languageLevelId, v]));
  const { error } = await supabase.rpc('save_library_item', {
    p_item_id: itemId,
    p_expected_revision: item.content_revision,
    p_item: {
      boardId: item.board_id,
      schoolId: item.school_id,
      type: item.type,
      title: parsed.data.title,
      summary: item.summary,
      licence: item.licence,
      subjectId: item.subject_id,
      durationMinutes: item.duration_minutes,
      materials: item.materials,
      keywords: item.keywords,
      isPrintable: item.is_printable,
      isProjectable: item.is_projectable,
      isInteractive: item.is_interactive,
      subFriendly: item.sub_friendly,
      safetyNotes: item.safety_notes,
      faithContent: item.faith_content,
      faithOnStudentSheet: item.faith_on_student_sheet,
      catholicConnection: item.catholic_connection,
      catholicReferenceId: item.catholic_reference_id,
      gradeCodes: item.library_item_grades.map((g) => g.grade_code),
      expectationIds: item.library_item_expectations.map((e) => e.expectation_id),
      tagIds: item.library_item_tags.map((t) => t.tag_id),
      versions: item.library_item_versions.map((v) => {
        const change = v.language_level_id ? edited.get(v.language_level_id) : undefined;
        return {
          languageLevelId: v.language_level_id,
          content: change ? toContent(parsed.data.objective, change) : v.content,
          answerKey: v.library_item_answer_keys?.answer_key ?? null,
        };
      }),
    },
  });
  if (error) return fail(reportError('updateSavedDifferentiation', error));
  revalidatePath(`/differentiate/saved/${itemId}`);
  return okVoid();
}

export async function deleteSavedDifferentiation(itemId: string): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('library_items')
    .delete()
    .eq('id', itemId)
    .select('id');
  if (error) return fail(reportError('deleteSavedDifferentiation', error));
  if (!data?.length) return fail('forbidden');
  revalidatePath('/differentiate');
  return okVoid();
}
