import type { LibraryItemView } from '@/server/library/view-model';
import { loadLineage } from '@/server/queries/library-growth';
import { Lineage } from '../growth/lineage';

export interface LineageSlotProps {
  item: LibraryItemView;
}

/**
 * The credit line of an adaptation on the item page and in its editor (DECISIONS D-092):
 * « Adaptée de « Le huard, oiseau des lacs » (Conseil scolaire) », the direct parent only, names
 * read live (`server/library/lineage-view.ts`). Rendered on the server right under the header,
 * for library users only; nothing for an item that is not an adaptation.
 */
export async function LineageSlot({ item }: LineageSlotProps) {
  if (!item.adaptation.isAdaptation) return null;
  const view = await loadLineage(item.id);
  return view ? <Lineage view={view} /> : null;
}
