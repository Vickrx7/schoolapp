import { ChevronRight, Info } from 'lucide-react';
import type { CoverageCounts } from '@lynx/domain';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ClassCoverageFilters } from '@/components/coverage/class-coverage-filters';
import { ClassCoverageList } from '@/components/coverage/class-coverage-list';
import { PlanningTabs } from '@/components/planning/planning-tabs';
import { Notice } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/page';
import { longDate, shortDate } from '@/components/year-plan/year-format';
import { cn } from '@/lib/utils';
import {
  CLASS_COVERAGE_SHOWS,
  classCoverageHref,
  type ClassCoverageShow,
  type CoveragePeriodChoice,
} from '@/server/planning/coverage-view';
import { loadClassCoverage, type ClassCoveragePage } from '@/server/queries/class-coverage';
import { loadClass } from '@/server/queries/classes';
import { requireSession } from '@/server/session';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ classId: string }>;
}): Promise<Metadata> {
  const { classId } = await params;
  const session = await requireSession();
  const [cls, t] = await Promise.all([loadClass(session, classId), getTranslations()]);
  return {
    title: cls ? t('classCoverage.metaTitle', { className: cls.name }) : t('units.tabs.coverage'),
  };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** « 22 attentes · 9 enseignées · 5 prévues · 8 pas encore prévues ». */
const countValues = (c: CoverageCounts) => ({
  total: c.total,
  taught: c.taught,
  planned: c.planned,
  notPlanned: c.notPlanned,
});

/**
 * « Couverture des attentes » (`/classes/[id]/planning/coverage?subject=<id>&grade=3&period=term1
 * &show=planned`, DECISIONS D-125): without a subject, the whole year's coverage per subject of
 * the class; with one, its attentes by domaine for the chosen grade and period (« Toute
 * l'année », a report period, « Dates choisies »), each with its status and evidence, the counts
 * whatever « Afficher » shows, « Comment on compte » and, while the curriculum is a summary, the
 * notice that it may be incomplete. Computed on each request from the class's own units, lessons
 * and progress; private to the class team (the class layout admits only them, D-013).
 */
export default async function ClassCoveragePage({
  params,
  searchParams,
}: {
  params: Promise<{ classId: string }>;
  searchParams: SearchParams;
}) {
  const { classId } = await params;
  const session = await requireSession();
  // The layout shows "not found" for a missing class, but pages render at the same time.
  const cls = await loadClass(session, classId);
  if (!cls) notFound();
  const [t, tk, locale, query] = await Promise.all([
    getTranslations('classCoverage'),
    getTranslations('reportPeriods.kinds'),
    getLocale(),
    searchParams,
  ]);
  const page = await loadClassCoverage(session, cls, query, locale);
  const { inputs } = page;
  if (!inputs) {
    return (
      <div className="space-y-5">
        <PlanningTabs classId={classId} />
        <Notice tone="warning">{t('failed')}</Notice>
      </div>
    );
  }

  const several = inputs.grades.length > 1;
  const values = {
    subject: page.subject?.id ?? null,
    grade: several ? (page.grade?.code ?? null) : null,
    period: page.period.choice,
    from: page.period.from,
    to: page.period.to,
    show: page.show,
  };
  const periodOptions: { value: CoveragePeriodChoice; label: string }[] = [
    { value: 'year', label: t('filters.year') },
    ...inputs.periods.map((p) => ({
      value: p.kind,
      label: t('filters.reportPeriod', {
        kind: tk(p.kind),
        from: shortDate(p.startsOn, locale),
        to: shortDate(p.endsOn, locale),
      }),
    })),
    { value: 'custom', label: t('filters.custom') },
  ];

  return (
    <div className="space-y-5">
      <PlanningTabs classId={classId} />
      <div className="min-w-0 space-y-1">
        <h2 className="text-xl font-bold text-slate-900">
          {t('title', { year: inputs.year.name })}
        </h2>
        <p className="max-w-prose text-slate-600">{t('intro')}</p>
      </div>

      {page.subject ? (
        <ClassCoverageFilters
          key={classCoverageHref(classId, values)}
          classId={classId}
          subjects={inputs.subjects.map((s) => ({ id: s.id, label: s.label }))}
          grades={inputs.grades}
          periods={periodOptions}
          year={inputs.year}
          values={values}
        />
      ) : null}

      {!page.subject ? (
        <Overview classId={classId} page={page} />
      ) : (
        <Detail classId={classId} page={page} values={values} locale={locale} />
      )}
    </div>
  );
}

/** « Vue d'ensemble »: the whole year's coverage per subject (and grade) of the class. */
async function Overview({ classId, page }: { classId: string; page: ClassCoveragePage }) {
  const t = await getTranslations('classCoverage');
  const overview = page.overview;
  const grades = new Map(page.inputs?.grades.map((g) => [g.code, g.label]));
  const several = (page.inputs?.grades.length ?? 0) > 1;
  return (
    <section aria-labelledby="class-coverage-overview" className="space-y-3">
      <h3 id="class-coverage-overview" className="text-lg font-semibold text-slate-900">
        {t('overview.title')}
      </h3>
      {!overview || overview.subjects.length === 0 ? (
        <EmptyState title={t('overview.empty')} />
      ) : (
        <>
          <p className="text-slate-600">{t('overview.intro')}</p>
          <ul className="space-y-2">
            {overview.subjects.map(({ subject, counts, grades: byGrade }) => (
              <li
                key={subject.id}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm"
              >
                <Link
                  href={classCoverageHref(classId, { subject: subject.id })}
                  className="flex min-h-11 items-center justify-between gap-2 font-semibold text-brand-700 underline-offset-2 hover:underline"
                >
                  {subject.label}
                  <ChevronRight className="size-4 shrink-0" aria-hidden />
                </Link>
                <p className="text-sm text-slate-700" data-testid="coverage-overview-counts">
                  {t('counts', countValues(counts))}
                </p>
                {several && byGrade.length > 0 ? (
                  <ul className="mt-2 space-y-1 border-t border-slate-100 pt-1">
                    {byGrade.map((g) => (
                      <li key={g.gradeCode}>
                        <Link
                          href={classCoverageHref(classId, {
                            subject: subject.id,
                            grade: g.gradeCode,
                          })}
                          className="inline-flex min-h-11 items-center text-sm font-medium text-brand-700 underline underline-offset-2"
                        >
                          {grades.get(g.gradeCode) ?? g.gradeCode}
                        </Link>
                        <p className="text-sm text-slate-700">
                          {t('counts', countValues(g.counts))}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
          {overview.without.length > 0 ? (
            <p className="text-sm text-slate-600">
              {t('overview.without', {
                subjects: overview.without.map((s) => s.label).join(', '),
              })}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

/** A subject and grade: the period, the counts, how they are counted, « Afficher » and the list. */
async function Detail({
  classId,
  page,
  values,
  locale,
}: {
  classId: string;
  page: ClassCoveragePage;
  values: {
    subject: string | null;
    grade: string | null;
    period: CoveragePeriodChoice;
    from: string | null;
    to: string | null;
    show: ClassCoverageShow;
  };
  locale: string;
}) {
  const [t, tk] = await Promise.all([
    getTranslations('classCoverage'),
    getTranslations('reportPeriods.kinds'),
  ]);
  const { subject, grade, view, period } = page;
  if (!subject || !grade) return null;
  if (page.failed || !view) return <Notice tone="warning">{t('failed')}</Notice>;

  const report = page.inputs?.periods.find((p) => p.kind === period.choice);
  const periodLine =
    period.window && report
      ? t('list.periodReport', {
          kind: tk(report.kind),
          from: longDate(period.window.startsOn, locale),
          to: longDate(period.window.endsOn, locale),
        })
      : period.window
        ? t('list.periodCustom', {
            from: longDate(period.window.startsOn, locale),
            to: longDate(period.window.endsOn, locale),
          })
        : t('list.periodYear');
  const { counts } = view;

  return (
    <section aria-labelledby="class-coverage-list" className="space-y-4">
      {period.invalid ? <Notice tone="warning">{t('filters.invalidDates')}</Notice> : null}
      <div className="space-y-1">
        <h3 id="class-coverage-list" className="text-lg font-semibold text-slate-900">
          {t('list.heading', { subject: subject.label, grade: grade.label })}
        </h3>
        <p className="text-sm text-slate-600">{periodLine}</p>
      </div>
      {counts.total === 0 ? (
        <EmptyState title={t('list.empty')} />
      ) : (
        <>
          <p className="font-medium text-slate-900" data-testid="coverage-counts">
            {t('counts', countValues(counts))}
            {period.window && counts.taughtEarlier > 0
              ? ` · ${t('countsEarlier', { count: counts.taughtEarlier })}`
              : null}
          </p>

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
              <p>{t('howCounted.taught')}</p>
              <p>{t('howCounted.unit')}</p>
              <p>{t('howCounted.planned')}</p>
              <p>{t('howCounted.ignored')}</p>
              <p>{t('howCounted.period')}</p>
              <p>{t('howCounted.units')}</p>
              <p>{t('howCounted.loaded')}</p>
              <p>{t('howCounted.private')}</p>
            </div>
          </details>

          {view.unverified ? <Notice>{t('list.unverified')}</Notice> : null}

          <ShowChips classId={classId} values={values} />

          {view.groups.length ? (
            <ClassCoverageList classId={classId} view={view} />
          ) : (
            <EmptyState title={t('list.emptyFilter', { show: t(`filters.show.${values.show}`) })} />
          )}
        </>
      )}
    </section>
  );
}

/** « Afficher »: « Toutes », « Pas encore prévues », « Prévues », « Enseignées » (links). */
async function ShowChips({
  classId,
  values,
}: {
  classId: string;
  values: Parameters<typeof classCoverageHref>[1] & { show: ClassCoverageShow };
}) {
  const t = await getTranslations('classCoverage.filters');
  return (
    <div className="space-y-2">
      <p id="class-coverage-show" className="text-sm font-medium text-slate-700">
        {t('showLabel')}
      </p>
      <ul aria-labelledby="class-coverage-show" className="flex flex-wrap gap-2">
        {CLASS_COVERAGE_SHOWS.map((show) => {
          const current = show === values.show;
          return (
            <li key={show}>
              <Link
                href={classCoverageHref(classId, { ...values, show })}
                scroll={false}
                replace
                aria-current={current ? 'true' : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center justify-center rounded-full border px-4 text-sm font-medium',
                  current
                    ? 'border-brand-600 bg-brand-50 text-brand-800'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
                )}
              >
                {t(`show.${show}`)}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
