import { ChartColumn, ChevronLeft } from 'lucide-react';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CurriculumTree } from '@/components/library/curriculum-tree';
import { GradeChips } from '@/components/library/grade-chips';
import { Notice } from '@/components/ui/card';
import { EmptyState, PageHeader } from '@/components/ui/page';
import { coverageHref } from '@/server/library/coverage-view';
import { loadCurriculumTree } from '@/server/queries/library-search';
import { requireSession, showLibrary } from '@/server/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('library.curriculum');
  return { title: t('title') };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const firstValue = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value)?.trim() || null;

/**
 * « Parcourir le curriculum » (`/library/curriculum?grade=3&subject=<id>`, DECISIONS D-069):
 * grade, then subject (Anglais from the board's start grade), then the attentes by domaine with
 * « À vérifier » (D-030) and « 3 ressources · 1 approuvée », each opening its results. For the
 * library's users and reviewers, like the hub.
 */
export default async function CurriculumPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireSession();
  if (!showLibrary(session)) notFound();
  const params = await searchParams;
  const [t, tl, tc, locale] = await Promise.all([
    getTranslations('library.curriculum'),
    getTranslations('library'),
    getTranslations('libraryCoverage'),
    getLocale(),
  ]);
  const browse = await loadCurriculumTree(
    {
      gradeCode: firstValue(params.grade)?.toUpperCase() ?? null,
      subjectId: firstValue(params.subject),
    },
    session,
    locale,
  );
  const { grade, subject } = browse;
  const kindergarten = grade !== null && grade.ordinal < 1;
  const href = (gradeCode: string, subjectId: string | null = subject?.id ?? null) =>
    `/library/curriculum?grade=${gradeCode}${subjectId ? `&subject=${subjectId}` : ''}`;

  return (
    <div className="space-y-5">
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

      <GradeChips
        label={t('grades')}
        labelId="curriculum-grades"
        chips={browse.options.grades.map((g) => ({
          code: g.code,
          label: g.label,
          href: href(g.code),
          current: g.code === grade?.code,
        }))}
      />

      {!grade ? (
        <p className="text-slate-600">{t('chooseGrade')}</p>
      ) : kindergarten ? (
        <EmptyState title={t('kindergarten')} />
      ) : (
        <>
          <GradeChips
            label={t('subjects')}
            labelId="curriculum-subjects"
            chips={browse.subjects.map((s) => ({
              code: s.id,
              label: s.label,
              href: href(grade.code, s.id),
              current: s.id === subject?.id,
            }))}
          />
          {!subject ? (
            <p className="text-slate-600">{t('chooseSubject')}</p>
          ) : browse.strands.length === 0 ? (
            <EmptyState title={t('noExpectations')} />
          ) : (
            <section aria-labelledby="curriculum-expectations" className="space-y-3">
              <h2 id="curriculum-expectations" className="text-lg font-semibold text-slate-900">
                {subject.label} · {grade.label}
              </h2>
              {/* « Couverture du curriculum » of the same grade and subject (Phase 5, D-094). */}
              <Link
                href={coverageHref({ grade: grade.code, subject: subject.id })}
                className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-brand-700 hover:underline"
              >
                <ChartColumn className="size-5" aria-hidden />
                {tc('curriculumLink')}
              </Link>
              <Notice>{t('toVerifyHint')}</Notice>
              <CurriculumTree
                strands={browse.strands}
                gradeCode={grade.code}
                subjectId={subject.id}
                canGenerate={browse.canGenerate}
              />
            </section>
          )}
        </>
      )}
    </div>
  );
}
