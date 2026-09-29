/**
 * Auto-grading where possible (SPEC 9.3, DECISIONS P-2): all or nothing for multiple choice,
 * true/false and ordering, one point per pair for matching. A short answer is correct only
 * when it matches an accepted answer after normalization; otherwise it goes to the teacher
 * (`correct: null`, « Correction manuelle »). Used by class mode in Phase 5; keys never leave
 * the server.
 */
import type { LibraryItemType } from './catalog';
import { questionsOf } from './questions-of';
import type { AnswerEntry, AnswerKey, Question } from './questions';

const VULGAR_FRACTIONS: Record<string, string> = {
  '½': '1/2',
  '⅓': '1/3',
  '⅔': '2/3',
  '¼': '1/4',
  '¾': '3/4',
  '⅕': '1/5',
  '⅖': '2/5',
  '⅗': '3/5',
  '⅘': '4/5',
  '⅙': '1/6',
  '⅚': '5/6',
  '⅐': '1/7',
  '⅛': '1/8',
  '⅜': '3/8',
  '⅝': '5/8',
  '⅞': '7/8',
  '⅑': '1/9',
  '⅒': '1/10',
};
const VULGAR_PATTERN = new RegExp(`[${Object.keys(VULGAR_FRACTIONS).join('')}]`, 'gu');

/**
 * Normalizes a short answer for comparison: case, accents, apostrophes, every kind of space
 * (including U+00A0 and U+202F), digit grouping (« 1 000 » = « 1000 »), decimal comma
 * (« 0,5 » = « 0.5 »), vulgar fractions (« ¾ » = « 3/4 »), surrounding quotes and final
 * punctuation.
 */
export function normalizeAnswer(text: string): string {
  return (
    text
      .replace(VULGAR_PATTERN, (f) => ` ${VULGAR_FRACTIONS[f]}`)
      .replace(/⁄/g, '/')
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[’‘`´]/g, "'")
      .replace(/\s+/gu, ' ')
      // Digit groups: « 1 000 000 » → « 1000000 ».
      .replace(/(?<=\d) (?=\d{3}(?!\d))/g, '')
      .replace(/(?<=\d),(?=\d)/g, '.')
      .trim()
      .replace(/^[«"'“]+\s*|\s*[»"'”]+$/g, '')
      .replace(/\s*[.!?;:…]+$/u, '')
      .trim()
  );
}

export type QuestionResponse =
  | { kind: 'multiple_choice'; choiceIds: string[] }
  | { kind: 'true_false'; value: boolean }
  /** Left id → right id. */
  | { kind: 'matching'; pairs: Record<string, string> }
  | { kind: 'ordering'; orderedIds: string[] }
  | { kind: 'short_answer'; text: string };

export interface GradeResult {
  score: number;
  max: number;
  /** Null: the teacher decides (« Correction manuelle »), or the key can't grade it. */
  correct: boolean | null;
}

function maxPoints(question: Question): number {
  if (question.kind === 'matching') return question.points ?? question.left.length;
  return question.points ?? 1;
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  new Set(a).size === new Set(b).size && a.every((x) => b.includes(x));

export function gradeQuestion(
  question: Question,
  entry: AnswerEntry | undefined,
  response: QuestionResponse | null | undefined,
): GradeResult {
  const max = maxPoints(question);
  if (!entry || entry.kind !== question.kind) return { score: 0, max, correct: null };
  const allOrNothing = (ok: boolean): GradeResult => ({ score: ok ? max : 0, max, correct: ok });
  if (!response || response.kind !== question.kind) return allOrNothing(false);

  switch (entry.kind) {
    case 'multiple_choice': {
      const chosen = (response as Extract<QuestionResponse, { kind: 'multiple_choice' }>).choiceIds;
      return allOrNothing(chosen.length > 0 && sameSet(chosen, entry.correctChoiceIds));
    }
    case 'true_false':
      return allOrNothing(
        (response as Extract<QuestionResponse, { kind: 'true_false' }>).value === entry.correct,
      );
    case 'ordering': {
      const given = (response as Extract<QuestionResponse, { kind: 'ordering' }>).orderedIds;
      return allOrNothing(
        given.length === entry.orderedIds.length &&
          given.every((id, i) => id === entry.orderedIds[i]),
      );
    }
    case 'matching': {
      const given = (response as Extract<QuestionResponse, { kind: 'matching' }>).pairs;
      const total = entry.pairs.length;
      if (!total) return { score: 0, max, correct: null };
      const right = entry.pairs.filter((p) => given[p.leftId] === p.rightId).length;
      const score = Math.round(((max * right) / total) * 100) / 100;
      return { score, max, correct: right === total };
    }
    case 'short_answer': {
      const text = normalizeAnswer(
        (response as Extract<QuestionResponse, { kind: 'short_answer' }>).text,
      );
      if (!text) return allOrNothing(false);
      const accepted = entry.acceptableAnswers.map(normalizeAnswer).filter(Boolean);
      if (accepted.includes(text)) return allOrNothing(true);
      return { score: 0, max, correct: null };
    }
  }
}

export interface GradedQuestion extends GradeResult {
  questionId: string;
  /** 1-based, like the student sheet. */
  number: number;
}

export interface GradeAllResult {
  score: number;
  max: number;
  /** Questions left to the teacher. */
  manual: number;
  results: GradedQuestion[];
}

/** Grades every question of a content; points add up across questions. */
export function gradeAll(
  type: LibraryItemType,
  content: unknown,
  key: AnswerKey | null,
  responses: Readonly<Record<string, QuestionResponse | undefined>>,
): GradeAllResult {
  const entries = new Map((key?.answers ?? []).map((a) => [a.questionId, a]));
  const results = questionsOf(type, content).map(({ question }, i) => ({
    questionId: question.id,
    number: i + 1,
    ...gradeQuestion(question, entries.get(question.id), responses[question.id]),
  }));
  return {
    score: Math.round(results.reduce((sum, r) => sum + r.score, 0) * 100) / 100,
    max: results.reduce((sum, r) => sum + r.max, 0),
    manual: results.filter((r) => r.correct === null).length,
    results,
  };
}
