'use client';

import { ArrowLeft, MonitorUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

/**
 * The projector pages need a landscape screen at least 768 px wide (DECISIONS D-090). Below that
 * (a phone, a tablet held upright) the layout shows this instead of the page, with a way back:
 * the projector shell has no navigation.
 */
export function NarrowNotice() {
  const t = useTranslations('classPresenter');
  const router = useRouter();
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 py-8 text-center">
      <MonitorUp aria-hidden className="size-12 text-brand-700" />
      <p className="text-xl font-semibold text-slate-900">{t('narrow')}</p>
      <p className="text-slate-700">{t('narrowHint')}</p>
      <Button
        variant="secondary"
        onClick={() => (window.history.length > 1 ? router.back() : router.push('/library'))}
      >
        <ArrowLeft aria-hidden />
        {t('back')}
      </Button>
    </div>
  );
}
