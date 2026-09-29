import type { LibraryItemView } from '@/server/library/view-model';

export interface LineageSlotProps {
  item: LibraryItemView;
}

/**
 * The credit line of an adaptation on the item page (DECISIONS D-092, slice S4): « Adaptée de
 * « Le huard, oiseau des lacs » (Conseil scolaire) », the direct parent only, names read live
 * (`server/library/lineage-view.ts`). Rendered on the server right under the header, for library
 * users only. Renders nothing until S4 fills it.
 */
export function LineageSlot(_props: LineageSlotProps) {
  return null;
}
