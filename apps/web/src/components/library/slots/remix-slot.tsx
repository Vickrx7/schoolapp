import type { LibraryItemView } from '@/server/library/view-model';

export interface RemixSlotProps {
  item: LibraryItemView;
}

/**
 * « Adapter cette ressource » on the item page (DECISIONS D-092, slice S4): a private copy with
 * lineage and credit, for items the user can use that are not archived and whose licence allows
 * it. Rendered on the server in the item page's action row, next to « Ajouter à ma
 * planification », for library users only. Renders nothing until S4 fills it.
 */
export function RemixSlot(_props: RemixSlotProps) {
  return null;
}
