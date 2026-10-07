'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useErrorReference } from '@/hooks/use-error-reference';

/**
 * Something failed on a class device's page: say so in French and offer to try again. Only the
 * `classPortal` and `problemReport` messages exist on this surface (D-090). The reference lets
 * the teacher match a report to the server's log (D-111); the report holds no page text.
 * Students have no account: « Signaler le problème » tells them to show the reference to their
 * teacher, who can send it with « Commentaires » (D-116).
 */
export default function JouerError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('classPortal');
  const tReport = useTranslations('problemReport');
  const reference = useErrorReference(error);
  const [help, setHelp] = useState(false);
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
      <p className="text-base text-slate-600" data-testid="error-reference">
        {t('errorReference', { ref: reference })}
      </p>
      {help ? (
        <p role="status" className="text-[22px] text-slate-800">
          {tReport('deviceHelp', { ref: reference })}
        </p>
      ) : (
        <button
          type="button"
          onClick={() => setHelp(true)}
          className="inline-flex min-h-16 items-center justify-center rounded-2xl px-6 text-[22px] font-bold text-slate-950 underline underline-offset-4 focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-slate-950"
        >
          {tReport('deviceButton')}
        </button>
      )}
    </div>
  );
}
