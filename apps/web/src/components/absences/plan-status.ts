/**
 * How a plan day's release is described (« Prêt · publié automatiquement à 7 h 30 », « Publié »).
 * The instants come from the database (review_deadline, released_at, D-047); this only puts
 * them on the school's clock.
 */
import type { LocalDate, LocalTime } from '@lynx/domain';
import { instantInZone } from '../../lib/format';

export type PlanStatusView =
  | { kind: 'released' }
  /** `onPlanDate`: the release happens on the day of the plan (the usual case). */
  | { kind: 'ready'; time: LocalTime; date: LocalDate; onPlanDate: boolean };

export function planStatusView(
  plan: { planDate: LocalDate; released: boolean; releaseAt: string },
  timeZone: string,
): PlanStatusView {
  if (plan.released) return { kind: 'released' };
  const at = instantInZone(plan.releaseAt, timeZone);
  return { kind: 'ready', time: at.time, date: at.date, onPlanDate: at.date === plan.planDate };
}
