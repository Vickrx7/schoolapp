import { FIRST_NAME_TOKEN } from '@lynx/content';
import { ChevronLeft } from 'lucide-react';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ReportBankGenerateForm } from '@/components/library/report-bank-generate-form';
import {
  bankValuesFromParams,
  defaultBankValues,
  effectiveBankValues,
  reportBankDraftPrefix,
} from '@/components/library/report-bank-values';
import { PageHeader } from '@/components/ui/page';
import { loadLibraryJobStatuses } from '@/server/queries/library-ai';
import { loadReportBankForm, valuesForBankJob } from '@/server/queries/report-bank-ai';
import { librarySchools, requireSession } from '@/server/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('reportBankAi');
  return { title: t('title') };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const firstValue = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value)?.trim() || null;

/**
 * « Créer une banque avec l’IA » (`/library/generate/comments`, DECISIONS D-132): for teachers
 * and direction at a library school; the form says when AI is off. `?resume=<jobId>` starts from
 * an earlier request; `?scope=&grade=&subject=&period=&exp=` (ids only) from a link of
 * « Bulletins ». Each has its own device draft, so a prefilled form never loses another draft.
 */
export default async function ReportBankGeneratePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await requireSession();
  if (!librarySchools(session).length) notFound();
  const [t, tl, locale, params] = await Promise.all([
    getTranslations('reportBankAi'),
    getTranslations('library'),
    getLocale(),
    searchParams,
  ]);
  const context = await loadReportBankForm(session, locale);
  const resume = firstValue(params.resume);
  const [fromJob, jobStatuses] = await Promise.all([
    resume ? valuesForBankJob(resume) : null,
    loadLibraryJobStatuses('report_comment_bank'),
  ]);
  const fromLink = fromJob ? null : bankValuesFromParams(context, params);
  const prefix = reportBankDraftPrefix(session.userId);
  const draftKey = fromJob
    ? `${prefix}:job:${resume}`
    : fromLink
      ? `${prefix}:link:${[fromLink.scope, fromLink.gradeCode, fromLink.subjectId, fromLink.period, ...fromLink.expectationIds].join(',')}`
      : prefix;
  const initial = fromJob
    ? effectiveBankValues({ ...defaultBankValues(context), ...fromJob }, context)
    : (fromLink ?? defaultBankValues(context));

  return (
    <div className="space-y-4">
      <PageHeader
        back={
          <Link
            href="/library"
            className="inline-flex min-h-11 items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
          >
            <ChevronLeft className="size-4" aria-hidden />
            {tl('title')}
          </Link>
        }
        title={t('title')}
        subtitle={t('intro', { token: FIRST_NAME_TOKEN })}
      />
      <ReportBankGenerateForm
        key={draftKey}
        context={context}
        initial={initial}
        draftKey={draftKey}
        jobStatuses={jobStatuses}
        resumed={fromJob !== null}
      />
    </div>
  );
}
