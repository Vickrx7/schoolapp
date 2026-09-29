'use server';

import { libraryItemFeature, libraryItemInputSchema } from '@lynx/ai/features/library-item';
import { libraryLevelsFeature, libraryLevelsInputSchema } from '@lynx/ai/features/library-levels';
import { Redactor, type BlockedKind, type Segment } from '@lynx/ai/privacy';
import {
  contentSchema,
  GRADE_CODE_PATTERN,
  isLibraryItemType,
  LIBRARY_ITEM_TYPES,
  TYPE_INFO,
} from '@lynx/content';
import { getLocale } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { localized } from '@/i18n/config';
import { fail, ok, type ActionResult } from '@/lib/action-result';
import { visiblePeople } from '../ai-people';
import { reportError } from '../errors';
import { segmentMessage } from '../library/ai-preview';
import { aiOn, librarySchools, requireSession } from '../session';
import { createSupabaseServerClient } from '../supabase';
import { parseInput } from './validation';

/**
 * « Créer avec l’IA » and « Créer les versions manquantes avec l’IA » (DECISIONS D-072, D-073,
 * D-074, D-078). The form sends ids and choices only; the database builds the request from its
 * tables (`library_item_ai_preview`, `library_levels_ai_preview`) and the server shows the
 * teacher exactly the de-identified text that would be sent, names highlighted (D-038). Nothing
 * is sent before she presses « Envoyer ».
 */

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

const AI_ERRORS: Record<string, string> = {
  LXA01: 'aiDisabled',
  LXA02: 'aiBudgetReached',
  LXA03: 'aiBusy',
};

/** An error of a library AI function, as a key under `errors`. */
function aiError(context: string, error: { code?: string; message?: string }): string {
  return (error.code && AI_ERRORS[error.code]) || reportError(context, error);
}

// ---------------------------------------------------------------------------------------
// « Créer avec l’IA »
// ---------------------------------------------------------------------------------------

const generateSchema = z
  .object({
    schoolId: z.uuid(),
    itemType: z.enum(LIBRARY_ITEM_TYPES),
    gradeCodes: z.array(z.string().regex(GRADE_CODE_PATTERN)).min(1, 'required').max(2, 'tooMany'),
    subjectId: z.uuid({ error: 'required' }),
    expectationIds: z.array(z.uuid()).max(5, 'tooMany'),
    levelIds: z.array(z.uuid()).max(6, 'tooMany'),
    catholicReferenceId: z.uuid().nullable(),
    durationMinutes: z.number().int().min(5).max(240),
    subFriendly: z.boolean(),
    teacherNote: z.string().trim().max(1000, 'tooLong'),
  })
  .superRefine((form, ctx) => {
    const info = TYPE_INFO[form.itemType];
    if (!form.expectationIds.length && !info.expectationsOptional) {
      ctx.addIssue({ code: 'custom', path: ['expectationIds'], message: 'required' });
    }
    if (form.itemType === 'catholic_reflection' && !form.catholicReferenceId) {
      ctx.addIssue({ code: 'custom', path: ['catholicReferenceId'], message: 'required' });
    }
  });
export type GenerateForm = z.input<typeof generateSchema>;

export interface ExistingItem {
  id: string;
  title: string;
}

export interface GenerationPreview {
  /** Exactly the text sent, split around the names replaced by markers. */
  message: Segment[];
  replaced: number;
  /** Personal details that block the request until the teacher removes them. */
  blocked: { kind: BlockedKind; match: string }[];
  /** Board-approved resources that already fit (« Des ressources approuvées existent déjà »). */
  existing: ExistingItem[];
}

const existingSchema = z.object({
  items: z.array(z.object({ id: z.uuid(), title: z.string() })),
});

/** Up to three board-approved resources of the type for the first attente (or grade and subject). */
async function approvedAlready(
  supabase: Supabase,
  form: z.infer<typeof generateSchema>,
): Promise<ExistingItem[]> {
  const { data, error } = await supabase.rpc('search_library', {
    p_filters: {
      types: [form.itemType],
      approvedOnly: true,
      gradeCode: form.gradeCodes[0],
      subjectId: form.subjectId,
      ...(form.expectationIds[0] ? { expectationId: form.expectationIds[0] } : {}),
    },
    p_limit: 3,
    p_offset: 0,
  });
  if (error) {
    reportError('approvedAlready', error);
    return [];
  }
  const parsed = existingSchema.safeParse(data);
  return parsed.success ? parsed.data.items : [];
}

async function prepareGeneration(raw: GenerateForm) {
  const session = await requireSession();
  const parsed = parseInput(generateSchema, raw);
  if (!parsed.ok) return { ok: false as const, result: parsed.result };
  const form = parsed.data;
  const school = librarySchools(session).find((s) => s.id === form.schoolId);
  if (!school) return { ok: false as const, result: fail('forbidden') };
  if (!aiOn(session, school)) return { ok: false as const, result: fail('aiDisabled') };
  const supabase = await createSupabaseServerClient();
  const request = {
    itemType: form.itemType,
    gradeCodes: form.gradeCodes,
    subjectId: form.subjectId,
    expectationIds: form.expectationIds,
    levelIds: TYPE_INFO[form.itemType].levelable ? form.levelIds : [],
    catholicReferenceId: form.catholicReferenceId,
    durationMinutes: form.durationMinutes,
    subFriendly: form.subFriendly && TYPE_INFO[form.itemType].subFriendlyAllowed,
    teacherNote: form.teacherNote,
  };
  const { data, error } = await supabase.rpc('library_item_ai_preview', {
    p_school_id: form.schoolId,
    p_request: request,
  });
  if (error)
    return { ok: false as const, result: fail(aiError('previewLibraryGeneration', error)) };
  const input = libraryItemInputSchema.safeParse(data);
  if (!input.success) {
    // Paths and codes only: never the request's text.
    reportError('previewLibraryGeneration', {
      code: 'invalid_input',
      message: input.error.issues.map((i) => `${i.path.join('.')}:${i.code}`).join(','),
    });
    return { ok: false as const, result: fail('invalid') };
  }
  const redactor = new Redactor(await visiblePeople(supabase));
  const { input: sent, blocked } = libraryItemFeature.redactInput(input.data, redactor);
  const message = libraryItemFeature.buildUserMessage(sent);
  const preview: GenerationPreview = {
    message: segmentMessage(message, redactor.replacements()),
    replaced: redactor.replacements().length,
    blocked: blocked.map((b) => ({ kind: b.kind, match: b.match })),
    existing: await approvedAlready(supabase, form),
  };
  return { ok: true as const, supabase, form, request, preview };
}

/** « Vérifier avant d’envoyer »: exactly what would be sent, and what already exists. */
export async function previewLibraryGeneration(
  raw: GenerateForm,
): Promise<ActionResult<GenerationPreview>> {
  const prepared = await prepareGeneration(raw);
  if (!prepared.ok) return prepared.result;
  return ok(prepared.preview);
}

/** « Envoyer »: queues the request (the database builds it again from the same ids). */
export async function requestLibraryGeneration(
  raw: GenerateForm,
): Promise<ActionResult<{ jobId: string }>> {
  const prepared = await prepareGeneration(raw);
  if (!prepared.ok) return prepared.result;
  if (prepared.preview.blocked.length) return fail('personalInfo');
  const { data, error } = await prepared.supabase.rpc('request_library_item', {
    p_school_id: prepared.form.schoolId,
    p_request: prepared.request,
  });
  if (error) return fail(aiError('requestLibraryGeneration', error));
  revalidatePath('/library');
  return ok({ jobId: data });
}

export interface ExpectationGroup {
  strandId: string | null;
  /** « B. Nombres »; null for attentes without a domaine. */
  strandLabel: string | null;
  expectations: {
    id: string;
    code: string;
    text: string;
    kind: 'overall' | 'specific';
    /** « À vérifier » while false (D-030). */
    verified: boolean;
  }[];
}

/**
 * The attentes of a subject for one or two grades, by domaine (overall, then specific), in the
 * interface language, for the form's checklist.
 */
export async function listGenerationExpectations(
  gradeCodes: string[],
  subjectId: string,
): Promise<ActionResult<ExpectationGroup[]>> {
  await requireSession();
  const args = z
    .object({
      gradeCodes: z.array(z.string().regex(GRADE_CODE_PATTERN)).min(1).max(2),
      subjectId: z.uuid(),
    })
    .safeParse({ gradeCodes, subjectId });
  if (!args.success) return fail('invalid');
  const [supabase, locale] = await Promise.all([createSupabaseServerClient(), getLocale()]);
  const { data, error } = await supabase
    .from('curriculum_expectations')
    .select(
      'id, code, text_fr, text_en, kind, is_verified, grade_code, sort_order, strand_id, strands(code, label_fr, label_en, sort_order)',
    )
    .eq('subject_id', args.data.subjectId)
    .in('grade_code', args.data.gradeCodes)
    .order('grade_code')
    .order('sort_order')
    .order('code');
  if (error) return fail(reportError('listGenerationExpectations', error));
  const groups = new Map<string, ExpectationGroup & { order: number }>();
  for (const e of data ?? []) {
    const key = e.strand_id ?? 'none';
    const group = groups.get(key) ?? {
      strandId: e.strand_id,
      strandLabel: e.strands
        ? `${e.strands.code}. ${localized(locale, e.strands.label_fr, e.strands.label_en)}`
        : null,
      order: e.strands?.sort_order ?? 999,
      expectations: [],
    };
    group.expectations.push({
      id: e.id,
      code: e.code,
      text: localized(locale, e.text_fr, e.text_en),
      kind: e.kind,
      verified: e.is_verified,
    });
    groups.set(key, group);
  }
  return ok(
    [...groups.values()]
      .sort((a, b) => a.order - b.order)
      .map(({ order: _order, ...group }) => ({
        ...group,
        // Overall attentes first, then the specific ones, each in curriculum order.
        expectations: [
          ...group.expectations.filter((e) => e.kind === 'overall'),
          ...group.expectations.filter((e) => e.kind === 'specific'),
        ],
      })),
  );
}

// ---------------------------------------------------------------------------------------
// « Créer les versions manquantes avec l’IA »
// ---------------------------------------------------------------------------------------

export interface LevelsPreview {
  message: Segment[];
  replaced: number;
  blocked: { kind: BlockedKind; match: string }[];
}

const levelsArgs = z.object({
  itemId: z.uuid(),
  schoolId: z.uuid(),
  levelIds: z.array(z.uuid()).min(1, 'required').max(6, 'tooMany'),
});

async function prepareLevels(itemId: string, schoolId: string, levelIds: string[]) {
  const session = await requireSession();
  const args = levelsArgs.safeParse({ itemId, schoolId, levelIds });
  if (!args.success) return { ok: false as const, result: fail('invalid') };
  const school = librarySchools(session).find((s) => s.id === args.data.schoolId);
  if (!school) return { ok: false as const, result: fail('forbidden') };
  if (!aiOn(session, school)) return { ok: false as const, result: fail('aiDisabled') };
  const supabase = await createSupabaseServerClient();

  // The base version must be complete (`final`) before the AI adapts it.
  const [item, base] = await Promise.all([
    supabase.from('library_items').select('type').eq('id', args.data.itemId).maybeSingle(),
    supabase
      .from('library_item_versions')
      .select('content')
      .eq('item_id', args.data.itemId)
      .is('language_level_id', null)
      .maybeSingle(),
  ]);
  if (!item.data || !isLibraryItemType(item.data.type)) {
    return { ok: false as const, result: fail('notFound') };
  }
  if (!base.data || !contentSchema(item.data.type, 'final').safeParse(base.data.content).success) {
    return { ok: false as const, result: fail('libraryNotReady') };
  }

  const { data, error } = await supabase.rpc('library_levels_ai_preview', {
    p_item_id: args.data.itemId,
    p_school_id: args.data.schoolId,
    p_level_ids: args.data.levelIds,
  });
  if (error) return { ok: false as const, result: fail(aiError('previewLibraryLevels', error)) };
  const input = libraryLevelsInputSchema.safeParse(data);
  if (!input.success) {
    reportError('previewLibraryLevels', {
      code: 'invalid_input',
      message: input.error.issues.map((i) => `${i.path.join('.')}:${i.code}`).join(','),
    });
    return { ok: false as const, result: fail('libraryInvalidContent') };
  }
  const redactor = new Redactor(await visiblePeople(supabase));
  const { input: sent, blocked } = libraryLevelsFeature.redactInput(input.data, redactor);
  const preview: LevelsPreview = {
    message: segmentMessage(libraryLevelsFeature.buildUserMessage(sent), redactor.replacements()),
    replaced: redactor.replacements().length,
    blocked: blocked.map((b) => ({ kind: b.kind, match: b.match })),
  };
  return { ok: true as const, supabase, args: args.data, preview };
}

/** « Vérifier avant d’envoyer » for the missing levels of a resource the teacher may edit. */
export async function previewLibraryLevels(
  itemId: string,
  schoolId: string,
  levelIds: string[],
): Promise<ActionResult<LevelsPreview>> {
  const prepared = await prepareLevels(itemId, schoolId, levelIds);
  if (!prepared.ok) return prepared.result;
  return ok(prepared.preview);
}

/** « Envoyer »: queues the request for the missing levels. */
export async function requestLibraryLevels(
  itemId: string,
  schoolId: string,
  levelIds: string[],
): Promise<ActionResult<{ jobId: string }>> {
  const prepared = await prepareLevels(itemId, schoolId, levelIds);
  if (!prepared.ok) return prepared.result;
  if (prepared.preview.blocked.length) return fail('personalInfo');
  const { data, error } = await prepared.supabase.rpc('request_library_levels', {
    p_item_id: prepared.args.itemId,
    p_school_id: prepared.args.schoolId,
    p_level_ids: prepared.args.levelIds,
  });
  if (error) return fail(aiError('requestLibraryLevels', error));
  revalidatePath(`/library/items/${prepared.args.itemId}`);
  return ok({ jobId: data });
}
