import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { DifferentiateForm } from '@/components/differentiate/differentiate-form';
import { DiscardJobButton } from '@/components/differentiate/discard-job-button';
import { resumeFormValues } from '@/components/differentiate/form-values';
import { DEFAULT_TIME_ZONE, formatMoment } from '@/components/differentiate/job-view';
import { Badge, Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page';
import {
  loadDifferentiateForm,
  loadJob,
  loadRecentJobs,
  loadSavedTexts,
} from '@/server/queries/differentiate';
import { aiSchools, requireSession } from '@/server/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('differentiate');
  return { title: t('title') };
}

const STATUS_TONE = {
  queued: 'neutral',
  running: 'brand',
  succeeded: 'success',
  failed: 'danger',
} as const;

export default async function DifferentiatePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const session = await requireSession();
  if (aiSchools(session).length === 0) redirect('/today');
  const t = await getTranslations('differentiate');
  const locale = await getLocale();
  // « Reprendre ce texte »: the form filled from an earlier request (only its author sees it).
  const { from } = await searchParams;
  const fromId = typeof from === 'string' && z.uuid().safeParse(from).success ? from : null;
  const [context, jobs, saved, previous] = await Promise.all([
    loadDifferentiateForm(session, locale),
    loadRecentJobs(),
    loadSavedTexts(session),
    fromId ? loadJob(fromId) : Promise.resolve(null),
  ]);
  const resume = previous
    ? { jobId: previous.id, values: resumeFormValues(context, previous) }
    : null;
  // Times in the school's time zone, not the server's.
  const timeZone = (schoolId: string | null) =>
    session.schools.find((s) => s.id === schoolId)?.timezone ?? DEFAULT_TIME_ZONE;

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} subtitle={t('intro')} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-labelledby="new-request">
          <h2 id="new-request" className="sr-only">
            {t('newRequest')}
          </h2>
          <DifferentiateForm
            // A new form (and draft) when the request being reused changes.
            key={resume?.jobId ?? 'new'}
            context={context}
            jobStatuses={Object.fromEntries(jobs.map((j) => [j.id, j.status]))}
            resume={resume}
          />
        </section>
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('recent')}</CardTitle>
            </CardHeader>
            <CardBody className="space-y-2">
              {jobs.length === 0 ? (
                <p className="text-sm text-slate-600">{t('recentEmpty')}</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {jobs.map((j) => (
                    <li key={j.id} className="flex items-center justify-between gap-2 py-2">
                      <Link href={`/differentiate/${j.id}`} className="min-w-0 hover:underline">
                        <span className="block truncate font-medium text-slate-900">
                          {j.title ?? t('untitled')}
                        </span>
                        <span className="text-xs text-slate-500">
                          {formatMoment(j.createdAt, locale, timeZone(j.schoolId))}
                        </span>
                      </Link>
                      <div className="flex shrink-0 items-center gap-1">
                        <Badge tone={STATUS_TONE[j.status]}>{t(`status.${j.status}`)}</Badge>
                        {j.status === 'succeeded' || j.status === 'failed' ? (
                          <DiscardJobButton jobId={j.id} />
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-slate-500">{t('recentHint')}</p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle id="saved-texts">{t('saved')}</CardTitle>
            </CardHeader>
            <CardBody>
              {saved.length === 0 ? (
                <p className="text-sm text-slate-600">{t('savedEmpty')}</p>
              ) : (
                <ul aria-labelledby="saved-texts" className="divide-y divide-slate-100">
                  {saved.map((s) => (
                    <li key={s.id} className="py-2">
                      <Link
                        href={`/library/items/${s.id}`}
                        className="block truncate font-medium text-slate-900 hover:underline"
                      >
                        {s.title}
                      </Link>
                      <span className="text-xs text-slate-500">
                        {formatMoment(s.updatedAt, locale, timeZone(s.schoolId))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
