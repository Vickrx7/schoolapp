import {
  addDays,
  isLocalDate,
  isoWeekday,
  localDateIn,
  localMinutesIn,
  timeToMinutes,
} from '@lynx/domain';
import { ChevronLeft, ChevronRight, MapPin } from 'lucide-react';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CheckOffButton } from '@/components/app/check-off-button';
import { Button } from '@/components/ui/button';
import { Badge, Card, Notice } from '@/components/ui/card';
import { EmptyState, PageHeader } from '@/components/ui/page';
import { formatLocalDate, formatTime, formatTimeRange } from '@/lib/format';
import { cn } from '@/lib/utils';
import { loadToday, type TodayBlock } from '@/server/queries/today';
import { requireSession, teachingSchools } from '@/server/session';

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
  if (schools.length === 0) redirect('/calendar');

  const t = await getTranslations('today');
  const locale = await getLocale();
  const timezone = schools[0]!.timezone;
  const today = localDateIn(timezone);
  const { date: requested } = await searchParams;
  const date = requested && isLocalDate(requested) ? requested : today;
  const data = await loadToday(session, date, locale);
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
          <div className="flex items-center gap-1">
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
  current,
}: {
  block: TodayBlock;
  date: string;
  showClass: boolean;
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
              {!inactive ? (
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
