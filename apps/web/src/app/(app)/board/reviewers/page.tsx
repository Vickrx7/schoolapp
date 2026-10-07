import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { BoardHeader } from '@/components/board/board-header';
import { ReviewersEditor } from '@/components/board/reviewers-editor';
import { EmptyState } from '@/components/ui/page';
import { loadReviewers, requireBoardPage } from '@/server/queries/board';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('board.reviewers');
  return { title: t('title') };
}

/** « Approbation des ressources » (DECISIONS D-064, D-107): only with the Library module. */
export default async function BoardReviewersPage({
  searchParams,
}: {
  searchParams: Promise<{ board?: string }>;
}) {
  const { board: requested } = await searchParams;
  const page = await requireBoardPage(requested);
  const t = await getTranslations('board.reviewers');
  const data = page.library ? await loadReviewers(page.board.id) : null;

  return (
    <div>
      <BoardHeader
        title={t('title')}
        board={page.board}
        boards={page.boards}
        query={page.query}
        library={page.library}
        path="/board/reviewers"
      />
      {data ? (
        <>
          <p className="mb-4 text-sm text-slate-600">{t('intro')}</p>
          <ReviewersEditor
            reviewers={data.reviewers}
            candidates={data.candidates.map((c) => ({
              roleId: c.roleId,
              displayName: c.displayName,
            }))}
          />
        </>
      ) : (
        <EmptyState title={t('noLibrary')} />
      )}
    </div>
  );
}
