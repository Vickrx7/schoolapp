import {
  datesInRange,
  formalStaffName,
  isWeekend,
  localDateIn,
  noSchoolEventOn,
  type LocalDate,
} from '@lynx/domain';
import { ChevronLeft, ClipboardList } from 'lucide-react';
import type { Metadata } from 'next';
import { useLocale, useTranslations } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { AbsenceActions } from '@/components/absences/absence-actions';
import { AbsenceDays } from '@/components/absences/absence-days';
import { AbsenceStatusPoller } from '@/components/absences/absence-status-poller';
import { capitalize, NoSchoolLine, useDaySummaryText } from '@/components/absences/absence-summary';
import { useAbsenceTitle } from '@/components/absences/absence-title';
import { PlanStatusBadge } from '@/components/absences/plan-status-badge';
import type { SubAccess } from '@/components/sub-codes/access-view';
import { CodePanel } from '@/components/sub-codes/code-panel';
import type { SubCodeContext } from '@/components/sub-codes/types';
import { ReleaseButton } from '@/components/sub-plans/release-button';
import { Button } from '@/components/ui/button';
import { Card, CardBody, Notice } from '@/components/ui/card';
import { EmptyState, PageHeader } from '@/components/ui/page';
import { formatLocalDate, formatShortDate } from '@/lib/format';
import { loadAbsence, loadSchoolEvents, type AbsencePlanRow } from '@/server/queries/absences';
import { loadSubAccess } from '@/server/queries/sub-access';
import { findSchool, requireSession } from '@/server/session';
import { subPortalConfigured } from '@/server/sub-portal/db';
import { subCodeKeys } from '@/server/sub-portal/keys';
import { createSupabaseServerClient } from '@/server/supabase';

type Params = { params: Promise<{ absenceId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('absences');
  return { title: t('title') };
}

/**
 * One day of the absence: its release status, what it covers, the owner's actions and, for a
 * day not over yet, « Code pour la personne suppléante » (D-050) when she knows who is coming.
 */
function PlanDayPanel({
  absenceId,
  plan,
  timeZone,
  today,
  codes,
}: {
  absenceId: string;
  plan: AbsencePlanRow;
  timeZone: string;
  today: LocalDate;
  codes: {
    access: SubAccess;
    context: SubCodeContext;
    configured: boolean;
    now: string;
  } | null;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const dayText = useDaySummaryText();
  return (
    <Card>
      <CardBody className="space-y-3 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-slate-900">
            {capitalize(formatLocalDate(plan.planDate, locale))}
          </h2>
          <PlanStatusBadge plan={plan} timeZone={timeZone} />
        </div>
        {plan.summary ? (
          <p className="text-sm text-slate-700">{dayText(plan.summary)}</p>
        ) : (
          <p className="text-sm text-amber-800">{t('subPlan.notReadable')}</p>
        )}
        {plan.summary &&
        (plan.summary.planWarnings.length > 0 || plan.summary.blockWarnings > 0) ? (
          <p className="text-sm text-amber-800">
            {[
              ...plan.summary.planWarnings.map((w) => t(`subPlan.warnings.${w}`)),
              plan.summary.blockWarnings > 0
                ? t('absences.blocksToCheck', { count: plan.summary.blockWarnings })
                : null,
            ]
              .filter(Boolean)
              .join(' ')}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button asChild variant={plan.released ? 'secondary' : 'primary'}>
            <Link href={`/absences/${absenceId}/plans/${plan.id}`}>
              <ClipboardList aria-hidden />
              {t('subPlan.review')}
            </Link>
          </Button>
          {!plan.released && plan.planDate >= today ? (
            <ReleaseButton planId={plan.id} variant="secondary" />
          ) : null}
        </div>
        {codes ? (
          <div className="border-t border-slate-100 pt-3">
            <h3 className="mb-2 text-sm font-semibold text-slate-800">{t('subCodes.title')}</h3>
            <CodePanel
              context={codes.context}
              access={codes.access}
              generateLabel={t('subCodes.forSubstitute')}
              canIssue={plan.planDate >= today}
              configured={codes.configured}
              now={codes.now}
            />
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

/** A title that the page and its heading share. */
function AbsenceHeading({ startsOn, endsOn }: { startsOn: string; endsOn: string }) {
  const title = useAbsenceTitle();
  return <>{title({ startsOn, endsOn })}</>;
}

/**
 * « Absence du lundi 5 octobre »: the plan of each school day is ready as soon as the absence
 * is published (it is built in the same request, D-047). One tab per school day; days without
 * school are listed without a plan. (Direction and office get their view of absences with the
 * substitute portal; this page is the owner's.)
 */
export default async function AbsencePage({ params }: Params) {
  const session = await requireSession();
  const { absenceId } = await params;
  if (!z.uuid().safeParse(absenceId).success) notFound();
  const absence = await loadAbsence(session, absenceId);
  if (!absence || !absence.isOwner) notFound();
  const school = findSchool(session, absence.schoolId);
  if (!school) notFound();
  const t = await getTranslations();
  const locale = await getLocale();

  const back = (
    <Link
      href="/absences"
      className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
    >
      <ChevronLeft className="size-4" aria-hidden />
      {t('absences.title')}
    </Link>
  );

  if (absence.status !== 'published') {
    return (
      <div>
        <PageHeader back={back} title={<AbsenceHeading {...absence} />} />
        <EmptyState title={t('absences.cancelled')} />
      </div>
    );
  }

  const today = localDateIn(school.timezone);
  const supabase = await createSupabaseServerClient();
  const events = await loadSchoolEvents(supabase, school, absence.startsOn, absence.endsOn);
  const planDates = new Set(absence.plans.map((p) => p.planDate));
  const noSchool = datesInRange(absence.startsOn, absence.endsOn).flatMap((date) => {
    if (planDates.has(date) || isWeekend(date)) return [];
    const event = noSchoolEventOn(events, date);
    return event ? [{ date, reason: event.eventType, title: event.title }] : [];
  });
  const upcoming = absence.plans.filter((p) => p.planDate >= today);
  // Codes and devices of the days not over yet (metadata only).
  const accessByPlan = new Map(
    await Promise.all(
      upcoming.map(async (p) => [p.id, await loadSubAccess(supabase, p.id)] as const),
    ),
  );
  const codesConfigured = subPortalConfigured() && subCodeKeys() !== null;
  const now = new Date().toISOString();
  const codesFor = (p: AbsencePlanRow) => {
    const access = accessByPlan.get(p.id);
    if (!access) return null;
    return {
      access,
      configured: codesConfigured,
      now,
      context: {
        planId: p.id,
        planDate: p.planDate,
        timezone: school.timezone,
        schoolName: school.name,
        schoolShortName: school.shortName,
        teacherName: formalStaffName(session.displayName, session.honorific),
        classNames: p.classNames,
        roomNames: p.roomNames,
        officePhone: school.settings.contact.officePhone?.trim() || null,
        arrivalInstructions: school.settings.substitute.arrivalInstructions,
      },
    };
  };

  return (
    <div className="space-y-4">
      <PageHeader
        back={back}
        title={<AbsenceHeading {...absence} />}
        subtitle={t(`absences.part.${absence.part}`)}
        actions={
          <AbsenceActions
            absence={{
              id: absence.id,
              startsOn: absence.startsOn,
              endsOn: absence.endsOn,
              part: absence.part,
              note: absence.note,
              catholicConnection: absence.catholicConnection,
            }}
            canRefresh={upcoming.length > 0}
          />
        }
      />

      {absence.note ? <Notice>{t('absences.noteLabel', { note: absence.note })}</Notice> : null}
      {absence.refreshing && upcoming.length > 0 ? (
        <AbsenceStatusPoller absenceId={absence.id} />
      ) : null}

      {absence.plans.length === 0 ? <EmptyState title={t('absences.noSchoolDays')} /> : null}

      <AbsenceDays
        initialKey={upcoming[0]?.planDate}
        tabs={absence.plans.map((p) => ({
          key: p.planDate,
          label: capitalize(formatShortDate(p.planDate, locale)),
          content: (
            <PlanDayPanel
              absenceId={absence.id}
              plan={p}
              timeZone={school.timezone}
              today={today}
              codes={codesFor(p)}
            />
          ),
        }))}
        footer={
          noSchool.length > 0 ? (
            <ul className="space-y-1">
              {noSchool.map((d) => (
                <NoSchoolLine key={d.date} day={d} />
              ))}
            </ul>
          ) : null
        }
      />
    </div>
  );
}
