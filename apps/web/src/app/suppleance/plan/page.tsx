import { composeSubPlan } from '@lynx/domain';
import { Phone } from 'lucide-react';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { PortalHeader } from '@/components/sub-portal/portal-header';
import { PortalPlan } from '@/components/sub-portal/portal-plan';
import { PortalPoller } from '@/components/sub-portal/portal-poller';
import { Notice } from '@/components/ui/card';
import { formatInstantTime, formatLocalDate, instantInZone } from '@/lib/format';
import { hasActivitySheets } from '@/server/pdf/activities-model';
import { requireSubDay } from '@/server/sub-portal/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('subPortal');
  return { title: t('planTitle') };
}

/**
 * « Plan de la journée » (DECISIONS D-056): the released plan of the one day this session is
 * for, audited once per content version. Before release it only says when the plan will be
 * ready. Checks for the teacher's changes every minute.
 */
export default async function PortalPlanPage() {
  const day = await requireSubDay('view');
  const t = await getTranslations('subPortal');
  const locale = await getLocale();
  const { context } = day;
  const tz = context.schoolTimezone;

  if (!context.released) {
    const release = instantInZone(context.releaseAt, tz);
    const time = formatInstantTime(context.releaseAt, tz, locale);
    return (
      <div className="space-y-4 py-4">
        <PortalPoller knownVersion={null} />
        <div>
          <p className="text-sm text-slate-600">{context.schoolName}</p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{t('planTitle')}</h1>
        </div>
        <Notice className="space-y-1">
          <p className="font-medium" data-testid="plan-not-released">
            {release.date === context.planDate
              ? t('notReleased', { time })
              : t('notReleasedOn', { date: formatLocalDate(release.date, locale), time })}
          </p>
          <p>{t('notReleasedHint')}</p>
        </Notice>
        {context.officePhone ? (
          <a
            href={`tel:${context.officePhone.replace(/[^\d+]/g, '')}`}
            className="inline-flex min-h-11 items-center gap-1.5 font-medium text-brand-700 underline underline-offset-2"
          >
            <Phone className="size-4" aria-hidden />
            {t('office', { phone: context.officePhone })}
          </a>
        ) : null}
      </div>
    );
  }

  const stored = day.plan !== null && day.plan !== 'unchanged' ? day.plan : null;
  if (!stored?.plan) {
    return (
      <div className="space-y-4 py-4">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{t('planTitle')}</h1>
        <Notice tone="warning">{t('unreadable')}</Notice>
      </div>
    );
  }

  const plan = composeSubPlan(stored.plan, {
    edits: stored.edits,
    ai: stored.ai,
    audience: 'substitute',
  });
  // « Mis à jour à 9 h 12 »: the teacher changed the plan after it went out.
  const changedAfterRelease =
    new Date(context.updatedAt).getTime() > new Date(context.releaseAt).getTime();

  return (
    <div className="space-y-4">
      <PortalPoller knownVersion={context.contentVersion} />
      <PortalHeader
        schoolName={context.schoolName}
        classes={plan.classes.map((c) => c.name)}
        rooms={[...new Set(plan.classes.map((c) => c.roomName).filter((r): r is string => !!r))]}
        planDate={context.planDate}
        teacherName={context.teacherName}
        officePhone={context.officePhone}
        expiresAt={context.expiresAt}
        updatedAt={changedAfterRelease ? context.updatedAt : null}
        timeZone={tz}
      />
      <h1 className="sr-only">{t('planTitle')}</h1>
      <PortalPlan
        plan={plan}
        context={{
          planDate: context.planDate,
          timezone: tz,
          teacherName: context.teacherName,
          absenceNote: context.absenceNote,
          officePhone: context.officePhone,
          arrivalInstructions: context.arrivalInstructions,
          emergencyInfo: context.emergencyInfo,
          contentVersion: context.contentVersion,
          alertsAvailable: context.alertsAvailable,
          reportStatus: context.reportStatus,
        }}
        roster={day.roster}
        levels={day.levels}
        activitySheets={hasActivitySheets(plan)}
      />
    </div>
  );
}
