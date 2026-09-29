/**
 * The editor's model (DECISIONS P-2): the author writes each answer next to its question
 * (« Écrivez les éléments dans le bon ordre : ils seront mélangés pour les élèves. »), and
 * `fromAuthoring` splits it into content (display order, no answers) and an answer key.
 * `toAuthoring` joins them back for editing.
 */
import { TYPE_INFO, type LibraryItemType } from './catalog';
import { isPlainObject } from './conform';
import { mapQuestions } from './questions-of';
import {
  isQuestionKind,
  type AchievementCategory,
  type AnswerEntry,
  type AnswerKey,
  type ChoiceOption,
  type QuestionKind,
} from './questions';
import { emptyContent, type ContentOf } from './schemas';
import {
  matchingPermutation,
  matchingSeed,
  orderingSeed,
  scrambleBySeed,
  unscramble,
} from './scramble';

interface AuthoringQuestionBase {
  id: string;
  prompt: string;
  hint: string;
  points: number | null;
  category: AchievementCategory | null;
  explanation: string;
}

export interface AuthoringChoice extends ChoiceOption {
  correct: boolean;
}

export interface AuthoringPair {
  leftId: string;
  left: string;
  rightId: string;
  right: string;
}

export type AuthoringQuestion =
  | (AuthoringQuestionBase & {
      kind: 'multiple_choice';
      choices: AuthoringChoice[];
      multipleAnswers: boolean;
    })
  | (AuthoringQuestionBase & { kind: 'true_false'; correct: boolean })
  | (AuthoringQuestionBase & {
      kind: 'matching';
      /** One row per left item, with its match. */
      pairs: AuthoringPair[];
      /** Right items that match nothing. */
      extraRight: ChoiceOption[];
    })
  | (AuthoringQuestionBase & {
      kind: 'ordering';
      /** In the correct order; the student sheet gets them scrambled. */
      items: ChoiceOption[];
    })
  | (AuthoringQuestionBase & {
      kind: 'short_answer';
      lines: number;
      sampleAnswer: string;
      acceptableAnswers: string[];
    });

export interface Authoring<T extends LibraryItemType = LibraryItemType> {
  type: T;
  /** The content, with `AuthoringQuestion`s in its question lists. */
  content: Record<string, unknown>;
  /** `answerKey.solution`: worked solution, expected results, solution of a challenge. */
  solution: string;
}

export function emptyAuthoring<T extends LibraryItemType>(type: T): Authoring<T> {
  return { type, content: emptyContent(type) as Record<string, unknown>, solution: '' };
}

/** An id with `prefix` not in `taken`: `q1`, `q2`… */
export function freshId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let n = 1; ; n++) {
    const id = `${prefix}${n}`;
    if (!used.has(id)) return id;
  }
}

/** A new, empty question of a kind for the editor, with ids that don't clash. */
export function newAuthoringQuestion(
  kind: QuestionKind,
  takenQuestionIds: Iterable<string>,
): AuthoringQuestion {
  const base: AuthoringQuestionBase = {
    id: freshId('q', takenQuestionIds),
    prompt: '',
    hint: '',
    points: null,
    category: null,
    explanation: '',
  };
  switch (kind) {
    case 'multiple_choice':
      return {
        ...base,
        kind,
        choices: [
          { id: 'c1', text: '', correct: true },
          { id: 'c2', text: '', correct: false },
        ],
        multipleAnswers: false,
      };
    case 'true_false':
      return { ...base, kind, correct: true };
    case 'matching':
      return {
        ...base,
        kind,
        pairs: [
          { leftId: 'l1', left: '', rightId: 'r1', right: '' },
          { leftId: 'l2', left: '', rightId: 'r2', right: '' },
        ],
        extraRight: [],
      };
    case 'ordering':
      return {
        ...base,
        kind,
        items: [
          { id: 'i1', text: '' },
          { id: 'i2', text: '' },
        ],
      };
    case 'short_answer':
      return { ...base, kind, lines: 3, sampleAnswer: '', acceptableAnswers: [] };
  }
}

function split(q: AuthoringQuestion): { question: Record<string, unknown>; entry: AnswerEntry } {
  const base = {
    id: q.id,
    kind: q.kind,
    prompt: q.prompt,
    hint: q.hint,
    points: q.points,
    category: q.category,
  };
  const head = { questionId: q.id, kind: q.kind };
  switch (q.kind) {
    case 'multiple_choice':
      return {
        question: {
          ...base,
          choices: q.choices.map((c) => ({ id: c.id, text: c.text })),
          multipleAnswers: q.multipleAnswers,
        },
        entry: {
          ...head,
          kind: q.kind,
          correctChoiceIds: q.choices.filter((c) => c.correct).map((c) => c.id),
          explanation: q.explanation,
        },
      };
    case 'true_false':
      return {
        question: base,
        entry: { ...head, kind: q.kind, correct: q.correct, explanation: q.explanation },
      };
    case 'matching': {
      const original = [
        ...q.pairs.map((p) => ({ id: p.rightId, text: p.right })),
        ...q.extraRight.map((r) => ({ id: r.id, text: r.text })),
      ];
      const perm = matchingPermutation(matchingSeed(q.id), original.length, q.pairs.length);
      return {
        question: {
          ...base,
          left: q.pairs.map((p) => ({ id: p.leftId, text: p.left })),
          right: perm.map((i) => original[i]!),
        },
        entry: {
          ...head,
          kind: q.kind,
          pairs: q.pairs.map((p) => ({ leftId: p.leftId, rightId: p.rightId })),
          explanation: q.explanation,
        },
      };
    }
    case 'ordering':
      return {
        question: {
          ...base,
          items: scrambleBySeed(
            q.items.map((i) => ({ id: i.id, text: i.text })),
            orderingSeed(q.id),
          ),
        },
        entry: {
          ...head,
          kind: q.kind,
          orderedIds: q.items.map((i) => i.id),
          explanation: q.explanation,
        },
      };
    case 'short_answer':
      return {
        question: { ...base, lines: q.lines },
        entry: {
          ...head,
          kind: q.kind,
          sampleAnswer: q.sampleAnswer,
          acceptableAnswers: q.acceptableAnswers,
          explanation: q.explanation,
        },
      };
  }
}

/**
 * Content and key from the editor's model. Ordering items and matching right columns are
 * scrambled deterministically (seeded by the question id). The key is null for types that
 * carry none, and for types with questions that have neither questions nor a solution yet
 * (unless the type needs a key).
 */
export function fromAuthoring<T extends LibraryItemType>(
  type: T,
  authoring: Authoring<T>,
): { content: ContentOf<T>; key: AnswerKey | null } {
  const answers: AnswerEntry[] = [];
  const content = mapQuestions(type, authoring.content, (q) => {
    if (!isQuestionKind(q.kind)) return q;
    const { question, entry } = split(q as unknown as AuthoringQuestion);
    answers.push(entry);
    return question;
  });
  const info = TYPE_INFO[type];
  const hasKey =
    info.mayHaveQuestions && (info.keyed || answers.length > 0 || !!authoring.solution.trim());
  return {
    content: content as ContentOf<T>,
    key: hasKey ? { answers, solution: authoring.solution } : null,
  };
}

type Item = { id: string; text: string };

function join(q: Record<string, unknown>, entry: AnswerEntry | undefined): AuthoringQuestion {
  const base: AuthoringQuestionBase = {
    id: String(q.id ?? ''),
    prompt: String(q.prompt ?? ''),
    hint: String(q.hint ?? ''),
    points: typeof q.points === 'number' ? q.points : null,
    category: (q.category ?? null) as AchievementCategory | null,
    explanation: entry?.explanation ?? '',
  };
  const same = entry?.kind === q.kind ? entry : undefined;
  const items = (value: unknown): Item[] =>
    Array.isArray(value) ? value.filter(isPlainObject).map((i) => i as unknown as Item) : [];
  switch (q.kind) {
    case 'multiple_choice': {
      const correct = same?.kind === 'multiple_choice' ? same.correctChoiceIds : [];
      return {
        ...base,
        kind: 'multiple_choice',
        choices: items(q.choices).map((c) => ({ ...c, correct: correct.includes(c.id) })),
        multipleAnswers: q.multipleAnswers === true,
      };
    }
    case 'true_false':
      return {
        ...base,
        kind: 'true_false',
        correct: same?.kind === 'true_false' ? same.correct : true,
      };
    case 'matching': {
      const left = items(q.left);
      const right = items(q.right);
      const pairs = same?.kind === 'matching' ? same.pairs : [];
      const rows: AuthoringPair[] = left.map((l) => {
        const rightId = pairs.find((p) => p.leftId === l.id)?.rightId ?? '';
        const match = right.find((r) => r.id === rightId);
        return {
          leftId: l.id,
          left: l.text,
          rightId: match ? rightId : '',
          right: match?.text ?? '',
        };
      });
      const paired = new Set(rows.map((r) => r.rightId));
      // Undo the scramble to give the extra items back in the author's order.
      const perm = matchingPermutation(matchingSeed(base.id), right.length, left.length);
      const extraRight = unscramble(right, perm).filter((r) => !paired.has(r.id));
      return { ...base, kind: 'matching', pairs: rows, extraRight };
    }
    case 'ordering': {
      const display = items(q.items);
      const ordered = same?.kind === 'ordering' ? same.orderedIds : [];
      const inOrder = ordered.map((id) => display.find((i) => i.id === id));
      const complete =
        inOrder.length === display.length && inOrder.every((i): i is Item => i !== undefined);
      return { ...base, kind: 'ordering', items: complete ? (inOrder as Item[]) : display };
    }
    default:
      // Short answers, and questions of an unknown kind (the editor offers them as short answers).
      return {
        ...base,
        kind: 'short_answer',
        lines: typeof q.lines === 'number' ? q.lines : 3,
        sampleAnswer: same?.kind === 'short_answer' ? same.sampleAnswer : '',
        acceptableAnswers: same?.kind === 'short_answer' ? same.acceptableAnswers : [],
      };
  }
}

/** The editor's model from stored content and its key (null when there is none). */
export function toAuthoring<T extends LibraryItemType>(
  type: T,
  content: ContentOf<T>,
  key: AnswerKey | null,
): Authoring<T> {
  const entries = new Map((key?.answers ?? []).map((a) => [a.questionId, a]));
  const joined = mapQuestions(type, content as unknown, (q) =>
    join(q, entries.get(String(q.id))),
  ) as Record<string, unknown>;
  return { type, content: joined, solution: key?.solution ?? '' };
}
