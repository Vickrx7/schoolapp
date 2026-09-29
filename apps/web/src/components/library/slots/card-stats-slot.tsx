import type { LibraryCardView } from '@/server/library/view-model';

export interface CardStatsSlotProps {
  card: LibraryCardView;
}

/**
 * A result card's opinions and usage (DECISIONS D-093, slice S4): « ★ 4,5 sur 5 (7 avis) » and
 * « Utilisée dans 12 unités », from the stats the search loads for the page of results in one
 * call. Rendered by `item-card.tsx` under the badges. Renders nothing until S4 fills it.
 */
export function CardStatsSlot(_props: CardStatsSlotProps) {
  return null;
}
