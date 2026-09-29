/**
 * Reading stored content for display. Rendering must cope with content that fails the
 * schemas (an API write that skipped the app, an older shape): the parse is lenient, keeps what
 * has the right shape and says whether the content is `valid` (passes `final`). Pages show what
 * they can plus « Une partie de cette ressource ne peut pas être affichée. »
 */
import type { LibraryItemType } from './catalog';
import { conform, isPlainObject } from './conform';
import { isQuestionKind, questionSchemas, type AnswerKey } from './questions';
import { answerKeySchema, contentObject, contentSchema, type ContentOf } from './schemas';

export type ParsedContent<T extends LibraryItemType> =
  { ok: true; content: ContentOf<T>; valid: boolean } | { ok: false };

const COMMON_KEYS = new Set(['title', 'objective', 'teacherNote']);

export function parseVersionContent<T extends LibraryItemType>(
  type: T,
  raw: unknown,
): ParsedContent<T> {
  if (!isPlainObject(raw)) return { ok: false };
  const draft = contentSchema(type, 'draft').safeParse(raw);
  if (draft.success) {
    return {
      ok: true,
      content: draft.data,
      valid: contentSchema(type, 'final').safeParse(draft.data).success,
    };
  }
  const shape = contentObject(type, 'draft');
  // Content of another type (or of nothing) is not this type's content.
  const own = Object.keys(shape.shape).filter((key) => !COMMON_KEYS.has(key));
  if (!own.some((key) => key in raw)) return { ok: false };
  return { ok: true, content: conform(shape, raw) as ContentOf<T>, valid: false };
}

export type ParsedAnswerKey = { ok: true; key: AnswerKey; valid: boolean } | { ok: false };

export function parseAnswerKey(raw: unknown): ParsedAnswerKey {
  if (!isPlainObject(raw)) return { ok: false };
  const draft = answerKeySchema('draft').safeParse(raw);
  if (draft.success) {
    return {
      ok: true,
      key: draft.data,
      valid: answerKeySchema('final').safeParse(draft.data).success,
    };
  }
  const key = conform(questionSchemas('draft').answerKey, raw) as AnswerKey;
  // Entries of an unknown kind can't be shown or graded.
  return {
    ok: true,
    key: { ...key, answers: key.answers.filter((a) => isQuestionKind(a.kind)) },
    valid: false,
  };
}
