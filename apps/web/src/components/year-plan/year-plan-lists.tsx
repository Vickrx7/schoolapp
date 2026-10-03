import { weekWindow, type DateWindow } from '@lynx/domain';
import { TriangleAlert } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { YearView } from '@/server/planning/year-view';
import type { YearPlanUnit } from '@/server/queries/year-plan';
import { SaveDatesButton } from './save-dates-button';
import { UnitPlanButton } from './year-plan-dialogs';
import { longDate, plannedUnitOf, shortDate, statusKey } from './year-format';

type Subjects = Map<string, { label: string; color: string | null }>;

function SubjectLine({
  subjectId,
  subjects,
  extra,
}: {
  subjectId: string;
  subjects: Subjects;
  extra?: string;
}) {
  const subject = subjects.get(subjectId);
  return (
    <p className="flex items-center gap-2 text-xs text-slate-600">
      <span
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: subject?.color ?? '#94a3b8' }}
        aria-hidden
      />
      {[subject?.label, extra].filter(Boolean).join(' · ')}
    </p>
  );
}

/**
 * « À vérifier » under the year (DECISIONS D-126), as text: units of a subject that overlap,
 * units over weeks without school, units outside the school year.
 */
export async function YearWarnings({ view }: { view: YearView<YearPlanUnit> }) {
  const t = await getTranslations('yearPlan.warnings');
  const locale = await getLocale();
  const lines = [
    ...view.overlaps.map((o) =>
      t('overlap', {
        first: o.first.title,
        second: o.second.title,
        subject: o.subject.label,
        from: longDate(o.from, locale),
        to: longDate(o.to, locale),
      }),
    ),
    ...view.breaks.map((b) =>
      t('breaks', { title: b.placed.unit.title, breaks: b.titles.join(', '), weeks: b.weeks }),
    ),
    ...view.outsideYear.map((p) =>
      t('outside', {
        title: p.unit.title,
        start: shortDate(p.startsOn, locale),
        end: shortDate(p.endsOn, locale),
      }),
    ),
  ];
  if (lines.length === 0) return null;
  return (
    <section aria-labelledby="year-warnings" className="space-y-2">
      <h3 id="year-warnings" className="font-semibold text-slate-900">
        {t('title')}
      </h3>
      <ul className="space-y-2">
        {lines.map((line, i) => (
          <li
            key={i}
            className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-700" aria-hidden />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The units to place (DECISIONS D-126): « Dates d'après les leçons données », units under way or
 * finished without saved dates, dated from their lessons (« Enregistrer ces dates » or
 * « Ajuster »), then « Unités sans dates » (« Placer »).
 */
export async function UnitsToPlace({
  classId,
  view,
  subjects,
  year,
}: {
  classId: string;
  view: YearView<YearPlanUnit>;
  subjects: Subjects;
  year: DateWindow;
}) {
  const t = await getTranslations();
  const locale = await getLocale();
  if (view.inferred.length === 0 && view.unplaced.length === 0) return null;
  const secondary = cn(buttonVariants({ variant: 'secondary', size: 'md' }));
  return (
    <div id="unites-a-placer" className="scroll-mt-4 space-y-6">
      {view.inferred.length > 0 ? (
        <section aria-labelledby="year-inferred" className="space-y-2">
          <h3 id="year-inferred" className="font-semibold text-slate-900">
            {t('yearPlan.inferred.title', { count: view.inferred.length })}
          </h3>
          <p className="max-w-prose text-sm text-slate-600">{t('yearPlan.inferred.intro')}</p>
          <Card>
            <ul className="divide-y divide-slate-100">
              {view.inferred.map((p) => {
                // Saved as weeks, as the planning dialog saves them (D-123).
                const weeks = weekWindow(p.startsOn, p.endsOn, year);
                return (
                  <li
                    key={p.unit.id}
                    className="flex flex-wrap items-center justify-between gap-3 p-4"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <SubjectLine
                        subjectId={p.unit.subjectId}
                        subjects={subjects}
                        extra={t(statusKey(p))}
                      />
                      <p className="font-medium text-slate-900">{p.unit.title}</p>
                      <p className="text-sm text-slate-700">
                        {t('yearPlan.inferred.dates', {
                          start: longDate(weeks?.startsOn ?? p.startsOn, locale),
                          end: longDate(weeks?.endsOn ?? p.endsOn, locale),
                        })}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {weeks ? (
                        <SaveDatesButton
                          classId={classId}
                          unitId={p.unit.id}
                          title={p.unit.title}
                          startsOn={weeks.startsOn}
                          endsOn={weeks.endsOn}
                        />
                      ) : null}
                      <UnitPlanButton
                        unit={plannedUnitOf(p.unit, p)}
                        aria-label={t('yearPlan.inferred.adjustLabel', { title: p.unit.title })}
                        className={secondary}
                      >
                        {t('yearPlan.inferred.adjust')}
                      </UnitPlanButton>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        </section>
      ) : null}
      {view.unplaced.length > 0 ? (
        <section aria-labelledby="year-unplaced" className="space-y-2">
          <h3 id="year-unplaced" className="font-semibold text-slate-900">
            {t('yearPlan.unplaced.title', { count: view.unplaced.length })}
          </h3>
          <p className="max-w-prose text-sm text-slate-600">{t('yearPlan.unplaced.intro')}</p>
          <Card>
            <ul className="divide-y divide-slate-100">
              {view.unplaced.map((unit) => (
                <li key={unit.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0 space-y-0.5">
                    <SubjectLine
                      subjectId={unit.subjectId}
                      subjects={subjects}
                      extra={t(`units.status.${unit.status}`)}
                    />
                    <p className="font-medium text-slate-900">{unit.title}</p>
                  </div>
                  <UnitPlanButton
                    unit={plannedUnitOf(unit)}
                    aria-label={t('yearPlan.unplaced.placeLabel', { title: unit.title })}
                    className={secondary}
                  >
                    {t('yearPlan.unplaced.place')}
                  </UnitPlanButton>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}
    </div>
  );
}
