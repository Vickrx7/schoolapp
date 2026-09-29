import { composeSubPlan } from '@lynx/domain';
import { ChevronLeft } from 'lucide-react';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { capitalize } from '@/components/absences/absence-summary';
import { PlanStatusBadge } from '@/components/absences/plan-status-badge';
import { PlanEditor } from '@/components/sub-plans/plan-editor';
import { PlanView } from '@/components/sub-plans/plan-view';
import { ReleaseButton } from '@/components/sub-plans/release-button';
import { Notice } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page';
import { formatLocalDate } from '@/lib/format';
import { loadPlanForOwner } from '@/server/queries/sub-plans';
import { requireSession } from '@/server/session';

type Params = { params: Promise<{ absenceId: string; planId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('subPlan');
  return { title: t('title') };
}

/**
 * « Plan de suppléance »: the owner reviews and edits one day's plan (her edits are an overlay
 * that rebuilds never overwrite, D-048) and can release it before its automatic time. (Direction
 * and office read released plans through an audited function, with the substitute portal.)
 */
export default async function PlanPage({ params }: Params) {
  const session = await requireSession();
  const { absenceId, planId } = await params;
  if (!z.uuid().safeParse(absenceId).success || !z.uuid().safeParse(planId).success) notFound();
  const owned = await loadPlanForOwner(session, planId);
  if (!owned || owned.absence.id !== absenceId) notFound();
  const t = await getTranslations();
  const locale = await getLocale();

  return (
    <div className="space-y-4">
      <PageHeader
        back={
          <Link
            href={`/absences/${absenceId}`}
            className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
          >
            <ChevronLeft className="size-4" aria-hidden />
            {owned.absence.startsOn === owned.absence.endsOn
              ? t('absences.titleOne', { date: formatLocalDate(owned.absence.startsOn, locale) })
              : t('absences.titleRange', {
                  start: formatLocalDate(owned.absence.startsOn, locale),
                  end: formatLocalDate(owned.absence.endsOn, locale),
                })}
          </Link>
        }
        title={t('subPlan.title')}
        subtitle={[
          capitalize(formatLocalDate(owned.planDate, locale)),
          t(`absences.part.${owned.absence.part}`),
        ].join(' · ')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <PlanStatusBadge plan={owned} timeZone={owned.context.timezone} />
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
