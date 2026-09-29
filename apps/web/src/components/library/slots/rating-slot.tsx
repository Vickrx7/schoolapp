import { getTranslations } from 'next-intl/server';
import type { LibraryItemView } from '@/server/library/view-model';
import { canGiveOpinion, opinionSummary } from '@/server/library/growth';
import { loadItemStats } from '@/server/queries/library-growth';
import { OpinionLine } from '../growth/card-stats';
import { RatingStars } from '../growth/rating-stars';

export interface RatingSlotProps {
  item: LibraryItemView;
}

/**
 * « Votre avis » on the item page (DECISIONS D-093): on a board-approved resource, the opinion
 * line (« ★ 4,5 sur 5 (7 avis) » from 5 opinions, or « 3 avis : pas encore assez pour une
 * moyenne »), and anonymous stars when the user did not write it (her own resource shows its
 * colleagues' opinions only). Rendered on the server below the versions and tabs, for library
 * users only; nothing for other resources (they take no opinion) or one the user cannot use.
 */
export async function RatingSlot({ item }: RatingSlotProps) {
  if (item.status !== 'board_approved') return null;
  const stats = await loadItemStats(item.id);
  const summary = opinionSummary(stats);
  if (!stats || !summary) return null;
  const t = await getTranslations('libraryGrowth.opinion');
  const rate = canGiveOpinion({ status: item.status, mine: item.mine });
  const headingId = `opinion-${item.id}`;
  return (
    <section
      aria-labelledby={headingId}
      className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm print:hidden"
    >
      <h2 id={headingId} className="text-base font-semibold text-slate-900">
        {rate ? t('title') : t('colleagues')}
      </h2>
      <OpinionLine summary={summary} />
      {rate ? (
        <RatingStars itemId={item.id} initial={stats.myRating} labelledBy={headingId} />
      ) : null}
    </section>
  );
}
