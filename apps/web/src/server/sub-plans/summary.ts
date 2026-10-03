/**
 * One-line summaries of built plans, for the absence form (« Lundi 5 octobre · 6 périodes à
 * couvrir · Messe à 9 h 45 ») and the absence page. Pure, so it can be unit-tested; it holds
 * no names and no teacher-written text other than event titles.
 */
import type {
  AbsencePlansResult,
  CalendarEventType,
  LocalDate,
  LocalTime,
  PlanWarningCode,
  SubPlanV1,
} from '@lynx/domain';

export interface PlanDaySummary {
  date: LocalDate;
  /** Subject periods the substitute takes (a period replaced by a mass still counts). */
  periods: number;
  /** Periods another adult takes (« EPS avec M. Leblanc »). */
  handovers: number;
  /** Events of the day, the ones on a period first: « Messe de l'école » at 09:45. */
  events: { title: string; start: LocalTime | null }[];
  /** Where morning ends, for the « Matin : jusqu'à 12 h 55 » hint. */
  split: LocalTime | null;
  /** « Jour 3 » in a rotating-day school. */
  dayKey: number | null;
  cycle: boolean;
  planWarnings: PlanWarningCode[];
  /** Blocks with a warning (no active unit, finished unit, thin lesson...). */
  blockWarnings: number;
}

export interface NoSchoolSummary {
  date: LocalDate;
  reason: CalendarEventType;
  title: string;
}

export interface AbsenceSummary {
  days: PlanDaySummary[];
  noSchool: NoSchoolSummary[];
}

export function summarizePlan(plan: SubPlanV1): PlanDaySummary {
  const events = new Map<string, { title: string; start: LocalTime | null }>();
  const add = (title: string, start: LocalTime | null) => {
    const key = `${start ?? ''}|${title}`;
    if (!events.has(key)) events.set(key, { title, start });
  };
  for (const b of plan.blocks) if (b.event) add(b.event.title, b.event.start);
  for (const e of plan.dayEvents) add(e.title, e.start);

  return {
    date: plan.date,
    periods: plan.blocks.filter((b) => b.kind === 'subject').length,
    handovers: plan.blocks.filter((b) => b.kind === 'handover').length,
    events: [...events.values()].sort(
      (a, b) =>
        (a.start ?? '99:99').localeCompare(b.start ?? '99:99') || a.title.localeCompare(b.title),
    ),
    split: plan.split,
    dayKey: plan.day.dayKey,
    cycle: plan.day.kind === 'cycle',
    planWarnings: [...new Set(plan.warnings.map((w) => w.code))],
    blockWarnings: plan.blocks.filter((b) => b.warnings.length > 0).length,
  };
}

export function summarizeAbsence(result: AbsencePlansResult): AbsenceSummary {
  return {
    days: result.plans.map((p) => summarizePlan(p.plan)),
    noSchool: result.noSchool.map((n) => ({ date: n.date, reason: n.reason, title: n.eventTitle })),
  };
}
