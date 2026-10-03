import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { BoardChecklist } from '@/components/board/board-checklist';
import { BoardHeader } from '@/components/board/board-header';
import { RetentionCard } from '@/components/board/retention-card';
import { SystemStatusCard } from '@/components/board/system-status-card';
import { loadBoardOverview, requireBoardPage } from '@/server/queries/board';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('board');
  return { title: t('title') };
}

/**
 * « Administration du conseil » (DECISIONS D-107, D-112): the landing page of a board admin who
 * neither teaches nor directs (D-118). What the board still has to set up, the system's state and
 * how long its data is kept; the sections are in the tabs.
 */
export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ board?: string }>;
}) {
  const { board: requested } = await searchParams;
  const page = await requireBoardPage(requested, { landing: true });
  const t = await getTranslations('board');
  const overview = await loadBoardOverview(page.basics, page.query);

  return (
    <div>
      <BoardHeader
        title={t('title')}
        board={page.board}
        boards={page.boards}
        query={page.query}
        library={page.library}
        path="/board"
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <BoardChecklist items={overview.checklist} />
        <div className="space-y-4">
          <SystemStatusCard
            status={overview.status}
            timezone={page.basics.timezone}
            now={new Date()}
          />
          <RetentionCard retention={page.board.settings.retention} />
        </div>
      </div>
    </div>
  );
}
