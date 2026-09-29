import { composeSubPlan } from '@lynx/domain';
import { ChevronLeft } from 'lucide-react';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { capitalize } from '@/components/absences/absence-summary';
import { PlanStatusBadge } from '@/components/absences/plan-status-badge';
import { AlertsReveal } from '@/components/sub-plans/alerts-reveal';
import { PlanEditor } from '@/components/sub-plans/plan-editor';
import { PdfLink } from '@/components/sub-plans/pdf-link';
import { PlanView } from '@/components/sub-plans/plan-view';
import { ReleaseButton } from '@/components/sub-plans/release-button';
import { Notice } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page';
import { formatInstantTime, formatLocalDate, instantInZone } from '@/lib/format';
import {
  loadPlanForOwner,
  loadPlanForStaff,
  staffSchoolForAbsence,
} from '@/server/queries/sub-plans';
import { requireSession, type SessionContext } from '@/server/session';

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
          staff.plan ? (
            <PdfLink href={`/absences/${absenceId}/plans/${planId}/pdf`} label={t('pdf.print')} />
          ) : null
        }
      />
      <Notice>{t('subPlanStaff.readOnly')}</Notice>
      {staff.plan ? (
        <PlanView
          plan={composeSubPlan(staff.plan, { edits: staff.edits, audience })}
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
                      showClassName={staff.plan!.classes.length > 1}
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
            {owned.plan && owned.absence.published ? (
              <PdfLink href={`/absences/${absenceId}/plans/${planId}/pdf`} label={t('pdf.open')} />
            ) : null}
            {!owned.released && owned.editable ? <ReleaseButton planId={owned.id} /> : null}
          </div>
        }
      />

      {!owned.plan ? (
        <Notice tone="warning">{t('subPlan.notReadable')}</Notice>
      ) : owned.editable ? (
        <PlanEditor
          // A new revision from the server (after « Prendre la plus récente ») starts over.
          key={owned.editsRevision}
          userId={session.userId}
          planId={owned.id}
          plan={owned.plan}
          initialEdits={owned.edits}
          editsRevision={owned.editsRevision}
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
            plan={composeSubPlan(owned.plan, { edits: owned.edits, audience: 'owner' })}
            context={owned.context}
            roster={owned.roster}
            levels={owned.levels}
          />
        </>
      )}
    </div>
  );
}
