/**
 * From `ai`-mode output to canonical content (DECISIONS D-061, D-080). These functions never
 * throw. They fix form for free (flat questions, ids, enum spelling, typography, ordering left
 * in answer order) and keep every substantive problem (an unknown question kind, a missing
 * answer) so that `final` and `validateAnswerKey` report it with its path.
 */
import type { LibraryItemType } from './catalog';
import { conform, foldKey, isPlainObject, looseEnumValue } from './conform';
import { mapQuestions } from './questions-of';
import {
  ACHIEVEMENT_CATEGORIES,
  QUESTION_KINDS,
  questionSchemas,
  type AchievementCategory,
  type AnswerKey,
} from './questions';
import { normalizeCommentTemplate } from './report-comments';
import { safetyNotesSchema, type SafetyNotesDraft } from './safety';
import { contentObject, type ContentOf } from './schemas';
import { matchingPermutation, matchingSeed, orderingSeed, permutationFor } from './scramble';
import {
  frenchStrings,
  mapFrenchStrings,
  mapStrings,
  normalizeFrenchTypography,
  suggestsFaithContent,
} from './style';

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** `Q1` → `q1`, `question-2` → `question2`, `1` → `x1`: the id pattern, deterministically. */
export function normalizeId(value: unknown): string {
  const raw = typeof value === 'number' ? String(value) : str(value);
  const id = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  return (/^[a-z]/.test(id) ? id : `x${id}`).slice(0, 8);
}

const CATEGORY_SYNONYMS: Record<string, AchievementCategory> = {
  connaissance: 'connaissance',
  connaissances: 'connaissance',
  connaissance_et_comprehension: 'connaissance',
  comprehension: 'connaissance',
  habiletes: 'habiletes',
  habilete: 'habiletes',
  habiletes_de_la_pensee: 'habiletes',
  pensee: 'habiletes',
  communication: 'communication',
  application: 'application',
  mise_en_application: 'application',
};

function normalizeCategory(value: unknown): AchievementCategory | null {
  if (typeof value !== 'string') return null;
  const folded = foldKey(value);
  return (
    CATEGORY_SYNONYMS[folded] ??
    ACHIEVEMENT_CATEGORIES.find((c) => c === folded) ??
    // An optional label: an unknown one is dropped rather than paid for with a retry.
    null
  );
}

function normalizePoints(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const points = Math.round(value);
  return points < 1 ? null : Math.min(points, 20);
}

function options(value: unknown) {
  return list(value).map((o) => {
    const option = isPlainObject(o) ? o : {};
    return { id: normalizeId(option.id), text: str(option.text) };
  });
}

/** A flat `ai` question (or an already canonical one) as a canonical question. */
export function normalizeAiQuestion(raw: unknown): Record<string, unknown> {
  const q = isPlainObject(raw) ? raw : {};
  const kind = looseEnumValue(str(q.kind), QUESTION_KINDS);
  const base = {
    id: normalizeId(q.id),
    kind,
    prompt: str(q.prompt),
    hint: str(q.hint),
    points: normalizePoints(q.points),
    category: normalizeCategory(q.category),
  };
  switch (kind) {
    case 'multiple_choice':
      return {
        ...base,
        choices: options(q.choices),
        multipleAnswers: typeof q.multipleAnswers === 'boolean' ? q.multipleAnswers : false,
      };
    case 'matching':
      return { ...base, left: options(q.left), right: options(q.right) };
    case 'ordering':
      return { ...base, items: options(q.items) };
    case 'short_answer':
      return {
        ...base,
        lines:
          typeof q.lines === 'number' && Number.isFinite(q.lines)
            ? Math.min(12, Math.max(1, Math.round(q.lines)))
            : 3,
      };
    default:
      // true_false, or an unknown kind that `final` will report at `kind`.
      return base;
  }
}

/** A flat `ai` answer-key entry (or a canonical one) as a canonical entry. */
export function normalizeAiEntry(raw: unknown): Record<string, unknown> {
  const e = isPlainObject(raw) ? raw : {};
  const kind = looseEnumValue(str(e.kind), QUESTION_KINDS);
  const base = { questionId: normalizeId(e.questionId), kind };
  const explanation = str(e.explanation);
  switch (kind) {
    case 'multiple_choice':
      return { ...base, correctChoiceIds: list(e.correctChoiceIds).map(normalizeId), explanation };
    case 'true_false':
      // A missing answer stays missing: `final` reports it instead of it becoming « Faux ».
      return { ...base, correct: e.correct ?? null, explanation };
    case 'matching':
      return {
        ...base,
        pairs: list(e.pairs).map((p) => {
          const pair = isPlainObject(p) ? p : {};
          return { leftId: normalizeId(pair.leftId), rightId: normalizeId(pair.rightId) };
        }),
        explanation,
      };
    case 'ordering':
      return { ...base, orderedIds: list(e.orderedIds).map(normalizeId), explanation };
    case 'short_answer':
      return {
        ...base,
        sampleAnswer: str(e.sampleAnswer),
        acceptableAnswers: list(e.acceptableAnswers).filter((a) => typeof a === 'string'),
        explanation,
      };
    default:
      return { ...base, explanation };
  }
}

const tidy = (text: string) => normalizeFrenchTypography(text.trim());

/** Scrambles ordering items and matching right columns that the AI left in answer order. */
function scrambleAnswerOrder<T>(type: LibraryItemType, content: T, key: AnswerKey): T {
  return mapQuestions(type, content, (question) => {
    const entry = key.answers.find((a) => a.questionId === question.id);
    if (!entry || entry.kind !== question.kind) return question;
    if (entry.kind === 'ordering' && Array.isArray(question.items)) {
      const items = question.items as { id: string }[];
      const inAnswerOrder =
        items.length >= 2 &&
        items.length === entry.orderedIds.length &&
        items.every((item, i) => item.id === entry.orderedIds[i]);
      if (!inAnswerOrder) return question;
      const perm = permutationFor(orderingSeed(String(question.id)), items.length);
      return { ...question, items: perm.map((i) => items[i]) };
    }
    if (
      entry.kind === 'matching' &&
      Array.isArray(question.left) &&
      Array.isArray(question.right)
    ) {
      const left = question.left as { id: string }[];
      const right = question.right as { id: string }[];
      const matched = left.map((l) => entry.pairs.find((p) => p.leftId === l.id)?.rightId);
      if (left.length < 2 || matched.some((id) => id === undefined)) return question;
      const positions = matched.map((id) => right.findIndex((r) => r.id === id));
      const inLeftOrder = positions.every((p, i) => p >= 0 && (i === 0 || p > positions[i - 1]!));
      if (!inLeftOrder) return question;
      const paired = positions.map((p) => right[p]!);
      const extra = right.filter((_, i) => !positions.includes(i));
      const original = [...paired, ...extra];
      const perm = matchingPermutation(
        matchingSeed(String(question.id)),
        original.length,
        paired.length,
      );
      return { ...question, right: perm.map((i) => original[i]) };
    }
    return question;
  });
}

/**
 * Converts `ai` content (or any content-like value) to the canonical shape of the type:
 * flat questions become canonical, ids follow the pattern, enum values are matched loosely,
 * French strings are trimmed and typography fixed (not `parent_guide.en`), and with the key,
 * ordering and matching questions left in answer order are scrambled. The result is not
 * guaranteed valid: check it with `contentSchema(type, 'final')`.
 */
export function normalizeAiContent<T extends LibraryItemType>(
  type: T,
  raw: unknown,
  key?: AnswerKey | null,
): ContentOf<T> {
  const conformed = conform(contentObject(type, 'draft'), raw, {
    question: normalizeAiQuestion,
    enumValue: looseEnumValue,
    keepInvalid: true,
  });
  let content = mapFrenchStrings(type, conformed, tidy);
  if (key) content = scrambleAnswerOrder(type, content, key);
  if (type === 'report_comments') content = normalizeCommentBank(content);
  return content as ContentOf<T>;
}

/**
 * A comment bank's entries (D-131): the placeholder spelled `{prénom}` with the article before it
 * in full, and a feminine or masculine text that only repeats the neutral one left empty.
 */
function normalizeCommentBank<C>(content: C): C {
  if (!isPlainObject(content) || !Array.isArray(content.entries)) return content;
  const entries = content.entries.map((raw) => {
    if (!isPlainObject(raw)) return raw;
    const entry = { ...raw };
    for (const field of ['neutral', 'feminine', 'masculine'] as const) {
      if (typeof entry[field] === 'string') {
        entry[field] = normalizeCommentTemplate(entry[field] as string);
      }
    }
    for (const field of ['feminine', 'masculine'] as const) {
      if (entry[field] === entry.neutral) entry[field] = '';
    }
    return entry;
  });
  return { ...content, entries } as C;
}

/** Converts an `ai` answer key to the canonical shape; null when there is none. */
export function normalizeAiKey(raw: unknown): AnswerKey | null {
  if (!isPlainObject(raw)) return null;
  const conformed = conform(questionSchemas('draft').answerKey, raw, {
    entry: normalizeAiEntry,
    enumValue: looseEnumValue,
    keepInvalid: true,
  });
  return mapStrings(conformed, tidy) as AnswerKey;
}

const SUPERVISION_SYNONYMS: Record<string, string> = {
  habituelle: 'standard',
  normale: 'standard',
  etroite: 'close',
  rapprochee: 'close',
  adulte: 'adult_only',
  adulte_seulement: 'adult_only',
  adult: 'adult_only',
};

/** Safety notes from the AI (or a form) in the canonical shape; null when absent. */
export function normalizeSafetyNotes(raw: unknown): SafetyNotesDraft | null {
  if (!isPlainObject(raw)) return null;
  const conformed = conform(safetyNotesSchema('draft'), raw, {
    enumValue: (value, values) => {
      const folded = foldKey(value);
      return SUPERVISION_SYNONYMS[folded] ?? looseEnumValue(value, values);
    },
  }) as Partial<SafetyNotesDraft>;
  const notes = mapStrings(
    { ...conformed, hazards: conformed.hazards ?? [], notes: conformed.notes ?? '' },
    tidy,
  );
  return notes as SafetyNotesDraft;
}

/** Both halves of a version from the AI, consistent with each other. */
export function normalizeAiVersion<T extends LibraryItemType>(
  type: T,
  raw: { content: unknown; answerKey: unknown },
): { content: ContentOf<T>; answerKey: AnswerKey | null } {
  const answerKey = normalizeAiKey(raw.answerKey);
  let content = normalizeAiContent(type, raw.content, answerKey);
  if (answerKey) {
    // Several correct choices mean several answers are expected.
    content = mapQuestions(type, content, (question) => {
      const entry = answerKey.answers.find((a) => a.questionId === question.id);
      return entry?.kind === 'multiple_choice' &&
        question.kind === 'multiple_choice' &&
        new Set(entry.correctChoiceIds).size > 1
        ? { ...question, multipleAnswers: true }
        : question;
    });
  }
  return { content, answerKey };
}

/** The author's (or the AI's) faith flag, or faith words in any French string of any version. */
export function aiFaithContent(
  type: LibraryItemType,
  contents: readonly unknown[],
  declared: boolean,
): boolean {
  return declared || contents.some((c) => suggestsFaithContent(frenchStrings(type, c).join('\n')));
}
