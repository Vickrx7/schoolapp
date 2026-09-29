import { ChevronLeft } from 'lucide-react';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { capitalize } from '@/components/absences/absence-summary';
import { ConfirmReport } from '@/components/sub-reports/confirm-report';
import { MarkPlannedButton } from '@/components/sub-reports/mark-planned-button';
import { ReportLessonList, ReportNotes } from '@/components/sub-reports/report-details';
import { Card, CardBody, Notice } from '@/components/ui/card';
import { EmptyState, PageHeader } from '@/components/ui/page';
import { formatInstantTime, formatLocalDate, instantInZone } from '@/lib/format';
import {
  loadReportForOwner,
  loadReportForStaff,
  type ReportView,
} from '@/server/queries/sub-reports';
import { findSchool, hasModule, hasRole, requireSession } from '@/server/session';
import { createSupabaseServerClient } from '@/server/supabase';

type Params = { params: Promise<{ absenceId: string; planId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('subReport');
  return { title: t('confirmTitle') };
}

function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
    >
      <ChevronLeft className="size-4" aria-hidden />
      {label}
    </Link>
  );
}

/** « Envoyé le … à … » / « Suivi confirmé le … à … », in the school's time zone. */
async function StatusLine({ report, timeZone }: { report: ReportView; timeZone: string }) {
  const t = await getTranslations('subReport');
  const locale = await getLocale();
  const at = (instant: string) => ({
    date: formatLocalDate(instantInZone(instant, timeZone).date, locale),
    time: formatInstantTime(instant, timeZone, locale),
  });
  if (report.status === 'confirmed' && report.confirmedAt) {
    return (
      <Notice tone="success" data-testid="report-confirmed">
        {t('confirmedOn', at(report.confirmedAt))}
      </Notice>
    );
  }
  if (report.status === 'draft') return <Notice tone="warning">{t('unsentDraft')}</Notice>;
  return report.submittedAt ? (
    <p className="text-sm text-slate-600">{t('sentAt', at(report.submittedAt))}</p>
  ) : null;
}

/**
 * The direction (DECISIONS D-056): the report read-only, through get_sub_report_for_staff,
 * which audits every view. Office staff only see the report's status on their board.
 */
async function StaffReportPage({ absenceId, planId }: { absenceId: string; planId: string }) {
  const session = await requireSession();
  // The absence (RLS: owner, direction and office) tells which school's licence applies.
  const supabase = await createSupabaseServerClient();
  const { data: absence } = await supabase
    .from('absences')
    .select('school_id')
    .eq('id', absenceId)
    .maybeSingle();
  const school = absence ? findSchool(session, absence.school_id) : null;
  if (
    !absence ||
    !school ||
    !hasModule(school, 'teaching') ||
    !hasRole(school, 'principal', 'vice_principal')
  ) {
    notFound();
  }
  const staff = await loadReportForStaff(planId);
  if (!staff || staff.absenceId !== absenceId) notFound();
  const t = await getTranslations();
  const locale = await getLocale();

  return (
    <div className="space-y-4">
      <PageHeader
        back={<BackLink href="/absences" label={t('subPlanStaff.back')} />}
        title={t('subReport.confirmTitle')}
        subtitle={[
          capitalize(formatLocalDate(staff.planDate, locale)),
          staff.teacherName,
          t(`absences.part.${staff.part}`),
        ].join(' · ')}
      />
      {staff.report ? (
        <>
          <Notice>{t('subReport.readOnlyStaff')}</Notice>
          <StatusLine report={staff.report} timeZone={school.timezone} />
          <ReportLessonList lessons={staff.report.lessons} locale={locale} showProgress={false} />
          <ReportNotes report={staff.report} />
        </>
      ) : (
        <EmptyState title={t('subReport.staffNone')} />
      )}
    </div>
  );
}

/**
 * « Suivi de la suppléance » (DECISIONS D-054): the absent teacher reads what the substitute
 * reported and confirms it, lesson by lesson; that is the only way the report's lessons become
 * completed. A draft the substitute never sent can be confirmed once the day's access is over;
 * with no report at all, « Marquer les leçons prévues comme données ».
 */
export default async function SubReportPage({ params }: Params) {
  const session = await requireSession();
  const { absenceId, planId } = await params;
  if (!z.uuid().safeParse(absenceId).success || !z.uuid().safeParse(planId).success) notFound();
  const owned = await loadReportForOwner(session, planId);
  if (!owned) return <StaffReportPage absenceId={absenceId} planId={planId} />;
  const { plan, report } = owned;
  if (plan.absence.id !== absenceId) notFound();
  const t = await getTranslations();
  const locale = await getLocale();
  const timeZone = plan.context.timezone;

  const back = (
    <BackLink
      href={`/absences/${absenceId}`}
      label={
        plan.absence.startsOn === plan.absence.endsOn
          ? t('absences.titleOne', { date: formatLocalDate(plan.absence.startsOn, locale) })
          : t('absences.titleRange', {
              start: formatLocalDate(plan.absence.startsOn, locale),
              end: formatLocalDate(plan.absence.endsOn, locale),
            })
      }
    />
  );

  return (
    <div className="space-y-4">
      <PageHeader
        back={back}
        title={t('subReport.confirmTitle')}
        subtitle={[
          capitalize(formatLocalDate(plan.planDate, locale)),
          t(`absences.part.${plan.absence.part}`),
        ].join(' · ')}
      />

      {!report ? (
        owned.windowEnded ? (
          <Card>
            <CardBody className="space-y-3 pt-4">
              <h2 className="font-semibold text-slate-900">{t('subReport.noReport')}</h2>
              <p className="text-sm text-slate-700">{t('subReport.noReportHint')}</p>
              {owned.unreported.length > 0 ? (
                <MarkPlannedButton planId={plan.id} count={owned.unreported.length} />
              ) : null}
            </CardBody>
          </Card>
        ) : (
          <Notice>{t('subReport.notYet')}</Notice>
        )
      ) : (
        <>
          <StatusLine report={report} timeZone={timeZone} />
          {report.status === 'confirmed' ? (
            <ReportLessonList lessons={report.lessons} locale={locale} showProgress />
          ) : (
            <ConfirmReport
              key={report.updatedAt}
              reportId={report.reportId}
              shownVersion={report.updatedAt}
              lessons={report.lessons}
            />
          )}
          {owned.unreported.length > 0 ? (
            <section className="space-y-2">
              <h2 className="font-semibold text-slate-900">{t('subReport.unreportedTitle')}</h2>
              <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                {owned.unreported.map((l) => (
                  <li key={l.lessonId}>
                    {t('subReport.lessonLine', { n: l.sequenceNumber, title: l.title })}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <ReportNotes report={report} />
        </>
      )}
    </div>
  );
}
