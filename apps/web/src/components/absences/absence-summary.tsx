import { useLocale, useTranslations } from 'next-intl';
import { formatLocalDate, formatShortDate, formatTime } from '@/lib/format';
import type {
  AbsenceSummary as Summary,
  NoSchoolSummary,
  PlanDaySummary,
} from '@/server/sub-plans/summary';

/** « Lundi » at the start of a line; English is already capitalized. */
export function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

/** « 6 périodes à couvrir · Jour 3 · Messe de l'école à 9 h 45 » (without the date). */
export function useDaySummaryText() {
  const t = useTranslations('absences');
  const locale = useLocale();
  return (day: PlanDaySummary) =>
    [
      day.cycle && day.dayKey ? t('dayOfCycle', { n: day.dayKey }) : null,
      t('summary', { count: day.periods }),
      ...day.events.map((e) =>
        e.start ? t('eventAt', { title: e.title, time: formatTime(e.start, locale) }) : e.title,
      ),
    ]
      .filter(Boolean)
      .join(' · ');
}

/** « Ven. 9 oct. : Journée pédagogique — pas de plan » */
export function NoSchoolLine({ day }: { day: NoSchoolSummary }) {
  const t = useTranslations('absences');
  const locale = useLocale();
  return (
    <li className="text-sm text-slate-600">
      {t('noSchoolDay', { date: capitalize(formatShortDate(day.date, locale)), title: day.title })}
    </li>
  );
}

/**
 * The live summary of an absence before it is sent: one line per school day, days without
 * school listed without a plan.
 */
export function AbsenceSummaryList({ summary }: { summary: Summary }) {
  const t = useTranslations('absences');
  const locale = useLocale();
  const dayText = useDaySummaryText();
  if (summary.days.length === 0) {
    return (
      <div className="space-y-1">
        <p className="text-sm text-amber-800">{t('noSchoolDays')}</p>
        <ul className="space-y-1">
          {summary.noSchool.map((d) => (
            <NoSchoolLine key={d.date} day={d} />
          ))}
        </ul>
      </div>
    );
  }
  const lines = [
    ...summary.days.map((d) => ({ date: d.date, day: d, closed: null })),
    ...summary.noSchool.map((d) => ({ date: d.date, day: null, closed: d })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <ul className="space-y-1" data-testid="absence-summary">
      {lines.map((l) =>
        l.day ? (
          <li key={l.date} className="text-sm text-slate-800">
            <span className="font-medium">{capitalize(formatLocalDate(l.date, locale))}</span>
            {' · '}
            {dayText(l.day)}
          </li>
        ) : (
          <NoSchoolLine key={l.date} day={l.closed!} />
        ),
      )}
    </ul>
  );
}
