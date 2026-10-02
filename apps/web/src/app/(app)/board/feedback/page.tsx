import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { BoardHeader } from '@/components/board/board-header';
import { FeedbackList } from '@/components/board/feedback-list';
import { EmptyState } from '@/components/ui/page';
import { cn } from '@/lib/utils';
import {
  FEEDBACK_STATUSES,
  loadFeedback,
  requireBoardPage,
  type FeedbackStatus,
} from '@/server/queries/board';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('board.feedback');
  return { title: t('title') };
}

/** « Commentaires reçus » (DECISIONS D-116): the pilot feedback of the board's people. */
export default async function BoardFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ board?: string; status?: string }>;
}) {
  const { board: requested, status: requestedStatus } = await searchParams;
  const page = await requireBoardPage(requested);
  const t = await getTranslations('board.feedback');
  const status = FEEDBACK_STATUSES.find((s) => s === requestedStatus) ?? null;
  const items = await loadFeedback(page.basics, status);
  const href = (s: FeedbackStatus | null) => {
    const params = new URLSearchParams();
    if (s) params.set('status', s);
    if (page.query) params.set('board', page.board.id);
    const text = params.toString();
    return `/board/feedback${text ? `?${text}` : ''}`;
  };

  return (
    <div>
      <BoardHeader
        title={t('title')}
        board={page.board}
        boards={page.boards}
        query={page.query}
        library={page.library}
        path="/board/feedback"
      />
      <p className="mb-4 text-sm text-slate-600">{t('intro')}</p>
      <nav aria-label={t('filter')} className="mb-4">
        <ul className="flex flex-wrap gap-2">
          {[null, ...FEEDBACK_STATUSES].map((s) => (
            <li key={s ?? 'all'}>
              <Link
                href={href(s)}
                aria-current={s === status ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium ring-1 ring-slate-300 ring-inset',
                  s === status
                    ? 'bg-brand-600 text-white ring-brand-600'
                    : 'bg-white text-slate-700',
                )}
              >
                {s ? t(`statuses.${s}`) : t('all')}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {items.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <FeedbackList items={items} timeZone={page.basics.timezone} />
      )}
    </div>
  );
}
