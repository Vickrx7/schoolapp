'use client';

import { PartyPopper } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { GameOver as GameOverReason } from './use-class-state';

/**
 * The end of the game for this device: « La partie est terminée. Merci! » (the session ended) or
 * « Cette partie est terminée pour toi. Merci! » (the teacher ended the session, which deletes
 * every device, or removed this one). « Rejoindre une autre partie » opens the join page again
 * as a new document, so nothing of this game stays in the page.
 */
export function GameOver({ reason }: { reason: GameOverReason }) {
  const t = useTranslations('classPortal');
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-8 text-center">
      <PartyPopper aria-hidden className="size-20 text-slate-800" />
      <h2 tabIndex={-1} className="text-[36px] leading-tight font-bold text-slate-950">
        {reason === 'gone' ? t('gone') : t('ended')}
      </h2>
      <a
        href="/jouer"
        className="inline-flex min-h-16 items-center justify-center rounded-2xl border-2 border-slate-950 bg-white px-8 text-[24px] font-bold text-slate-950 focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-slate-950"
      >
        {t('joinAnother')}
      </a>
    </div>
  );
}
