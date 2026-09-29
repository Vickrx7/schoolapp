/**
 * What students may see of a content (SPEC 9.3, DECISIONS P-2). Driven by `EDITOR_SPEC`: only
 * fields listed there for students are copied (an allowlist, so an unknown key never reaches a
 * student), teacher-only fields are left out, and question categories (teacher copy only) are
 * removed. Answer keys are never an argument.
 */
import { TYPE_INFO, type LibraryItemType } from './catalog';
import { isPlainObject } from './conform';
import { EDITOR_SPEC, type FieldSpec } from './editor-spec';

export type StudentContent = Record<string, unknown>;

function stripQuestion(question: unknown): unknown {
  if (!isPlainObject(question)) return question;
  const { category: _category, ...rest } = question;
  return rest;
}

function strip(specs: readonly FieldSpec[], value: Record<string, unknown>): StudentContent {
  const result: StudentContent = {};
  for (const spec of specs) {
    if (spec.audience === 'teacher' || !(spec.path in value)) continue;
    const inner = value[spec.path];
    if (spec.kind === 'questions') {
      result[spec.path] = Array.isArray(inner) ? inner.map(stripQuestion) : [];
    } else if (spec.kind === 'objectList' && spec.fields) {
      const fields = spec.fields;
      result[spec.path] = Array.isArray(inner)
        ? inner.map((item) => (isPlainObject(item) ? strip(fields, item) : item))
        : [];
    } else if (spec.kind === 'object' && spec.fields) {
      result[spec.path] = isPlainObject(inner) ? strip(spec.fields, inner) : null;
    } else {
      result[spec.path] = inner;
    }
  }
  return result;
}

/**
 * The content without teacher-only fields; null for teacher-only types (`lesson_plan`,
 * `teacher_guide`), which have no student sheet.
 */
export function studentContent(type: LibraryItemType, content: unknown): StudentContent | null {
  if (TYPE_INFO[type].audience === 'teacher') return null;
  return strip(EDITOR_SPEC[type], isPlainObject(content) ? content : {});
}
