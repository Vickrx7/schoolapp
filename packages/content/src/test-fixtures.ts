/**
 * Helpers for this package's tests (not exported from the package).
 */
import { LIBRARY_ITEM_TYPES, TYPE_INFO, type LibraryItemType } from './catalog';
import { EDITOR_SPEC, type FieldSpec } from './editor-spec';
import { sampleCanonical } from './samples';

export const TEACHER_SENTINEL = 'SENTINELLE-ENSEIGNANT';
export const KEY_SENTINEL = 'SENTINELLE-CORRIGE';

export const STUDENT_TYPES = LIBRARY_ITEM_TYPES.filter((t) => TYPE_INFO[t].audience !== 'teacher');
export const QUESTION_TYPES = LIBRARY_ITEM_TYPES.filter((t) => TYPE_INFO[t].mayHaveQuestions);

function sentinelValue(spec: FieldSpec): unknown {
  switch (spec.kind) {
    case 'text':
    case 'textarea':
      return TEACHER_SENTINEL;
    case 'stringList':
      return [TEACHER_SENTINEL];
    case 'objectList':
      return [Object.fromEntries((spec.fields ?? []).map((f) => [f.path, sentinelValue(f)]))];
    default:
      throw new Error(`no sentinel for ${spec.kind}`);
  }
}

/** A valid sample with a sentinel in every teacher-only field. */
export function withTeacherSentinels(type: LibraryItemType): Record<string, unknown> {
  const content = { ...(sampleCanonical(type).content as Record<string, unknown>) };
  for (const spec of EDITOR_SPEC[type]) {
    if (spec.audience === 'teacher' && TYPE_INFO[type].audience !== 'teacher') {
      content[spec.path] = sentinelValue(spec);
    }
  }
  content.teacherNote = TEACHER_SENTINEL;
  return content;
}

/** Every key of a JSON value, at any depth. */
export function allKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, keys));
  else if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      keys.add(k);
      allKeys(v, keys);
    }
  }
  return keys;
}
