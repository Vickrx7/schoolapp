import { composeSubPlan } from '@lynx/domain';
import { ChevronLeft } from 'lucide-react';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { capitalize } from '@/components/absences/absence-summary';
import { PlanStatusBadge } from '@/components/absences/plan-status-badge';
import { SubPlanAiPanel } from '@/components/sub-plans/ai-panel';
import { AlertsReveal } from '@/components/sub-plans/alerts-reveal';
import { PlanEditor } from '@/components/sub-plans/plan-editor';
import { PdfLink } from '@/components/sub-plans/pdf-link';
import { PlanView } from '@/components/sub-plans/plan-view';
import { ReleaseButton } from '@/components/sub-plans/release-button';
import { Notice } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page';
import { formatInstantTime, formatLocalDate, instantInZone } from '@/lib/format';
import { hasActivitySheets } from '@/server/pdf/activities-model';
import { loadSubPlanAiState } from '@/server/queries/sub-plan-ai';
import {
  loadPlanForOwner,
  loadPlanForStaff,
  staffSchoolForAbsence,
} from '@/server/queries/sub-plans';
import { requireSession, type SessionContext } from '@/server/session';
import { createSupabaseServerClient } from '@/server/supabase';

type Params = { params: Promise<{ absenceId: string; planId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('subPlan');
  return { title: t('title') };
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

/**
 * Direction and office (DECISIONS D-056): a released plan, read-only, through
 * get_sub_plan_for_staff (each view audited; office staff never get « Gestion de classe »).
 * Direction can reveal each covered class's alerts (get_class_alerts, audited); office cannot.
 * Before release, only when it will be released, and « Publier maintenant ».
 */
async function StaffPlanPage({
  session,
  absenceId,
  planId,
}: {
  session: SessionContext;
  absenceId: string;
  planId: string;
}) {
  // The absence (RLS: owner, direction and office) tells which school's licence applies.
  const school = await staffSchoolForAbsence(session, absenceId);
  if (!school) notFound();
  const staff = await loadPlanForStaff(planId);
  if (!staff || (staff.released && staff.absenceId !== absenceId)) notFound();
  const t = await getTranslations();
  const locale = await getLocale();
  const back = <BackLink href="/absences" label={t('subPlanStaff.back')} />;

  if (!staff.released) {
    const at = instantInZone(staff.releaseAt, school.timezone);
    const time = formatInstantTime(staff.releaseAt, school.timezone, locale);
    return (
      <div className="space-y-4">
        <PageHeader
          back={back}
          title={t('subPlan.title')}
          actions={<ReleaseButton planId={planId} />}
        />
        <Notice>
          {t('subPlanStaff.notReleasedOn', {
            date: formatLocalDate(at.date, locale),
            time,
          })}
        </Notice>
      </div>
    );
  }

  const audience = staff.role === 'office' ? 'office' : 'staff';
  const plan = staff.plan
    ? composeSubPlan(staff.plan, { edits: staff.edits, ai: staff.ai, audience })
    : null;
  const pdf = `/absences/${absenceId}/plans/${planId}/pdf`;
  return (
    <div className="space-y-4">
      <PageHeader
        back={back}
        title={t('subPlan.title')}
        subtitle={[
          capitalize(formatLocalDate(staff.planDate, locale)),
          staff.context.teacherName,
          t(`absences.part.${staff.context.part}`),
        ].join(' · ')}
        actions={
          plan ? (
            <div className="flex flex-wrap items-center gap-2">
              <PdfLink href={pdf} label={t('pdf.print')} />
              {hasActivitySheets(plan) ? (
                <PdfLink
                  href={`${pdf}?doc=activities`}
                  label={t('activitySheets.open')}
                  testId="activity-sheets-pdf"
                />
              ) : null}
            </div>
          ) : null
        }
      />
      <Notice>{t('subPlanStaff.readOnly')}</Notice>
      {plan ? (
        <PlanView
          plan={plan}
          context={staff.context}
          roster={staff.roster}
          levels={staff.levels}
          slots={
            staff.role === 'direction' && school.studentAlertsEnabled
              ? {
                  alerts: (cls) => (
                    <AlertsReveal
                      classId={cls.classId}
                      className={cls.name}
                      showClassName={plan.classes.length > 1}
                      roster={staff.roster}
                    />
                  ),
                }
              : {}
          }
        />
      ) : (
        <Notice tone="warning">{t('subPortal.unreadable')}</Notice>
      )}
    </div>
  );
}

/**
 * « Plan de suppléance »: the owner reviews and edits one day's plan (her edits are an overlay
 * that rebuilds never overwrite, D-048) and can release it before its automatic time. Direction
 * and office read it once released (StaffPlanPage).
 */
export default async function PlanPage({ params }: Params) {
  const session = await requireSession();
  const { absenceId, planId } = await params;
  if (!z.uuid().safeParse(absenceId).success || !z.uuid().safeParse(planId).success) notFound();
  const owned = await loadPlanForOwner(session, planId);
  if (!owned) return <StaffPlanPage session={session} absenceId={absenceId} planId={planId} />;
  if (owned.absence.id !== absenceId) notFound();
  const t = await getTranslations();
  const locale = await getLocale();
  // « Consignes détaillées (IA) » (3b): null when there is nothing to offer or show.
  const aiState = await loadSubPlanAiState(await createSupabaseServerClient(), session, owned);
  const plan = owned.plan
    ? composeSubPlan(owned.plan, { edits: owned.edits, ai: owned.ai, audience: 'owner' })
    : null;
  const pdf = `/absences/${absenceId}/plans/${planId}/pdf`;

  return (
    <div className="space-y-4">
      <PageHeader
        back={
          <BackLink
            href={`/absences/${absenceId}`}
            label={
              owned.absence.startsOn === owned.absence.endsOn
                ? t('absences.titleOne', {
                    date: formatLocalDate(owned.absence.startsOn, locale),
                  })
                : t('absences.titleRange', {
                    start: formatLocalDate(owned.absence.startsOn, locale),
                    end: formatLocalDate(owned.absence.endsOn, locale),
                  })
            }
          />
        }
        title={t('subPlan.title')}
        subtitle={[
          capitalize(formatLocalDate(owned.planDate, locale)),
          t(`absences.part.${owned.absence.part}`),
        ].join(' · ')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <PlanStatusBadge plan={owned} timeZone={owned.context.timezone} />
            {plan && owned.absence.published ? (
              <>
                <PdfLink href={pdf} label={t('pdf.open')} />
                {/* The students' own pages, once the AI's instructions hold an activity (3b). */}
                {hasActivitySheets(plan) ? (
                  <PdfLink
                    href={`${pdf}?doc=activities`}
                    label={t('activitySheets.open')}
                    testId="activity-sheets-pdf"
                  />
                ) : null}
              </>
            ) : null}
            {!owned.released && owned.editable ? <ReleaseButton planId={owned.id} /> : null}
          </div>
        }
      />

      {aiState ? (
        <SubPlanAiPanel planId={owned.id} state={aiState} timeZone={owned.context.timezone} />
      ) : null}

      {!owned.plan || !plan ? (
        <Notice tone="warning">{t('subPlan.notReadable')}</Notice>
      ) : owned.editable ? (
        <PlanEditor
          // One editor per plan. It starts over itself after « Prendre la plus récente »; other
          // refreshes (its own saves, the AI request finishing) leave it as it is.
          key={owned.id}
          userId={session.userId}
          planId={owned.id}
          plan={owned.plan}
          initialEdits={owned.edits}
          editsRevision={owned.editsRevision}
          ai={owned.ai}
          context={owned.context}
          roster={owned.roster}
          levels={owned.levels}
          alertsEnabled={owned.alertsEnabled}
          editable
        />
      ) : (
        <>
          <Notice>{t('subPlan.readOnly')}</Notice>
          <PlanView
            plan={plan}
            context={owned.context}
            roster={owned.roster}
            levels={owned.levels}
          />
        </>
      )}
    </div>
  );
}
