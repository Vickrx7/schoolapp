/**
 * Jouer: games, brain breaks, songs, riddles and weekly challenges.
 */
import { common, type SchemaContext } from './shared';

/** `questions` is the question bank for quiz battles (Phase 5). */
export function game({ k, q }: SchemaContext) {
  return k.obj({
    ...common(k),
    grouping: k.text(200),
    /** Teacher-only. */
    setup: k.optText(1500),
    rules: k.list(k.text(500), 1, 12),
    howToWin: k.text(500),
    variations: k.list(k.text(500), 0, 6),
    questions: k.list(q.question, 0, 40),
  });
}

export const BRAIN_BREAK_SPACES = ['desk', 'open'] as const;

export function brainBreak({ k }: SchemaContext) {
  return k.obj({
    ...common(k),
    space: k.enumOf(BRAIN_BREAK_SPACES),
    steps: k.list(k.text(300), 1, 10),
    /** Teacher-only: a calmer version. */
    calmVariant: k.optText(500),
  });
}

export function song({ k }: SchemaContext) {
  return k.obj({
    ...common(k),
    /** « Sur l’air de … »: a public-domain tune, or empty for an original melody. */
    tune: k.optText(120),
    verses: k.list(k.obj({ label: k.text(40), lines: k.list(k.text(200), 1, 12) }), 1, 8),
    /** Teacher-only. */
    gestures: k.list(k.text(300), 0, 10),
  });
}

/** Short answers only. */
export function riddle({ k, q }: SchemaContext) {
  return k.obj({
    ...common(k),
    riddles: k.list(q.shortAnswerQuestion, 1, 12),
  });
}

/** The solution goes in `answerKey.solution`. */
export function weeklyChallenge({ k }: SchemaContext) {
  return k.obj({
    ...common(k),
    challenge: k.text(2000),
    days: k.list(k.obj({ label: k.text(40), task: k.text(600) }), 0, 5),
    hints: k.list(k.text(300), 0, 5),
    extension: k.optText(1000),
  });
}
