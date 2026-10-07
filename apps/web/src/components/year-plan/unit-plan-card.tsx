import { unitSchoolDays, weeksOf, type DateWindow } from '@lynx/domain';
import { CalendarRange } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/card';
import { formatLocalDate } from '@/lib/format';
import type { ExpectationChoice } from '@/server/queries/year-plan';
import { UnitPlanDialog, type PlanWeek, type PlannedUnit } from './unit-plan-dialog';

/**
 * A unit's planning on its page (DECISIONS D-123): « Prévue du 11 janvier au 5 février », its
 * weeks and school days, the attentes it aims at, and « Modifier la planification ».
 */
export async function UnitPlanCard({
  classId,
  unit,
  year,
  weeks,
  expectations,
}: {
  classId: string;
  unit: PlannedUnit;
  /** Null when the class's year cannot be read: the planning is shown, not edited. */
  year: DateWindow | null;
  weeks: PlanWeek[];
  expectations: ExpectationChoice[];
}) {
  const t = await getTranslations('yearPlan.unit');
  const locale = await getLocale();
  const day = (d: string) => formatLocalDate(d, locale, { day: 'numeric', month: 'long' });
  const span =
    unit.startsOn && unit.endsOn ? { startsOn: unit.startsOn, endsOn: unit.endsOn } : null;
  const outside =
    span !== null && year !== null && (span.startsOn < year.startsOn || span.endsOn > year.endsOn);
  const byId = new Map(expectations.map((e) => [e.id, e]));
  const aimed = unit.expectationIds
    .map((id) => byId.get(id))
    .filter((e): e is ExpectationChoice => Boolean(e))
    .sort((a, b) => expectations.indexOf(a) - expectations.indexOf(b));
  const showGrade = new Set(aimed.map((e) => e.gradeCode)).size > 1;

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 className="font-semibold text-slate-900">{t('title')}</h3>
          <p className="text-sm text-slate-700">
            {span ? (
              <>
                {t('planned', { start: day(span.startsOn), end: day(span.endsOn) })}
                {weeks.length ? (
                  <>
                    {' · '}
                    {t('summary', {
                      weeks: weeksOf(span, weeks).length,
                      days: unitSchoolDays(span, weeks),
                    })}
                  </>
                ) : null}
              </>
            ) : (
              t('noWindow')
            )}
          </p>
          {outside ? <p className="text-sm text-amber-800">{t('outsideYear')}</p> : null}
        </div>
        {year ? (
          <UnitPlanDialog
            classId={classId}
            unit={unit}
            weeks={weeks}
            year={year}
            expectations={expectations}
            trigger={
              <Button variant="secondary" size="sm" className="min-h-11">
                <CalendarRange aria-hidden />
                {t('edit')}
              </Button>
            }
          />
        ) : null}
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-700">{t('expectations')}</p>
        {aimed.length === 0 ? (
          <p className="text-sm text-slate-600">{t('noExpectations')}</p>
        ) : (
          <>
            <ul className="flex flex-wrap gap-1.5" aria-label={t('expectations')}>
              {aimed.map((e) => (
                <li key={e.id}>
                  <Badge tone="brand">
                    {showGrade ? `${e.gradeLabel} · ` : null}
                    {e.code}
                  </Badge>
                </li>
              ))}
            </ul>
            <details className="text-sm">
              <summary className="cursor-pointer py-1 text-slate-700 hover:text-slate-900">
                {t('showTexts')}
              </summary>
              <ul className="mt-2 space-y-1.5 text-slate-700">
                {aimed.map((e) => (
                  <li key={e.id}>
                    <span className="font-semibold">{e.code}</span> {e.text}
                  </li>
                ))}
              </ul>
            </details>
          </>
        )}
      </div>
    </Card>
  );
}
