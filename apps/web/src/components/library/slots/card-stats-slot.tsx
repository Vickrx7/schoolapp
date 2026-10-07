import type { LibraryCardView } from '@/server/library/view-model';
import { CardStats } from '../growth/card-stats';

export interface CardStatsSlotProps {
  card: LibraryCardView;
}

/**
 * A result card's opinions and usage (DECISIONS D-093): « ★ 4,5 sur 5 (7 avis) » and
 * « Utilisée dans 12 unités », from the stats the search loads for the page of results in one
 * call (`loadCardStats`). Rendered by `item-card.tsx` under the badges; nothing when the stats
 * could not be loaded.
 */
export function CardStatsSlot({ card }: CardStatsSlotProps) {
  return <CardStats stats={card.stats} />;
}
