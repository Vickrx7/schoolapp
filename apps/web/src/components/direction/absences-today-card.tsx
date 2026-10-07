import type { LocalDate } from '@lynx/domain';
import { ChevronDown, ClipboardList } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useReleaseText } from '@/components/office/sub-day-board';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader } from '@/components/ui/card';
import { formatLocalDate } from '@/lib/format';
import type { SubBoardDay, SubDayRow } from '@/server/queries/sub-office';

/** One absent teacher's day, compact: who, classes and rooms, then statuses as text badges. */
function AbsenceRow({ row, timeZone }: { row: SubDayRow; timeZone: string }) {
  const t = useTranslations();
  const releaseText = useReleaseText();
  return (
    <li className="space-y-1.5 py-3 first:pt-0 last:pb-0" data-testid="direction-absence">
      <p className="font-medium text-slate-900">
        {t('office.row', { teacher: row.teacherName, part: t(`absences.part.${row.part}`) })}
      </p>
      {row.classNames.length + row.roomNames.length > 0 ? (
        <p className="text-sm text-slate-600">
          {[...row.classNames, ...row.roomNames].join(' · ')}
        </p>
      ) : null}
      <p className="flex flex-wrap gap-1.5">
        {row.refreshing ? (
          <Badge tone="warning">{t('office.refreshing')}</Badge>
        ) : (
          <Badge tone={row.released ? 'success' : 'brand'}>{releaseText(row, timeZone)}</Badge>
        )}
        <Badge>{t('direction.absences.codes', { count: row.activeCodes })}</Badge>
        <Badge>{t('office.devicesCount', { count: row.devices })}</Badge>
        <Badge tone={row.reportStatus === 'none' ? 'neutral' : 'success'}>
          {t(`office.report.${row.reportStatus}`)}
        </Badge>
      </p>
    </li>
  );
}

function DayRows({ day, empty, timeZone }: { day: SubBoardDay; empty: string; timeZone: string }) {
  if (day.rows.length === 0) return <p className="text-sm text-slate-600">{empty}</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {day.rows.map((row) => (
        <AbsenceRow key={row.planId} row={row} timeZone={timeZone} />
      ))}
    </ul>
  );
}

/**
 * « Absences aujourd'hui » (DECISIONS D-102): who is away today, their plan's status, codes,
 * devices and the end-of-day report, from the « Suppléances » rows; the next school day is
 * folded away. On a day without school, the next school day is shown open. Metadata only: the
 * plans open from « Suppléances », where every view is audited.
 */
export function AbsencesTodayCard({
  days,
  today,
  timeZone,
}: {
  days: SubBoardDay[];
  today: LocalDate;
  timeZone: string;
}) {
  const t = useTranslations('direction.absences');
  const locale = useLocale();
  const [first, second] = days;
  const dayLabel = (date: LocalDate) =>
    formatLocalDate(date, locale, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <Card>
      <CardHeader>
        <h3 className="text-base font-semibold text-slate-900">{t('title')}</h3>
      </CardHeader>
      <CardBody className="space-y-4">
        {!first ? (
          <p className="text-sm text-slate-600">{t('noSchoolDays')}</p>
        ) : first.date === today ? (
          <>
            <DayRows day={first} empty={t('empty')} timeZone={timeZone} />
            {second ? (
              <details className="group rounded-lg border border-slate-200">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-medium text-slate-800 [&::-webkit-details-marker]:hidden">
                  {t('nextDay', { date: dayLabel(second.date) })}
                  <ChevronDown
                    className="size-4 shrink-0 text-slate-500 transition-transform group-open:rotate-180"
                    aria-hidden
                  />
                </summary>
                <div className="px-3 pb-3">
                  <DayRows day={second} empty={t('emptyDay')} timeZone={timeZone} />
                </div>
              </details>
            ) : null}
          </>
        ) : (
          <>
            <p className="text-sm text-slate-600">{t('noSchoolToday')}</p>
            <h4 className="text-sm font-semibold text-slate-800">
              {t('nextDay', { date: dayLabel(first.date) })}
            </h4>
            <DayRows day={first} empty={t('emptyDay')} timeZone={timeZone} />
          </>
        )}
        <Button asChild variant="secondary">
          <Link href="/absences">
            <ClipboardList aria-hidden />
            {t('open')}
          </Link>
        </Button>
      </CardBody>
    </Card>
  );
}
