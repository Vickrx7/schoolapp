import { redirect } from 'next/navigation';
import { planPdfResponse } from '@/server/pdf/response';
import { subPortalConfigured } from '@/server/sub-portal/db';
import { loadDay } from '@/server/sub-portal/portal';
import { readSubToken } from '@/server/sub-portal/session';

// React-PDF and the fonts on disk need Node; every download is rendered for the session.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * « Télécharger le PDF » for the substitute (DECISIONS D-053, D-056): the released plan of this
 * session's day, which sub_portal.load records as sub_plan.printed. Never alerts (they stay on
 * screen, behind a tap) and never « Gestion de classe ». Without a working session it goes where
 * the plan page would.
 */
export async function GET() {
  if (!subPortalConfigured()) redirect('/suppleance');
  const token = await readSubToken();
  if (!token) redirect('/suppleance');
  const day = await loadDay(token, null, 'pdf');
  if (!day) redirect('/suppleance/ended');
  const stored = day.plan !== null && day.plan !== 'unchanged' ? day.plan : null;
  // Not released yet, or unreadable: the plan page says which.
  if (!day.context.released || !stored?.plan) redirect('/suppleance/plan');
  const { context } = day;
  return planPdfResponse({
    plan: stored.plan,
    edits: stored.edits,
    context: {
      planId: context.planId,
      planDate: context.planDate,
      part: context.part,
      schoolName: context.schoolName,
      timezone: context.schoolTimezone,
      officePhone: context.officePhone,
      arrivalInstructions: context.arrivalInstructions,
      emergencyInfo: context.emergencyInfo,
      teacherName: context.teacherName,
      absenceNote: context.absenceNote,
    },
    roster: day.roster,
    levels: day.levels,
  });
}
