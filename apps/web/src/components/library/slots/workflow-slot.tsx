import type { LibraryItemView } from '@/server/library/view-model';

/**
 * The item page's workflow panel (slice S6): the readiness checklist « Avant de marquer comme
 * révisée », « J’ai révisé cette ressource », « Partager », « Proposer au conseil », « Remettre
 * en brouillon », « Archiver » / « Restaurer », « Supprimer », and for reviewers the « Décision »
 * panel (D-063, D-064). Rendered on the server under the header, before the versions and tabs.
 * The page already shows the status badges, « Modifier » (when `item.canEdit`), the AI draft
 * notice, « En attente d’approbation depuis le … » and the reviewer's note (« À retravailler :
 * … ») to the item's keeper and reviewers. Returns nothing until S6 fills it.
 */
export function WorkflowSlot(_props: { item: LibraryItemView }) {
  return null;
}
