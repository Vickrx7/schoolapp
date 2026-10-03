import { ChevronLeft } from 'lucide-react';
import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { DeleteResultsButton } from '@/components/class-mode/results/delete-results-button';
import { SessionResults } from '@/components/class-mode/results/session-results';
import { Notice } from '@/components/ui/card';
import { loadSessionResults } from '@/server/queries/class-mode';

type Props = { params: Promise<{ classId: string; sessionId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('classMode.results');
  return { title: t('pageTitle') };
}

/**
 * « Résultats de la séance » (DECISIONS D-089): the class results a teacher kept, for the class
 * team with a teacher role (row level security; anyone else: not found), with « Supprimer ».
 */
export default async function SessionResultsPage({ params }: Props) {
  const { classId, sessionId } = await params;
  if (!z.uuid().safeParse(sessionId).success) notFound();
  const results = await loadSessionResults(classId, sessionId);
  if (!results) notFound();
  const [t, format] = await Promise.all([getTranslations('classMode.results'), getFormatter()]);
  const date = format.dateTime(new Date(results.savedAt), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="space-y-5">
      <Link
        href={`/classes/${classId}/class-mode`}
        className="inline-flex min-h-11 items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
      >
        <ChevronLeft aria-hidden className="size-4" />
        {t('back')}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-slate-900">
            {results.itemTitle ? (
              <span lang={results.lang}>{results.itemTitle}</span>
            ) : (
              t('untitled')
            )}
          </h2>
          <p className="text-slate-600">{t('playedOn', { date })}</p>
        </div>
        <DeleteResultsButton sessionId={results.sessionId} classId={results.classId} />
      </div>
      {results.aggregate ? (
        <SessionResults aggregate={results.aggregate} lang={results.lang} />
      ) : (
        <Notice tone="warning">{t('unreadable')}</Notice>
      )}
    </div>
  );
}
