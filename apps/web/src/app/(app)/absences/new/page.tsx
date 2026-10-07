import { ChevronLeft } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AbsenceForm } from '@/components/absences/absence-form';
import { FAITH_COOKIE } from '@/components/absences/types';
import { Notice } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page';
import { loadAbsenceFormContext } from '@/server/queries/absences';
import { hasSampleClass } from '@/server/queries/onboarding';
import { requireSession, teachingSchools } from '@/server/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('absences');
  return { title: t('new') };
}

export default async function NewAbsencePage() {
  const session = await requireSession();
  if (teachingSchools(session).length === 0) redirect('/today');
  const t = await getTranslations();
  const [schools, cookieStore, sample] = await Promise.all([
    loadAbsenceFormContext(session),
    cookies(),
    hasSampleClass(session),
  ]);

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        back={
          <Link
            href="/absences"
            className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
          >
            <ChevronLeft className="size-4" aria-hidden />
            {t('absences.title')}
          </Link>
        }
        title={t('absences.new')}
      />
      {sample ? (
        // A sample class never reaches a substitute plan (DECISIONS D-109).
        <Notice tone="info" className="mb-4" data-testid="sample-absence-notice">
          {t('onboarding.sample.absence')}
        </Notice>
      ) : null}
      <AbsenceForm
        userId={session.userId}
        schools={schools}
        faithDefault={cookieStore.get(FAITH_COOKIE)?.value !== '0'}
      />
    </div>
  );
}
