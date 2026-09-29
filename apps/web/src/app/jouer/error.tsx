'use client';

import { useTranslations } from 'next-intl';

/**
 * Something failed on a class device's page: say so in French and offer to try again. Only the
 * `classPortal` messages exist on this surface (D-090).
 */
export default function JouerError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations('classPortal');
  return (
    <div className="mx-auto max-w-xl space-y-6 py-12 text-center">
      <h1 className="text-[36px] font-bold text-slate-950">{t('errorTitle')}</h1>
      <p className="text-[24px] text-slate-800">{t('errorBody')}</p>
      <button
        type="button"
        onClick={reset}
        className="inline-flex min-h-16 items-center justify-center rounded-2xl bg-slate-950 px-8 text-[24px] font-bold text-white focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-slate-950"
      >
        {t('retry')}
      </button>
    </div>
  );
}
