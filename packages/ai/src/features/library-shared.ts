/**
 * What the two library AI features share (« Créer avec l’IA » and « Créer les versions manquantes
 * avec l’IA », DECISIONS D-072, D-073, D-080): the level input, the fictional first names, the
 * `ai`-shape schema of a version, normalizing a version, and the checks every answer gets. Pure
 * (Zod and @lynx/content only): the web server imports the features for its previews.
 *
 * Problems are paths and codes (« base.content.questions.2.prompt: required »), never content:
 * they are logged, and a problem means the answer is retried.
 */
import {
  answerKeySchema,
  contentSchema,
  frenchStrings,
  issueKey,
  mapQuestions,
  mapStrings,
  normalizeAiVersion,
  notCanadianWords,
  questionsOf,
  studentContent,
  TYPE_INFO,
  validateAnswerKey,
  type AnswerEntry,
  type AnswerKey,
  type LibraryItemType,
} from '@lynx/content';
import { z } from 'zod';
import type { Redactor } from '../privacy';
import { differentiateLevelSchema } from './differentiate';
import { mentionsLevelLabel } from './shared';

/** A language level asked for, as the database sends it (keys `L1`…, ids never in the prompt). */
export const libraryLevelSchema = differentiateLevelSchema.extend({
  /**
   * The board's most accessible level (its lowest order): the shortest sentences and a glossary.
   * False for every level when that level is not asked for.
   */
  mostAccessible: z.boolean(),
});
export type LibraryLevelInput = z.infer<typeof libraryLevelSchema>;

/**
 * First names a character may take (plan E3). Library content is reusable, so it never names a
 * student; Hugo and Maëlle, in the plan's list, are left out because they are demo students.
 * Each request sends only the names that belong to nobody its redactor knows
 * (`characterNamesFor`): a name here that is also a student's would otherwise make the last
 * check before sending refuse the request.
 */
export const CHARACTER_NAMES = [
  'Alix',
  'Bastien',
  'Capucine',
  'Désiré',
  'Éloïse',
  'Fabien',
  'Gaëlle',
  'Inès',
  'Jules',
  'Laurier',
  'Noé',
  'Océane',
  'Raphaëlle',
  'Yanis',
] as const;

/** The character names this request may use: none that a known person has. */
export function characterNamesFor(redactor: Redactor): string[] {
  return CHARACTER_NAMES.filter((name) => !redactor.mentionsKnownPerson(name));
}

// ---------------------------------------------------------------------------------------
// One version, as the AI answers it
// ---------------------------------------------------------------------------------------

/** A version of a resource: its content and answer key (`ai` shape until normalized). */
export interface LibraryAiVersion {
  content: Record<string, unknown>;
  /** Null for a version without questions or solution. */
  answerKey: Record<string, unknown> | null;
}

export interface LibraryAiLevel extends LibraryAiVersion {
  /** The level's key (`L1`…), copied from the request. */
  level: string;
}

/** The `ai`-mode schema of one version of a type: no enum, pattern or size limit (D-061). */
export function aiVersionSchema(type: LibraryItemType) {
  return z.object({
    content: contentSchema(type, 'ai'),
    answerKey: answerKeySchema('ai').nullable(),
  });
}

/** The `ai`-mode schema of one level version of a type. */
export function aiLevelSchema(type: LibraryItemType) {
  return z.object({
    level: z.string(),
    content: contentSchema(type, 'ai'),
    answerKey: answerKeySchema('ai').nullable(),
  });
}

function flatQuestion(q: Record<string, unknown>): Record<string, unknown> {
  return {
    id: q.id,
    kind: q.kind,
    prompt: q.prompt,
    hint: q.hint ?? '',
    points: q.points ?? null,
    category: q.category ?? null,
    choices: q.choices ?? null,
    multipleAnswers: q.multipleAnswers ?? null,
    left: q.left ?? null,
    right: q.right ?? null,
    items: q.items ?? null,
    lines: q.lines ?? null,
  };
}

function flatEntry(entry: AnswerEntry): Record<string, unknown> {
  const e = entry as unknown as Partial<Record<string, unknown>>;
  return {
    questionId: entry.questionId,
    kind: entry.kind,
    correctChoiceIds: e.correctChoiceIds ?? null,
    correct: e.correct ?? null,
    pairs: e.pairs ?? null,
    orderedIds: e.orderedIds ?? null,
    sampleAnswer: e.sampleAnswer ?? null,
    acceptableAnswers: e.acceptableAnswers ?? null,
    explanation: entry.explanation,
  };
}

/**
 * Canonical content and key in the `ai` shape (flat questions and answers), as a model would
 * answer them: for the fake provider, which copies a resource's base version.
 */
export function toAiVersion(
  type: LibraryItemType,
  content: unknown,
  answerKey: AnswerKey | null,
): LibraryAiVersion {
  const flat = mapQuestions(type, structuredClone(content), flatQuestion);
  return {
    content: (flat && typeof flat === 'object' ? flat : {}) as Record<string, unknown>,
    answerKey: answerKey
      ? { answers: answerKey.answers.map(flatEntry), solution: answerKey.solution }
      : null,
  };
}

/**
 * A version in the canonical shape (normalizeAiVersion: flat questions, ids, enum spelling,
 * typography, ordering left in answer order). Types that never have questions or a solution
 * keep no key.
 */
export function normalizeLibraryVersion<V extends LibraryAiVersion>(
  type: LibraryItemType,
  version: V,
): V {
  const { content, answerKey } = normalizeAiVersion(type, {
    content: version.content,
    answerKey: TYPE_INFO[type].mayHaveQuestions ? version.answerKey : null,
  });
  return {
    ...version,
    content: content as Record<string, unknown>,
    answerKey: answerKey as unknown as Record<string, unknown> | null,
  };
}

// ---------------------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------------------

const pathOf = (path: readonly PropertyKey[]) => path.map(String).join('.');

/** Every prose string of a value (machine keys such as ids and kinds left out). */
export function proseStrings(value: unknown): string[] {
  const strings: string[] = [];
  mapStrings(value, (s) => {
    strings.push(s);
    return s;
  });
  return strings;
}

/**
 * What the store needs of one version (`at`: « base », « levels.2 »): the content passes
 * `final`, the key passes `final` and matches the questions (a key is required when there are
 * questions, and for keyed types), and nothing students receive names a language level (D-042).
 */
export function versionProblems(
  type: LibraryItemType,
  at: string,
  version: LibraryAiVersion,
  levelLabels: readonly string[],
): string[] {
  const problems: string[] = [];
  const content = contentSchema(type, 'final').safeParse(version.content);
  if (!content.success) {
    for (const issue of content.error.issues) {
      problems.push(
        `${at}.content${issue.path.length ? `.${pathOf(issue.path)}` : ''}: ${issueKey(issue)}`,
      );
    }
  }
  const info = TYPE_INFO[type];
  if (info.mayHaveQuestions) {
    const questions = questionsOf(type, version.content);
    if (!version.answerKey) {
      if (questions.length || info.keyed) problems.push(`${at}.answerKey: missing`);
    } else {
      const key = answerKeySchema('final').safeParse(version.answerKey);
      if (!key.success) {
        for (const issue of key.error.issues) {
          problems.push(
            `${at}.answerKey${issue.path.length ? `.${pathOf(issue.path)}` : ''}: ${issueKey(issue)}`,
          );
        }
      } else if (content.success) {
        for (const issue of validateAnswerKey(type, content.data, key.data)) {
          const where = issue.where === 'key' ? 'answerKey' : 'content';
          problems.push(`${at}.${where}.${pathOf(issue.path)}: ${issue.code}`);
        }
      }
    }
  }
  const forStudents = studentContent(type, version.content);
  if (forStudents && proseStrings(forStudents).some((s) => mentionsLevelLabel(s, levelLabels))) {
    problems.push(`${at}: level name shown to students`);
  }
  return problems;
}

/** Each level asked for exactly once, and no other. */
export function levelSetProblems(expected: readonly string[], got: readonly string[]): string[] {
  const problems: string[] = [];
  for (const key of expected) {
    const count = got.filter((g) => g === key).length;
    if (count === 0) problems.push(`missing level ${key}`);
    if (count > 1) problems.push(`level ${key} appears ${count} times`);
  }
  for (const key of new Set(got))
    if (!expected.includes(key)) problems.push(`unexpected level ${key}`);
  return problems;
}

/**
 * Types whose level versions keep the base's questions: the same number, the same kinds, in the
 * same order (assessments and student sheets, D-073), so answers line up across versions.
 */
export const SAME_QUESTIONS_TYPES: readonly LibraryItemType[] = [
  'quiz',
  'unit_test',
  'diagnostic',
  'exit_ticket',
  'worksheet',
  'reading_passage',
];

const objectiveOf = (content: unknown) =>
  content &&
  typeof content === 'object' &&
  typeof (content as { objective?: unknown }).objective === 'string'
    ? (content as { objective: string }).objective.trim()
    : '';

/** A level version against the base: the same objective (or none), the same questions. */
export function levelParityProblems(
  type: LibraryItemType,
  base: unknown,
  level: unknown,
  at: string,
): string[] {
  const problems: string[] = [];
  const objective = objectiveOf(level);
  if (objective && objective !== objectiveOf(base))
    problems.push(`${at}.content.objective: changed`);
  if (SAME_QUESTIONS_TYPES.includes(type)) {
    const kinds = (content: unknown) =>
      questionsOf(type, content).map((q) => String(q.question.kind));
    const expected = kinds(base);
    const got = kinds(level);
    if (expected.length !== got.length) {
      problems.push(`${at}: ${got.length} questions instead of ${expected.length}`);
    } else if (expected.some((k, i) => k !== got[i])) {
      problems.push(`${at}: question kinds differ from the base version`);
    }
  }
  return problems;
}

/** « Élève A », « Adulte B »: the markers the redactor puts in place of people. */
const MARKER =
  /(?<![\p{L}\p{M}\p{N}])([ÉEée]l[èe]ve|[Aa]dulte)\s+([A-Z]{1,3})(?![\p{L}\p{M}\p{N}])/gu;
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** The person markers in some text (« Élève A »), spelled one way. */
export function markersIn(texts: readonly string[]): Set<string> {
  return new Set(
    texts.flatMap((t) =>
      [...t.matchAll(MARKER)].map(
        (m) => `${fold(m[1]!) === 'adulte' ? 'Adulte' : 'Élève'} ${m[2]}`,
      ),
    ),
  );
}

/** France's grade names: never used in Ontario schools. */
const FRENCH_GRADES = /(?<![\p{L}\p{N}])(?:CP|CE ?[12]|CM ?[12])(?![\p{L}\p{N}])/u;
/** Dotted Ontario curriculum codes (« B1.2 »). */
const CURRICULUM_CODE = /(?<![\p{L}\p{N}])[A-E]\d{1,2}\.\d{1,2}(?!\p{N})/gu;
/** Publishers and sites whose material the resource must not copy (or cite as its source). */
const THIRD_PARTY =
  /(?<![\p{L}\p{N}])(?:id[ée]llo|teachers pay teachers|tpt|cheneli[èe]re|erpi|scholastic)(?![\p{L}\p{N}])/iu;
/** Quotations: text between « ». */
const QUOTATION = /«([^»]*)»/g;
const MAX_QUOTATION_WORDS = 40;

/** The dotted curriculum codes in some text. */
export function curriculumCodesIn(texts: readonly string[]): Set<string> {
  return new Set(texts.flatMap((t) => [...t.matchAll(CURRICULUM_CODE)].map((m) => m[0])));
}

/**
 * Checks on the words of an answer (D-080). `french`: every French prose string (not the English
 * half of a family guide); `all`: every prose string. Only markers in `allowedMarkers` (those the
 * request itself had) and codes in `allowedCodes` may appear.
 */
export function wordingProblems(
  at: string,
  texts: { french: readonly string[]; all: readonly string[] },
  allowed: { markers: ReadonlySet<string>; codes: ReadonlySet<string> },
): string[] {
  const problems: string[] = [];
  const european = [...new Set(texts.french.flatMap(notCanadianWords))];
  if (european.length) problems.push(`${at}: not Canadian French (${european.join(', ')})`);
  if (texts.french.some((t) => FRENCH_GRADES.test(t))) problems.push(`${at}: France grade name`);
  const codes = [...curriculumCodesIn(texts.all)].filter((c) => !allowed.codes.has(c));
  if (codes.length) problems.push(`${at}: curriculum code not given (${codes.join(', ')})`);
  if ([...markersIn(texts.all)].some((m) => !allowed.markers.has(m))) {
    problems.push(`${at}: a person marker`);
  }
  if (texts.all.some((t) => THIRD_PARTY.test(t))) problems.push(`${at}: a third-party source`);
  const long = texts.all.some((t) =>
    [...t.matchAll(QUOTATION)].some(
      (m) => (m[1]!.match(/[\p{L}\p{N}’'-]+/gu)?.length ?? 0) > MAX_QUOTATION_WORDS,
    ),
  );
  if (long) problems.push(`${at}: a quotation over ${MAX_QUOTATION_WORDS} words`);
  return problems;
}

/** The French and all prose strings of a version, for `wordingProblems`. */
export function versionTexts(type: LibraryItemType, version: LibraryAiVersion) {
  return {
    french: [...frenchStrings(type, version.content), ...proseStrings(version.answerKey)],
    all: [...proseStrings(version.content), ...proseStrings(version.answerKey)],
  };
}

/** Level labels as a request gives them, for the student checks. */
export const levelLabelsOf = (levels: readonly { label: string }[]) =>
  levels.map((l) => l.label).filter((l) => l.trim());
