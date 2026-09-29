/**
 * The question editor's changes (« Contenu », DECISIONS D-062): pure functions on the editor's
 * model (`AuthoringQuestion` from @lynx/content), where the author writes each answer next to its
 * question. `fromAuthoring` later splits the answers into the answer key and scrambles ordering
 * items and matching right columns, so the editor always works in the author's order.
 *
 * Every function returns a new value and never goes past the schema's limits (the buttons that
 * would are disabled), so the list editors stay dumb. Ids are short and stable (`q3`, `c2`,
 * `l4`, `r5`, `i2`) and unique where the schemas and `validateAnswerKey` need them to be.
 */
import {
  QUESTION_KINDS,
  freshId,
  mapQuestions,
  newAuthoringQuestion,
  type AuthoringChoice,
  type AuthoringPair,
  type AuthoringQuestion,
  type ChoiceOption,
  type LibraryItemType,
  type QuestionKind,
} from '@lynx/content';

/** Sizes of the parts of a question (questions.ts in @lynx/content; a test keeps them in step). */
export const QUESTION_LIMITS = {
  choices: { min: 2, max: 6 },
  /** Left column (one row per pair). */
  pairs: { min: 2, max: 8 },
  /** Right column: the paired items plus the extra ones. */
  right: { min: 2, max: 8 },
  items: { min: 2, max: 8 },
  acceptableAnswers: { min: 0, max: 10 },
  lines: { min: 1, max: 12 },
  points: { min: 1, max: 20 },
} as const;

export type Direction = 'up' | 'down';

/** A copy of `list` with the element at `index` moved one place up or down (unchanged at an end). */
export function move<T>(list: readonly T[], index: number, direction: Direction): T[] {
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return [...list];
  const copy = [...list];
  [copy[index], copy[target]] = [copy[target]!, copy[index]!];
  return copy;
}

export function removeAt<T>(list: readonly T[], index: number): T[] {
  return list.filter((_, i) => i !== index);
}

export function replaceAt<T>(list: readonly T[], index: number, value: T): T[] {
  return list.map((item, i) => (i === index ? value : item));
}

/** The kinds a question list offers: riddles are short answers only. */
export function kindsFor(shortAnswerOnly: boolean): readonly QuestionKind[] {
  return shortAnswerOnly ? ['short_answer'] : QUESTION_KINDS;
}

/**
 * Every question id of a content in the editor's model, in every list (a unit test's sections
 * share one numbering: `validateAnswerKey` refuses the same id twice).
 */
export function questionIdsOf(type: LibraryItemType, content: unknown): string[] {
  const ids: string[] = [];
  mapQuestions(type, content, (q) => {
    if (typeof q.id === 'string') ids.push(q.id);
    return q;
  });
  return ids;
}

/** A new question of `kind` at the end of `list`, with an id no other question of the item has. */
export function addQuestion(
  list: readonly AuthoringQuestion[],
  kind: QuestionKind,
  takenIds: Iterable<string>,
): AuthoringQuestion[] {
  return [...list, newAuthoringQuestion(kind, [...takenIds, ...list.map((q) => q.id)])];
}

const texts = (q: AuthoringQuestion): string[] => {
  switch (q.kind) {
    case 'multiple_choice':
      return q.choices.map((c) => c.text);
    case 'ordering':
      return q.items.map((i) => i.text);
    case 'matching':
      return q.pairs.map((p) => p.left);
    default:
      return [];
  }
};

/**
 * The same question as another kind. What every kind shares is kept (id, prompt, hint, points,
 * category, explanation), and so are the texts of choices, items or left-hand items when the new
 * kind has a list; the answers themselves start again.
 */
export function changeKind(q: AuthoringQuestion, kind: QuestionKind): AuthoringQuestion {
  if (q.kind === kind) return q;
  const fresh = newAuthoringQuestion(kind, []);
  const common = {
    id: q.id,
    prompt: q.prompt,
    hint: q.hint,
    points: q.points,
    category: q.category,
    explanation: q.explanation,
  };
  const kept = texts(q).filter((t) => t.trim());
  switch (fresh.kind) {
    case 'multiple_choice': {
      const choices =
        kept.length >= QUESTION_LIMITS.choices.min
          ? kept.slice(0, QUESTION_LIMITS.choices.max).map((text, i) => ({
              id: `c${i + 1}`,
              text,
              correct: i === 0,
            }))
          : fresh.choices;
      return { ...fresh, ...common, choices };
    }
    case 'ordering': {
      const items =
        kept.length >= QUESTION_LIMITS.items.min
          ? kept.slice(0, QUESTION_LIMITS.items.max).map((text, i) => ({ id: `i${i + 1}`, text }))
          : fresh.items;
      return { ...fresh, ...common, items };
    }
    case 'matching': {
      const pairs =
        kept.length >= QUESTION_LIMITS.pairs.min
          ? kept.slice(0, QUESTION_LIMITS.pairs.max).map((left, i) => ({
              leftId: `l${i + 1}`,
              left,
              rightId: `r${i + 1}`,
              right: '',
            }))
          : fresh.pairs;
      return { ...fresh, ...common, pairs };
    }
    default:
      return { ...fresh, ...common };
  }
}

// ---------------------------------------------------------------------------------------
// Multiple choice
// ---------------------------------------------------------------------------------------

type Mc = Extract<AuthoringQuestion, { kind: 'multiple_choice' }>;
type Matching = Extract<AuthoringQuestion, { kind: 'matching' }>;
type Ordering = Extract<AuthoringQuestion, { kind: 'ordering' }>;
type ShortAnswer = Extract<AuthoringQuestion, { kind: 'short_answer' }>;

export function addChoice(q: Mc): Mc {
  if (q.choices.length >= QUESTION_LIMITS.choices.max) return q;
  const id = freshId(
    'c',
    q.choices.map((c) => c.id),
  );
  return { ...q, choices: [...q.choices, { id, text: '', correct: false }] };
}

export function removeChoice(q: Mc, index: number): Mc {
  if (q.choices.length <= QUESTION_LIMITS.choices.min) return q;
  return { ...q, choices: removeAt(q.choices, index) };
}

export function setChoiceText(q: Mc, index: number, text: string): Mc {
  const choice = q.choices[index];
  if (!choice) return q;
  return { ...q, choices: replaceAt(q.choices, index, { ...choice, text }) };
}

/**
 * Marks a choice as a correct answer. With one correct answer (the default), it becomes the only
 * one; with « Plusieurs bonnes réponses », it is toggled.
 */
export function toggleCorrect(q: Mc, index: number): Mc {
  if (!q.choices[index]) return q;
  const choices: AuthoringChoice[] = q.multipleAnswers
    ? q.choices.map((c, i) => (i === index ? { ...c, correct: !c.correct } : c))
    : q.choices.map((c, i) => ({ ...c, correct: i === index }));
  return { ...q, choices };
}

/** « Plusieurs bonnes réponses ». Turned off, only the first correct choice stays correct. */
export function setMultipleAnswers(q: Mc, multipleAnswers: boolean): Mc {
  if (multipleAnswers || q.choices.filter((c) => c.correct).length <= 1) {
    return { ...q, multipleAnswers };
  }
  const first = q.choices.findIndex((c) => c.correct);
  return {
    ...q,
    multipleAnswers,
    choices: q.choices.map((c, i) => ({ ...c, correct: i === first })),
  };
}

// ---------------------------------------------------------------------------------------
// Matching: one row per pair (left item and its match), plus right-hand items that match nothing
// ---------------------------------------------------------------------------------------

const rightCount = (q: Matching) => q.pairs.length + q.extraRight.length;
const rightIds = (q: Matching) => [
  ...q.pairs.map((p) => p.rightId),
  ...q.extraRight.map((r) => r.id),
];

export const canAddPair = (q: Matching) =>
  q.pairs.length < QUESTION_LIMITS.pairs.max && rightCount(q) < QUESTION_LIMITS.right.max;
export const canAddExtraRight = (q: Matching) => rightCount(q) < QUESTION_LIMITS.right.max;

export function addPair(q: Matching): Matching {
  if (!canAddPair(q)) return q;
  const pair: AuthoringPair = {
    leftId: freshId(
      'l',
      q.pairs.map((p) => p.leftId),
    ),
    left: '',
    rightId: freshId('r', rightIds(q)),
    right: '',
  };
  return { ...q, pairs: [...q.pairs, pair] };
}

export function removePair(q: Matching, index: number): Matching {
  if (q.pairs.length <= QUESTION_LIMITS.pairs.min) return q;
  return { ...q, pairs: removeAt(q.pairs, index) };
}

export function setPair(
  q: Matching,
  index: number,
  change: Partial<Pick<AuthoringPair, 'left' | 'right'>>,
): Matching {
  const pair = q.pairs[index];
  if (!pair) return q;
  return { ...q, pairs: replaceAt(q.pairs, index, { ...pair, ...change }) };
}

export function addExtraRight(q: Matching): Matching {
  if (!canAddExtraRight(q)) return q;
  return { ...q, extraRight: [...q.extraRight, { id: freshId('r', rightIds(q)), text: '' }] };
}

export function removeExtraRight(q: Matching, index: number): Matching {
  return { ...q, extraRight: removeAt(q.extraRight, index) };
}

export function setExtraRight(q: Matching, index: number, text: string): Matching {
  const item = q.extraRight[index];
  if (!item) return q;
  return { ...q, extraRight: replaceAt(q.extraRight, index, { ...item, text }) };
}

// ---------------------------------------------------------------------------------------
// Ordering: items in the correct order (the student sheet gets them scrambled)
// ---------------------------------------------------------------------------------------

export function addItem(q: Ordering): Ordering {
  if (q.items.length >= QUESTION_LIMITS.items.max) return q;
  const item: ChoiceOption = {
    id: freshId(
      'i',
      q.items.map((i) => i.id),
    ),
    text: '',
  };
  return { ...q, items: [...q.items, item] };
}

export function removeItem(q: Ordering, index: number): Ordering {
  if (q.items.length <= QUESTION_LIMITS.items.min) return q;
  return { ...q, items: removeAt(q.items, index) };
}

export function setItem(q: Ordering, index: number, text: string): Ordering {
  const item = q.items[index];
  if (!item) return q;
  return { ...q, items: replaceAt(q.items, index, { ...item, text }) };
}

export function moveItem(q: Ordering, index: number, direction: Direction): Ordering {
  return { ...q, items: move(q.items, index, direction) };
}

// ---------------------------------------------------------------------------------------
// Short answer: accepted answers (automatic correction) and writing lines
// ---------------------------------------------------------------------------------------

export function addAcceptable(q: ShortAnswer): ShortAnswer {
  if (q.acceptableAnswers.length >= QUESTION_LIMITS.acceptableAnswers.max) return q;
  return { ...q, acceptableAnswers: [...q.acceptableAnswers, ''] };
}

export function setAcceptable(q: ShortAnswer, index: number, text: string): ShortAnswer {
  if (index < 0 || index >= q.acceptableAnswers.length) return q;
  return { ...q, acceptableAnswers: replaceAt(q.acceptableAnswers, index, text) };
}

export function removeAcceptable(q: ShortAnswer, index: number): ShortAnswer {
  return { ...q, acceptableAnswers: removeAt(q.acceptableAnswers, index) };
}

/** A whole number within `limits`, or null when the field was emptied. */
export function clampInt(raw: string, limits: { min: number; max: number }): number | null {
  if (raw.trim() === '') return null;
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return null;
  return Math.min(limits.max, Math.max(limits.min, n));
}
