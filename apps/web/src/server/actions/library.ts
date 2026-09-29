'use server';

import {
  isLibraryItemType,
  reviewReadiness,
  type LibraryItemForm,
  type ReadinessBlockingCode,
} from '@lynx/content';
import type { Json, ShareScope } from '@lynx/db';
import { getLocale } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { fail, ok, okVoid, type ActionResult } from '@/lib/action-result';
import { visiblePeople } from '../ai-people';
import { readinessFieldErrors, reportError } from '../errors';
import type { EditorExpectation } from '../library/editor-context';
import { editorFormSchema, type LibraryEditorForm } from '../library/editor-form';
import { buildSavePayload, readinessErrors } from '../library/save-payload';
import {
  findPersonalInfo,
  guardVerdict,
  itemStrings,
  type GuardVerdict,
} from '../library/share-guard';
import { loadBoardLevelIds, loadExpectations } from '../queries/library-authoring';
import {
  aiSchools,
  librarySchools,
  requireSession,
  showLibrary,
  type SessionContext,
} from '../session';
import { createSupabaseServerClient, type ServerSupabase } from '../supabase';
import { parseInput } from './validation';

/**
 * Writing library resources and moving them through the workflow (DECISIONS D-063 to D-067,
 * D-079). The database decides everything (every write is a function that checks the user, the
 * status and the item's rules again); these actions add what it cannot do: the content schemas
 * (`@lynx/content`), the first-name guard (D-066), and the Library module (D-078).
 */

const uuid = z.uuid();
const namesSchema = z.array(z.string().trim().min(1).max(200)).max(200);

/** Where a resource shows: its page, its editor, « Mes ressources », the hub and the queue. */
function refreshItem(itemId: string) {
  revalidatePath(`/library/items/${itemId}`);
  revalidatePath(`/library/items/${itemId}/edit`);
  revalidatePath('/library/mine');
  revalidatePath('/library/review');
  revalidatePath('/library');
}

/** Library pages and actions need a library school or a reviewer designation (D-078). */
async function librarySession(): Promise<SessionContext | null> {
  const session = await requireSession();
  return showLibrary(session) ? session : null;
}

// ---------------------------------------------------------------------------------------
// Reading an item as the database stores it (for the guard and readiness)
// ---------------------------------------------------------------------------------------

interface StoredItem {
  id: string;
  boardId: string;
  schoolId: string | null;
  authorId: string | null;
  type: LibraryItemForm['type'];
  status: string;
  shareScope: ShareScope;
  contentRevision: number;
  /** An adaptation's original title as copied (D-092): colleagues see it, so the guard reads it. */
  parentTitle: string | null;
  /** In the save payload's shape, so the guard and readiness read it like a new save. */
  payload: LibraryItemForm;
}

async function loadStoredItem(
  supabase: ServerSupabase,
  itemId: string,
): Promise<StoredItem | null> {
  const { data } = await supabase
    .from('library_items')
    .select(
      'id, board_id, school_id, author_id, parent_title, type, title, summary, licence, subject_id, duration_minutes, materials, keywords, is_printable, is_projectable, is_interactive, sub_friendly, safety_notes, faith_content, faith_on_student_sheet, catholic_connection, catholic_reference_id, status, share_scope, content_revision, library_item_grades(grade_code), library_item_expectations(expectation_id), library_item_tags(tag_id), library_item_versions(language_level_id, content, library_item_answer_keys(answer_key))',
    )
    .eq('id', itemId)
    .maybeSingle();
  if (!data || !isLibraryItemType(data.type)) return null;
  return {
    id: data.id,
    boardId: data.board_id,
    schoolId: data.school_id,
    authorId: data.author_id,
    type: data.type,
    status: data.status,
    shareScope: data.share_scope,
    contentRevision: data.content_revision,
    parentTitle: data.parent_title,
    payload: {
      type: data.type,
      boardId: data.board_id,
      schoolId: data.school_id,
      title: data.title,
      summary: data.summary ?? '',
      licence: data.licence ?? '',
      subjectId: data.subject_id,
      gradeCodes: data.library_item_grades.map((g) => g.grade_code),
      expectationIds: data.library_item_expectations.map((e) => e.expectation_id),
      tagIds: data.library_item_tags.map((t) => t.tag_id),
      keywords: data.keywords ?? '',
      durationMinutes: data.duration_minutes,
      materials: data.materials ?? '',
      isPrintable: data.is_printable,
      isProjectable: data.is_projectable,
      isInteractive: data.is_interactive,
      subFriendly: data.sub_friendly,
      safetyNotes: data.safety_notes as LibraryItemForm['safetyNotes'],
      faithContent: data.faith_content,
      faithOnStudentSheet: data.faith_on_student_sheet,
      catholicConnection: data.catholic_connection ?? '',
      catholicReferenceId: data.catholic_reference_id,
      versions: data.library_item_versions.map((v) => ({
        languageLevelId: v.language_level_id,
        content: v.content as Record<string, unknown>,
        answerKey:
          (v.library_item_answer_keys?.answer_key as Record<string, unknown> | undefined) ?? null,
      })),
    },
  };
}

/**
 * The first-name guard (D-066) over a payload, with the students of the user's schools; and an
 * adaptation's original title as copied (`parentTitle`, D-092).
 */
async function runGuard(
  supabase: ServerSupabase,
  payload: LibraryItemForm,
  confirmedNames: readonly string[],
  parentTitle: string | null,
): Promise<GuardVerdict> {
  const people = await visiblePeople(supabase);
  const findings = findPersonalInfo(
    itemStrings({
      title: payload.title,
      parentTitle,
      summary: payload.summary,
      materials: payload.materials,
      keywords: payload.keywords,
      catholicConnection: payload.catholicConnection,
      safetyNotes: payload.safetyNotes,
      versions: payload.versions,
    }),
    people,
  );
  return guardVerdict(findings, confirmedNames);
}

/** A refusal of the guard: the names to confirm and the details to remove. */
export interface NamesCheck {
  names: string[];
  blocked: string[];
}

// ---------------------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------------------

export type SaveLibraryItemResult =
  | { status: 'saved'; itemId: string; contentRevision: number; savedAt: string }
  | ({ status: 'names' } & NamesCheck);

/**
 * « Enregistrer » (D-063). `expectedRevision` is the revision the form was edited from; null for
 * a new item, whose id the browser chose and keeps in its device draft. A create sent again after
 * a lost answer finds its item and saves over it. A reviewed item must stay ready (D-067), and a
 * shared one goes through the first-name guard first (D-066).
 */
export async function saveLibraryItem(
  itemId: string,
  expectedRevision: number | null,
  raw: LibraryEditorForm,
  confirmedNames: string[] = [],
): Promise<ActionResult<SaveLibraryItemResult>> {
  const session = await librarySession();
  if (!session) return fail('forbidden');
  if (!uuid.safeParse(itemId).success) return fail('invalid');
  if (expectedRevision !== null && !Number.isInteger(expectedRevision)) return fail('invalid');
  const parsedNames = namesSchema.safeParse(confirmedNames);
  if (!parsedNames.success) return fail('invalid');
  const parsed = parseInput(editorFormSchema, raw);
  if (!parsed.ok) return parsed.result;
  const built = buildSavePayload(parsed.data);
  if (!built.ok) return fail('libraryInvalidContent', built.fieldErrors);
  const payload = built.payload;

  const supabase = await createSupabaseServerClient();
  let revision = expectedRevision;
  const stored = await loadStoredItem(supabase, itemId);
  if (revision === null) {
    if (stored) {
      // The same create sent again: its first sending went through.
      if (stored.authorId !== session.userId) return fail('forbidden');
      revision = stored.contentRevision;
    } else if (
      !librarySchools(session).some(
        (s) => s.id === payload.schoolId && s.boardId === payload.boardId,
      )
    ) {
      // New resources are written for one of the user's library schools (D-078).
      return fail('forbidden');
    }
  }

  if (stored && revision !== null) {
    if (stored.type !== payload.type) return fail('invalid');
    if (stored.status === 'teacher_reviewed') {
      const errors = readinessErrors(payload, await loadBoardLevelIds(stored.boardId));
      if (Object.keys(errors).length) return fail('libraryNotReady', errors);
    }
    if (stored.shareScope !== 'private') {
      const verdict = await runGuard(supabase, payload, parsedNames.data, stored.parentTitle);
      if (!verdict.ok)
        return ok({ status: 'names', names: verdict.names, blocked: verdict.blocked });
    }
  }

  const { data, error } = await supabase.rpc('save_library_item', {
    p_item_id: itemId,
    // A retried create is saved as an update of what went through.
    p_expected_revision: revision as number,
    p_item: payload as unknown as Json,
  });
  if (error) return fail(reportError('saveLibraryItem', error), readinessFieldErrors(error));
  const row = data?.[0];
  if (!row) return fail('unexpected');
  refreshItem(itemId);
  return ok({
    status: 'saved',
    itemId: row.item_id,
    contentRevision: row.content_revision,
    savedAt: new Date().toISOString(),
  });
}

/** The attentes of grades and a subject, for the editor's picker when they change. */
export async function listExpectations(
  gradeCodes: string[],
  subjectId: string | null,
): Promise<ActionResult<EditorExpectation[]>> {
  const session = await librarySession();
  if (!session) return fail('forbidden');
  const input = z
    .object({ gradeCodes: z.array(z.string().max(4)).max(4), subjectId: z.uuid().nullable() })
    .safeParse({ gradeCodes, subjectId });
  if (!input.success) return fail('invalid');
  return ok(await loadExpectations(input.data.gradeCodes, input.data.subjectId, await getLocale()));
}

/**
 * Whether the item is the user's own text saved from « Texte différencié »: outside the library
 * (a school without the Library module), she can still delete those (D-073, D-078).
 */
async function isOwnSavedText(supabase: ServerSupabase, itemId: string, userId: string) {
  const { data } = await supabase
    .from('library_items')
    .select('id, ai_generations!inner(feature)')
    .eq('id', itemId)
    .eq('author_id', userId)
    .eq('source', 'ai_generated')
    .eq('ai_generations.feature', 'differentiate')
    .maybeSingle();
  return data !== null;
}

/**
 * « Supprimer »: the author's drafts, sent-back and archived resources (row level security).
 * Without library screens, only her own texts saved from « Texte différencié ».
 */
export async function deleteLibraryItem(itemId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!uuid.safeParse(itemId).success) return fail('forbidden');
  const supabase = await createSupabaseServerClient();
  if (
    !showLibrary(session) &&
    !(aiSchools(session).length > 0 && (await isOwnSavedText(supabase, itemId, session.userId)))
  ) {
    return fail('forbidden');
  }
  const { data, error } = await supabase
    .from('library_items')
    .delete()
    .eq('id', itemId)
    .select('id');
  if (error) return fail(reportError('deleteLibraryItem', error));
  if (!data?.length) return fail('forbidden');
  refreshItem(itemId);
  revalidatePath('/differentiate');
  return okVoid();
}

// ---------------------------------------------------------------------------------------
// The workflow (D-063, D-066, D-067)
// ---------------------------------------------------------------------------------------

/** Field errors of a readiness check, one per missing part (`readiness.<code>`). */
function readinessKeys(blocking: readonly { code: ReadinessBlockingCode }[]) {
  return Object.fromEntries(blocking.map((b) => [`readiness.${b.code}`, `readiness.${b.code}`]));
}

/**
 * « J'ai révisé cette ressource », with « Je confirme que ce contenu est original… ». The app
 * checks what SQL cannot (every version passes `final`, the keys are complete) before the
 * database checks the rest.
 */
export async function markReviewed(itemId: string, originality: boolean): Promise<ActionResult> {
  const session = await librarySession();
  if (!session || !uuid.safeParse(itemId).success) return fail('forbidden');
  if (originality !== true) return fail('invalid', { originality: 'required' });
  const supabase = await createSupabaseServerClient();
  const stored = await loadStoredItem(supabase, itemId);
  if (!stored) return fail('notFound');
  const readiness = reviewReadiness({
    item: {
      type: stored.type,
      gradeCodes: stored.payload.gradeCodes,
      subjectId: stored.payload.subjectId,
      durationMinutes: stored.payload.durationMinutes,
      materials: stored.payload.materials,
      keywords: stored.payload.keywords,
      tagIds: stored.payload.tagIds,
      expectationIds: stored.payload.expectationIds,
      safetyNotes: stored.payload.safetyNotes,
      subFriendly: stored.payload.subFriendly,
    },
    versions: stored.payload.versions,
    boardLevelIds: [],
    forApproval: false,
  });
  if (!readiness.ready) {
    // Safety notes have their own message (as the database's LXL02).
    const onlySafety = readiness.blocking.every((b) => b.code === 'safety');
    return fail(
      onlySafety ? 'librarySafetyNotes' : 'libraryNotReady',
      readinessKeys(readiness.blocking),
    );
  }
  const { error } = await supabase.rpc('library_mark_reviewed', {
    p_item_id: itemId,
    p_originality_confirmed: true,
  });
  if (error) return fail(reportError('markReviewed', error), readinessFieldErrors(error));
  refreshItem(itemId);
  return okVoid();
}

/** « Remettre en brouillon ». */
export async function returnToDraft(itemId: string): Promise<ActionResult> {
  return workflowCall('returnToDraft', itemId, 'library_return_to_draft');
}

export type GuardedResult = { done: true } | ({ done: false } & NamesCheck);

const scopeSchema = z.enum(['private', 'school', 'board']);

/**
 * « Partager » (D-066): the first-name guard answers with the names to confirm (« Ce n'est pas
 * un nom d'élève ») and the details to remove until every name is confirmed and nothing is
 * blocked; then `library_share`, which records how many names were confirmed.
 */
export async function shareItem(
  itemId: string,
  scope: ShareScope,
  schoolId: string | null,
  confirmedNames: string[],
): Promise<ActionResult<GuardedResult>> {
  const session = await librarySession();
  if (!session || !uuid.safeParse(itemId).success) return fail('forbidden');
  const input = z
    .object({ scope: scopeSchema, schoolId: z.uuid().nullable(), names: namesSchema })
    .safeParse({ scope, schoolId, names: confirmedNames });
  if (!input.success) return fail('invalid');
  if (input.data.schoolId && !librarySchools(session).some((s) => s.id === input.data.schoolId)) {
    return fail('forbidden');
  }
  const supabase = await createSupabaseServerClient();
  const stored = await loadStoredItem(supabase, itemId);
  if (!stored) return fail('notFound');
  let namesConfirmed = 0;
  if (input.data.scope !== 'private') {
    const verdict = await runGuard(supabase, stored.payload, input.data.names, stored.parentTitle);
    if (!verdict.ok) return ok({ done: false, names: verdict.names, blocked: verdict.blocked });
    namesConfirmed = verdict.namesConfirmed;
  }
  const { error } = await supabase.rpc('library_share', {
    p_item_id: itemId,
    p_scope: input.data.scope,
    ...(input.data.schoolId ? { p_school_id: input.data.schoolId } : {}),
    p_names_confirmed: namesConfirmed,
  });
  if (error) return fail(reportError('shareItem', error));
  refreshItem(itemId);
  return ok({ done: true });
}

/** « Proposer au conseil », after the first-name guard: reviewers of the board will read it. */
export async function requestApproval(
  itemId: string,
  confirmedNames: string[],
): Promise<ActionResult<GuardedResult>> {
  const session = await librarySession();
  if (!session || !uuid.safeParse(itemId).success) return fail('forbidden');
  const names = namesSchema.safeParse(confirmedNames);
  if (!names.success) return fail('invalid');
  const supabase = await createSupabaseServerClient();
  const stored = await loadStoredItem(supabase, itemId);
  if (!stored) return fail('notFound');
  const readiness = reviewReadiness({
    item: {
      type: stored.type,
      gradeCodes: stored.payload.gradeCodes,
      subjectId: stored.payload.subjectId,
      durationMinutes: stored.payload.durationMinutes,
      materials: stored.payload.materials,
      keywords: stored.payload.keywords,
      tagIds: stored.payload.tagIds,
      expectationIds: stored.payload.expectationIds,
      safetyNotes: stored.payload.safetyNotes,
      subFriendly: stored.payload.subFriendly,
    },
    versions: stored.payload.versions,
    boardLevelIds: await loadBoardLevelIds(stored.boardId),
    forApproval: true,
  });
  if (!readiness.ready) return fail('libraryNotReady', readinessKeys(readiness.blocking));
  const verdict = await runGuard(supabase, stored.payload, names.data, stored.parentTitle);
  if (!verdict.ok) return ok({ done: false, names: verdict.names, blocked: verdict.blocked });
  const { error } = await supabase.rpc('library_request_approval', { p_item_id: itemId });
  if (error) return fail(reportError('requestApproval', error), readinessFieldErrors(error));
  refreshItem(itemId);
  return ok({ done: true });
}

/** « Retirer la demande ». */
export async function cancelApproval(itemId: string): Promise<ActionResult> {
  return workflowCall('cancelApproval', itemId, 'library_cancel_request');
}

/** « Archiver »: out of the library for everyone, whatever its status. */
export async function archiveItem(itemId: string): Promise<ActionResult> {
  return workflowCall('archiveItem', itemId, 'library_archive');
}

/** « Restaurer »: an archived resource comes back as a private draft. */
export async function restoreItem(itemId: string): Promise<ActionResult> {
  return workflowCall('restoreItem', itemId, 'library_restore');
}

type SimpleWorkflowFunction =
  'library_return_to_draft' | 'library_cancel_request' | 'library_archive' | 'library_restore';

async function workflowCall(
  context: string,
  itemId: string,
  fn: SimpleWorkflowFunction,
): Promise<ActionResult> {
  const session = await librarySession();
  if (!session || !uuid.safeParse(itemId).success) return fail('forbidden');
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc(fn, { p_item_id: itemId });
  if (error) return fail(reportError(context, error));
  refreshItem(itemId);
  return okVoid();
}
