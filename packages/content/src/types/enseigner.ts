/**
 * Enseigner: lesson plans, anchor charts, worked examples and teacher guides.
 */
import { common, glossaryEntry, step, type SchemaContext } from './shared';

/** Teacher-only type. Phase labels come from `lessonPhaseLabels` (by subject). */
export function lessonPlan({ k }: SchemaContext) {
  return k.obj({
    ...common(k),
    successCriteria: k.list(k.text(300), 0, 8),
    opening: k.list(step(k), 1, 8),
    development: k.list(step(k), 1, 12),
    closing: k.list(step(k), 1, 8),
    differentiation: k.optText(2000),
    assessment: k.optText(2000),
    subNotes: k.optText(2000),
  });
}

export function anchorChart({ k }: SchemaContext) {
  return k.obj({
    ...common(k),
    heading: k.text(120),
    sections: k.list(
      k.obj({
        title: k.text(120),
        points: k.list(k.text(300), 1, 8),
        example: k.optText(500),
      }),
      1,
      6,
    ),
    /** Teacher-only: no images in Phase 4, only suggestions. */
    visualIdeas: k.list(k.text(300), 0, 5),
  });
}

export function workedExample({ k, q }: SchemaContext) {
  return k.obj({
    ...common(k),
    problem: k.text(2000),
    steps: k.list(k.obj({ explanation: k.text(600), work: k.optText(600) }), 1, 10),
    answer: k.text(500),
    practice: k.list(q.question, 0, 6),
  });
}

/** Teacher-only type: how to teach the concept and the common misconceptions. */
export function teacherGuide({ k }: SchemaContext) {
  return k.obj({
    ...common(k),
    bigIdea: k.text(1000),
    background: k.text(4000),
    keyVocabulary: k.list(glossaryEntry(k), 0, 20),
    misconceptions: k.list(k.obj({ misconception: k.text(500), response: k.text(1000) }), 1, 8),
    teachingTips: k.list(k.text(500), 0, 10),
    lookFors: k.list(k.text(300), 0, 10),
  });
}
