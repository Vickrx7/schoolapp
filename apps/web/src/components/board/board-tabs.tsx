'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
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
  const nav = useRef<HTMLElement>(null);
  const [more, setMore] = useState({ before: false, after: false });

  useEffect(() => {
    const row = nav.current;
    if (!row) return;
    // The current section in the middle of the row (the page itself does not move).
    const active = row.querySelector<HTMLElement>('[aria-current="page"]');
    if (active) {
      row.scrollLeft = active.offsetLeft - (row.clientWidth - active.offsetWidth) / 2;
    }
    const update = () =>
      setMore({
        before: row.scrollLeft > 1,
        after: row.scrollLeft + row.clientWidth < row.scrollWidth - 1,
      });
    update();
    row.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      row.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [pathname]);

  const edge =
    'pointer-events-none absolute inset-y-0 z-10 flex w-10 items-center text-slate-500 md:hidden';
  return (
    <div className="relative -mx-4 mb-5">
      {more.before ? (
        <span
          className={cn(edge, 'left-0 justify-start bg-gradient-to-r from-slate-50 pl-1')}
          aria-hidden
          data-testid="board-tabs-more-before"
        >
          <ChevronLeft className="size-4" />
        </span>
      ) : null}
      {more.after ? (
        <span
          className={cn(edge, 'right-0 justify-end bg-gradient-to-l from-slate-50 pr-1')}
          aria-hidden
          data-testid="board-tabs-more-after"
        >
          <ChevronRight className="size-4" />
        </span>
      ) : null}
      <nav
        ref={nav}
        className="relative overflow-x-auto border-b border-slate-200 px-4"
        aria-label={t('label')}
      >
        <ul className="flex gap-1">
          {tabs.map((tab) => {
            const active =
              pathname === tab.href ||
              (tab.href !== '/board' && pathname.startsWith(`${tab.href}/`));
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
      </nav>
    </div>
  );
}
