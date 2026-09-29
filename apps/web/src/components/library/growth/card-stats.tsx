import { Star, StarHalf, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import {
  opinionSummary,
  starFill,
  type ItemStats,
  type OpinionSummary,
} from '@/server/library/growth';

/**
 * The opinion line (DECISIONS D-093): « ★ 4,5 sur 5 (7 avis) » from 5 opinions, rounded to the
 * half star; « 3 avis : pas encore assez pour une moyenne » below; « Aucun avis pour l’instant »
 * with none. The stars are decoration: the text says it all.
 */
export function OpinionLine({
  summary,
  className,
}: {
  summary: OpinionSummary;
  className?: string;
}) {
  const t = useTranslations('libraryGrowth.opinion');
  return (
    <p
      className={cn(
        'flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-700',
        className,
      )}
    >
      {summary.kind === 'average' ? (
        <>
          <span className="inline-flex text-amber-700" aria-hidden>
            {starFill(summary.average).map((fill, i) =>
              fill === 'half' ? (
                <StarHalf key={i} className="size-4 fill-amber-400" />
              ) : (
                <Star key={i} className={cn('size-4', fill === 'full' && 'fill-amber-400')} />
              ),
            )}
          </span>
          <span className="tabular-nums">
            {t('average', { average: summary.average, count: summary.count })}
          </span>
        </>
      ) : summary.kind === 'notEnough' ? (
        <span>{t('notEnough', { count: summary.count })}</span>
      ) : (
        <span>{t('none')}</span>
      )}
    </p>
  );
}

/**
 * A result card's opinions and usage: the opinion line of a board-approved resource, then
 * « Utilisée dans 12 unités ». Nothing when the stats could not be loaded.
 */
export function CardStats({ stats }: { stats: ItemStats | null | undefined }) {
  const t = useTranslations('libraryGrowth');
  if (!stats) return null;
  const summary = opinionSummary(stats);
  return (
    <div className="space-y-0.5 text-sm text-slate-700">
      {summary && summary.kind !== 'none' ? <OpinionLine summary={summary} /> : null}
      <p className="flex items-center gap-2 tabular-nums">
        <Users className="size-4 shrink-0 text-slate-500" aria-hidden />
        {t('usage', { count: stats.usageCount })}
      </p>
    </div>
  );
}
