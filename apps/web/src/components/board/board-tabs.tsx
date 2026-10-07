'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ScrollingTabs } from '@/components/app/scrolling-tabs';
import { cn } from '@/lib/utils';

const TABS = [
  { key: 'overview', href: '/board' },
  { key: 'staff', href: '/board/staff' },
  { key: 'schools', href: '/board/schools' },
  { key: 'years', href: '/board/years' },
  { key: 'reviewers', href: '/board/reviewers' },
  { key: 'usage', href: '/board/usage' },
  { key: 'feedback', href: '/board/feedback' },
  // The board's view of « Journal d'audit » (D-103), always for this board.
  { key: 'audit', href: '/audit' },
] as const;

/**
 * The sections of « Administration du conseil » (DECISIONS D-107). The row scrolls sideways on
 * phones, as a class's tabs do: the current section is scrolled into view, and a fade with an
 * arrow at either edge says more sections are that way. « Approbation des ressources » only when
 * a school of the board has the Library module. `query` keeps the chosen board (`?board=`) when
 * there are several; « Journal d'audit » always names the board (a person who also directs a
 * school would otherwise open their school's log).
 */
export function BoardTabs({
  query,
  library,
  boardId,
}: {
  query: string;
  library: boolean;
  boardId: string;
}) {
  const t = useTranslations('board.tabs');
  const pathname = usePathname();
  const tabs = TABS.filter((tab) => library || tab.key !== 'reviewers');
  return (
    <ScrollingTabs label={t('label')} testId="board-tabs" className="mb-5">
      <ul className="flex gap-1">
        {tabs.map((tab) => {
          const active =
            pathname === tab.href || (tab.href !== '/board' && pathname.startsWith(`${tab.href}/`));
          return (
            <li key={tab.key}>
              <Link
                href={tab.key === 'audit' ? `/audit?board=${boardId}` : `${tab.href}${query}`}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center border-b-2 border-transparent px-3 text-sm font-medium whitespace-nowrap text-slate-600 hover:text-slate-900',
                  active && 'border-brand-600 text-brand-700',
                )}
              >
                {t(tab.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </ScrollingTabs>
  );
}
