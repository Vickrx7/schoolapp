import { ChevronLeft } from 'lucide-react';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { GenerateForm } from '@/components/library/generate-form';
import { generateDraftPrefix } from '@/components/library/generate-values';
import { PageHeader } from '@/components/ui/page';
import {
  defaultGenerateValues,
  loadGenerateForm,
  loadLibraryJobStatuses,
  valuesForExpectation,
  valuesForJob,
} from '@/server/queries/library-ai';
import { librarySchools, requireSession } from '@/server/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('libraryAi');
  return { title: t('title') };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const firstValue = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value)?.trim() || null;

/**
 * « Créer avec l’IA » (`/library/generate`, DECISIONS D-072, D-074, D-078): for teachers and
 * direction at a library school; the form says when AI is off. `?exp=<id>` starts from an
 * attente (« Créer avec l’IA pour cette attente »), `?resume=<jobId>` from an earlier request.
 * Each has its own device draft, so a prefilled form never loses another draft.
 */
export default async function LibraryGeneratePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await requireSession();
  if (!librarySchools(session).length) notFound();
  const [t, tl, locale, params] = await Promise.all([
    getTranslations('libraryAi'),
    getTranslations('library'),
    getLocale(),
    searchParams,
  ]);
  const context = await loadGenerateForm(session, locale);
  const resume = firstValue(params.resume);
  const exp = firstValue(params.exp);
  const [fromJob, fromExpectation, jobStatuses] = await Promise.all([
    resume ? valuesForJob(context, resume) : null,
    exp && !resume ? valuesForExpectation(context, exp) : null,
    loadLibraryJobStatuses(),
  ]);
  const prefix = generateDraftPrefix(session.userId);
  const draftKey = fromJob
    ? `${prefix}:job:${resume}`
    : fromExpectation
      ? `${prefix}:exp:${exp}`
      : prefix;

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
        subtitle={t('intro')}
      />
      <GenerateForm
        key={draftKey}
        context={context}
        initial={fromJob ?? fromExpectation ?? defaultGenerateValues(context)}
        draftKey={draftKey}
        jobStatuses={jobStatuses}
        resumed={fromJob !== null}
      />
    </div>
  );
}
