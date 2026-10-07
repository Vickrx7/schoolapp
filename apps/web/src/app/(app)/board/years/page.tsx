import { localDateIn } from '@lynx/domain';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { BoardHeader } from '@/components/board/board-header';
import { YearsEditor } from '@/components/board/years-editor';
import { loadBoardYears, requireBoardPage } from '@/server/queries/board';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('board.years');
  return { title: t('title') };
}

/** « Années scolaires » (DECISIONS D-107). */
export default async function BoardYearsPage({
  searchParams,
}: {
  searchParams: Promise<{ board?: string }>;
}) {
  const { board: requested } = await searchParams;
  const page = await requireBoardPage(requested);
  const t = await getTranslations('board.years');
  const years = await loadBoardYears(page.board.id);

  return (
    <div>
      <BoardHeader
        title={t('title')}
        board={page.board}
        boards={page.boards}
        query={page.query}
        library={page.library}
        path="/board/years"
      />
      <p className="mb-4 text-sm text-slate-600">{t('intro')}</p>
      <YearsEditor
        boardId={page.board.id}
        years={years}
        today={localDateIn(page.basics.timezone)}
      />
    </div>
  );
}
