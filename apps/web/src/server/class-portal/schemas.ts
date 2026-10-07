/**
 * What crosses the wire in « Quiz sur les appareils » (DECISIONS D-083 to D-087):
 *
 * - the results of the `class_portal` functions, which are not in the generated types (the
 *   schema is not exposed by the API), parsed before a device gets anything;
 * - what the projector polls (`public.class_session_live`);
 * - what a device sends as its answer, checked before any database call.
 *
 * Every object schema **strips** unknown keys (Zod's default; never `looseObject`, `passthrough`
 * or a record of unknown values). This is one of the guards that keep answer keys off student
 * devices (D-086, guard 4): even if a database function one day returned `accepted`, `answer` or
 * `explanation`, the web server would drop it. The projector receives the current answer only in
 * the reveal phases, and `liveStateSchema` drops `reveal` in any other phase, and the answer and
 * the number of right answers when answers are hidden.
 *
 * Sizes mirror the snapshot rules of `app.class_mode_question` (options of at most 8, 300
 * characters each; prompts of 1000; hints of 300) and the grading rules of `app.class_grade`.
 * Pure (no server-only import): route handlers, `portal.ts` and client hooks share it, and it is
 * unit-tested.
 */
import { ID_PATTERN, QUESTION_KINDS, type QuestionKind } from '@lynx/content';
import { z } from 'zod';
import { CLASS_LINK_PATTERN } from './code';

/**
 * Team keys, in list order (`session_participants_team_key`, `app.class_team_keys`, and
 * `CLASS_TEAMS` in `@lynx/content`, which adds colours and shapes; the names are in the
 * `classMode.teams` messages).
 */
export const CLASS_TEAM_KEYS = [
  'huards',
  'castors',
  'orignaux',
  'ours',
  'loups',
  'renards',
] as const;
export type ClassTeamKey = (typeof CLASS_TEAM_KEYS)[number];

export const CLASS_PHASES = ['lobby', 'question', 'reveal', 'leaderboard', 'finished'] as const;
export type ClassPhase = (typeof CLASS_PHASES)[number];

/** Phases in which the projector may hold the current question's answer. */
const REVEAL_PHASES: readonly ClassPhase[] = ['reveal', 'leaderboard', 'finished'];

/** At most 80 questions per session (`question_index between -1 and 79`). */
export const MAX_CLASS_QUESTIONS = 80;
/** At most 120 device numbers per session (`device_seq`). */
const MAX_DEVICE_NUMBER = 120;

// ---------------------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------------------

/**
 * A value the database may leave out (`jsonb_strip_nulls`) or send as null: null either way, so
 * screens test one thing.
 */
const orNull = <T extends z.ZodType>(schema: T) => schema.nullish().transform((v) => v ?? null);

const id = z.string().regex(ID_PATTERN);
/** A timestamp as PostgreSQL writes it in JSON (`2026-11-03T14:05:00.123456+00:00`). */
const timestamp = z.string().min(1).max(64);
const count = z.number().int().min(0);
const teamKey = z.enum(CLASS_TEAM_KEYS);
const phase = z.enum(CLASS_PHASES);
const questionIndex = z
  .number()
  .int()
  .min(0)
  .max(MAX_CLASS_QUESTIONS - 1);

const option = z.object({ id, text: z.string().max(300) });
const options = z.array(option).max(8);

/**
 * One question as devices and the projector see it: the whitelist of `app.class_mode_question`
 * plus `scorable`. There is no field for an answer, so none can pass.
 */
export const deviceQuestionSchema = z.object({
  id,
  kind: z.enum(QUESTION_KINDS),
  prompt: z.string().max(1000),
  hint: orNull(z.string().max(300)),
  /** Multiple choice only. */
  multipleAnswers: orNull(z.boolean()),
  choices: orNull(options),
  left: orNull(options),
  right: orNull(options),
  items: orNull(options),
  /** The question counts for points (short answers are not scored by default, D-087). */
  scorable: z.boolean().default(false),
});
export type DeviceQuestion = z.output<typeof deviceQuestionSchema>;

/** `app.class_team_scores`: no score for a team without members (it shows « — », last). */
export const teamScoreSchema = z.object({
  team: teamKey,
  members: count,
  score: orNull(z.number().min(0)),
});
export type TeamScore = z.output<typeof teamScoreSchema>;

// ---------------------------------------------------------------------------------------
// What a device receives (`app.class_device_state` and the class_portal functions)
// ---------------------------------------------------------------------------------------

const deviceSessionSchema = z.object({
  title: orNull(z.string().max(200)),
  /** The content's language (`ang` → en-CA); the screens around it stay French (D-090). */
  lang: z.enum(['fr-CA', 'en-CA']),
  mode: z.enum(['teams', 'solo']),
  phase,
  /** -1 in the lobby. */
  index: z
    .number()
    .int()
    .min(-1)
    .max(MAX_CLASS_QUESTIONS - 1),
  total: z.number().int().min(0).max(MAX_CLASS_QUESTIONS),
  /** When the current question closes (a timer was set). */
  closesAt: orNull(timestamp),
  joiningOpen: z.boolean(),
  teamChoice: z.enum(['random', 'device']),
  /** Team mode: the session's teams, in list order. */
  teams: orNull(z.array(teamKey).max(CLASS_TEAM_KEYS.length)),
});

const deviceOkSchema = z.object({
  status: z.literal('ok'),
  version: z.number().int(),
  serverNow: timestamp,
  session: deviceSessionSchema,
  me: z.object({
    device: z.number().int().min(1).max(MAX_DEVICE_NUMBER),
    team: orNull(teamKey),
  }),
  question: orNull(deviceQuestionSchema),
  /** This device's answer to the current question; its result only after the reveal (D-086). */
  myAnswer: orNull(
    z.object({
      answered: z.literal(true),
      result: orNull(z.object({ correct: z.boolean(), points: z.number().int().min(0).max(100) })),
    }),
  ),
  leaderboard: orNull(z.array(teamScoreSchema).max(CLASS_TEAM_KEYS.length)),
  myTotal: orNull(count),
});
export type DeviceOkState = z.output<typeof deviceOkSchema>;

/**
 * `class_portal.state`: the device's view, `unchanged` when the version it knows is current,
 * `ended` (closed or expired) or `gone` (unknown token: removed, left, or cleaned up).
 */
export const deviceStateSchema = z.discriminatedUnion('status', [
  deviceOkSchema,
  z.object({ status: z.literal('unchanged'), serverNow: timestamp }),
  z.object({ status: z.literal('ended') }),
  z.object({ status: z.literal('gone') }),
]);
export type DeviceState = z.output<typeof deviceStateSchema>;

export const JOIN_OUTCOMES = [
  'ok',
  'invalid',
  'invalid_link',
  /** A valid class link while no lobby is open: not a failure, the device retries. */
  'waiting',
  /** Throttled: `retryAfter` seconds. */
  'wait',
  'locked',
  'full',
] as const;
export type JoinOutcome = (typeof JOIN_OUTCOMES)[number];

/** A row of `class_portal.join` (pg gives timestamps as dates). */
export const joinRowSchema = z.object({
  outcome: z.enum(JOIN_OUTCOMES),
  /** Only for 'ok': goes into the HttpOnly cookie, stored as a hash. */
  token: orNull(z.string().regex(CLASS_LINK_PATTERN)),
  expires_at: orNull(z.coerce.date()),
  retry_after: orNull(count),
});
export type JoinRow = z.output<typeof joinRowSchema>;

/** `class_portal.answer`. */
export const answerResultSchema = z.union([
  z.object({ status: z.literal('gone') }),
  z.object({ status: z.literal('ended') }),
  z.object({ status: z.literal('ok'), outcome: z.literal('invalid') }),
  z.object({
    status: z.literal('ok'),
    /** `already`: a resent answer (the device retries with the same payload). */
    outcome: z.enum(['recorded', 'already', 'closed']),
    state: deviceOkSchema,
  }),
]);
export type AnswerResult = z.output<typeof answerResultSchema>;

/** `class_portal.set_team`: the device's view, or `invalid` for a team it may not take. */
export const teamResultSchema = z.union([
  z.object({ status: z.literal('ok').optional(), outcome: z.literal('invalid') }),
  deviceStateSchema,
]);
export type TeamResult = z.output<typeof teamResultSchema>;

// ---------------------------------------------------------------------------------------
// What the projector polls (`public.class_session_live`, the teacher's own session)
// ---------------------------------------------------------------------------------------

/**
 * The current question's key entry, for the projector once the answer is shown. The normalized
 * forms short answers are graded against (`accepted`) are not needed on screen and are dropped;
 * `display` holds what the teacher shows.
 */
const revealAnswerSchema = z.object({
  kind: z.enum(QUESTION_KINDS),
  choiceIds: orNull(z.array(id).max(6)),
  value: orNull(z.boolean()),
  pairs: orNull(z.record(id, id)),
  orderedIds: orNull(z.array(id).max(8)),
  display: orNull(
    z.object({
      sampleAnswer: orNull(z.string().max(1000)),
      acceptable: orNull(z.array(z.string().max(100)).max(10)),
      explanation: orNull(z.string().max(500)),
    }),
  ),
});

export const liveStateSchema = z
  .object({
    /** `closed` once the session ended (its answers and devices are deleted). */
    status: z.enum(['open', 'closed']).default('open'),
    version: z.number().int(),
    /** The resource's title when the session started. */
    title: orNull(z.string().max(200)),
    phase,
    index: z
      .number()
      .int()
      .min(-1)
      .max(MAX_CLASS_QUESTIONS - 1),
    total: z.number().int().min(0).max(MAX_CLASS_QUESTIONS),
    mode: z.enum(['teams', 'solo']),
    /** Team mode: the session's teams, in list order. */
    teams: orNull(z.array(teamKey).max(CLASS_TEAM_KEYS.length)),
    /** « Les élèves choisissent leur équipe » (`device`) or balanced at random. */
    teamChoice: z.enum(['random', 'device']).default('random'),
    /** « Minuterie »: null without a timer. */
    secondsPerQuestion: orNull(z.number().int().min(10).max(300)),
    lang: z.enum(['fr-CA', 'en-CA']),
    /** `class_sessions.join_code`'s own check. */
    joinCode: z.string().regex(/^[A-Z0-9]{4,8}$/),
    joiningOpen: z.boolean(),
    joiningClosesAt: orNull(timestamp),
    expiresAt: timestamp,
    closesAt: orNull(timestamp),
    serverNow: timestamp,
    /** « Garder les résultats de la classe (sans noms) ». */
    keep: z.boolean(),
    revealAnswers: z.boolean(),
    question: orNull(deviceQuestionSchema),
    /** Answers to the current question. */
    answered: count.default(0),
    devices: z.object({
      count,
      /** Seen within 20 s. */
      connected: count,
      byTeam: z.array(z.object({ team: teamKey, members: count })).max(CLASS_TEAM_KEYS.length),
      list: z
        .array(
          z.object({
            id: z.uuid(),
            device: z.number().int().min(1).max(MAX_DEVICE_NUMBER),
            team: orNull(teamKey),
            left: z.boolean(),
          }),
        )
        .max(MAX_DEVICE_NUMBER),
    }),
    reveal: orNull(
      z.object({
        /** Answers per choice id, or per `true` / `false`. */
        distribution: z.record(z.string().max(40), count),
        correctCount: orNull(count),
        /** Only when answers are shown. */
        answer: orNull(revealAnswerSchema),
      }),
    ),
    leaderboard: orNull(z.array(teamScoreSchema).max(CLASS_TEAM_KEYS.length)),
    classStats: orNull(z.object({ percentCorrect: orNull(z.number().min(0).max(100)) })),
  })
  // There is never a key before the reveal: whatever arrives, the projector gets none. With
  // answers hidden, neither the answer nor how many found it (beside the per-choice counts, that
  // number would name the right choice).
  .transform((state) => {
    if (!REVEAL_PHASES.includes(state.phase)) return { ...state, reveal: null };
    if (!state.revealAnswers && state.reveal) {
      return { ...state, reveal: { ...state.reveal, answer: null, correctCount: null } };
    }
    return state;
  });
export type LiveState = z.output<typeof liveStateSchema>;

// ---------------------------------------------------------------------------------------
// What a device sends (checked before `class_portal.answer`, which grades in SQL)
// ---------------------------------------------------------------------------------------

const answerShapes = {
  multiple_choice: z.object({ choiceIds: z.array(id).min(1).max(6) }),
  true_false: z.object({ value: z.boolean() }),
  /** Left id → right id. */
  matching: z.object({
    pairs: z.record(id, id).refine((pairs) => {
      const n = Object.keys(pairs).length;
      return n >= 1 && n <= 8;
    }),
  }),
  ordering: z.object({ orderedIds: z.array(id).min(1).max(8) }),
  /** Graded in the transaction that receives it, then stored as `{}` (D-088). */
  short_answer: z.object({ text: z.string().trim().min(1).max(100) }),
} as const satisfies Record<QuestionKind, z.ZodType>;

type AnswerShapes = typeof answerShapes;
export type ClassAnswer<K extends QuestionKind = QuestionKind> = z.output<AnswerShapes[K]>;

/** The shape of an answer to a question of this kind; anything else in it is dropped. */
export function answerSchema<K extends QuestionKind>(kind: K): AnswerShapes[K] {
  return answerShapes[kind];
}

/** The body of `POST /jouer/api/answer`: the question it answers, its kind and the answer. */
export const answerRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    index: questionIndex,
    kind: z.literal('multiple_choice'),
    response: answerShapes.multiple_choice,
  }),
  z.object({
    index: questionIndex,
    kind: z.literal('true_false'),
    response: answerShapes.true_false,
  }),
  z.object({ index: questionIndex, kind: z.literal('matching'), response: answerShapes.matching }),
  z.object({ index: questionIndex, kind: z.literal('ordering'), response: answerShapes.ordering }),
  z.object({
    index: questionIndex,
    kind: z.literal('short_answer'),
    response: answerShapes.short_answer,
  }),
]);
export type AnswerRequest = z.output<typeof answerRequestSchema>;
