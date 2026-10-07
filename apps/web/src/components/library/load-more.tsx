'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useSearchNavigation } from './search-navigation';

/**
 * « Afficher plus »: 24 more results, kept in the address (`page`) so a reload or « Précédent »
 * comes back to the same list. The focus then moves to the first new result, so keyboard and
 * screen reader users carry on where the list grew.
 */
export function LoadMore({ href, shown, total }: { href: string; shown: number; total: number }) {
  const t = useTranslations('library');
  const { navigate, pending } = useSearchNavigation();
  // The index of the first result to focus once it is on screen.
  const [focusFrom, setFocusFrom] = useState<number | null>(null);

  useEffect(() => {
    if (focusFrom === null || shown <= focusFrom) return;
    document
      .querySelector<HTMLElement>(`[data-result-index="${focusFrom}"] h3 a`)
      ?.focus({ preventScroll: false });
    // Once: a later change of the list must not move the focus again.
    const done = setTimeout(() => setFocusFrom(null), 0);
    return () => clearTimeout(done);
  }, [focusFrom, shown]);

  return (
    <div className="flex flex-col items-center gap-2 pt-2">
      <p className="text-sm text-slate-600 tabular-nums">{t('shown', { shown, total })}</p>
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() => {
          setFocusFrom(shown);
          navigate(href);
        }}
      >
        {t('loadMore')}
      </Button>
    </div>
  );
}
