'use client';

import type { EnglishState } from '@lynx/domain';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

/**
 * How a paragraph's English stands (DECISIONS D-137), in words (never colour alone):
 * « English : à écrire », « préparé par l'application », « traduit par l'IA — à relire »,
 * « à mettre à jour (le français a changé) », « écrit par vous ». Nothing for an empty paragraph.
 */
export function EnglishStatus({ state }: { state: EnglishState }) {
  const t = useTranslations('newsletter.editor.englishState');
  if (state === 'none') return <span />;
  const attention = state === 'missing' || state === 'stale' || state === 'ai';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        attention ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-700',
      )}
      data-testid="english-status"
    >
      {t(state)}
    </span>
  );
}
