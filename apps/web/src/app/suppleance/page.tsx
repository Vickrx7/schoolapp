import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { CodeForm } from '@/components/sub-portal/code-form';
import { ForgetReportDrafts } from '@/components/sub-portal/forget-report-drafts';
import { Notice } from '@/components/ui/card';
import { subPortalConfigured } from '@/server/sub-portal/db';
import { subCodeKeys } from '@/server/sub-portal/keys';
import { readSubToken } from '@/server/sub-portal/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('subPortal');
  return { title: t('title') };
}

/**
 * « Accès suppléance »: one field for the code. A texted link carries the code in the URL
 * fragment (…/suppleance#code=…), which never reaches the server; the form copies it into the
 * field, removes it from the address bar and waits for « Commencer » (never redeemed on its own).
 */
export default async function PortalAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ ended?: string; done?: string }>;
}) {
  const { ended, done } = await searchParams;
  const t = await getTranslations('subPortal');
  const tLegal = await getTranslations('legal');
  const configured = subPortalConfigured() && subCodeKeys() !== null;
  const signedIn = configured && !ended && !done && (await readSubToken()) !== null;

  return (
    <div className="mx-auto max-w-md space-y-4 py-4">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">{t('title')}</h1>
      {/* The access ended: the report kept in this tab goes too (it is on the server). */}
      {ended || done ? <ForgetReportDrafts /> : null}
      {ended ? <Notice tone="warning">{t('ended')}</Notice> : null}
      {done ? <Notice tone="success">{t('done')}</Notice> : null}
      {!configured ? (
        <Notice tone="warning">{t('notConfigured')}</Notice>
      ) : (
        <>
          {signedIn ? (
            <Notice className="space-y-1">
              <p>{t('signedIn')}</p>
              <Link
                href="/suppleance/plan"
                className="inline-flex min-h-11 items-center font-medium underline underline-offset-2"
              >
                {t('openPlan')}
              </Link>
            </Notice>
          ) : null}
          <p className="text-slate-600">{t('intro')}</p>
          <CodeForm />
          {/* One line, no click-through (D-110). */}
          <p className="text-sm text-slate-600" data-testid="portal-privacy-line">
            {tLegal('portalNotice')}
          </p>
        </>
      )}
    </div>
  );
}
