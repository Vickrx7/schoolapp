import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { EmptyState } from '@/components/ui/page';
import {
  MAX_PAGES,
  clearFilters,
  hasFilters,
  itemHref,
  libraryHref,
  withChanges,
  type LibrarySearch,
} from '@/server/library/search-params';
import type { AttachTarget } from '@/server/library/view-model';
import type { LibrarySearchResult } from '@/server/queries/library-search';
import { ItemCard } from './item-card';
import { LoadMore } from './load-more';

/**
 * The number of results, as a polite live region: it is announced each time the search or a
 * filter changes (« 12 ressources »). Stays in place from one search to the next.
 */
export function ResultCount({ total }: { total: number }) {
  const t = useTranslations('library.results');
  return (
    <div>
      <p role="status" className="font-semibold text-slate-900 tabular-nums">
        {t('count', { count: total })}
      </p>
      <p className="text-sm text-slate-600">{t('order')}</p>
    </div>
  );
}

/**
 * The results (D-068): cards in the search's order (board-approved first), then « Afficher
 * plus » while there are more. With no result, an empty state that says why when it can
 * (kindergarten has no resources in the pilot, D-069) and offers « Effacer les filtres ».
 */
export function ResultList({
  result,
  search,
  gradeLabels,
  attachTo,
}: {
  result: LibrarySearchResult;
  search: LibrarySearch;
  gradeLabels: ReadonlyMap<string, string>;
  attachTo: AttachTarget | null;
}) {
  const t = useTranslations('library');
  const shown = result.cards.length;

  if (!shown) {
    const body =
      search.grade === 'K1' || search.grade === 'K2'
        ? t('empty.kindergarten')
        : search.mine && !search.q && facetless(search)
          ? t('empty.mine')
          : t('empty.body');
    return (
      <EmptyState
        title={t('empty.title')}
        body={body}
        action={
          hasFilters(search) ? (
            <Link
              href={libraryHref(clearFilters(search))}
              className="inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-medium text-brand-700 ring-1 ring-slate-300 ring-inset hover:bg-slate-50"
            >
              {t('filters.clear')}
            </Link>
          ) : null
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <ol className="grid gap-3 sm:grid-cols-2">
        {result.cards.map((card, index) => (
          <ItemCard
            key={card.id}
            card={card}
            href={itemHref(card.id, search)}
            index={index}
            gradeLabels={gradeLabels}
            attachTo={attachTo}
          />
        ))}
      </ol>
      {shown < result.total ? (
        search.page < MAX_PAGES ? (
          <LoadMore
            href={libraryHref(withChanges(search, { page: search.page + 1 }))}
            shown={shown}
            total={result.total}
          />
        ) : (
          <p className="text-center text-sm text-slate-600">{t('refine')}</p>
        )
      ) : null}
    </div>
  );
}

/** « Mes ressources » with nothing else chosen. */
function facetless(search: LibrarySearch) {
  return (
    !search.grade &&
    !search.subject &&
    !search.strand &&
    !search.exp &&
    !search.types.length &&
    !search.buckets.length &&
    !search.dur &&
    !search.fmt.length &&
    !search.sub &&
    !search.approved &&
    !search.level
  );
}
