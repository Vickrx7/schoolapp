/**
 * Questions and answer keys (DECISIONS D-062). A question lives in the content with an id; its
 * answer lives in the answer key (`library_item_answer_keys`), never in the content. Ordering
 * items and matching right columns are stored in display order, scrambled, so the stored order
 * never gives the answer away.
 */
import { z } from 'zod';
import { kit, type SchemaMode } from './kit';

export const QUESTION_KINDS = [
  'multiple_choice',
  'true_false',
  'matching',
  'ordering',
  'short_answer',
] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

/** The four categories of the Ontario achievement chart (SPEC 9.3). */
export const ACHIEVEMENT_CATEGORIES = [
  'connaissance',
  'habiletes',
  'communication',
  'application',
] as const;
export type AchievementCategory = (typeof ACHIEVEMENT_CATEGORIES)[number];

export interface ChoiceOption {
  id: string;
  text: string;
}

interface QuestionBase {
  id: string;
  prompt: string;
  hint: string;
  /** Null: one point (or one per pair for matching). */
  points: number | null;
  /** Achievement-chart category; shown on the teacher copy only. */
  category: AchievementCategory | null;
}

export interface MultipleChoiceQuestion extends QuestionBase {
  kind: 'multiple_choice';
  choices: ChoiceOption[];
  multipleAnswers: boolean;
}
export interface TrueFalseQuestion extends QuestionBase {
  kind: 'true_false';
}
export interface MatchingQuestion extends QuestionBase {
  kind: 'matching';
  left: ChoiceOption[];
  /** Display order; may hold more items than `left`. */
  right: ChoiceOption[];
}
export interface OrderingQuestion extends QuestionBase {
  kind: 'ordering';
  /** Display order, never the answer order. */
  items: ChoiceOption[];
}
export interface ShortAnswerQuestion extends QuestionBase {
  kind: 'short_answer';
  /** Writing lines on the student sheet. */
  lines: number;
}
export type Question =
  | MultipleChoiceQuestion
  | TrueFalseQuestion
  | MatchingQuestion
  | OrderingQuestion
  | ShortAnswerQuestion;

interface AnswerBase {
  questionId: string;
  explanation: string;
}
export interface MultipleChoiceAnswer extends AnswerBase {
  kind: 'multiple_choice';
  correctChoiceIds: string[];
}
export interface TrueFalseAnswer extends AnswerBase {
  kind: 'true_false';
  correct: boolean;
}
export interface MatchingPair {
  leftId: string;
  rightId: string;
}
export interface MatchingAnswer extends AnswerBase {
  kind: 'matching';
  pairs: MatchingPair[];
}
export interface OrderingAnswer extends AnswerBase {
  kind: 'ordering';
  orderedIds: string[];
}
export interface ShortAnswerAnswer extends AnswerBase {
  kind: 'short_answer';
  sampleAnswer: string;
  acceptableAnswers: string[];
}
export type AnswerEntry =
  MultipleChoiceAnswer | TrueFalseAnswer | MatchingAnswer | OrderingAnswer | ShortAnswerAnswer;

/** `library_item_answer_keys.answer_key`. */
export interface AnswerKey {
  answers: AnswerEntry[];
  /** Worked solution, expected results of an experiment, solution of a challenge. */
  solution: string;
}

export interface QuestionSchemas {
  option: z.ZodType<ChoiceOption>;
  /** One question of any kind: a discriminated union, or in `ai` mode one flat object. */
  question: z.ZodType<Question>;
  /** Riddles accept short answers only (flat in `ai` mode). */
  shortAnswerQuestion: z.ZodType<ShortAnswerQuestion>;
  key: z.ZodType<AnswerEntry>;
  answerKey: z.ZodType<AnswerKey>;
}

/** Question-shaped schemas of every mode, so shape walkers can recognize them. */
export const QUESTION_SCHEMAS = new WeakSet<z.ZodType>();
/** Answer-entry schemas of every mode. */
export const ANSWER_ENTRY_SCHEMAS = new WeakSet<z.ZodType>();

function build(mode: SchemaMode): QuestionSchemas {
  const k = kit(mode);
  const option = k.obj({ id: k.id, text: k.text(300) });

  if (mode === 'ai') {
    // One flat object with nullable per-kind fields: structured outputs handle it reliably.
    const flat = z.object({
      id: z.string(),
      kind: z.string(),
      prompt: z.string(),
      hint: z.string(),
      points: z.number().nullable(),
      category: z.string().nullable(),
      choices: z.array(option).nullable(),
      multipleAnswers: z.boolean().nullable(),
      left: z.array(option).nullable(),
      right: z.array(option).nullable(),
      items: z.array(option).nullable(),
      lines: z.number().nullable(),
    });
    const flatKey = z.object({
      questionId: z.string(),
      kind: z.string(),
      correctChoiceIds: z.array(z.string()).nullable(),
      correct: z.boolean().nullable(),
      pairs: z.array(z.object({ leftId: z.string(), rightId: z.string() })).nullable(),
      orderedIds: z.array(z.string()).nullable(),
      sampleAnswer: z.string().nullable(),
      acceptableAnswers: z.array(z.string()).nullable(),
      explanation: z.string(),
    });
    QUESTION_SCHEMAS.add(flat);
    ANSWER_ENTRY_SCHEMAS.add(flatKey);
    return {
      option,
      question: flat as unknown as z.ZodType<Question>,
      shortAnswerQuestion: flat as unknown as z.ZodType<ShortAnswerQuestion>,
      key: flatKey as unknown as z.ZodType<AnswerEntry>,
      answerKey: z.object({
        answers: z.array(flatKey),
        solution: z.string(),
      }) as unknown as z.ZodType<AnswerKey>,
    };
  }

  const base = {
    id: k.id,
    prompt: k.text(1000),
    hint: k.optText(300),
    points: k.int(1, 20).nullable(),
    category: k.enumOf(ACHIEVEMENT_CATEGORIES).nullable(),
  };
  const multipleChoice = k.obj({
    id: base.id,
    kind: z.literal('multiple_choice'),
    ...omitId(base),
    choices: k.list(option, 2, 6),
    multipleAnswers: k.bool,
  });
  const trueFalse = k.obj({ id: base.id, kind: z.literal('true_false'), ...omitId(base) });
  const matching = k.obj({
    id: base.id,
    kind: z.literal('matching'),
    ...omitId(base),
    left: k.list(option, 2, 8),
    right: k.list(option, 2, 8),
  });
  const ordering = k.obj({
    id: base.id,
    kind: z.literal('ordering'),
    ...omitId(base),
    items: k.list(option, 2, 8),
  });
  const shortAnswer = k.obj({
    id: base.id,
    kind: z.literal('short_answer'),
    ...omitId(base),
    lines: k.int(1, 12),
  });
  const question = z.discriminatedUnion('kind', [
    multipleChoice,
    trueFalse,
    matching,
    ordering,
    shortAnswer,
  ]);

  const explanation = k.optText(500);
  const key = z.discriminatedUnion('kind', [
    k.obj({
      questionId: k.id,
      kind: z.literal('multiple_choice'),
      correctChoiceIds: k.list(k.id, 1, 6),
      explanation,
    }),
    k.obj({ questionId: k.id, kind: z.literal('true_false'), correct: k.bool, explanation }),
    k.obj({
      questionId: k.id,
      kind: z.literal('matching'),
      pairs: k.list(k.obj({ leftId: k.id, rightId: k.id }), 1, 8),
      explanation,
    }),
    k.obj({
      questionId: k.id,
      kind: z.literal('ordering'),
      orderedIds: k.list(k.id, 2, 8),
      explanation,
    }),
    k.obj({
      questionId: k.id,
      kind: z.literal('short_answer'),
      sampleAnswer: k.optText(1000),
      acceptableAnswers: k.list(k.text(100), 0, 10),
      explanation,
    }),
  ]);
  QUESTION_SCHEMAS.add(question);
  QUESTION_SCHEMAS.add(shortAnswer);
  ANSWER_ENTRY_SCHEMAS.add(key);
  return {
    option,
    question: question as unknown as z.ZodType<Question>,
    shortAnswerQuestion: shortAnswer as unknown as z.ZodType<ShortAnswerQuestion>,
    key: key as unknown as z.ZodType<AnswerEntry>,
    answerKey: k.obj({
      answers: k.list(key, 0, 80),
      solution: k.optText(8000),
    }) as unknown as z.ZodType<AnswerKey>,
  };
}

function omitId<T extends { id: unknown }>(base: T): Omit<T, 'id'> {
  const { id: _id, ...rest } = base;
  return rest;
}

const CACHE = new Map<SchemaMode, QuestionSchemas>();

export function questionSchemas(mode: SchemaMode): QuestionSchemas {
  let schemas = CACHE.get(mode);
  if (!schemas) {
    schemas = build(mode);
    CACHE.set(mode, schemas);
  }
  return schemas;
}

export function isQuestionKind(value: unknown): value is QuestionKind {
  return typeof value === 'string' && (QUESTION_KINDS as readonly string[]).includes(value);
}
