import { Clock, MousePointerClick, Presentation, Printer } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Badge } from '@/components/ui/card';
import type { LibraryResultCard } from '@/server/queries/library-search';
import type { AttachTarget } from '@/server/library/view-model';
import { ItemBadges } from './item-badges';
import { CardActionsSlot } from './slots/card-actions-slot';
import { CardStatsSlot } from './slots/card-stats-slot';

const FORMAT_ICONS = {
  printable: Printer,
  projectable: Presentation,
  interactive: MousePointerClick,
} as const;

/**
 * A search result (D-068): the type, the title (a link to « Fiche de la ressource », 44 px tall,
 * that keeps the search for the way back), grades and
 * duration, the summary, the badges as text (« Approuvée par le conseil », « Suppléance »,
 * « 4 niveaux » or « Version de base seulement », « IA », « Foi »; the workflow status too on
 * the user's own items) and the formats. The card's actions (« Joindre à cette leçon ») are the
 * card actions slot's; its opinions and usage are the card stats slot's.
 */
export function ItemCard({
  card,
  href,
  gradeLabels,
  attachTo,
  index,
}: {
  card: LibraryResultCard;
  /** The item page, with the search it was found with (`itemHref`). */
  href: string;
  /** Grade code → « 3e année ». */
  gradeLabels: ReadonlyMap<string, string>;
  attachTo: AttachTarget | null;
  /** Its place in the results (« Afficher plus » moves the focus to the first new card). */
  index: number;
}) {
  const t = useTranslations('library');
  const tc = useTranslations('libraryCommon');
  const grades = card.gradeCodes.map((code) => gradeLabels.get(code) ?? code).join(', ');
  const formats = (Object.keys(FORMAT_ICONS) as (keyof typeof FORMAT_ICONS)[]).filter(
    (f) => card.formats[f],
  );

  return (
    <li data-result-index={index}>
      <article className="flex h-full flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
          <Badge tone="brand">{tc(`types.${card.type}`)}</Badge>
          <span>{tc(`buckets.${card.bucket}`)}</span>
        </p>
        <h3 className="text-base leading-snug font-semibold break-words text-slate-900">
          <Link
            href={href}
            className="flex min-h-11 items-center hover:text-brand-700 hover:underline"
          >
            {card.title}
          </Link>
        </h3>
        {grades || card.durationMinutes ? (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
            {grades ? <span>{grades}</span> : null}
            {card.durationMinutes ? (
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Clock className="size-4" aria-hidden />
                {tc('duration.minutes', { count: card.durationMinutes })}
              </span>
            ) : null}
          </p>
        ) : null}
        {card.summary ? (
          <p className="line-clamp-3 text-sm break-words text-slate-700">{card.summary}</p>
        ) : null}
        <ItemBadges
          withStatus={card.mine}
          input={{
            type: card.type,
            status: card.status,
            requested: card.requested,
            source: card.source,
            subFriendly: card.subFriendly,
            requiresFaithReview: card.requiresFaithReview,
            levelCount: card.levelIds.length,
          }}
        />
        {/* Opinions and « Utilisée dans N unités » (Phase 5, D-093). */}
        <CardStatsSlot card={card} />
        {formats.length ? (
          <ul aria-label={t('card.formats')} className="mt-auto flex flex-wrap gap-3 pt-1">
            {formats.map((f) => {
              const Icon = FORMAT_ICONS[f];
              return (
                <li key={f} className="inline-flex items-center gap-1 text-xs text-slate-600">
                  <Icon className="size-4" aria-hidden />
                  {tc(`formats.${f}`)}
                </li>
              );
            })}
          </ul>
        ) : null}
        <CardActionsSlot card={card} attachTo={attachTo} />
      </article>
    </li>
  );
}
