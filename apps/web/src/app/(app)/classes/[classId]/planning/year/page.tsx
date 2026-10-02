import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { PlanningTabs } from '@/components/planning/planning-tabs';
import { Notice } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/page';
import { YearGrid } from '@/components/year-plan/year-grid';
import { YearMonthList } from '@/components/year-plan/year-month-list';
import { PlanUnitButton, YearPlanDialogs } from '@/components/year-plan/year-plan-dialogs';
import { UnitsToPlace, YearWarnings } from '@/components/year-plan/year-plan-lists';
import { buildYearView } from '@/server/planning/year-view';
import { loadClass } from '@/server/queries/classes';
import { loadYearPlan } from '@/server/queries/year-plan';
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
    title: cls ? t('yearPlan.page.metaTitle', { className: cls.name }) : t('units.tabs.year'),
  };
}

/**
 * « Mon année » (DECISIONS D-126): the class's units on the weeks of its school year, with its
 * days off, masses, report dates and liturgical seasons; a grid on larger screens, a list of
 * months on phones. Units dated from their lessons are shown and saved only when the teacher
 * confirms; units without dates are listed to place. Private to the class team (the class
 * layout admits only them, D-013). No drag and drop: the planning dialog places a unit.
 */
export default async function YearPlanPage({ params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const session = await requireSession();
  // The layout shows "not found" for a missing class, but pages render at the same time.
  const cls = await loadClass(session, classId);
  if (!cls) notFound();
  const t = await getTranslations('yearPlan.page');
  const locale = await getLocale();
  const plan = await loadYearPlan(session, cls, locale);
  if (!plan) {
    return (
      <div className="space-y-5">
        <PlanningTabs classId={classId} />
        <Notice tone="warning">{t('noYear')}</Notice>
      </div>
    );
  }

  const view = buildYearView({
    year: plan.year,
    weeks: plan.weeks,
    periods: plan.periods,
    units: plan.units,
    subjects: plan.subjects,
    blockSubjectIds: plan.blockSubjectIds,
    today: plan.today,
  });
  const subjects = new Map(plan.subjects.map((s) => [s.id, s]));
  const toPlace = view.inferred.length + view.unplaced.length;

  return (
    <YearPlanDialogs
      classId={classId}
      subjects={plan.subjects.map((s) => ({ id: s.id, label: s.label }))}
      // What the week selects need: the weeks without their events.
      weeks={plan.weeks.map(({ monday, days, schoolDays, daysOff }) => ({
        monday,
        days,
        schoolDays,
        daysOff,
      }))}
      year={plan.year}
    >
      <div className="space-y-5">
        <PlanningTabs classId={classId} />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h2 className="text-xl font-bold text-slate-900">
              {t('title', { year: plan.year.name })}
            </h2>
            <p className="max-w-prose text-slate-600">{t('intro')}</p>
          </div>
          <PlanUnitButton />
        </div>
        {toPlace > 0 ? (
          <Notice tone="info" className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{t('toPlace', { count: toPlace })}</span>
            <a
              href="#unites-a-placer"
              className="inline-flex min-h-11 items-center font-medium underline underline-offset-2"
            >
              {t('toPlaceLink')}
            </a>
          </Notice>
        ) : null}
        {plan.units.length === 0 ? (
          <EmptyState title={t('empty')} action={<PlanUnitButton />} />
        ) : null}
        <div className="hidden md:block">
          <YearGrid view={view} />
        </div>
        <div className="md:hidden">
          <YearMonthList view={view} subjects={subjects} />
        </div>
        <YearWarnings view={view} />
        <UnitsToPlace classId={classId} view={view} subjects={subjects} year={plan.year} />
      </div>
    </YearPlanDialogs>
  );
}
