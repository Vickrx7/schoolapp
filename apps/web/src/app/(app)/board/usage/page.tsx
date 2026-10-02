import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { BoardHeader } from '@/components/board/board-header';
import { UsageTable } from '@/components/board/usage-table';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/page';
import { formatLocalDate } from '@/lib/format';
import { monthOrCurrent, shiftMonth } from '@/lib/month';
import { loadBoardUsage, requireBoardPage } from '@/server/queries/board';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('board.usage');
  return { title: t('title') };
}

/**
 * « Utilisation de l'IA » (DECISIONS D-104): requests, failures and cost per school for a month
 * (`?month=YYYY-MM`, the board's current month by default), and the CSV. Budgets stay IP Lynx's
 * (D-040); nobody's own use is shown.
 */
export default async function BoardUsagePage({
  searchParams,
}: {
  searchParams: Promise<{ board?: string; month?: string }>;
}) {
  const { board: requested, month: requestedMonth } = await searchParams;
  const page = await requireBoardPage(requested);
  const t = await getTranslations('board.usage');
  const locale = await getLocale();
  const month = monthOrCurrent(requestedMonth, page.basics.timezone);
  const rows = await loadBoardUsage(page.basics, month);
  const label = formatLocalDate(`${month}-01`, locale, { month: 'long', year: 'numeric' });
  const link = (m: string) =>
    `/board/usage?month=${m}${page.query ? `&${page.query.slice(1)}` : ''}`;
  const exportHref = `/board/usage/export?month=${month}&board=${page.board.id}`;

  return (
    <div>
      <BoardHeader
        title={t('title')}
        board={page.board}
        boards={page.boards}
        query={page.query}
        library={page.library}
        path="/board/usage"
      />
      <p className="mb-4 text-sm text-slate-600">{t('intro')}</p>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button asChild variant="ghost" size="icon">
            <Link href={link(shiftMonth(month, -1))} aria-label={t('previous')}>
              <ChevronLeft aria-hidden />
            </Link>
          </Button>
          <h2 className="min-w-40 text-center font-semibold text-slate-900 capitalize">{label}</h2>
          <Button asChild variant="ghost" size="icon">
            <Link href={link(shiftMonth(month, 1))} aria-label={t('next')}>
              <ChevronRight aria-hidden />
            </Link>
          </Button>
        </div>
        {/* A plain link: the browser downloads the file. */}
        <Button asChild variant="secondary">
          <a href={exportHref} download>
            <Download aria-hidden />
            {t('download')}
          </a>
        </Button>
      </div>
      {rows.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <UsageTable rows={rows} monthLabel={label} />
      )}
      <p className="mt-3 text-sm text-slate-600">{t('costNote')}</p>
    </div>
  );
}
