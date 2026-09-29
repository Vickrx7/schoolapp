import type { LibraryItemView } from '@/server/library/view-model';

export interface RatingSlotProps {
  item: LibraryItemView;
}

/**
 * « Votre avis » on the item page (DECISIONS D-093, slice S4): anonymous stars on board-approved
 * items the user did not write, with « ★ 4,5 sur 5 (7 avis) » from 5 opinions, or « 3 avis : pas
 * encore assez pour une moyenne ». Rendered on the server below the versions and tabs, for
 * library users only. Renders nothing until S4 fills it.
 */
export function RatingSlot(_props: RatingSlotProps) {
  return null;
}
