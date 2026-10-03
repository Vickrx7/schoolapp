import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { PackBadge } from '@/components/library/packs/pack-badge';
import { Badge } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/page';
import {
  loadBoardDraftRuns,
  loadBoardDraftsQueue,
  loadOtherBoardDrafts,
} from '@/server/queries/library-bulk';
import { loadLibrarySearchOptions } from '@/server/queries/library-search';
import type { SessionContext } from '@/server/session';

export interface ReviewBoardDraftsSlotProps {
  session: SessionContext;
}

/**
 * The tab « Brouillons du conseil » of « Approbation des ressources » (DECISIONS D-095 to D-097,
 * D-100): the board drafts of the most recent bulk generation runs, grouped by run with the run's
 * summary line (« Lot du 3 novembre : 42 créées · 3 titres semblables… ») and « Titre semblable à
 * une ressource existante » badges, then « Autres brouillons du conseil » (e.g. a content pack's
 * resources imported before they were ready, with the pack's badge), for the board's content
 * reviewers. Each draft opens its page, where « Approuver pour le conseil » and « Supprimer le
 * brouillon » are.
 *
 * `boardDraftsQueue` tells the review page whether to show the tab (null: nothing to show, no tab)
 * and its count (drafts still to review); `ReviewBoardDraftsSlot` is the tab's content, rendered
 * on the server when it is chosen (`/library/review?queue=drafts`).
 */
export async function boardDraftsQueue(session: SessionContext): Promise<{ count: number } | null> {
  return loadBoardDraftsQueue(session);
}

export async function ReviewBoardDraftsSlot({ session }: ReviewBoardDraftsSlotProps) {
  const locale = await getLocale();
  const [runs, others, t, tc, format, options] = await Promise.all([
    loadBoardDraftRuns(session),
    loadOtherBoardDrafts(session),
    getTranslations('libraryBulk'),
    getTranslations('libraryCommon'),
    getFormatter(),
    loadLibrarySearchOptions(session, locale),
  ]);
  if (!runs?.length && !others?.length) return <EmptyState title={t('empty')} />;
  const gradeLabel = (code: string) => options.grades.find((g) => g.code === code)?.label ?? code;
  const date = (instant: string) =>
    format.dateTime(new Date(instant), { day: 'numeric', month: 'long', year: 'numeric' });
  const usd = (amount: number) =>
    format.number(amount, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-700">{t('intro')}</p>
      {(runs ?? []).map((run) => (
        <section
          key={run.id}
          aria-labelledby={`run-${run.id}`}
          className="space-y-3"
          data-testid="board-draft-run"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`run-${run.id}`} className="text-base font-semibold text-slate-900">
              {run.summary
                ? t('runSummary', {
                    date: date(run.createdAt),
                    created: run.summary.created,
                    similar: run.summary.similarTitles,
                    failed: run.summary.failed,
                    spent: usd(run.summary.spentUsd),
                    max: usd(run.summary.maxCostUsd),
                  })
                : t('runPending', { date: date(run.createdAt) })}
            </h3>
            {run.status === 'cancelled' || run.status === 'failed' ? (
              <Badge tone="warning">{t(`runStatus.${run.status}`)}</Badge>
            ) : null}
          </div>
          {run.drafts.length === 0 ? (
            <p className="text-sm text-slate-600">{t('drafts', { count: 0 })}</p>
          ) : (
            <>
              <p className="text-sm text-slate-600">{t('drafts', { count: run.drafts.length })}</p>
              <ul className="space-y-3">
                {run.drafts.map((draft) => (
                  <li key={draft.itemId}>
                    <article className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <p className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                        <Badge tone="brand">{tc(`types.${draft.type}`)}</Badge>
                        {draft.gradeCodes.length ? (
                          <span>{draft.gradeCodes.map(gradeLabel).join(', ')}</span>
                        ) : null}
                        <Badge>
                          {draft.requested ? t('requested') : tc(`status.${draft.status}`)}
                        </Badge>
                        {draft.similarTitle ? (
                          <Badge tone="warning">{t('similarTitle')}</Badge>
                        ) : null}
                        {draft.studentName ? (
                          <Badge tone="warning">{t('studentName')}</Badge>
                        ) : null}
                      </p>
                      <h4 className="text-base font-semibold text-slate-900">
                        <Link
                          href={`/library/items/${draft.itemId}`}
                          className="flex min-h-11 items-center hover:text-brand-700 hover:underline"
                        >
                          {draft.title}
                        </Link>
                      </h4>
                    </article>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      ))}
      {others?.length ? (
        <section aria-labelledby="other-board-drafts" className="space-y-3">
          <h3 id="other-board-drafts" className="text-base font-semibold text-slate-900">
            {t('others.title')}
          </h3>
          <p className="text-sm text-slate-600">{t('others.hint')}</p>
          <p className="text-sm text-slate-600">{t('drafts', { count: others.length })}</p>
          <ul className="space-y-3">
            {others.map((draft) => (
              <li key={draft.itemId}>
                <article className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    <Badge tone="brand">{tc(`types.${draft.type}`)}</Badge>
                    {draft.gradeCodes.length ? (
                      <span>{draft.gradeCodes.map(gradeLabel).join(', ')}</span>
                    ) : null}
                    <Badge>{tc(`status.${draft.status}`)}</Badge>
                    <PackBadge pack={draft.pack ?? undefined} />
                  </p>
                  <h4 className="text-base font-semibold text-slate-900">
                    <Link
                      href={`/library/items/${draft.itemId}`}
                      className="flex min-h-11 items-center hover:text-brand-700 hover:underline"
                    >
                      {draft.title}
                    </Link>
                  </h4>
                </article>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
