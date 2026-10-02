import { ChevronLeft, RotateCcw } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { JobProgress } from '@/components/differentiate/job-progress';
import { GeneratedRedirect } from '@/components/library/generated-redirect';
import { generateDraftPrefix } from '@/components/library/generate-values';
import { reportBankDraftPrefix } from '@/components/library/report-bank-values';
import { Button } from '@/components/ui/button';
import { Card, CardBody, Notice } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page';
import { loadLibraryJob } from '@/server/queries/library-ai';
import { requireSession } from '@/server/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('libraryAi.job');
  return { title: t('title') };
}

/**
 * « Préparation de la ressource » (DECISIONS D-072, D-073, D-132): follows one of the teacher's
 * library AI requests (row level security: her own), then opens the resource: the new draft (a
 * resource, or a comment bank: « En préparation » until then), or the resource that received its
 * versions. A failed request says why and offers to take it up again.
 */
export default async function LibraryJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const session = await requireSession();
  const { jobId } = await params;
  if (!z.uuid().safeParse(jobId).success) notFound();
  const job = await loadLibraryJob(jobId);
  if (!job) notFound();
  const levels = job.feature === 'library_levels';
  const bank = job.feature === 'report_comment_bank';
  const itemHref = job.itemId ? `/library/items/${job.itemId}` : '/library';

  // The levels are on the resource: straight there. A new resource first forgets the form's
  // draft that became this request (D-035, GeneratedRedirect).
  if (levels && job.status === 'succeeded' && job.itemId) redirect(itemHref);

  const [t, tBank, tErrors] = await Promise.all([
    getTranslations('libraryAi.job'),
    getTranslations('reportBankAi.job'),
    getTranslations('errors'),
  ]);
  const errorKey =
    job.errorCode && tErrors.has(job.errorCode as 'aiError') ? job.errorCode : 'aiError';
  const resumeHref = levels
    ? itemHref
    : bank
      ? `/library/generate/comments?resume=${job.id}`
      : `/library/generate?resume=${job.id}`;
  // A new resource's words, or a comment bank's.
  const words = bank
    ? {
        title: tBank('title'),
        working: tBank('working'),
        workingHint: tBank('workingHint'),
        tooLongHint: tBank('tooLongHint'),
        failed: tBank('failed'),
        failedKept: tBank('failedKept'),
      }
    : {
        title: t('title'),
        working: t('working'),
        workingHint: t('workingHint'),
        tooLongHint: t('tooLongHint'),
        failed: t('failed'),
        failedKept: t('failedKept'),
      };

  return (
    <div className="space-y-4">
      <PageHeader
        back={
          <Link
            href={levels ? itemHref : '/library'}
            className="inline-flex min-h-11 items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
          >
            <ChevronLeft className="size-4" aria-hidden />
            {levels ? t('backToItem') : t('backToLibrary')}
          </Link>
        }
        title={levels ? t('levelsTitle') : words.title}
      />
      {job.status === 'queued' || job.status === 'running' ? (
        <JobProgress
          jobId={job.id}
          status={job.status}
          createdAt={job.createdAt}
          resumeHref={resumeHref}
          working={levels ? t('levelsWorking') : words.working}
          workingHint={levels ? t('levelsWorkingHint') : words.workingHint}
          tooLongHint={levels ? t('levelsTooLongHint') : words.tooLongHint}
          resumeLabel={levels ? t('backToItem') : t('resume')}
        />
      ) : null}
      {job.status === 'succeeded' && job.itemId ? (
        <GeneratedRedirect
          href={itemHref}
          draftPrefix={
            bank ? reportBankDraftPrefix(session.userId) : generateDraftPrefix(session.userId)
          }
          jobId={job.id}
        />
      ) : null}
      {job.status === 'failed' || (job.status === 'succeeded' && !job.itemId) ? (
        <Card>
          <CardBody className="space-y-3 pt-4">
            <Notice tone="danger">
              <p className="font-medium">{levels ? t('levelsFailed') : words.failed}</p>
              <p>{tErrors(errorKey as 'aiError')}</p>
            </Notice>
            <p className="text-sm text-slate-600">
              {levels ? t('levelsFailedKept') : words.failedKept}
            </p>
            <Button asChild>
              <Link href={resumeHref}>
                <RotateCcw aria-hidden />
                {levels ? t('backToItem') : t('resume')}
              </Link>
            </Button>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
