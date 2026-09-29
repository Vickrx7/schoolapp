import { z } from 'zod';
import { pdfNotFound, planPdfResponse } from '@/server/pdf/response';
import {
  loadPlanForOwner,
  loadPlanForStaff,
  staffSchoolForAbsence,
} from '@/server/queries/sub-plans';
import { findSchool, hasModule, requireSession } from '@/server/session';

// React-PDF and the fonts on disk need Node; every download is rendered for the caller.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * « PDF » of one day's plan (DECISIONS D-053, D-056), opened through a plain link so it is never
 * prefetched. The absent teacher prints her own plan (RLS, not audited) at any time while the
 * absence stands; direction and office print it once released, through get_sub_plan_for_staff,
 * which records sub_plan.printed. Never alerts, never « Gestion de classe ».
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<'/absences/[absenceId]/plans/[planId]/pdf'>,
) {
  const session = await requireSession();
  const { absenceId, planId } = await params;
  if (!z.uuid().safeParse(absenceId).success || !z.uuid().safeParse(planId).success) {
    return pdfNotFound();
  }

  const owned = await loadPlanForOwner(session, planId);
  if (owned) {
    const school = findSchool(session, owned.absence.schoolId);
    if (
      owned.absence.id !== absenceId ||
      !owned.absence.published ||
      !owned.plan ||
      !school ||
      !hasModule(school, 'teaching')
    ) {
      return pdfNotFound();
    }
    return planPdfResponse({
      plan: owned.plan,
      edits: owned.edits,
      context: owned.context,
      roster: owned.roster,
      levels: owned.levels,
    });
  }

  if (!(await staffSchoolForAbsence(session, absenceId))) return pdfNotFound();
  const staff = await loadPlanForStaff(planId, 'pdf');
  if (!staff?.released || staff.absenceId !== absenceId || !staff.plan) return pdfNotFound();
  return planPdfResponse({
    plan: staff.plan,
    edits: staff.edits,
    context: staff.context,
    roster: staff.roster,
    levels: staff.levels,
  });
}
