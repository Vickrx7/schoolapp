import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LIBRARY_ITEM_TYPES, TYPE_INFO } from './catalog';
import { EDITOR_SPEC, solutionLabelKey, type FieldSpec } from './editor-spec';
import { studentContent } from './project';
import { questionsOf } from './questions-of';
import { contentObject } from './schemas';
import { allKeys, TEACHER_SENTINEL, withTeacherSentinels } from './test-fixtures';

/** Compares a spec list with an object schema's keys, recursively; returns the differences. */
function mismatches(specs: readonly FieldSpec[], schema: z.ZodObject, at: string): string[] {
  const shape = schema.shape as Record<string, z.ZodType>;
  const specKeys = specs.map((s) => s.path);
  const problems = [
    ...Object.keys(shape)
      .filter((k) => !specKeys.includes(k))
      .map((k) => `${at}${k}: no editor entry`),
    ...specKeys.filter((k) => !(k in shape)).map((k) => `${at}${k}: not in the schema`),
  ];
  for (const spec of specs) {
    let inner: unknown = shape[spec.path];
    while (inner instanceof z.ZodNullable || inner instanceof z.ZodArray) {
      inner = inner instanceof z.ZodNullable ? inner.unwrap() : inner.element;
    }
    if (spec.kind === 'object' || spec.kind === 'objectList' || spec.kind === 'rubric') {
      if (!(inner instanceof z.ZodObject) || !spec.fields) {
        problems.push(`${at}${spec.path}: ${spec.kind} without an object schema or fields`);
      } else {
        problems.push(...mismatches(spec.fields, inner, `${at}${spec.path}.`));
      }
    } else if (inner instanceof z.ZodObject && spec.kind !== 'questions') {
      // Questions (a union, or the short-answer object of riddles) have their own editor.
      problems.push(`${at}${spec.path}: object schema shown as ${spec.kind}`);
    }
  }
  return problems;
}

describe('project and editor-spec', () => {
  it('30. studentContent removes every teacher-only field, and is null for teacher types', () => {
    for (const type of LIBRARY_ITEM_TYPES) {
      const content = withTeacherSentinels(type);
      const student = studentContent(type, content);
      if (TYPE_INFO[type].audience === 'teacher') {
        expect(student, type).toBeNull();
        continue;
      }
      expect(JSON.stringify(student), type).not.toContain(TEACHER_SENTINEL);
      // Question categories are for the teacher copy (a rubric's categories are not questions).
      expect(allKeys(questionsOf(type, student)).has('category'), type).toBe(false);
      expect(allKeys(student).has('teacherNote'), type).toBe(false);
    }
    expect(studentContent('lesson_plan', {})).toBeNull();
    expect(studentContent('teacher_guide', {})).toBeNull();
    // Unknown keys never reach students (allowlist).
    expect(studentContent('quiz', { instructions: 'x', questions: [], secret: 'y' })).toEqual({
      instructions: 'x',
      questions: [],
    });
  });

  it('31. every schema key has an editor entry, and every entry a schema key', () => {
    for (const type of LIBRARY_ITEM_TYPES) {
      expect(mismatches(EDITOR_SPEC[type], contentObject(type, 'draft'), ''), type).toEqual([]);
    }
  });

  it('marks teacher types and label keys consistently', () => {
    const walk = (specs: readonly FieldSpec[], visit: (s: FieldSpec) => void) =>
      specs.forEach((s) => {
        visit(s);
        if (s.fields) walk(s.fields, visit);
      });
    for (const type of LIBRARY_ITEM_TYPES) {
      walk(EDITOR_SPEC[type], (spec) => {
        expect(spec.labelKey).toMatch(/^content(\.[a-zA-Z0-9]+)+$/);
        expect(spec.labelKey.endsWith(`.${spec.path}`)).toBe(true);
        if (TYPE_INFO[type].audience === 'teacher') expect(spec.audience).toBe('teacher');
        if (spec.kind === 'select') expect(spec.options?.length).toBeGreaterThan(0);
      });
    }
    const title = EDITOR_SPEC.quiz.find((s) => s.path === 'title')!;
    expect(title.maxLength).toBe(200);
    expect(EDITOR_SPEC.riddle.find((s) => s.path === 'riddles')!.shortAnswerOnly).toBe(true);
    expect(EDITOR_SPEC.parent_guide.find((s) => s.path === 'en')!.lang).toBe('en-CA');
    expect(solutionLabelKey('experiment')).toBe('content.solution.experiment');
    expect(solutionLabelKey('song')).toBeNull();
  });
});
