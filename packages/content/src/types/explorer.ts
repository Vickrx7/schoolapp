/**
 * Explorer: experiments, STEM challenges, projects and outdoor activities. Experiments and STEM
 * challenges also need structured safety notes on the item (`safety.ts`).
 */
import { common, type SchemaContext } from './shared';

/**
 * Follows the « processus d’enquête scientifique » (stage labels to be checked against the
 * 2022 science curriculum). Expected results go in `answerKey.solution`.
 */
export function experiment({ k, q }: SchemaContext) {
  return k.obj({
    ...common(k),
    researchQuestion: k.text(500),
    hypothesisPrompt: k.optText(300),
    steps: k.list(k.text(600), 1, 12),
    observationTable: k.obj({ columns: k.list(k.text(60), 1, 6), rows: k.int(1, 12) }).nullable(),
    conclusionQuestions: k.list(q.question, 0, 6),
    communication: k.optText(500),
  });
}

/** The stages of the « processus de design en ingénierie » (2022; labels to be checked). */
export const DESIGN_STAGES = [
  'definir',
  'rechercher',
  'planifier',
  'construire',
  'tester',
  'ameliorer',
  'communiquer',
] as const;

export function stemChallenge({ k, q }: SchemaContext) {
  return k.obj({
    ...common(k),
    challenge: k.text(1000),
    constraints: k.list(k.text(300), 0, 8),
    criteria: k.list(k.text(300), 1, 8),
    designStages: k.list(k.obj({ stage: k.enumOf(DESIGN_STAGES), prompt: k.text(600) }), 1, 8),
    reflectionQuestions: k.list(q.question, 0, 6),
  });
}

export function project({ k }: SchemaContext) {
  return k.obj({
    ...common(k),
    drivingQuestion: k.text(500),
    overview: k.text(3000),
    milestones: k.list(
      k.obj({
        title: k.text(120),
        description: k.text(1000),
        sessions: k.int(1, 20).nullable(),
      }),
      1,
      10,
    ),
    deliverables: k.list(k.text(300), 1, 6),
    successCriteria: k.list(k.text(300), 1, 10),
  });
}

export function outdoorActivity({ k }: SchemaContext) {
  return k.obj({
    ...common(k),
    location: k.text(300),
    /** Teacher-only. */
    setup: k.text(1000),
    steps: k.list(k.text(600), 1, 10),
    safetyReminders: k.list(k.text(300), 0, 6),
    /** Teacher-only. */
    weatherAlternative: k.optText(1000),
  });
}
