/**
 * From the editor's form to what `save_library_item` stores (DECISIONS D-061 to D-063, D-067).
 * Each version goes through `fromAuthoring` (content in display order, answers in the key), then
 * the whole payload is checked in `draft` mode (`libraryItemFormSchema`) and each key against its
 * questions (`validateAnswerKey`). Problems come back as field errors keyed by where the editor
 * shows them (`title`, `versions.0.content.questions.2.prompt`, `versions.1.solution`…), with an
 * error key as value (`libraryEdit.errors.<key>`).
 *
 * Pure: no server-only import, so it is unit-tested; the save action runs it on the server, where
 * the form cannot be trusted.
 */
import {
  CONTENT_ERROR_KEYS,
  FORM_ERROR_KEYS,
  TYPE_INFO,
  answerKeySchema,
  contentSchema,
  fromAuthoring,
  libraryItemFormSchema,
  mapQuestions,
  questionsOf,
  reviewReadiness,
  validateAnswerKey,
  type AnswerKey,
  type ContentPath,
  type KeyIssue,
  type LibraryItemForm,
  type LibraryItemType,
  type SafetyNotesDraft,
} from '@lynx/content';
import { z } from 'zod';
import type { LibraryEditorForm } from './editor-form';

export type FieldErrors = Record<string, string>;

export type SavePayloadResult =
  { ok: true; payload: LibraryItemForm } | { ok: false; fieldErrors: FieldErrors };

// ---------------------------------------------------------------------------------------
// The editor's questions, checked before conversion (the form comes from the browser)
// ---------------------------------------------------------------------------------------

const id = z.string().max(40);
const text = (max: number) => z.string().max(max);
const option = z.object({ id, text: text(3000) });
const questionBase = {
  id,
  prompt: text(10_000),
  hint: text(3000),
  points: z.number().nullable(),
  category: z.string().nullable(),
  explanation: text(5000),
};

/** The shape `fromAuthoring` needs; exact sizes and values are the content schemas' job. */
const authoringQuestionSchema = z.discriminatedUnion('kind', [
  z.object({
    ...questionBase,
    kind: z.literal('multiple_choice'),
    choices: z.array(option.extend({ correct: z.boolean() })).max(30),
    multipleAnswers: z.boolean(),
  }),
  z.object({ ...questionBase, kind: z.literal('true_false'), correct: z.boolean() }),
  z.object({
    ...questionBase,
    kind: z.literal('matching'),
    pairs: z
      .array(z.object({ leftId: id, left: text(3000), rightId: id, right: text(3000) }))
      .max(30),
    extraRight: z.array(option).max(30),
  }),
  z.object({ ...questionBase, kind: z.literal('ordering'), items: z.array(option).max(30) }),
  z.object({
    ...questionBase,
    kind: z.literal('short_answer'),
    lines: z.number(),
    sampleAnswer: text(10_000),
    acceptableAnswers: z.array(text(1000)).max(30),
  }),
]);

const joinPath = (path: readonly PropertyKey[]) => path.map(String).join('.');

/** An error key from a Zod message: the message when it is a key, else `invalid`. */
function errorKeyOf(message: string): string {
  return /^[a-zA-Z]+$/.test(message) ? message : 'invalid';
}

// ---------------------------------------------------------------------------------------
// Where the editor shows an error
// ---------------------------------------------------------------------------------------

/** The questions of a content (canonical and editor model share their paths), by id. */
function questionPaths(type: LibraryItemType, content: unknown) {
  return questionsOf(type, content).map(({ path, question }) => ({ path, question }));
}

const startsWith = (path: ContentPath, prefix: ContentPath) =>
  prefix.length <= path.length && prefix.every((p, i) => p === path[i]);

/**
 * A content path (canonical content) as a path of the editor's model. Outside questions they
 * are the same. Inside one, choices and left-hand items keep their places (a left-hand item is a
 * row of pairs); right-hand columns and ordering items are scrambled in the content, so errors
 * there point at the list.
 */
export function editorContentPath(
  type: LibraryItemType,
  content: unknown,
  path: ContentPath,
): ContentPath {
  const located = questionPaths(type, content).find((q) => startsWith(path, q.path));
  if (!located) return path;
  const rest = path.slice(located.path.length);
  const [field, index, sub] = rest;
  switch (field) {
    case undefined:
    case 'id':
    case 'kind':
      return located.path;
    case 'prompt':
    case 'hint':
    case 'points':
    case 'category':
    case 'lines':
    case 'multipleAnswers':
      return [...located.path, field];
    case 'choices':
      return index === undefined
        ? [...located.path, 'choices']
        : [...located.path, 'choices', index, ...(sub === 'text' ? ['text'] : [])];
    case 'left':
      return index === undefined
        ? [...located.path, 'pairs']
        : [...located.path, 'pairs', index, 'left'];
    case 'right':
      return [...located.path, 'pairs'];
    case 'items':
      return [...located.path, 'items'];
    default:
      return located.path;
  }
}

/**
 * A path in an answer key (`answers.3.acceptableAnswers.0`, `solution`) as a path of the editor's
 * model, relative to the version: `solution`, or the question's field
 * (`content.questions.3.acceptableAnswers.0`).
 */
export function editorKeyPath(
  type: LibraryItemType,
  content: unknown,
  key: AnswerKey | null,
  path: ContentPath,
): string[] {
  if (path[0] === 'solution') return ['solution'];
  if (path[0] !== 'answers' || typeof path[1] !== 'number') return ['content'];
  const questionId = key?.answers[path[1]]?.questionId;
  const located = questionPaths(type, content).find((q) => q.question.id === questionId);
  if (!located) return ['content'];
  const base = ['content', ...located.path.map(String)];
  const [, , field, index] = path;
  switch (field) {
    case 'correctChoiceIds':
      return [...base, 'choices'];
    case 'pairs':
      return [...base, 'pairs'];
    case 'orderedIds':
      return [...base, 'items'];
    case 'correct':
    case 'sampleAnswer':
    case 'explanation':
      return [...base, field];
    case 'acceptableAnswers':
      return index === undefined
        ? [...base, 'acceptableAnswers']
        : [...base, 'acceptableAnswers', String(index)];
    default:
      return base;
  }
}

/** A `validateAnswerKey` problem as a path of the editor's model, relative to the version. */
function keyIssuePath(
  type: LibraryItemType,
  content: unknown,
  key: AnswerKey | null,
  issue: KeyIssue,
): string[] {
  if (issue.where === 'content') {
    return ['content', ...editorContentPath(type, content, issue.path).map(String)];
  }
  if (issue.code === 'missingAnswer' && issue.questionId) {
    const located = questionPaths(type, content).find((q) => q.question.id === issue.questionId);
    if (located) return ['content', ...located.path.map(String)];
  }
  return editorKeyPath(type, content, key, issue.path);
}

/**
 * Key problems that only say the author has not finished: a draft may keep them (D-035), and
 * « J'ai révisé cette ressource » refuses them (`reviewReadiness`).
 */
const UNFINISHED_KEY_ISSUES: ReadonlySet<KeyIssue['code']> = new Set(['noCorrectChoice']);

// ---------------------------------------------------------------------------------------
// The payload
// ---------------------------------------------------------------------------------------

/** Safety notes with nothing in them are no safety notes (null in the database). */
function safetyNotesOf(
  type: LibraryItemType,
  notes: SafetyNotesDraft | null,
): SafetyNotesDraft | null {
  if (!TYPE_INFO[type].needsSafety || !notes) return null;
  const blank =
    !notes.ageSuitability.trim() &&
    !notes.allergyAwareMaterials.trim() &&
    !notes.supervision &&
    !notes.notes.trim() &&
    notes.hazards.every((h) => !h.trim());
  if (blank) return null;
  return { ...notes, hazards: notes.hazards.map((h) => h.trim()).filter(Boolean) };
}

/**
 * The payload of `save_library_item` from the editor's form, or the field errors that stop it.
 * A draft may be incomplete (D-035): only what the `draft` schemas refuse, and key problems that
 * are not just unfinished, stop a save.
 */
export function buildSavePayload(form: LibraryEditorForm): SavePayloadResult {
  const type = form.type;
  const fieldErrors: FieldErrors = {};
  const add = (key: string, error: string) => {
    fieldErrors[key] ??= error;
  };

  form.versions.forEach((version, i) => {
    mapQuestions(type, version.content, (question, path) => {
      if (!authoringQuestionSchema.safeParse(question).success) {
        add(`versions.${i}.content.${joinPath(path)}`, 'invalid');
      }
      return question;
    });
  });
  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };

  const converted = form.versions.map((version) =>
    fromAuthoring(type, { type, content: version.content, solution: version.solution }),
  );
  const candidate = {
    type,
    boardId: form.boardId,
    schoolId: form.schoolId,
    title: form.title,
    summary: form.summary,
    licence: form.licence,
    subjectId: form.subjectId,
    gradeCodes: form.gradeCodes,
    expectationIds: form.expectationIds,
    tagIds: form.tagIds,
    keywords: form.keywords,
    durationMinutes: form.durationMinutes,
    materials: form.materials,
    isPrintable: form.isPrintable,
    isProjectable: form.isProjectable,
    isInteractive: form.isInteractive,
    subFriendly: form.subFriendly,
    safetyNotes: safetyNotesOf(type, form.safetyNotes),
    faithContent: form.faithContent,
    faithOnStudentSheet: form.faithOnStudentSheet,
    catholicConnection: form.catholicConnection,
    catholicReferenceId: form.catholicReferenceId,
    versions: form.versions.map((version, i) => ({
      languageLevelId: version.languageLevelId,
      content: converted[i]!.content as Record<string, unknown>,
      answerKey: converted[i]!.key as Record<string, unknown> | null,
    })),
  };

  const parsed = libraryItemFormSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      add(formIssuePath(type, candidate.versions, issue.path), errorKeyOf(issue.message));
    }
  }
  converted.forEach(({ content, key }, i) => {
    for (const issue of validateAnswerKey(type, content, key)) {
      if (UNFINISHED_KEY_ISSUES.has(issue.code)) continue;
      add(`versions.${i}.${keyIssuePath(type, content, key, issue).join('.')}`, issue.code);
    }
  });

  if (!parsed.success || Object.keys(fieldErrors).length) return { ok: false, fieldErrors };
  return { ok: true, payload: parsed.data };
}

/** A path of `libraryItemFormSchema` (the payload) as a field of the editor. */
function formIssuePath(
  type: LibraryItemType,
  versions: readonly { content: unknown; answerKey: unknown }[],
  path: readonly PropertyKey[],
): string {
  const [root, index, part, ...rest] = path;
  if (root !== 'versions' || typeof index !== 'number') return joinPath(path) || 'form';
  const version = versions[index];
  if (!version || part === undefined || part === 'languageLevelId') return joinPath(path);
  const restPath = rest.filter((p): p is string | number => typeof p !== 'symbol');
  if (part === 'content') {
    return `versions.${index}.content${
      restPath.length ? `.${joinPath(editorContentPath(type, version.content, restPath))}` : ''
    }`;
  }
  if (part === 'answerKey') {
    const keyPath = editorKeyPath(type, version.content, version.answerKey as AnswerKey, restPath);
    return `versions.${index}.${keyPath.join('.')}`;
  }
  return joinPath(path);
}

// ---------------------------------------------------------------------------------------
// Readiness (D-067)
// ---------------------------------------------------------------------------------------

/** What a reviewed item's readiness says, as field errors of the editor and the checklist. */
export function readinessErrors(
  payload: LibraryItemForm,
  boardLevelIds: readonly string[],
): FieldErrors {
  const type = payload.type;
  const fieldErrors: FieldErrors = {};
  const add = (key: string, error: string) => {
    fieldErrors[key] ??= error;
  };
  const readiness = reviewReadiness({
    item: {
      type,
      gradeCodes: payload.gradeCodes,
      subjectId: payload.subjectId,
      durationMinutes: payload.durationMinutes,
      materials: payload.materials,
      keywords: payload.keywords,
      tagIds: payload.tagIds,
      expectationIds: payload.expectationIds,
      safetyNotes: payload.safetyNotes,
      subFriendly: payload.subFriendly,
    },
    versions: payload.versions,
    boardLevelIds,
    forApproval: false,
  });
  for (const issue of readiness.blocking) add(`readiness.${issue.code}`, `readiness.${issue.code}`);
  // Every field that fails `final`, not only the first one the checklist names.
  payload.versions.forEach((version, i) => {
    const content = contentSchema(type, 'final').safeParse(version.content);
    if (!content.success) {
      for (const issue of content.error.issues) {
        const path = ['versions', i, 'content', ...issue.path];
        add(formIssuePath(type, payload.versions, path), errorKeyOf(issue.message));
      }
    }
    if (version.answerKey) {
      const key = version.answerKey as unknown as AnswerKey;
      // The key check first: « noCorrectChoice » says more than the schema's « tooFew ».
      for (const issue of validateAnswerKey(type, version.content, key)) {
        add(
          `versions.${i}.${keyIssuePath(type, version.content, key, issue).join('.')}`,
          issue.code,
        );
      }
      const final = answerKeySchema('final').safeParse(key);
      if (!final.success) {
        for (const issue of final.error.issues) {
          const path = ['versions', i, 'answerKey', ...issue.path];
          add(formIssuePath(type, payload.versions, path), errorKeyOf(issue.message));
        }
      }
    }
  });
  return fieldErrors;
}

/** The error keys a save can give (tested against the messages). */
export const SAVE_ERROR_KEYS = [...CONTENT_ERROR_KEYS, ...FORM_ERROR_KEYS] as const;
