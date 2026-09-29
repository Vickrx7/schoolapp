import type { LibraryItemView } from '@/server/library/view-model';

/**
 * « Créer les versions manquantes avec l’IA » on the item page (slice S8, D-073): for the
 * item's editors, when the type has levels and some board levels have no version yet. Rendered
 * on the server right under the version picker. Returns nothing until S8 fills it.
 */
export function LevelsAiSlot(_props: { item: LibraryItemView }) {
  return null;
}
