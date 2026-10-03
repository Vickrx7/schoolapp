'use client';

import { Star } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAction } from '@/hooks/use-action';
import { cn } from '@/lib/utils';
import { rateItem } from '@/server/actions/library-growth';

/** Keys and arrows move through the stars: wait this long after the last move before saving. */
const SAVE_DELAY_MS = 350;

/**
 * « Votre avis » (DECISIONS D-093): five stars as a labelled radio group (« 4 étoiles sur 5 »),
 * each a 44 px target, and « Retirer mon avis ». A choice is saved on its own (the last one
 * when the arrows move through several), then the page's opinion line follows. The choice stays
 * on screen if saving fails (the error says so); the opinion is anonymous (no one sees who gave
 * it).
 */
export function RatingStars({
  itemId,
  initial,
  labelledBy,
}: {
  itemId: string;
  initial: number | null;
  /** The id of the heading that names the stars (« Votre avis »). */
  labelledBy: string;
}) {
  const t = useTranslations('libraryGrowth.opinion');
  const router = useRouter();
  const hintId = useId();
  const [value, setValue] = useState<number | null>(initial);
  const [status, setStatus] = useState('');
  const rate = useAction(rateItem);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const save = (next: number | null, delay = SAVE_DELAY_MS) => {
    setValue(next);
    setStatus('');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void rate.run(itemId, next).then((result) => {
        if (!result?.ok) return;
        setStatus(next === null ? t('cleared') : t('saved'));
        router.refresh();
      });
    }, delay);
  };

  return (
    <div className="space-y-2">
      <p id={hintId} className="text-sm text-slate-600">
        {t('hint')}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="radiogroup"
          aria-labelledby={labelledBy}
          aria-describedby={hintId}
          className="flex gap-1"
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <span key={n} className="relative inline-flex size-11 items-center justify-center">
              <input
                type="radio"
                name={`opinion-${itemId}`}
                value={n}
                checked={value === n}
                onChange={() => save(n)}
                aria-label={t('star', { n })}
                className="absolute inset-0 size-full cursor-pointer appearance-none rounded-lg hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              />
              <Star
                aria-hidden
                className={cn(
                  'pointer-events-none relative size-7',
                  value !== null && n <= value ? 'fill-amber-400 text-amber-700' : 'text-slate-500',
                )}
              />
            </span>
          ))}
        </div>
        {value !== null ? (
          <Button variant="ghost" disabled={rate.pending} onClick={() => save(null, 0)}>
            {t('clear')}
          </Button>
        ) : null}
      </div>
      <p role="status" aria-live="polite" className="min-h-5 text-sm text-slate-600">
        {status}
      </p>
    </div>
  );
}
