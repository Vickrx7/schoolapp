'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A row of tabs that scrolls sideways on phones (« Administration du conseil », a class's tabs):
 * the current tab (`aria-current="page"`) is scrolled into the middle of the row (the page itself
 * does not move), and a fade with an arrow at either edge says more tabs are that way.
 */
export function ScrollingTabs({
  label,
  testId,
  className,
  children,
}: {
  label: string;
  /** `<testId>-more-before` and `<testId>-more-after` on the edges. */
  testId: string;
  /** The outer box (its margins). */
  className?: string;
  /** The tabs' list. */
  children: ReactNode;
}) {
  const pathname = usePathname();
  const nav = useRef<HTMLElement>(null);
  const [more, setMore] = useState({ before: false, after: false });

  useEffect(() => {
    const row = nav.current;
    if (!row) return;
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
    <div className={cn('relative -mx-4', className)}>
      {more.before ? (
        <span
          className={cn(edge, 'left-0 justify-start bg-gradient-to-r from-slate-50 pl-1')}
          aria-hidden
          data-testid={`${testId}-more-before`}
        >
          <ChevronLeft className="size-4" />
        </span>
      ) : null}
      {more.after ? (
        <span
          className={cn(edge, 'right-0 justify-end bg-gradient-to-l from-slate-50 pr-1')}
          aria-hidden
          data-testid={`${testId}-more-after`}
        >
          <ChevronRight className="size-4" />
        </span>
      ) : null}
      <nav
        ref={nav}
        className="relative overflow-x-auto border-b border-slate-200 px-4"
        aria-label={label}
      >
        {children}
      </nav>
    </div>
  );
}
