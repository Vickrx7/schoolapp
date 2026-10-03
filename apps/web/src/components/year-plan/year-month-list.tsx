import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { YearView } from '@/server/planning/year-view';
import type { YearPlanUnit } from '@/server/queries/year-plan';
import { StatusText } from './year-grid';
import { UnitPlanButton } from './year-plan-dialogs';
import { longDate, monthLabel, plannedUnitOf, shortRange, statusKey } from './year-format';

/**
 * « Mon année » on a phone (DECISIONS D-126): the year as a list of months, each with its school
 * days, its days off and events, its report dates and seasons, written out, then the units that
 * touch it, each a 44 px button that opens « Planification de l'unité ». Nothing scrolls
 * sideways.
 */
export async function YearMonthList({
  view,
  subjects,
}: {
  view: YearView<YearPlanUnit>;
  subjects: Map<string, { label: string; color: string | null }>;
}) {
  const t = await getTranslations();
  const locale = await getLocale();

  const current = view.monthList.find((m) => m.current);
  return (
    <div className="space-y-3">
      {current && current !== view.monthList[0] ? (
        <a
          href={`#year-month-${current.month}`}
          className="inline-flex min-h-11 items-center text-sm font-medium text-brand-700 underline underline-offset-2"
        >
          {t('yearPlan.month.jump')}
        </a>
      ) : null}
      <ol className="space-y-4">
        {view.monthList.map((m) => {
          const headingId = `year-month-${m.month}-heading`;
          return (
            <li key={m.month}>
              <section
                id={`year-month-${m.month}`}
                aria-labelledby={headingId}
                className={cn(
                  'scroll-mt-4',
                  'rounded-xl border bg-white shadow-sm',
                  m.current ? 'border-brand-300 ring-1 ring-brand-300' : 'border-slate-200',
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                  <h3 id={headingId} className="font-semibold text-slate-900">
                    {t('yearPlan.month.heading', {
                      month: monthLabel(m.month, locale),
                      days: m.schoolDays,
                    })}
                  </h3>
                  {m.current ? <Badge tone="brand">{t('yearPlan.month.current')}</Badge> : null}
                </div>
                <div className="space-y-3 px-4 py-3 text-sm">
                  {m.daysOff.length || m.events.length || m.markers.length || m.seasons.length ? (
                    <dl className="space-y-2">
                      <Facts label={t('yearPlan.month.daysOff')}>
                        {m.daysOff.map((d) => (
                          <li key={`${d.title}-${d.from}`}>
                            {d.title} · {shortRange(d.from, d.to, locale)}
                          </li>
                        ))}
                      </Facts>
                      <Facts label={t('yearPlan.month.events')}>
                        {m.events.map((e) => (
                          <li key={e.id}>
                            {e.title} · {shortRange(e.from, e.to, locale)}
                          </li>
                        ))}
                      </Facts>
                      <Facts label={t('yearPlan.month.reports')}>
                        {m.markers.map((marker) => (
                          <li key={`${marker.kind}-${marker.what}`}>
                            {t('yearPlan.reports.marker', {
                              kind: t(`reportPeriods.kinds.${marker.kind}`),
                              what: t(`yearPlan.reports.what.${marker.what}`, {
                                date: longDate(marker.date, locale),
                              }),
                            })}
                          </li>
                        ))}
                      </Facts>
                      <Facts label={t('yearPlan.month.seasons')}>
                        {m.seasons.map((s) => (
                          <li key={s.season}>
                            {t(`yearPlan.seasons.${s.season}`)} · {shortRange(s.from, s.to, locale)}
                          </li>
                        ))}
                      </Facts>
                    </dl>
                  ) : null}
                  <div>
                    <h4 className="sr-only">{t('yearPlan.month.units')}</h4>
                    {m.units.length === 0 ? (
                      <p className="text-slate-600">{t('yearPlan.month.noUnits')}</p>
                    ) : (
                      <ul className="space-y-2">
                        {m.units.map((p) => {
                          const subject = subjects.get(p.unit.subjectId);
                          const status = t(statusKey(p));
                          const dates = shortRange(p.startsOn, p.endsOn, locale);
                          const label = [
                            subject?.label,
                            p.unit.title,
                            dates,
                            status,
                            p.inferred ? t('yearPlan.status.inferred') : null,
                          ]
                            .filter(Boolean)
                            .join(' · ');
                          return (
                            <li key={p.unit.id}>
                              <UnitPlanButton
                                unit={plannedUnitOf(p.unit, p)}
                                aria-label={label}
                                className={cn(
                                  'flex min-h-11 w-full items-stretch gap-3 rounded-lg border bg-white py-2 pr-3 pl-2 text-left hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none',
                                  p.inferred
                                    ? 'border-dashed border-slate-400'
                                    : 'border-slate-300',
                                )}
                              >
                                <span
                                  className="w-1 shrink-0 rounded-full"
                                  style={{ backgroundColor: subject?.color ?? '#94a3b8' }}
                                  aria-hidden
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block text-xs text-slate-600">
                                    {subject?.label}
                                  </span>
                                  <span className="block font-medium text-slate-900">
                                    {p.unit.title}
                                  </span>
                                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                                    <span className="text-slate-700 tabular-nums">{dates}</span>
                                    <StatusText p={p} label={status} />
                                    {p.inferred ? (
                                      <span className="text-slate-600">
                                        {t('yearPlan.status.inferred')}
                                      </span>
                                    ) : null}
                                  </span>
                                </span>
                              </UnitPlanButton>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              </section>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** One kind of fact of a month (« Pas d'école », « Bulletins »…), left out when there is none. */
function Facts({ label, children }: { label: string; children: ReactNode[] }) {
  if (children.length === 0) return null;
  return (
    <div>
      <dt className="text-xs font-semibold tracking-wide text-slate-600 uppercase">{label}</dt>
      <dd>
        <ul className="text-slate-700">{children}</ul>
      </dd>
    </div>
  );
}
