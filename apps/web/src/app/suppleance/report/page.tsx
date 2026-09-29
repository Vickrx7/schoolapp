import { composeSubPlan, reportableLessons, subReportContentSchema } from '@lynx/domain';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { emptyReportState, reportStateFrom } from '@/components/sub-portal/report-state';
import { ReportForm } from '@/components/sub-portal/report-form';
import { Notice } from '@/components/ui/card';
import { parseKeyRing } from '@/server/alerts-crypto';
import { serverEnv } from '@/server/env';
import { requireSubDay } from '@/server/sub-portal/session';
import { decryptReportNotes } from '@/server/sub-reports/notes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('subReport');
  return { title: t('title') };
}

/** The alerts key ring, or null when it is missing or invalid (the notes then stay closed). */
function alertsRing() {
  try {
    return parseKeyRing(serverEnv().ALERTS_ENCRYPTION_KEYS);
  } catch {
    return null;
  }
}

/**
 * « Suivi de la journée » (DECISIONS D-054): what the substitute reports to the teacher, filled
 * in during the day. Only the lessons the plan asked her to teach, and the day's roster for the
 * absent students. The saved report is shown to the device that started it; its notes are
 * decrypted here and never logged.
 */
export default async function PortalReportPage() {
  const day = await requireSubDay('view');
  const t = await getTranslations('subReport');
  const tPortal = await getTranslations('subPortal');
  const { context } = day;

  const back = (
    <Link
      href="/suppleance/plan"
      className="inline-flex min-h-11 items-center text-sm text-brand-700 underline underline-offset-2"
    >
      {t('backToPlan')}
    </Link>
  );
  const stored = day.plan !== null && day.plan !== 'unchanged' ? day.plan : null;
  if (!context.released || !stored?.plan) {
    return (
      <div className="space-y-4 py-4">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{t('title')}</h1>
        <Notice tone="warning">
          {context.released ? tPortal('unreadable') : t('notReleased')}
        </Notice>
        {back}
      </div>
    );
  }

  const plan = composeSubPlan(stored.plan, {
    edits: stored.edits,
    ai: stored.ai,
    audience: 'substitute',
  });
  const lessons = reportableLessons(plan);
  const rosterIds = new Set(day.roster.map((s) => s.id));
  const report = day.report;
  let initial = emptyReportState();
  let notesUnreadable = false;
  if (report && !report.lockedToOtherDevice) {
    const content = subReportContentSchema.safeParse(report.content);
    let notes = null;
    if (report.notesCiphertext) {
      const ring = alertsRing();
      notes = ring ? decryptReportNotes(report.notesCiphertext, context.planId, ring) : null;
      notesUnreadable = notes === null;
    }
    initial = reportStateFrom(content.success ? content.data : null, notes, lessons, rosterIds);
  }

  return (
    <div className="space-y-4 py-4">
      <div>
        <p className="text-sm text-slate-600">{context.schoolName}</p>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{t('title')}</h1>
      </div>
      <ReportForm
        planId={context.planId}
        contentVersion={context.contentVersion}
        timeZone={context.schoolTimezone}
        lessons={lessons}
        classes={plan.classes.map((c) => ({ classId: c.classId, name: c.name }))}
        roster={day.roster}
        initial={initial}
        status={report?.status ?? 'none'}
        updatedAt={report?.updatedAt ?? null}
        lockedToOtherDevice={report?.lockedToOtherDevice ?? false}
        notesUnreadable={notesUnreadable}
      />
    </div>
  );
}
