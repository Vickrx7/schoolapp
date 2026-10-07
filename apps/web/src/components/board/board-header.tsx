import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page';
import type { AdminBoard } from '@/server/queries/board';
import { BoardTabs } from './board-tabs';

/**
 * The top of every « Conseil » page: its title, the board (a picker when the person administers
 * several: a plain GET form, no script needed) and the sections.
 */
export async function BoardHeader({
  title,
  board,
  boards,
  query,
  library,
  path,
  actions,
  back,
}: {
  title: string;
  board: AdminBoard;
  boards: AdminBoard[];
  query: string;
  library: boolean;
  /** This page, for the picker's form. */
  path: string;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  const t = await getTranslations('board');
  return (
    <>
      <PageHeader
        title={title}
        subtitle={boards.length > 1 ? undefined : board.name}
        actions={actions}
        back={back}
      />
      {boards.length > 1 ? (
        <form method="get" action={path} className="mb-4 flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 space-y-1.5 sm:max-w-sm">
            <span className="block text-sm font-medium text-slate-700">{t('boardPicker')}</span>
            <Select name="board" defaultValue={board.id}>
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </label>
          <Button type="submit" variant="secondary">
            {t('showBoard')}
          </Button>
        </form>
      ) : null}
      <BoardTabs query={query} library={library} boardId={board.id} />
    </>
  );
}
