/**
 * The end-of-day report (« Suivi de la journée ») and its confirmation (DECISIONS D-054).
 * Only lessons the plan assigned can be reported; the teacher confirms before any lesson is
 * marked completed.
 */
import type { SubPlanBlock, SubReportContent } from './schema';

export interface ReportableLesson {
  blockKey: string;
  lessonId: string;
  title: string;
  unitTitle: string;
  sequenceNumber: number;
  className: string;
  start: string;
  end: string;
}

type PlanBlocks = {
  blocks: readonly Pick<SubPlanBlock, 'key' | 'lesson' | 'className' | 'start' | 'end'>[];
};

/** Blocks whose lesson the substitute was asked to teach (not those already taught), in order. */
export function reportableLessons(plan: PlanBlocks): ReportableLesson[] {
  const seen = new Set<string>();
  return plan.blocks.flatMap((b) => {
    if (!b.lesson || b.lesson.assignment !== 'assigned' || seen.has(b.lesson.lessonId)) return [];
    seen.add(b.lesson.lessonId);
    return [
      {
        blockKey: b.key,
        lessonId: b.lesson.lessonId,
        title: b.lesson.title,
        unitTitle: b.lesson.unitTitle,
        sequenceNumber: b.lesson.sequenceNumber,
        className: b.className,
        start: b.start,
        end: b.end,
      },
    ];
  });
}

export type ConfirmDecision = 'completed' | 'not_completed' | 'skipped';

/**
 * What the confirmation page preselects: « Terminé » → completed; « En partie » and « Pas
 * fait » → not completed, so the lesson comes back as next. Only lessons the report mentions
 * (confirm_sub_report refuses others), in plan order.
 */
export function defaultConfirmDecisions(
  plan: PlanBlocks,
  content: Pick<SubReportContent, 'lessons'>,
): { lessonId: string; decision: ConfirmDecision }[] {
  const outcome = new Map<string, ConfirmDecision>();
  for (const l of content.lessons) {
    const decision: ConfirmDecision = l.outcome === 'done' ? 'completed' : 'not_completed';
    if (outcome.get(l.lessonId) !== 'completed') outcome.set(l.lessonId, decision);
  }
  const planOrder = reportableLessons(plan).map((l) => l.lessonId);
  const ordered = [
    ...planOrder.filter((id) => outcome.has(id)),
    ...[...outcome.keys()].filter((id) => !planOrder.includes(id)),
  ];
  return ordered.map((lessonId) => ({ lessonId, decision: outcome.get(lessonId)! }));
}
