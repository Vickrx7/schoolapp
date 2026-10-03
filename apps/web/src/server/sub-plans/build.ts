import 'server-only';
import {
  buildAbsencePlans,
  type AbsenceInput,
  type AbsencePlansResult,
  type SubPlanSources,
} from '@lynx/domain';
import type { Json } from '@lynx/db';
import { webLogger } from '../observability';

/**
 * Builds every school day of an absence in the request (DECISIONS D-047): a day whose build
 * throws gets the minimal plan, so publishing never fails because of the builder. Failures are
 * logged with the absence id and the date only (the sources hold lesson text).
 */
export function buildForAbsence(
  sources: SubPlanSources,
  absence: AbsenceInput,
  context: { absenceId?: string } = {},
): AbsencePlansResult {
  return buildAbsencePlans(sources, absence, {
    now: new Date(),
    onError: (date, error) =>
      webLogger.warn('plan day fell back to the minimal plan', {
        context: 'buildAbsencePlans',
        absenceId: context.absenceId ?? null,
        date,
        error: error instanceof Error ? error.name : 'unknown',
      }),
  });
}

/** The `p_plans` argument of publish_absence, update_absence and refresh_sub_plans. */
export function plansPayload(result: AbsencePlansResult): Json {
  return result.plans.map((p) => ({ date: p.date, classIds: p.classIds, plan: p.plan })) as Json;
}
