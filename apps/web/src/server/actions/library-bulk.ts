'use server';

import { isLibraryItemType, reviewReadiness, type ReadinessBlockingCode } from '@lynx/content';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { fail, ok, okVoid, type ActionResult } from '@/lib/action-result';
import { readinessFieldErrors, reportError } from '../errors';
import { loadBoardLevelIds } from '../queries/library-authoring';
import { requireSession } from '../session';
import { createSupabaseServerClient, type ServerSupabase } from '../supabase';

/**
 * The board's drafts from bulk generation (DECISIONS D-091, D-095): « Approuver pour le conseil »
 * in one step and « Supprimer le brouillon », for the board's content reviewers. The database
 * checks who may do it and every step (`public.library_approve_board_draft`: reviewed with the
 * originality box, proposed, approved on the revision the reviewer read; row level security for
 * deleting); the app adds what SQL cannot check, the content schemas and keys (D-067).
 */

const idSchema = z.uuid();

async function contentReviewer() {
  const session = await requireSession();
  return session.libraryReviewer.some((r) => r.approvesContent) ? session : null;
}

function refresh(itemId: string) {
  revalidatePath(`/library/items/${itemId}`);
  revalidatePath('/library/review');
  revalidatePath('/library');
}

/** A board draft as its readiness reads it (null when the user cannot read it). */
async function loadDraft(supabase: ServerSupabase, itemId: string) {
  const { data } = await supabase
    .from('library_items')
    .select(
      'id, board_id, board_owned, type, subject_id, duration_minutes, materials, keywords, safety_notes, sub_friendly, library_item_grades(grade_code), library_item_expectations(expectation_id), library_item_tags(tag_id), library_item_versions(language_level_id, content, library_item_answer_keys(answer_key))',
    )
    .eq('id', itemId)
    .maybeSingle();
  if (!data || !data.board_owned || !isLibraryItemType(data.type)) return null;
  return {
    boardId: data.board_id,
    item: {
      type: data.type,
      gradeCodes: data.library_item_grades.map((g) => g.grade_code),
      subjectId: data.subject_id,
      durationMinutes: data.duration_minutes,
      materials: data.materials,
      keywords: data.keywords,
      tagIds: data.library_item_tags.map((t) => t.tag_id),
      expectationIds: data.library_item_expectations.map((e) => e.expectation_id),
      safetyNotes: data.safety_notes,
      subFriendly: data.sub_friendly,
    },
    versions: data.library_item_versions.map((v) => ({
      languageLevelId: v.language_level_id,
      content: v.content,
      answerKey: v.library_item_answer_keys?.answer_key ?? null,
    })),
  };
}

/** Field errors of a readiness check, one per missing part (`readiness.<code>`). */
function readinessKeys(blocking: readonly { code: ReadinessBlockingCode }[]) {
  return Object.fromEntries(blocking.map((b) => [`readiness.${b.code}`, `readiness.${b.code}`]));
}

export type BoardDraftApproval = 'approved' | 'faith_review';

/**
 * « Approuver pour le conseil » for a board draft, on the revision the reviewer read: approved
 * and board-wide (`approved`), or, for faith content, proposed and waiting for its faith review
 * (`faith_review`).
 */
export async function approveBoardDraft(
  itemId: string,
  revision: number,
  originality: boolean,
): Promise<ActionResult<BoardDraftApproval>> {
  if (!(await contentReviewer())) return fail('forbidden');
  const input = z
    .object({ itemId: idSchema, revision: z.number().int().min(1) })
    .safeParse({ itemId, revision });
  if (!input.success) return fail('invalid');
  if (originality !== true) return fail('invalid', { originality: 'required' });
  const supabase = await createSupabaseServerClient();
  const draft = await loadDraft(supabase, itemId);
  if (!draft) return fail('notFound');
  const readiness = reviewReadiness({
    item: draft.item,
    versions: draft.versions,
    boardLevelIds: await loadBoardLevelIds(draft.boardId),
    forApproval: true,
  });
  if (!readiness.ready) {
    const onlySafety = readiness.blocking.every((b) => b.code === 'safety');
    return fail(
      onlySafety ? 'librarySafetyNotes' : 'libraryNotReady',
      readinessKeys(readiness.blocking),
    );
  }
  const { data, error } = await supabase.rpc('library_approve_board_draft', {
    p_item_id: input.data.itemId,
    p_expected_revision: input.data.revision,
    p_originality_confirmed: true,
  });
  if (error) return fail(reportError('approveBoardDraft', error), readinessFieldErrors(error));
  refresh(itemId);
  return ok(data === 'faith_review' ? 'faith_review' : 'approved');
}

/** « Supprimer le brouillon »: a board draft (draft, sent back or archived), with its versions. */
export async function deleteBoardDraft(itemId: string): Promise<ActionResult> {
  if (!(await contentReviewer())) return fail('forbidden');
  if (!idSchema.safeParse(itemId).success) return fail('invalid');
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('library_items')
    .delete()
    .eq('id', itemId)
    .eq('board_owned', true)
    .select('id');
  if (error) return fail(reportError('deleteBoardDraft', error));
  if (!data?.length) return fail('forbidden');
  refresh(itemId);
  return okVoid();
}
