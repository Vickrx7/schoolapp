/**
 * The check before « Lancer » of « Quiz sur les appareils » (DECISIONS D-084, D-086, D-087): how
 * many questions devices will get, how many count for points, and every string devices will show,
 * so the teacher is warned when the quiz may name a student of the class (it can be her own
 * private draft). The database builds the real snapshot and key at start
 * (`app.class_mode_questions`, `app.class_mode_key`): this is the same whitelist, applied in
 * TypeScript for the preview only. Nothing here decides what devices get.
 *
 * Pure (no server-only import) so it is unit-tested; `server/actions/class-mode.ts` runs it with
 * the version the teacher chose and the class's students.
 */
import { ID_PATTERN, type LibraryItemType, type QuestionKind } from '@lynx/content';

const PLAYABLE_TYPES: readonly LibraryItemType[] = ['quiz', 'game'];
const KINDS: readonly QuestionKind[] = [
  'multiple_choice',
  'true_false',
  'matching',
  'ordering',
  'short_answer',
];
const MAX_QUESTIONS = 80;
const MAX_OPTIONS = 8;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is string =>
  typeof value === 'string' && ID_PATTERN.test(value);
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

interface Option {
  id: string;
  text: string;
}

/** A question as devices see it (`app.class_mode_question`). */
export interface PreviewQuestion {
  id: string;
  kind: QuestionKind;
  prompt: string;
  hint: string;
  multipleAnswers: boolean;
  choices: Option[];
  left: Option[];
  right: Option[];
  items: Option[];
}

/** Options as {id, text}: well-formed ids once each, at most 8 (`app.class_mode_options`). */
function options(value: unknown): Option[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: Option[] = [];
  for (const o of value) {
    if (!isObject(o) || !isId(o.id) || typeof o.text !== 'string' || seen.has(o.id)) continue;
    seen.add(o.id);
    out.push({ id: o.id, text: o.text.slice(0, 300) });
    if (out.length === MAX_OPTIONS) break;
  }
  return out;
}

function question(q: Json): PreviewQuestion {
  const kind = q.kind as QuestionKind;
  return {
    id: q.id as string,
    kind,
    prompt: typeof q.prompt === 'string' ? q.prompt.slice(0, 1000) : '',
    hint: typeof q.hint === 'string' ? q.hint.slice(0, 300).trim() : '',
    multipleAnswers: kind === 'multiple_choice' && q.multipleAnswers === true,
    choices: kind === 'multiple_choice' ? options(q.choices) : [],
    left: kind === 'matching' ? options(q.left) : [],
    right: kind === 'matching' ? options(q.right) : [],
    items: kind === 'ordering' ? options(q.items) : [],
  };
}

/** A question a device can answer (`app.class_mode_playable`). */
function playable(q: PreviewQuestion): boolean {
  if (!q.prompt.trim()) return false;
  switch (q.kind) {
    case 'multiple_choice':
      return q.choices.length >= 2;
    case 'matching':
      return q.left.length >= 1 && q.right.length >= 1;
    case 'ordering':
      return q.items.length >= 2;
    default:
      return true;
  }
}

/** The questions devices get from a version's content (`app.class_mode_questions`). */
export function deviceQuestions(type: LibraryItemType, content: unknown): PreviewQuestion[] {
  if (!PLAYABLE_TYPES.includes(type) || !isObject(content) || !Array.isArray(content.questions)) {
    return [];
  }
  const seen = new Set<string>();
  const out: PreviewQuestion[] = [];
  for (const raw of content.questions) {
    if (!isObject(raw) || !isId(raw.id) || !KINDS.includes(raw.kind as QuestionKind)) continue;
    if (seen.has(raw.id)) continue;
    seen.add(raw.id);
    const q = question(raw);
    if (playable(q)) out.push(q);
    if (out.length === MAX_QUESTIONS) break;
  }
  return out;
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join('\u0000') === [...b].sort().join('\u0000');

/**
 * Whether a question counts for points: its key entry is complete and fits the question
 * (`app.class_mode_key_entry`). Short answers only with « Noter les réponses courtes ».
 */
export function isScorable(
  q: PreviewQuestion,
  rawKey: unknown,
  scoreShortAnswers: boolean,
): boolean {
  const answers = isObject(rawKey) && Array.isArray(rawKey.answers) ? rawKey.answers : [];
  const entry = answers.find(
    (a): a is Json => isObject(a) && a.questionId === q.id && a.kind === q.kind,
  );
  if (!entry) return false;
  switch (q.kind) {
    case 'multiple_choice': {
      const ids = [...new Set(strings(entry.correctChoiceIds))];
      const all = q.choices.map((c) => c.id);
      return (
        ids.length >= 1 &&
        ids.length <= 6 &&
        ids.every((id) => all.includes(id)) &&
        (ids.length === 1 || q.multipleAnswers)
      );
    }
    case 'true_false':
      return typeof entry.correct === 'boolean';
    case 'matching': {
      if (!Array.isArray(entry.pairs)) return false;
      const pairs = entry.pairs.filter(
        (p): p is { leftId: string; rightId: string } =>
          isObject(p) && typeof p.leftId === 'string' && typeof p.rightId === 'string',
      );
      const lefts = pairs.map((p) => p.leftId);
      const rights = q.right.map((r) => r.id);
      return (
        pairs.length === entry.pairs.length &&
        new Set(lefts).size === lefts.length &&
        sameSet(
          lefts,
          q.left.map((l) => l.id),
        ) &&
        pairs.every((p) => rights.includes(p.rightId))
      );
    }
    case 'ordering': {
      const ids = strings(entry.orderedIds);
      return (
        Array.isArray(entry.orderedIds) &&
        ids.length === entry.orderedIds.length &&
        sameSet(
          ids,
          q.items.map((i) => i.id),
        )
      );
    }
    case 'short_answer':
      return scoreShortAnswers && strings(entry.acceptableAnswers).some((a) => a.trim() !== '');
  }
}

export interface QuizPreview {
  /** Questions devices will get (0: not playable, LXC04). */
  questions: number;
  /** Of which count for points. */
  scorable: number;
  /** Every string a device will show: the title, prompts, hints and options. */
  deviceStrings: string[];
}

export function quizPreview(input: {
  type: LibraryItemType;
  title: string;
  content: unknown;
  answerKey: unknown;
  scoreShortAnswers: boolean;
}): QuizPreview {
  const questions = deviceQuestions(input.type, input.content);
  const deviceStrings = [input.title.slice(0, 200)];
  for (const q of questions) {
    deviceStrings.push(q.prompt, q.hint);
    for (const o of [...q.choices, ...q.left, ...q.right, ...q.items]) deviceStrings.push(o.text);
  }
  return {
    questions: questions.length,
    scorable: questions.filter((q) => isScorable(q, input.answerKey, input.scoreShortAnswers))
      .length,
    deviceStrings: deviceStrings.filter((s) => s.trim() !== ''),
  };
}
