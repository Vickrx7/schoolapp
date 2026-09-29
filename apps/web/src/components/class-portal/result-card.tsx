'use client';

import { Check, CircleDashed, Eye, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '../../lib/utils';
import type { DeviceOkState } from '../../server/class-portal/schemas';

/**
 * What a device learns about its answer after « Afficher la réponse » (DECISIONS D-086): only its
 * own result (« Bonne réponse! +100 points » or « Pas cette fois. »), and only when the teacher
 * shows answers; otherwise « Réponse enregistrée ». Never the correct answer or the explanation:
 * the device does not have them. An icon and words say it, never a colour alone.
 */
export function ResultCard({ myAnswer }: { myAnswer: DeviceOkState['myAnswer'] }) {
  const t = useTranslations('classPortal');
  const result = myAnswer?.result ?? null;

  let tone: 'right' | 'wrong' | 'neutral' = 'neutral';
  let Icon = CircleDashed;
  let title = t('notAnswered');
  if (result) {
    tone = result.correct ? 'right' : 'wrong';
    Icon = result.correct ? Check : X;
    title = result.correct ? t('correct') : t('incorrect');
  } else if (myAnswer?.answered) {
    Icon = Check;
    title = t('recorded');
  }

  return (
    <div
      className={cn(
        'space-y-3 rounded-3xl border-4 px-6 py-6 text-center',
        tone === 'right' && 'border-emerald-800 bg-emerald-50 text-emerald-950',
        tone === 'wrong' && 'border-slate-700 bg-slate-100 text-slate-950',
        tone === 'neutral' && 'border-slate-300 bg-white text-slate-950',
      )}
    >
      <p className="flex items-center justify-center gap-3 text-[36px] leading-tight font-bold">
        <Icon aria-hidden className="size-12 shrink-0" strokeWidth={3} />
        {title}
      </p>
      {result && result.points > 0 ? (
        <p className="text-[30px] font-bold tabular-nums">
          {t('points', { points: result.points })}
        </p>
      ) : null}
      {result ? (
        <p className="flex items-center justify-center gap-2 text-[22px] text-slate-800">
          <Eye aria-hidden className="size-7 shrink-0" />
          {t('seeScreen')}
        </p>
      ) : null}
    </div>
  );
}
