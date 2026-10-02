import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { BoardHeader } from '@/components/board/board-header';
import { InviteDialog } from '@/components/board/invite-dialog';
import { InvitationList, StaffList } from '@/components/board/staff-list';
import { EmptyState } from '@/components/ui/page';
import { loadBoardStaff, requireBoardPage } from '@/server/queries/board';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('board.staff');
  return { title: t('title') };
}

/** « Personnel » (DECISIONS D-107): the board's people, open invitations, « Inviter une personne ». */
export default async function BoardStaffPage({
  searchParams,
}: {
  searchParams: Promise<{ board?: string }>;
}) {
  const { board: requested } = await searchParams;
  const page = await requireBoardPage(requested);
  const t = await getTranslations('board.staff');
  const staff = await loadBoardStaff(page.basics);

  return (
    <div>
      <BoardHeader
        title={t('title')}
        board={page.board}
        boards={page.boards}
        query={page.query}
        library={page.library}
        path="/board/staff"
        actions={
          <InviteDialog
            boardId={page.board.id}
            schools={page.basics.schools.map((s) => ({ id: s.id, name: s.name }))}
            query={page.query}
          />
        }
      />
      <div className="space-y-6">
        {staff.invitations.length > 0 ? (
          <section aria-labelledby="board-invitations" className="space-y-2">
            <h2 id="board-invitations" className="font-semibold text-slate-900">
              {t('invitations')}
            </h2>
            <p className="text-sm text-slate-600">{t('invitationsHint')}</p>
            <InvitationList invitations={staff.invitations} query={page.query} />
          </section>
        ) : null}
        <section aria-labelledby="board-people" className="space-y-2">
          <h2 id="board-people" className="font-semibold text-slate-900">
            {t('people')}
          </h2>
          <p className="text-sm text-slate-600">{t('intro')}</p>
          {staff.people.length > 0 ? (
            <StaffList people={staff.people} query={page.query} />
          ) : (
            <EmptyState title={t('empty')} />
          )}
        </section>
      </div>
    </div>
  );
}
