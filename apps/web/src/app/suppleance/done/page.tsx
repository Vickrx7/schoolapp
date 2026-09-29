import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { EndDayButton } from '@/components/sub-portal/end-day-button';
import { requireSubDay } from '@/server/sub-portal/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('subPortal');
  return { title: t('doneTitle') };
}

/**
 * « Merci! »: the end of the substitute's day. « Terminer ma journée » ends this device's
 * session, so a phone left behind no longer opens the plan.
 */
export default async function PortalDonePage() {
  await requireSubDay('poll');
  const t = await getTranslations('subPortal');
  return (
    <div className="mx-auto max-w-md space-y-4 py-6 text-center">
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">{t('doneTitle')}</h1>
      <p className="text-slate-700">{t('doneBody')}</p>
      <p className="text-sm text-slate-600">{t('endDayHint')}</p>
      <div className="flex flex-col items-center gap-2">
        <EndDayButton />
        <Link
          href="/suppleance/plan"
          className="inline-flex min-h-11 items-center text-sm text-brand-700 underline underline-offset-2"
        >
          {t('planTitle')}
        </Link>
      </div>
    </div>
  );
}
