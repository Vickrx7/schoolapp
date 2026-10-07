import { redirect } from 'next/navigation';
import {
  pdfNotFound,
  planPdfResponse,
  requestedPdfDisposition,
  requestedPdfDoc,
} from '@/server/pdf/response';
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
 * the plan page would. The link is a plain navigation (no `download` attribute): `?download=1`
 * saves the PDF only when there is one, and anything else (the access ended, a failure) is a
 * page the substitute can read, never a file saved by mistake.
 *
 * `?doc=activities` downloads the students' activity sheets instead (3b), recorded the same way;
 * back to the plan when it has no activity (the teacher removed the AI's instructions since).
 */
export async function GET(request: Request) {
  const doc = requestedPdfDoc(request);
  if (!doc) return pdfNotFound();
  if (!subPortalConfigured()) redirect('/suppleance');
  const token = await readSubToken();
  if (!token) redirect('/suppleance');
  const day = await loadDay(token, null, 'pdf');
  if (!day) redirect('/suppleance/ended');
  const stored = day.plan !== null && day.plan !== 'unchanged' ? day.plan : null;
  // Not released yet, or unreadable: the plan page says which.
  if (!day.context.released || !stored?.plan) redirect('/suppleance/plan');
  const { context } = day;
  const response = await planPdfResponse({
    doc,
    disposition: requestedPdfDisposition(request),
    backHref: '/suppleance/plan',
    plan: stored.plan,
    edits: stored.edits,
    ai: stored.ai,
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
  if (!response) redirect('/suppleance/plan');
  return response;
}
