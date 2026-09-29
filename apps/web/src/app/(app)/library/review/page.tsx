import type { Metadata } from 'next';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/card';
import { EmptyState, PageHeader } from '@/components/ui/page';
import { cn } from '@/lib/utils';
import { loadReviewQueues, type ReviewQueueRow } from '@/server/queries/library-authoring';
import { loadLibrarySearchOptions } from '@/server/queries/library-search';
import { requireSession } from '@/server/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('libraryReview');
  return { title: t('title') };
}

type Queue = 'content' | 'faith';

/**
 * « Approbation des ressources » (DECISIONS D-064): for the board's designated reviewers, the
 * resources proposed to the board (« À approuver ») and, for faith reviewers, those whose faith
 * content waits for its review (« Contenu de foi »), oldest request first. Each row opens the
 * resource, where the « Décision » panel is. Not found for everyone else.
 */
export default async function ReviewQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ queue?: string | string[] }>;
}) {
  const session = await requireSession();
  if (!session.libraryReviewer.length) notFound();
  const locale = await getLocale();
  const [t, tc, format, queues, options, query] = await Promise.all([
    getTranslations('libraryReview'),
    getTranslations('libraryCommon'),
    getFormatter(),
    loadReviewQueues(session),
    loadLibrarySearchOptions(session, locale),
    searchParams,
  ]);
  const available: Queue[] = [
    ...(queues.content ? (['content'] as const) : []),
    ...(queues.faith ? (['faith'] as const) : []),
  ];
  const wanted = Array.isArray(query.queue) ? query.queue[0] : query.queue;
  const queue: Queue = available.find((q) => q === wanted) ?? available[0] ?? 'content';
  const rows: ReviewQueueRow[] = (queue === 'faith' ? queues.faith : queues.content) ?? [];
  const gradeLabel = (code: string) => options.grades.find((g) => g.code === code)?.label ?? code;
  const date = (instant: string) =>
    format.dateTime(new Date(instant), { day: 'numeric', month: 'short' });

  return (
    <div className="space-y-5">
      <PageHeader
        back={
          <Link
            href="/library"
            className="inline-flex min-h-11 items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
          >
            {t('back')}
          </Link>
        }
        title={t('title')}
        subtitle={t('intro')}
      />

      {available.length > 1 ? (
        <nav aria-label={t('queuesLabel')}>
          <ul className="flex flex-wrap gap-2">
            {available.map((q) => (
              <li key={q}>
                <Link
                  href={`/library/review?queue=${q}`}
                  aria-current={q === queue ? 'page' : undefined}
                  className={cn(
                    'inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium',
                    q === queue
                      ? 'border-brand-600 bg-brand-50 text-brand-800'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
                  )}
                >
                  {t(`queues.${q}`, {
                    count: (q === 'faith' ? queues.faith : queues.content)?.length ?? 0,
                  })}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      <section aria-labelledby="review-queue">
        <h2
          id="review-queue"
          className={available.length > 1 ? 'sr-only' : 'mb-3 text-base font-semibold'}
        >
          {t(`queues.${queue}`, { count: rows.length })}
        </h2>
        {rows.length === 0 ? (
          <EmptyState title={t(`empty.${queue}`)} />
        ) : (
          <ul className="space-y-3">
            {rows.map((row) => (
              <li key={row.itemId}>
                <article className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    <Badge tone="brand">{tc(`types.${row.type}`)}</Badge>
                    {row.gradeCodes.length ? (
                      <span>{row.gradeCodes.map(gradeLabel).join(', ')}</span>
                    ) : null}
                    {row.requiresFaithReview ? (
                      <Badge tone={row.faithReviewed ? 'success' : 'warning'}>
                        {row.faithReviewed ? t('faithReviewed') : tc('badges.faith')}
                      </Badge>
                    ) : null}
                    {row.safety ? <Badge tone="warning">{t('safety')}</Badge> : null}
                  </p>
                  <h3 className="text-base font-semibold text-slate-900">
                    <Link
                      href={`/library/items/${row.itemId}`}
                      className="flex min-h-11 items-center hover:text-brand-700 hover:underline"
                    >
                      {row.title}
                    </Link>
                  </h3>
                  <p className="text-sm text-slate-600">
                    {row.authorName
                      ? [row.authorName, row.schoolName].filter(Boolean).join(' · ')
                      : t('boardItem')}
                    {' · '}
                    {t('requestedOn', { date: date(row.requestedAt) })}
                  </p>
                </article>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
