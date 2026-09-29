/**
 * Kept class results (« Résultats gardés », Phase 5 plan, decision P-8). When the teacher ticks
 * « Garder les résultats de la classe (sans noms) », `app.class_session_aggregate` writes
 * `class_session_results.aggregate` before the session's answers are deleted. It holds counts
 * per question and choice, team scores and totals: never device numbers, participant ids or
 * anything a student typed.
 *
 * The results page reads the stored JSON through this schema. Unknown keys are stripped, so even
 * a row written by a future (or faulty) version can only show the fields listed here. A row of
 * another `schemaVersion` does not parse: the page says it cannot show it. Kept rows last up to
 * `classModeResultsRetentionDays` (a year by default), so this schema only ever grows new
 * optional fields. Pure so it is unit-tested.
 */
import { QUESTION_KINDS } from '@lynx/content';
import { z } from 'zod';
import { CLASS_TEAM_KEYS, teamScoreSchema } from '../class-portal/schemas';

/** Must match `schemaVersion` in `app.class_session_aggregate`. */
export const SESSION_AGGREGATE_VERSION = 1;

/** Null whether the database wrote null or left the key out. */
const orNull = <T extends z.ZodType>(schema: T) => schema.nullish().transform((v) => v ?? null);

const count = z.number().int().min(0);

const aggregateQuestionSchema = z.object({
  /** Position in the session, from 0. */
  index: z.number().int().min(0).max(79),
  id: z.string().max(8),
  kind: z.enum(QUESTION_KINDS),
  /** The first 300 characters. */
  prompt: z.string().max(300),
  /** Counted for points (an unscored short answer is not). */
  scorable: z.boolean(),
  /** Devices that answered. */
  answered: count,
  /** Correct answers; null when the question was not scored. */
  correct: orNull(count),
  /** 0–100; null when the question was not scored or nobody answered. */
  averageScore: orNull(z.number().min(0).max(100)),
  /** Multiple choice: answers per choice, and which choices were right. */
  choices: orNull(
    z
      .array(
        z.object({
          id: z.string().max(8),
          text: z.string().max(300),
          count,
          correct: orNull(z.boolean()),
        }),
      )
      .max(8),
  ),
  /** True or false: answers per value, and the right one. */
  trueFalse: orNull(
    z.object({ trueCount: count, falseCount: count, correct: orNull(z.boolean()) }),
  ),
});

export const sessionAggregateSchema = z.object({
  schemaVersion: z.literal(SESSION_AGGREGATE_VERSION),
  /** Null when the resource has since been deleted. */
  itemId: orNull(z.string().max(64)),
  itemTitle: orNull(z.string().max(200)),
  mode: z.enum(['teams', 'solo']),
  revealAnswers: z.boolean(),
  startedAt: z.string().min(1).max(64),
  endedAt: z.string().min(1).max(64),
  /** Devices that joined (a count only). */
  deviceCount: count,
  questionsPlayed: count,
  /** Team mode: `app.class_team_scores`, best first; no score for a team without members. */
  teams: orNull(z.array(teamScoreSchema).max(CLASS_TEAM_KEYS.length)),
  questions: z.array(aggregateQuestionSchema).max(80),
});
export type SessionAggregate = z.output<typeof sessionAggregateSchema>;
export type AggregateQuestion = SessionAggregate['questions'][number];

/** The stored aggregate, or null when it cannot be shown (another version, a damaged row). */
export function parseSessionAggregate(value: unknown): SessionAggregate | null {
  const parsed = sessionAggregateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * The share of correct answers to a question, as a whole percentage (« 74 % »), or null when
 * it was not scored or nobody answered.
 */
export function percentCorrect(question: AggregateQuestion): number | null {
  if (!question.scorable || question.correct === null || question.answered === 0) return null;
  return Math.round((100 * question.correct) / question.answered);
}

/**
 * The class's share of correct answers over every scored question played, or null when no
 * scored question was answered.
 */
export function classPercentCorrect(aggregate: SessionAggregate): number | null {
  let answered = 0;
  let correct = 0;
  for (const q of aggregate.questions) {
    if (!q.scorable || q.correct === null) continue;
    answered += q.answered;
    correct += q.correct;
  }
  return answered === 0 ? null : Math.round((100 * correct) / answered);
}
