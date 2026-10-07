import type { PlacedUnit } from '@lynx/domain';
import { Check, Church } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { cn } from '@/lib/utils';
import type { GridCell, YearView, YearWeek } from '@/server/planning/year-view';
import type { YearPlanUnit } from '@/server/queries/year-plan';
import { UnitPlanButton } from './year-plan-dialogs';
import { YearGridScroller } from './year-grid-scroller';
import { longDate, monthLabel, plannedUnitOf, shortDate, statusKey } from './year-format';

/** Column widths: the subject column, then each week. */
const SUBJECT_WIDTH = 10; // rem
const WEEK_WIDTH = 4.75; // rem

/** Liturgical colours, always with the season's name (never colour alone). */
const SEASON_STYLE = {
  avent: 'bg-violet-100 text-violet-900 ring-violet-200',
  careme: 'bg-violet-100 text-violet-900 ring-violet-200',
  noel: 'bg-amber-50 text-amber-900 ring-amber-200',
  paques: 'bg-amber-50 text-amber-900 ring-amber-200',
} as const;

const sticky =
  'sticky left-0 z-10 border-r border-b border-slate-200 bg-white px-3 text-left align-middle';

/**
 * « Mon année » on larger screens (DECISIONS D-126): a table of weeks by subject, in a box that
 * scrolls sideways with the subject column kept in view. Header rows give the months and each
 * week's first day (« Semaine du 7 septembre » for screen readers); then the calendar (weeks
 * without school, partial weeks, masses), the report dates, the liturgical seasons, and one row
 * per subject, with a second lane when two units share a week. Every status is written out.
 */
export async function YearGrid({ view }: { view: YearView<YearPlanUnit> }) {
  const t = await getTranslations();
  const locale = await getLocale();
  const { weeks } = view;
  const monthStarts = new Set(view.months.map((m) => m.start));
  // Week columns: a darker line where a month starts, grey without school, tinted this week.
  const column = (w: YearWeek) =>
    cn(
      'border-b border-r border-slate-100',
      monthStarts.has(w.index) && w.index > 0 && 'border-l border-l-slate-300',
      w.noSchool ? 'bg-slate-100' : w.current && 'bg-brand-50/70',
    );

  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-600">{t('yearPlan.grid.scrollHint')}</p>
      <YearGridScroller labelledBy="year-grid-caption">
        <table
          className="border-separate border-spacing-0 text-sm"
          style={{
            tableLayout: 'fixed',
            width: `${SUBJECT_WIDTH + weeks.length * WEEK_WIDTH}rem`,
          }}
        >
          <caption id="year-grid-caption" className="sr-only">
            {t('yearPlan.grid.caption')}
          </caption>
          <colgroup>
            <col style={{ width: `${SUBJECT_WIDTH}rem` }} />
            {weeks.map((w) => (
              <col key={w.monday} style={{ width: `${WEEK_WIDTH}rem` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th
                scope="col"
                data-sticky-column
                className={cn(sticky, 'bg-slate-50 py-2 text-xs font-medium text-slate-600')}
              >
                {t('yearPlan.grid.month')}
              </th>
              {view.months.map((m) => (
                <th
                  key={m.key}
                  scope="colgroup"
                  colSpan={m.span}
                  className={cn(
                    'border-b border-slate-200 bg-slate-50 px-2 py-2 text-left font-semibold whitespace-nowrap text-slate-800',
                    m.start > 0 && 'border-l border-l-slate-300',
                  )}
                >
                  {/* Kept in view while the month's first weeks scroll away. */}
                  <span
                    className="sticky inline-block"
                    style={{ left: `${SUBJECT_WIDTH + 0.5}rem` }}
                  >
                    {monthLabel(m.key, locale)}
                  </span>
                </th>
              ))}
            </tr>
            <tr>
              <th
                scope="col"
                className={cn(sticky, 'bg-slate-50 py-1.5 text-xs font-medium text-slate-600')}
              >
                {t('yearPlan.grid.weekOf')}
              </th>
              {weeks.map((w) => (
                <th
                  key={w.monday}
                  scope="col"
                  data-current-week={w.current ? '' : undefined}
                  className={cn(
                    'border-b border-slate-200 bg-slate-50 py-1.5 text-center text-xs font-medium text-slate-700 tabular-nums',
                    monthStarts.has(w.index) && w.index > 0 && 'border-l border-l-slate-300',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'inline-flex min-w-7 justify-center rounded-full px-1.5 py-0.5',
                      w.current && 'bg-brand-700 font-semibold text-white',
                    )}
                  >
                    {formatDay(w.first, locale)}
                  </span>
                  <span className="sr-only">
                    {t('yearPlan.grid.week', { date: longDate(w.first, locale) })}
                    {w.current ? ` (${t('yearPlan.grid.thisWeek')})` : ''}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* « Calendrier »: weeks without school, partial weeks, masses. */}
            <tr>
              <th scope="row" className={cn(sticky, 'py-2 font-medium text-slate-700')}>
                {t('yearPlan.grid.calendar')}
              </th>
              {weeks.map((w) => (
                <td key={w.monday} className={cn(column(w), 'py-1.5 align-top')}>
                  <div className="space-y-1 px-0.5 text-[0.6875rem] leading-tight tracking-tight">
                    {w.noSchool ? (
                      <p className="font-semibold text-slate-800">{t('yearPlan.grid.noSchool')}</p>
                    ) : w.schoolDays < 5 ? (
                      <p className="font-semibold text-slate-800">
                        <span aria-hidden>
                          {t('yearPlan.grid.schoolDays', { count: w.schoolDays })}
                        </span>
                        <span className="sr-only">
                          {t('yearPlan.grid.schoolDaysLong', { count: w.schoolDays })}
                        </span>
                      </p>
                    ) : null}
                    {w.closures.map((title) => (
                      <p key={title} className="hyphens-auto break-words text-slate-700">
                        {title}
                      </p>
                    ))}
                    {w.masses.map((e) => (
                      <p
                        key={e.id}
                        className="flex items-center gap-0.5 font-medium text-violet-900"
                        title={e.title}
                      >
                        <Church className="size-3 shrink-0" aria-hidden />
                        <span aria-hidden>{t('yearPlan.grid.mass')}</span>
                        <span className="sr-only">
                          {t('yearPlan.grid.massLabel', {
                            title: e.title,
                            date: longDate(e.startsOn, locale),
                          })}
                        </span>
                      </p>
                    ))}
                  </div>
                </td>
              ))}
            </tr>
            {/* « Bulletins »: the end of each evaluation period, « saisie » and « remise ». */}
            <tr>
              <th scope="row" className={cn(sticky, 'py-2 font-medium text-slate-700')}>
                {t('yearPlan.grid.reports')}
              </th>
              {weeks.map((w) => (
                <td key={w.monday} className={cn(column(w), 'px-1 py-1.5 align-top')}>
                  <ul className="space-y-1">
                    {w.markers.map((m) => {
                      const full = t('yearPlan.reports.marker', {
                        kind: t(`reportPeriods.kinds.${m.kind}`),
                        what: t(`yearPlan.reports.what.${m.what}`, {
                          date: longDate(m.date, locale),
                        }),
                      });
                      return (
                        <li
                          key={`${m.kind}-${m.what}`}
                          title={full}
                          className="rounded border-l-2 border-amber-500 bg-amber-50 px-1 py-0.5 text-[0.6875rem] leading-tight text-amber-950"
                        >
                          <span aria-hidden>
                            <span className="block font-semibold">
                              {t(`yearPlan.reports.short.${m.kind}`)}
                            </span>
                            {t(`yearPlan.reports.whatShort.${m.what}`, {
                              date: shortDate(m.date, locale),
                            })}
                          </span>
                          <span className="sr-only">{full}</span>
                        </li>
                      );
                    })}
                  </ul>
                </td>
              ))}
            </tr>
            {/* « Temps liturgique »: Advent, Christmas, Lent, Easter (each week by its Wednesday). */}
            <tr>
              <th scope="row" className={cn(sticky, 'py-2 font-medium text-slate-700')}>
                {t('yearPlan.grid.seasons')}
              </th>
              {view.seasons.map((s) =>
                s.key && s.band ? (
                  <td
                    key={s.start}
                    colSpan={s.span}
                    className={cn(
                      'border-b border-slate-100 px-1 py-1.5',
                      monthStarts.has(s.start) && s.start > 0 && 'border-l border-l-slate-300',
                    )}
                  >
                    <span
                      className={cn(
                        'block truncate rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset',
                        SEASON_STYLE[s.key],
                      )}
                    >
                      <span aria-hidden>{t(`yearPlan.seasons.${s.key}`)}</span>
                      <span className="sr-only">
                        {t('yearPlan.grid.seasonDates', {
                          season: t(`yearPlan.seasons.${s.key}`),
                          from: longDate(s.band.from, locale),
                          to: longDate(s.band.to, locale),
                        })}
                      </span>
                    </span>
                  </td>
                ) : (
                  weeks
                    .slice(s.start, s.start + s.span)
                    .map((w) => <td key={w.monday} className={column(w)} />)
                ),
              )}
            </tr>
            {/* One row per subject (a lane per row). */}
            {view.rows.map((row) =>
              row.lanes.map((lane, i) => (
                <tr key={`${row.subject.id}-${i}`}>
                  {i === 0 ? (
                    <th
                      scope="row"
                      rowSpan={row.lanes.length}
                      className={cn(sticky, 'py-2 font-medium text-slate-900')}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: row.subject.color ?? '#94a3b8' }}
                          aria-hidden
                        />
                        <span className="leading-snug">{row.subject.label}</span>
                      </span>
                    </th>
                  ) : null}
                  {lane.map((cell) =>
                    cell.kind === 'empty' ? (
                      <td key={cell.week} className={cn(column(weeks[cell.week]!), 'h-16')} />
                    ) : (
                      <UnitCell
                        key={cell.placed.unit.id}
                        cell={cell}
                        color={row.subject.color}
                        subject={row.subject.label}
                        monthStart={monthStarts.has(cell.start) && cell.start > 0}
                      />
                    ),
                  )}
                </tr>
              )),
            )}
          </tbody>
        </table>
      </YearGridScroller>
    </div>
  );
}

/** The day of a week's first date: « 7 », « 1er ». */
function formatDay(date: string, locale: string) {
  const day = Number(date.slice(8, 10));
  return locale.startsWith('fr') && day === 1 ? '1er' : String(day);
}

/** A unit across its weeks: a button that opens « Planification de l'unité ». */
async function UnitCell({
  cell,
  color,
  subject,
  monthStart,
}: {
  cell: Extract<GridCell<YearPlanUnit>, { kind: 'unit' }>;
  color: string | null;
  subject: string;
  monthStart: boolean;
}) {
  const t = await getTranslations();
  const locale = await getLocale();
  const p: PlacedUnit<YearPlanUnit> = cell.placed;
  const status = t(statusKey(p));
  const dates = t('yearPlan.grid.unitDates', {
    start: longDate(p.startsOn, locale),
    end: longDate(p.endsOn, locale),
  });
  const label = [p.unit.title, status, p.inferred ? t('yearPlan.status.inferred') : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <td
      colSpan={cell.span}
      className={cn(
        'h-16 border-b border-r border-slate-100 p-1 align-top',
        monthStart && 'border-l border-l-slate-300',
      )}
    >
      <UnitPlanButton
        unit={plannedUnitOf(p.unit, p)}
        aria-label={`${label} · ${subject}, ${dates}`}
        title={`${p.unit.title} (${dates})`}
        className={cn(
          'flex h-full min-h-14 w-full flex-col items-start rounded-md border border-l-4 bg-white px-2 py-1.5 text-left shadow-xs hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none',
          p.inferred ? 'border-dashed border-slate-400' : 'border-slate-300',
          p.unit.status === 'completed' && 'bg-slate-50',
        )}
        style={{ borderLeftColor: color ?? '#94a3b8', borderLeftStyle: 'solid' }}
      >
        {/* Kept in view beside the subject column while the unit's first weeks scroll away. */}
        <span
          className="sticky flex max-w-full min-w-0 flex-col gap-1"
          style={{ left: `${SUBJECT_WIDTH + 0.5}rem` }}
        >
          <span className="line-clamp-2 text-[0.8125rem] leading-snug font-semibold break-words text-slate-900">
            {p.unit.title}
          </span>
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs leading-tight">
            <StatusText p={p} label={status} />
            {p.inferred ? (
              <span className="text-slate-600">{t('yearPlan.status.inferred')}</span>
            ) : null}
          </span>
        </span>
      </UnitPlanButton>
    </td>
  );
}

/** A unit's status in words, with a mark that never carries the meaning alone. */
export function StatusText({ p, label }: { p: PlacedUnit<YearPlanUnit>; label: string }) {
  if (p.lateStart) {
    return (
      <span className="inline-flex items-center gap-1 font-semibold text-amber-800">
        <span className="size-1.5 rounded-full bg-amber-600" aria-hidden />
        {label}
      </span>
    );
  }
  switch (p.unit.status) {
    case 'active':
      return (
        <span className="inline-flex items-center gap-1 font-semibold text-emerald-800">
          <span className="size-1.5 rounded-full bg-emerald-600" aria-hidden />
          {label}
        </span>
      );
    case 'completed':
      return (
        <span className="inline-flex items-center gap-1 font-medium text-slate-700">
          <Check className="size-3" aria-hidden />
          {label}
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 font-medium text-brand-800">
          <span className="size-1.5 rounded-full ring-1 ring-brand-700" aria-hidden />
          {label}
        </span>
      );
  }
}
