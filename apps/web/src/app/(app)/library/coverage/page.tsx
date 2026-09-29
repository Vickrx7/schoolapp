import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Info,
} from 'lucide-react';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CoverageFilters } from '@/components/library/coverage/coverage-filters';
import { CoverageList } from '@/components/library/coverage/coverage-list';
import { CoverageSummary } from '@/components/library/coverage/coverage-summary';
import { GradeChips } from '@/components/library/grade-chips';
import { Badge, Notice } from '@/components/ui/card';
import { EmptyState, PageHeader } from '@/components/ui/page';
import {
  coverageFilter,
  coverageHref,
  coverageMin,
  withAnyApproved,
  type CoverageFilter,
  type CoverageView,
} from '@/server/library/coverage-view';
import {
  coverageBoardId,
  loadCoverage,
  loadCoverageSummary,
  type CoveragePage as CoverageData,
} from '@/server/queries/library-coverage';
import { loadLibrarySearchOptions } from '@/server/queries/library-search';
import { requireSession, showLibrary } from '@/server/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('libraryCoverage');
  return { title: t('title') };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const firstValue = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value)?.trim() || null;

/** Whether any attente of the list is a summary still « À vérifier » (D-030). */
const hasUnverified = (view: CoverageView) =>
  view.groups.some((g) =>
    g.entries.some((e) => !e.expectation.verified || e.children.some((c) => !c.verified)),
  );

/**
 * « Couverture du curriculum » (`/library/coverage?grade=3&subject=<id>&show=none&min=2`,
 * DECISIONS D-094): « Vue d’ensemble » (grades × subjects of the board), then, for the chosen
 * grade and subject, the attentes by domaine with the number of board-approved resources linked
 * to each, the filters « Sans ressource approuvée / Peu de ressources / Toutes » and « Seuil »,
 * « Comment on compte », and the links to create what is missing. Content reviewers also see
 * « en révision ». For the library's users and reviewers, like the hub; linked from the hub and
 * from « Parcourir le curriculum ».
 */
export default async function CoveragePage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireSession();
  if (!showLibrary(session)) notFound();
  const boardId = coverageBoardId(session);
  if (!boardId) notFound();
  const params = await searchParams;
  const min = coverageMin(params.min);
  const show = coverageFilter(params.show);
  const [t, tb, tl, locale] = await Promise.all([
    getTranslations('libraryCoverage'),
    getTranslations('library.curriculum'),
    getTranslations('library'),
    getLocale(),
  ]);
  const options = await loadLibrarySearchOptions(session, locale);
  const [page, summary] = await Promise.all([
    loadCoverage(
      {
        gradeCode: firstValue(params.grade)?.toUpperCase() ?? null,
        subjectId: firstValue(params.subject),
        min,
        show,
      },
      session,
      locale,
    ),
    loadCoverageSummary(boardId, min, options),
  ]);
  const { grade, subject } = page;
  const kindergarten = grade !== null && grade.ordinal < 1;

  return (
    <div className="space-y-6">
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

      <section aria-labelledby="coverage-summary" className="space-y-3">
        <h2 id="coverage-summary" className="text-lg font-semibold text-slate-900">
          {t('summary.title')}
        </h2>
        {summary ? (
          <CoverageSummary
            summary={summary}
            current={{ grade: grade?.code ?? null, subject: subject?.id ?? null }}
            show={show}
            min={min}
          />
        ) : (
          <Notice tone="warning">{t('summary.error')}</Notice>
        )}
      </section>

      <div className="space-y-4">
        <GradeChips
          label={tb('grades')}
          labelId="coverage-grades"
          chips={options.grades.map((g) => ({
            code: g.code,
            label: g.label,
            href: coverageHref({ grade: g.code, subject: subject?.id ?? null, show, min }),
            current: g.code === grade?.code,
          }))}
        />
        {!grade ? (
          <p className="text-slate-600">{tb('chooseGrade')}</p>
        ) : kindergarten ? (
          <EmptyState title={tb('kindergarten')} />
        ) : (
          <>
            <GradeChips
              label={tb('subjects')}
              labelId="coverage-subjects"
              chips={page.subjects.map((s) => ({
                code: s.id,
                label: s.label,
                href: coverageHref({ grade: grade.code, subject: s.id, show, min }),
                current: s.id === subject?.id,
              }))}
            />
            {!subject ? (
              <p className="text-slate-600">{tb('chooseSubject')}</p>
            ) : (
              <section aria-labelledby="coverage-list" className="space-y-4">
                <h2 id="coverage-list" className="text-lg font-semibold text-slate-900">
                  {subject.label} · {grade.label}
                </h2>
                <Detail page={page} show={show} min={min} />
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** The chosen grade and subject: the counts, how they are counted, the filters and the list. */
async function Detail({
  page,
  show,
  min,
}: {
  page: CoverageData;
  show: CoverageFilter;
  min: number;
}) {
  const [t, tb] = await Promise.all([
    getTranslations('libraryCoverage'),
    getTranslations('library.curriculum'),
  ]);
  const { view, grade, subject } = page;
  if (page.failed || !grade || !subject) return <EmptyState title={t('list.error')} />;
  if (!view || view.counts.units === 0) return <EmptyState title={tb('noExpectations')} />;
  const { counts } = view;

  return (
    <>
      <div className="space-y-2">
        <p className="font-medium text-slate-900">
          {t('list.covered', { covered: withAnyApproved(counts), total: counts.units })}
        </p>
        <ul className="flex flex-wrap gap-2">
          <li>
            <Badge tone="danger" className="text-sm">
              <CircleDashed className="size-4" aria-hidden />
              {t('list.none', { count: counts.none })}
            </Badge>
          </li>
          {min > 1 ? (
            <li>
              <Badge tone="warning" className="text-sm">
                <CircleAlert className="size-4" aria-hidden />
                {t('list.few', { count: counts.few, min })}
              </Badge>
            </li>
          ) : null}
          <li>
            <Badge tone="success" className="text-sm">
              <CircleCheck className="size-4" aria-hidden />
              {t('list.enough', { count: counts.covered, min })}
            </Badge>
          </li>
        </ul>
      </div>

      <details className="group rounded-lg border border-slate-200 bg-white">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 text-sm font-medium text-brand-700 [&::-webkit-details-marker]:hidden">
          <Info className="size-4 shrink-0" aria-hidden />
          {t('howCounted.title')}
          <ChevronRight
            className="ml-auto size-4 shrink-0 transition-transform group-open:rotate-90"
            aria-hidden
          />
        </summary>
        <div className="space-y-2 border-t border-slate-200 px-4 py-3 text-sm text-slate-700">
          <p>{t('howCounted.direct')}</p>
          <p>{t('howCounted.browse')}</p>
          <p>{t('howCounted.threshold')}</p>
          {page.inReview ? <p>{t('howCounted.review')}</p> : null}
        </div>
      </details>

      <CoverageFilters grade={grade.code} subject={subject.id} show={show} min={min} />

      {hasUnverified(view) ? <Notice>{tb('toVerifyHint')}</Notice> : null}

      {view.groups.length ? (
        <CoverageList
          view={view}
          scope={{
            gradeCode: grade.code,
            subjectId: subject.id,
            canCreate: page.canCreate,
            canGenerate: page.canGenerate,
          }}
        />
      ) : (
        <EmptyState title={show === 'none' ? t('list.emptyNone') : t('list.emptyFew', { min })} />
      )}
    </>
  );
}
