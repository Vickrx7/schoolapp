/**
 * Évaluer: quizzes, end-of-unit tests, diagnostics and rubrics.
 */
import { ACHIEVEMENT_CATEGORIES } from '../questions';
import { common, type SchemaContext } from './shared';

export function quiz({ k, q }: SchemaContext) {
  return k.obj({
    ...common(k),
    instructions: k.optText(1000),
    questions: k.list(q.question, 1, 30),
  });
}

/** Question categories are shown on the teacher copy only. */
export function unitTest({ k, q }: SchemaContext) {
  return k.obj({
    ...common(k),
    instructions: k.optText(1000),
    sections: k.list(k.obj({ title: k.text(160), questions: k.list(q.question, 1, 30) }), 1, 8),
  });
}

export function diagnostic({ k, q }: SchemaContext) {
  return k.obj({
    ...common(k),
    /** Teacher-only. */
    purpose: k.text(1000),
    questions: k.list(q.question, 1, 20),
    /** Teacher-only: what an answer tells you, and what to do next. */
    interpretation: k.list(k.obj({ signal: k.text(500), nextStep: k.text(500) }), 0, 8),
  });
}

/** Follows the Ontario achievement chart: four categories, levels 1 to 4 (SPEC 9.3). */
export function rubric({ k }: SchemaContext) {
  const schema = k.obj({
    ...common(k),
    task: k.text(1000),
    criteria: k.list(
      k.obj({
        category: k.enumOf(ACHIEVEMENT_CATEGORIES),
        criterion: k.text(300),
        levels: k.obj({
          level1: k.text(500),
          level2: k.text(500),
          level3: k.text(500),
          level4: k.text(500),
        }),
      }),
      4,
      16,
    ),
  });
  if (k.mode !== 'final') return schema;
  return schema.superRefine((value, ctx) => {
    const present = new Set(value.criteria.map((c) => c.category));
    if (ACHIEVEMENT_CATEGORIES.some((c) => !present.has(c))) {
      ctx.addIssue({ code: 'custom', path: ['criteria'], message: 'missingCategory' });
    }
  });
}
