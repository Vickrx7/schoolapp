import {
  addDays,
  isLocalDate,
  isoWeekday,
  localDateIn,
  localMinutesIn,
  timeToMinutes,
} from '@lynx/domain';
import {
  CalendarX,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  MapPin,
} from 'lucide-react';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AbsenceList } from '@/components/absences/absence-list';
import { CheckOffButton } from '@/components/app/check-off-button';
import { PurgeNotice } from '@/components/onboarding/class-notices';
import { SampleBadge } from '@/components/onboarding/sample-badge';
import { TeacherChecklist } from '@/components/onboarding/teacher-checklist';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, CardTitle, Notice } from '@/components/ui/card';
import { EmptyState, PageHeader } from '@/components/ui/page';
import { formatLocalDate, formatTime, formatTimeRange } from '@/lib/format';
import { cn } from '@/lib/utils';
import { loadMyAbsences } from '@/server/queries/absences';
import { loadTeacherOnboarding } from '@/server/queries/onboarding';
import { loadPendingReports } from '@/server/queries/sub-reports';
import { loadToday, type TodayBlock } from '@/server/queries/today';
import {
  landingFor,
  requireSession,
  substituteBoardSchools,
  teachingSchools,
} from '@/server/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('today');
  return { title: t('title') };
}

/** Previous/next school weekday (skips Saturday and Sunday). */
function stepWeekday(date: string, direction: 1 | -1): string {
  let d = addDays(date, direction);
  while (isoWeekday(d) >= 6) d = addDays(d, direction);
  return d;
}

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const session = await requireSession();
  const schools = teachingSchools(session);
  // Whoever does not teach has a landing page of their own (DECISIONS D-118).
  if (schools.length === 0) redirect(landingFor(session));

  const t = await getTranslations('today');
  const tAbsences = await getTranslations('absences');
  const tNav = await getTranslations('nav');
  // A teaching principal (or office staff who also teach): the phone bar has no room for
  // « Suppléances » (components/app/nav-items.ts), so the board is linked from here.
  const showBoard = substituteBoardSchools(session).length > 0;
  const locale = await getLocale();
  const timezone = schools[0]!.timezone;
  const today = localDateIn(timezone);
  const { date: requested } = await searchParams;
  const date = requested && isLocalDate(requested) ? requested : today;
  const [data, upcomingAbsences, pendingReports, onboarding] = await Promise.all([
    loadToday(session, date, locale),
    loadMyAbsences(session, { from: today, limit: 5 }),
    loadPendingReports(),
    loadTeacherOnboarding(session),
  ]);
  // « Pour bien commencer » until it is done or hidden (D-109); sample classes carry « Exemple ».
  const showChecklist = !onboarding.dismissed && onboarding.done < onboarding.total;
  const samples = new Set(onboarding.sampleClassIds);
  const tReport = await getTranslations('subReport');
  const tOnboarding = await getTranslations('onboarding');
  const isToday = date === today;
  const nowMinutes = isToday ? localMinutesIn(timezone) : null;
  const multipleClasses = new Set(data.blocks.map((b) => b.classId)).size > 1;

  const dayInfo = data.schoolDays[0]?.day;
  const subtitle = [
    formatLocalDate(date, locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
    dayInfo?.status === 'instructional' && schools[0]!.scheduleType === 'cycle'
      ? t('dayOfCycle', { n: dayInfo.dayKey })
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div>
      <PageHeader
        title={isToday ? t('title') : formatLocalDate(date, locale)}
        subtitle={subtitle}
        actions={
          <div className="flex flex-wrap items-center gap-1">
            <Button asChild variant="secondary" className="mr-1">
              <Link href="/absences/new">
                <CalendarX aria-hidden />
                {tAbsences('quick')}
              </Link>
            </Button>
            {showBoard ? (
              <Button asChild variant="secondary" className="mr-1 md:hidden">
                <Link href="/absences">
                  <ClipboardList aria-hidden />
                  {tNav('substitutes')}
                </Link>
              </Button>
            ) : null}
            <Button asChild variant="secondary" size="icon">
              <Link href={`/today?date=${stepWeekday(date, -1)}`} aria-label={t('previousDay')}>
                <ChevronLeft />
              </Link>
            </Button>
            {!isToday ? (
              <Button asChild variant="secondary">
                <Link href="/today">{t('backToToday')}</Link>
              </Button>
            ) : null}
            <Button asChild variant="secondary" size="icon">
              <Link href={`/today?date=${stepWeekday(date, 1)}`} aria-label={t('nextDay')}>
                <ChevronRight />
              </Link>
            </Button>
          </div>
        }
      />

      {pendingReports.length > 0 ? (
        <div className="mb-4 space-y-2">
          {/* The substitute's report is back: confirm it (D-054). */}
          {pendingReports.map((r) => (
            <Notice
              key={r.reportId}
              tone={r.status === 'submitted' ? 'info' : 'warning'}
              className="flex flex-wrap items-center justify-between gap-2"
              data-testid="report-banner"
            >
              <span className="flex items-center gap-2">
                <ClipboardCheck className="size-4 shrink-0" aria-hidden />
                {tReport(r.status === 'submitted' ? 'banner' : 'bannerDraft', {
                  date: formatLocalDate(r.planDate, locale, {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  }),
                })}
              </span>
              <Link
                href={`/absences/${r.absenceId}/plans/${r.planId}/report`}
                className="inline-flex min-h-11 items-center font-medium underline underline-offset-2"
              >
                {tReport('bannerAction')}
              </Link>
            </Notice>
          ))}
        </div>
      ) : null}

      {onboarding.purgeNotices.length > 0 ? (
        <div className="mb-4 space-y-2">
          {/* Students' first names are erased after the school year (D-105). */}
          {onboarding.purgeNotices.map((n) => (
            <PurgeNotice key={n.classId} className={n.className} purgeOn={n.purgeOn} />
          ))}
        </div>
      ) : null}

      {showChecklist ? (
        <TeacherChecklist data={onboarding} variant="card" />
      ) : (
        // The checklist says it too; without it, each sample class is still announced.
        onboarding.samples.map((sample) => (
          <Notice key={sample.id} tone="info" className="mb-4" data-testid="sample-notice">
            <Link
              href={`/classes/${sample.id}/students`}
              className="font-medium underline underline-offset-2"
            >
              {sample.name}
            </Link>{' '}
            ·{' '}
            {tOnboarding('sample.notice', {
              date: formatLocalDate(sample.purgeOn, locale, {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              }),
            })}
          </Notice>
        ))
      )}

      {upcomingAbsences.length > 0 ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>{tAbsences('upcoming')}</CardTitle>
          </CardHeader>
          <CardBody>
            <AbsenceList
              absences={upcomingAbsences}
              timezones={Object.fromEntries(session.schools.map((s) => [s.id, s.timezone]))}
            />
          </CardBody>
        </Card>
      ) : null}

      {!data.hasClasses ? (
        <EmptyState
          title={t('noClasses')}
          action={
            <Button asChild>
              <Link href="/classes">{t('createClass')}</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {data.schoolDays.map((sd) =>
            sd.day.status === 'no_school' ? (
              <Notice key={sd.schoolId} tone="info">
                {sd.day.reason === 'weekend'
                  ? t('weekend')
                  : t('noSchool', { title: sd.day.event?.title ?? '' })}
              </Notice>
            ) : sd.day.status === 'unknown_cycle_day' ? (
              <Notice key={sd.schoolId} tone="warning">
                {t('unknownCycle')}
              </Notice>
            ) : null,
          )}

          {data.schoolDays.some(
            (sd) => sd.day.status === 'instructional' && sd.events.length > 0,
          ) ? (
            <Card className="p-4">
              <h2 className="mb-2 text-sm font-semibold text-slate-700">{t('events')}</h2>
              <ul className="space-y-1 text-sm">
                {data.schoolDays.flatMap((sd) =>
                  sd.events.map((e) => (
                    <li key={e.id} className="flex flex-wrap gap-x-2">
                      <span className="font-medium">{e.title}</span>
                      {e.startTime || e.endTime ? (
                        <span className="text-slate-600">
                          {e.startTime && e.endTime
                            ? formatTimeRange(e.startTime, e.endTime, locale)
                            : e.startTime
                              ? formatTime(e.startTime, locale)
                              : formatTime(e.endTime!, locale)}
                        </span>
                      ) : null}
                    </li>
                  )),
                )}
              </ul>
            </Card>
          ) : null}

          {data.blocks.length === 0 &&
          data.schoolDays.every((sd) => sd.day.status === 'instructional') ? (
            <EmptyState
              title={t('noBlocks')}
              action={
                <Button asChild variant="secondary">
                  <Link href="/classes">{t('setUpTimetable')}</Link>
                </Button>
              }
            />
          ) : null}

          <ol className="space-y-3">
            {data.blocks.map((block) => (
              <li key={block.id}>
                <BlockCard
                  block={block}
                  date={date}
                  showClass={multipleClasses}
                  sample={samples.has(block.classId)}
                  current={
                    nowMinutes !== null &&
                    nowMinutes >= timeToMinutes(block.effectiveStart) &&
                    nowMinutes < timeToMinutes(block.effectiveEnd)
                  }
                />
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

async function BlockCard({
  block,
  date,
  showClass,
  sample,
  current,
}: {
  block: TodayBlock;
  date: string;
  showClass: boolean;
  /** A sample class's block (D-109): « Exemple ». */
  sample: boolean;
  current: boolean;
}) {
  const t = await getTranslations();
  const locale = await getLocale();
  const inactive = block.status === 'cancelled' || block.status === 'replaced';
  const heading =
    block.subject?.label ??
    block.title ??
    t(`timetable.kinds.${block.kind}` as 'timetable.kinds.other');
  const statusLabel = block.status !== 'normal' ? t(`today.status.${block.status}`) : null;

  if (block.kind !== 'subject') {
    return (
      <div
        className={cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-600',
          current && 'bg-brand-50 text-brand-900',
          inactive && 'line-through opacity-60',
        )}
      >
        <span className="shrink-0 whitespace-nowrap tabular-nums sm:w-32">
          {formatTimeRange(block.effectiveStart, block.effectiveEnd, locale)}
        </span>
        <span>{block.title ?? heading}</span>
        {statusLabel ? <Badge tone="warning">{statusLabel}</Badge> : null}
      </div>
    );
  }

  return (
    <Card
      className={cn(
        'overflow-hidden',
        current && 'ring-2 ring-brand-500',
        inactive && 'opacity-70',
      )}
    >
      <div className="flex">
        <div
          className="w-1.5 shrink-0"
          style={{ backgroundColor: block.subject?.color ?? '#94a3b8' }}
          aria-hidden
        />
        <div className="min-w-0 flex-1 p-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-sm font-medium tabular-nums text-slate-600">
              {formatTimeRange(block.effectiveStart, block.effectiveEnd, locale)}
            </span>
            <h2 className={cn('font-semibold', inactive && 'line-through')}>{heading}</h2>
            {showClass ? <Badge>{block.className}</Badge> : null}
            {sample ? <SampleBadge /> : null}
            {statusLabel ? (
              <Badge tone="warning">
                {block.affectedBy
                  ? t('today.affectedBy', { status: statusLabel, event: block.affectedBy.title })
                  : statusLabel}
              </Badge>
            ) : null}
            {block.roomName ? (
              <span className="inline-flex items-center gap-1 text-sm text-slate-500">
                <MapPin className="size-3.5" aria-hidden />
                {block.roomName}
              </span>
            ) : null}
          </div>

          {block.lesson ? (
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                  {block.lesson.taught ? t('today.taught') : t('today.nextLesson')} ·{' '}
                  {t('lessons.number', { n: block.lesson.sequenceNumber })}
                </p>
                <p className="font-medium text-slate-900">{block.lesson.title}</p>
                {block.lesson.objectives ? (
                  <p className="mt-1 line-clamp-2 text-sm text-slate-600">
                    {block.lesson.objectives}
                  </p>
                ) : null}
                <Link
                  href={`/classes/${block.classId}/planning/${block.lesson.unitId}`}
                  className="mt-1 inline-block text-sm text-brand-700 hover:underline"
                >
                  {block.lesson.unitTitle}
                </Link>
                {block.gapTitle ? (
                  <p className="mt-2 text-sm text-amber-800">
                    {t('today.gapWarning', { title: block.gapTitle })}
                  </p>
                ) : null}
              </div>
              {block.lesson.pendingConfirmation ? (
                // Confirmed only through the substitute's report, never checked off here.
                block.lesson.pendingReport ? (
                  <Link
                    href={`/absences/${block.lesson.pendingReport.absenceId}/plans/${block.lesson.pendingReport.planId}/report`}
                    className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-amber-100 px-3 text-sm font-medium text-amber-900 underline-offset-2 hover:underline"
                    data-testid="pending-chip"
                  >
                    {t('subReport.pendingChip')}
                  </Link>
                ) : (
                  <Badge tone="warning" data-testid="pending-chip">
                    {t('subReport.pendingChip')}
                  </Badge>
                )
              ) : !inactive ? (
                <CheckOffButton
                  lessonId={block.lesson.id}
                  lessonTitle={block.lesson.title}
                  date={date}
                  taught={block.lesson.taught}
                />
              ) : null}
            </div>
          ) : block.lessonState === 'no_active_unit' ? (
            <p className="mt-2 text-sm text-slate-600">
              {t('today.noActiveUnit')}{' '}
              <Link
                href={`/classes/${block.classId}/planning`}
                className="text-brand-700 underline underline-offset-2 hover:text-brand-800"
              >
                {t('today.planUnit')}
              </Link>
            </p>
          ) : block.lessonState === 'unit_finished' ? (
            <p className="mt-2 text-sm text-slate-600">
              {t('today.unitFinished')}{' '}
              <Link
                href={`/classes/${block.classId}/planning`}
                className="text-brand-700 underline underline-offset-2 hover:text-brand-800"
              >
                {t('today.planUnit')}
              </Link>
            </p>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
