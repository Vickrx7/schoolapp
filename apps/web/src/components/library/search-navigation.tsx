'use client';

import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useTransition,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';

interface SearchNavigationValue {
  /**
   * Replaces the address with another search (no new history entry, no scroll). `optimistic`
   * runs in the same transition, so a control can show its new state (`useOptimistic`) until the
   * results arrive.
   */
  navigate: (href: string, optimistic?: () => void) => void;
  /** A search is on its way: the results on screen are the previous ones. */
  pending: boolean;
}

const SearchNavigationContext = createContext<SearchNavigationValue | null>(null);

/**
 * The library's search lives in the address (`/library?q=…&type=…`): the search field, the
 * filters and « Afficher plus » change it here, in one transition, so the server renders the new
 * results while the old ones stay on screen (marked busy) and the search field keeps its focus.
 */
export function SearchNavigation({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const navigate = useCallback(
    (href: string, optimistic?: () => void) =>
      startTransition(() => {
        optimistic?.();
        router.replace(href, { scroll: false });
      }),
    [router],
  );
  const value = useMemo(() => ({ navigate, pending }), [navigate, pending]);
  return (
    <SearchNavigationContext.Provider value={value}>{children}</SearchNavigationContext.Provider>
  );
}

export function useSearchNavigation(): SearchNavigationValue {
  const value = useContext(SearchNavigationContext);
  if (!value) throw new Error('useSearchNavigation needs <SearchNavigation>');
  return value;
}

/** Results that are being replaced: dimmed and `aria-busy` until the new ones arrive. */
export function PendingRegion({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { pending } = useSearchNavigation();
  return (
    <div
      aria-busy={pending}
      className={cn('transition-opacity', pending && 'opacity-60', className)}
    >
      {children}
    </div>
  );
}
