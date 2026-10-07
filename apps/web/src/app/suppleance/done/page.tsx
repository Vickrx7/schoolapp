import { ClipboardCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { EndDayButton } from '@/components/sub-portal/end-day-button';
import { Button } from '@/components/ui/button';
import { requireSubDay } from '@/server/sub-portal/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('subPortal');
  return { title: t('doneTitle') };
}

/**
 * « Merci! »: the end of the substitute's day, after « Envoyer le suivi ». « Terminer ma
 * journée » ends this device's session, so a phone left behind no longer opens the plan. While
 * the report is not sent, sending it is the main action and ending the day asks first.
 */
export default async function PortalDonePage() {
  const day = await requireSubDay('poll');
  const t = await getTranslations('subPortal');
  const tReport = await getTranslations('subReport');
  const sent = day.context.reportStatus === 'submitted' || day.context.reportStatus === 'confirmed';
  return (
    <div className="mx-auto max-w-md space-y-4 py-6 text-center">
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">{t('doneTitle')}</h1>
      <p className="text-slate-700">{t('doneBody')}</p>
      <p className="text-slate-700" data-testid="report-status">
        {sent ? tReport('doneSent') : tReport('doneNotSent')}
      </p>
      <p className="text-sm text-slate-600">{t('endDayHint')}</p>
      <div className="flex flex-col items-center gap-2">
        {sent ? (
          <>
            <EndDayButton reportSent />
            <Link
              href="/suppleance/report"
              className="inline-flex min-h-11 items-center text-sm text-brand-700 underline underline-offset-2"
            >
              {tReport('edit')}
            </Link>
          </>
        ) : (
          <>
            <Button asChild size="lg">
              <Link href="/suppleance/report">
                <ClipboardCheck aria-hidden />
                {tReport('open')}
              </Link>
            </Button>
            <EndDayButton reportSent={false} />
          </>
        )}
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
