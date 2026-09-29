import type { SessionContext } from '@/server/session';

export interface ReviewBoardDraftsSlotProps {
  session: SessionContext;
}

/**
 * The tab « Brouillons du conseil (IA) » of « Approbation des ressources » (DECISIONS D-095 to
 * D-097, slice S6): the board drafts of bulk generation runs, grouped by run with the run's
 * summary line (« Lot du 3 novembre : 42 créées · 3 titres semblables… ») and « Titre semblable
 * à une ressource existante » badges, for the board's content reviewers.
 *
 * `boardDraftsQueue` tells the review page whether to show the tab (null: no tab) and its count;
 * `ReviewBoardDraftsSlot` is the tab's content, rendered on the server when it is chosen
 * (`/library/review?queue=drafts`). Both stay empty until S6 fills them.
 */
export async function boardDraftsQueue(
  _session: SessionContext,
): Promise<{ count: number } | null> {
  return null;
}

export async function ReviewBoardDraftsSlot(_props: ReviewBoardDraftsSlotProps) {
  return null;
}
