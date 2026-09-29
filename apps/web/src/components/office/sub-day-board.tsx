import type { LocalDate } from '@lynx/domain';
import { ClipboardCheck, ClipboardList, LoaderCircle, Smartphone } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { capitalize } from '@/components/absences/absence-summary';
import { CodePanel } from '@/components/sub-codes/code-panel';
import type { SubCodeContext } from '@/components/sub-codes/types';
import { PdfLink } from '@/components/sub-plans/pdf-link';
import { ReleaseButton } from '@/components/sub-plans/release-button';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/page';
import { formatInstantTime, formatLocalDate, instantInZone } from '@/lib/format';
import type { SubBoardDay, SubDayRow } from '@/server/queries/sub-office';

export interface BoardSchool {
  id: string;
  name: string;
  shortName: string | null;
  timezone: string;
  officePhone: string | null;
  arrivalInstructions: string | null;
}

/** « Publié à 7 h 30 », « Publié par Mme Tremblay à 7 h 05 », « Sera publié à 7 h 30 ». */
function useReleaseText() {
  const t = useTranslations('office');
  const locale = useLocale();
  return (row: SubDayRow, timeZone: string) => {
    const at = instantInZone(row.releaseAt, timeZone);
    const time = formatInstantTime(row.releaseAt, timeZone, locale);
    const sameDay = at.date === row.planDate;
    const date = formatLocalDate(at.date, locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
    });
    if (!row.released) return sameDay ? t('releaseAt', { time }) : t('releaseAtOn', { date, time });
    if (row.releasedByName) {
      return sameDay
        ? t('releasedBy', { name: row.releasedByName, time })
        : t('releasedByOn', { name: row.releasedByName, date, time });
    }
    return sameDay ? t('released', { time }) : t('releasedOn', { date, time });
  };
}

function BoardRow({
  row,
  school,
  today,
  configured,
  now,
  canReadReports,
  heading: Heading,
}: {
  row: SubDayRow;
  school: BoardSchool;
  today: LocalDate;
  configured: boolean;
  now: string;
  canReadReports: boolean;
  heading: 'h3' | 'h4';
}) {
  const t = useTranslations();
  const tOffice = useTranslations('office');
  const locale = useLocale();
  const releaseText = useReleaseText();
  const context: SubCodeContext = {
    planId: row.planId,
    planDate: row.planDate,
    timezone: school.timezone,
    schoolName: school.name,
    schoolShortName: school.shortName,
    teacherName: row.teacherName,
    classNames: row.classNames,
    roomNames: row.roomNames,
    officePhone: school.officePhone,
    arrivalInstructions: school.arrivalInstructions,
  };
  const upcoming = row.planDate >= today;

  return (
    <Card data-testid="sub-day-row">
      <CardBody className="space-y-3 pt-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <Heading className="font-semibold text-slate-900">
              {tOffice('row', {
                teacher: row.teacherName,
                part: t(`absences.part.${row.part}`),
              })}
            </Heading>
            <p className="text-sm text-slate-600">
              {[...row.classNames, ...row.roomNames].join(' · ')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {row.devices >= 2 ? (
              <Badge tone="warning">
                <Smartphone className="size-3" aria-hidden />
                {tOffice('secondDevice', { count: row.devices })}
              </Badge>
            ) : null}
            <Badge tone={row.released ? 'success' : 'brand'} data-testid="board-status">
              {releaseText(row, school.timezone)}
            </Badge>
          </div>
        </div>

        {row.note ? (
          <p className="text-sm text-slate-700">{tOffice('note', { note: row.note })}</p>
        ) : null}
        {row.refreshing ? (
          <p className="flex items-center gap-1.5 text-sm text-slate-600">
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
            {tOffice('refreshing')}
          </p>
        ) : null}
        <p className="text-sm text-slate-700">
          {[
            tOffice('devicesCount', { count: row.devices }),
            row.firstSessionAt
              ? tOffice('signedInAt', {
                  time: formatInstantTime(row.firstSessionAt, school.timezone, locale),
                })
              : null,
            row.lastSeenAt
              ? tOffice('seenAt', {
                  time: formatInstantTime(row.lastSeenAt, school.timezone, locale),
                })
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}{' '}
          · <span data-testid="board-report">{tOffice(`report.${row.reportStatus}`)}</span>
        </p>

        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary">
            {/* Not prefetched: every view of the plan is audited (D-056). */}
            <Link href={`/absences/${row.absenceId}/plans/${row.planId}`} prefetch={false}>
              <ClipboardList aria-hidden />
              {tOffice('viewPlan')}
            </Link>
          </Button>
          {row.released ? (
            // Printing is audited too (sub_plan.printed); the PDF never has alerts (D-053).
            <PdfLink
              href={`/absences/${row.absenceId}/plans/${row.planId}/pdf`}
              label={t('pdf.print')}
            />
          ) : null}
          {canReadReports &&
          (row.reportStatus === 'submitted' ||
            row.reportStatus === 'confirmed' ||
            (row.reportStatus === 'in_progress' && row.planDate < today)) ? (
            <Button asChild variant="secondary">
              {/* Not prefetched: every view of a report is audited (D-056). */}
              <Link href={`/absences/${row.absenceId}/plans/${row.planId}/report`} prefetch={false}>
                <ClipboardCheck aria-hidden />
                {t('subReport.viewStaff')}
              </Link>
            </Button>
          ) : null}
          {!row.released && upcoming ? (
            <ReleaseButton planId={row.planId} variant="secondary" />
          ) : null}
        </div>

        {row.access ? (
          <div className="border-t border-slate-100 pt-3">
            <CodePanel
              context={context}
              access={row.access}
              generateLabel={t('subCodes.generate')}
              canIssue={upcoming}
              configured={configured}
              now={now}
            />
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

/**
 * « Suppléances »: today (or the chosen day) and the next school day at one school, one card per
 * absent teacher's day. Metadata only (DECISIONS D-056): the plan itself opens through « Voir le
 * plan », which is audited.
 */
export function SubDayBoard({
  school,
  days,
  today,
  configured,
  now,
  showSchoolName,
  canReadReports,
}: {
  school: BoardSchool;
  days: SubBoardDay[];
  today: LocalDate;
  configured: boolean;
  now: string;
  showSchoolName: boolean;
  /** The direction reads reports (audited); office staff see only their status. */
  canReadReports: boolean;
}) {
  const t = useTranslations('office');
  const locale = useLocale();
  // School (when several) > day > teacher.
  const DayHeading = showSchoolName ? 'h3' : 'h2';
  return (
    <section className="space-y-4" aria-label={school.name}>
      {showSchoolName ? (
        <h2 className="text-lg font-semibold text-slate-900">{school.name}</h2>
      ) : null}
      {days.length === 0 ? <EmptyState title={t('noSchoolDays')} /> : null}
      {days.map((day) => (
        <div key={day.date} className="space-y-3">
          <DayHeading className="font-semibold text-slate-800">
            {day.date === today
              ? `${t('today')} · ${formatLocalDate(day.date, locale)}`
              : capitalize(formatLocalDate(day.date, locale))}
          </DayHeading>
          {day.rows.length === 0 ? (
            <p className="text-sm text-slate-600">{t('empty')}</p>
          ) : (
            <ul className="space-y-3">
              {day.rows.map((row) => (
                <li key={row.planId}>
                  <BoardRow
                    row={row}
                    school={school}
                    today={today}
                    configured={configured}
                    now={now}
                    canReadReports={canReadReports}
                    heading={showSchoolName ? 'h4' : 'h3'}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}
