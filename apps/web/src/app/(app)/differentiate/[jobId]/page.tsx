import { ChevronLeft, RotateCcw } from 'lucide-react';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { JobProgress } from '@/components/differentiate/job-progress';
import { jobEditorVersions } from '@/components/differentiate/job-view';
import { ResultEditor } from '@/components/differentiate/result-editor';
import { Button } from '@/components/ui/button';
import { Card, CardBody, Notice } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page';
import { loadJob, loadLanguageLevels } from '@/server/queries/differentiate';
import { requireSession } from '@/server/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('differentiate');
  return { title: t('title') };
}

export default async function DifferentiateJobPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const session = await requireSession();
  const { jobId } = await params;
  if (!z.uuid().safeParse(jobId).success) notFound();
  const job = await loadJob(jobId);
  if (!job) notFound();
  const t = await getTranslations();
  const tErrors = await getTranslations('errors');
  const errorKey =
    job.errorCode && tErrors.has(job.errorCode as 'aiError') ? job.errorCode : 'aiError';

  const back = (
    <Link
      href="/differentiate"
      className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
    >
      <ChevronLeft className="size-4" aria-hidden />
      {t('differentiate.title')}
    </Link>
  );
  const resumeHref = `/differentiate?from=${job.id}`;

  // Level names follow the interface language; the request stored the French ones.
  const levelLabels = async () =>
    new Map((await loadLanguageLevels(await getLocale())).map((l) => [l.id, l.label]));
  const versions =
    job.status === 'succeeded' && job.result
      ? jobEditorVersions(job.input, job.result, await levelLabels())
      : null;

  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <PageHeader back={back} title={job.input.title} />
      </div>
      {job.status === 'queued' || job.status === 'running' ? (
        <JobProgress
          jobId={job.id}
          status={job.status}
          createdAt={job.createdAt}
          resumeHref={resumeHref}
        />
      ) : null}
      {job.status === 'failed' ? (
        <Card>
          <CardBody className="space-y-3 pt-4">
            <Notice tone="danger">
              <p className="font-medium">{t('differentiate.failed')}</p>
              <p>{tErrors(errorKey as 'aiError')}</p>
            </Notice>
            <p className="text-sm text-slate-600">{t('differentiate.failedKept')}</p>
            <Button asChild>
              <Link href={resumeHref}>
                <RotateCcw aria-hidden />
                {t('differentiate.resume')}
              </Link>
            </Button>
          </CardBody>
        </Card>
      ) : null}
      {versions && job.result ? (
        <>
          <ResultEditor
            mode="job"
            id={job.id}
            userId={session.userId}
            initial={{ title: job.input.title, objective: job.result.objective, versions }}
          />
          {job.sentText ? (
            <details className="rounded-xl border border-slate-200 bg-white p-4 print:hidden">
              <summary className="cursor-pointer font-medium text-slate-900">
                {t('differentiate.sentText')}
              </summary>
              <pre className="mt-3 text-sm whitespace-pre-wrap text-slate-700">{job.sentText}</pre>
            </details>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
