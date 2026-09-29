'use server';

import { isLibraryItemType } from '@lynx/content';
import { z } from 'zod';
import { fail, ok, type ActionResult } from '@/lib/action-result';
import { isPresentable, presenterAnswer, type PresenterAnswer } from '../class-mode/presenter';
import { reportError } from '../errors';
import { librarySchools, requireSession } from '../session';
import { createSupabaseServerClient } from '../supabase';

/**
 * « Afficher la réponse » on the projector (DECISIONS D-082, D-086). The presenter page carries
 * no answer: when the teacher asks, this reads the version's key as the teacher (row level
 * security decides, as on the item page's « Guide et corrigé ») and returns only that question's
 * answer and explanation, for a question the presentation shows on a question slide. Never the
 * other questions' answers, the worked solution or the rest of the key. Nothing is written or
 * audited: keys hold no personal data, and the teacher can already read this one.
 */

const inputSchema = z.object({
  itemId: z.uuid(),
  versionId: z.uuid(),
  // Question ids are short (`kit.id`); anything longer is not one.
  questionId: z.string().min(1).max(60),
});

export async function revealPresenterAnswer(
  itemId: string,
  versionId: string,
  questionId: string,
): Promise<ActionResult<PresenterAnswer | null>> {
  const session = await requireSession();
  if (!librarySchools(session).length) return fail('forbidden');
  const input = inputSchema.safeParse({ itemId, versionId, questionId });
  if (!input.success) return fail('invalid');

  const supabase = await createSupabaseServerClient();
  const [version, key] = await Promise.all([
    supabase
      .from('library_item_versions')
      .select(
        'id, schema_version, content, library_items!inner(type, status, share_scope, author_id, is_projectable)',
      )
      .eq('id', input.data.versionId)
      .eq('item_id', input.data.itemId)
      .maybeSingle(),
    supabase
      .from('library_item_answer_keys')
      .select('answer_key, library_item_versions!inner(item_id)')
      .eq('version_id', input.data.versionId)
      .eq('library_item_versions.item_id', input.data.itemId)
      .maybeSingle(),
  ]);
  if (version.error || key.error) {
    return fail(reportError('revealPresenterAnswer', version.error ?? key.error));
  }
  const item = version.data?.library_items;
  if (!version.data || !item || !isLibraryItemType(item.type)) return fail('notFound');
  const presentable = isPresentable({
    type: item.type,
    projectable: item.is_projectable,
    status: item.status,
    shareScope: item.share_scope,
    mine: item.author_id !== null && item.author_id === session.userId,
  });
  if (!presentable) return fail('notFound');

  return ok(
    presenterAnswer(
      item.type,
      { schemaVersion: version.data.schema_version, content: version.data.content },
      key.data?.answer_key ?? null,
      input.data.questionId,
    ),
  );
}
