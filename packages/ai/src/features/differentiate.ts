/**
 * Texte différencié: one version of a text, instructions or activity for each French
 * language level, all with the same learning objective (SPEC 9.2).
 */
import { z } from 'zod';
import type { BlockedFinding, Redactor } from '../privacy';
import type { FeatureDefinition } from '../types';

export const DIFFERENTIATE = 'differentiate';

export const differentiateItemTypes = ['reading_passage', 'worksheet'] as const;
export type DifferentiateItemType = (typeof differentiateItemTypes)[number];

export const differentiateLevelSchema = z.object({
  /** Stable key used in the prompt ("L1".."L6"); level ids never go to the model. */
  key: z.string().regex(/^L[1-6]$/),
  languageLevelId: z.uuid(),
  label: z.string().trim().min(1).max(60),
  description: z.string().trim().max(1000).nullable(),
});

/**
 * The most text × levels the app sends in one request (characters of text times the number of
 * levels): 5,000 characters for 6 levels, 12,000 for 2. The answer grows with both, and this
 * keeps the largest requests well inside the worker's time limit for a job (13 minutes).
 * Checked by the web form, with its own message; the input schema below stays wider so a
 * request already stored remains readable.
 */
export const MAX_TEXT_TIMES_LEVELS = 30_000;

export const differentiateInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  text: z.string().trim().min(20).max(12_000),
  objective: z.string().trim().max(500),
  itemType: z.enum(differentiateItemTypes),
  gradeCode: z.string().regex(/^[A-Z0-9]{1,4}$/),
  gradeLabel: z.string().trim().min(1).max(60),
  subjectId: z.uuid().nullable(),
  subjectLabel: z.string().trim().max(80).nullable(),
  levels: z
    .array(differentiateLevelSchema)
    .min(2)
    .max(6)
    .refine((levels) => new Set(levels.map((l) => l.key)).size === levels.length, 'duplicate'),
});
export type DifferentiateInput = z.infer<typeof differentiateInputSchema>;

// The model's answer. Kept free of length limits (structured outputs support few
// constraints); `validate` checks sizes instead.
export const differentiateVersionSchema = z.object({
  level: z.string(),
  title: z.string(),
  text: z.string(),
  glossary: z.array(z.object({ term: z.string(), definition: z.string() })),
  visualSupports: z.array(z.string()),
  questions: z.array(z.string()),
  teacherNote: z.string(),
});
export const differentiateOutputSchema = z.object({
  objective: z.string(),
  versions: z.array(differentiateVersionSchema),
});
export type DifferentiateVersion = z.infer<typeof differentiateVersionSchema>;
export type DifferentiateOutput = z.infer<typeof differentiateOutputSchema>;

const ITEM_TYPE_LABELS: Record<DifferentiateItemType, string> = {
  reading_passage: 'un texte à lire',
  worksheet: 'des consignes ou une activité',
};

function tagged(tag: string, content: string): string {
  // The teacher's text cannot close our tags.
  const safe = content.replaceAll(`</${tag}>`, `< /${tag}>`);
  return `<${tag}>\n${safe}\n</${tag}>`;
}

export const differentiateFeature: FeatureDefinition<DifferentiateInput, DifferentiateOutput> = {
  name: DIFFERENTIATE,
  promptVersion: 'v1',
  inputSchema: differentiateInputSchema,
  outputSchema: differentiateOutputSchema,
  // Room for adaptive thinking plus the whole answer at the largest input allowed: 12,000
  // characters (about 4k tokens of French) rewritten for 6 levels, each with its glossary,
  // questions and notes, is about 30k tokens before any thinking. Opus 5.5 always thinks and
  // thinking counts toward this limit. Needs a streamed call (see providers.ts).
  maxTokens: 64_000,

  redactInput(input: DifferentiateInput, redactor: Redactor) {
    const blocked: BlockedFinding[] = [];
    const clean = (value: string) => {
      const r = redactor.redact(value);
      blocked.push(...r.blocked);
      return r.text;
    };
    return {
      input: {
        ...input,
        title: clean(input.title),
        text: clean(input.text),
        objective: clean(input.objective),
        levels: input.levels.map((l) => ({
          ...l,
          label: clean(l.label),
          description: l.description === null ? null : clean(l.description),
        })),
      },
      blocked,
    };
  },

  buildUserMessage(input: DifferentiateInput): string {
    const levels = input.levels
      .map((l) => `- ${l.key} — ${l.label}${l.description ? ` : ${l.description}` : ''}`)
      .join('\n');
    return [
      `Année d'études : ${input.gradeLabel}`,
      `Matière : ${input.subjectLabel ?? 'non précisée'}`,
      `Type de contenu : ${ITEM_TYPE_LABELS[input.itemType]}`,
      `Objectif d'apprentissage fourni par l'enseignant·e : ${input.objective || 'aucun (dégage-le du texte)'}`,
      '',
      'Niveaux demandés, dans cet ordre :',
      levels,
      '',
      tagged('titre', input.title),
      '',
      tagged('texte_original', input.text),
    ].join('\n');
  },

  validate(output: DifferentiateOutput, input: DifferentiateInput): string[] {
    const problems: string[] = [];
    const expected = input.levels.map((l) => l.key);
    const got = output.versions.map((v) => v.level.trim());
    for (const key of expected) {
      const count = got.filter((g) => g === key).length;
      if (count === 0) problems.push(`missing level ${key}`);
      if (count > 1) problems.push(`level ${key} appears ${count} times`);
    }
    for (const key of got) if (!expected.includes(key)) problems.push(`unexpected level ${key}`);
    if (!output.objective.trim()) problems.push('empty objective');
    // Student copies must not label anyone "Débutant": no level name in a title.
    for (const v of output.versions) {
      const title = v.title.toLowerCase();
      const labelled = input.levels.some((l) =>
        new RegExp(
          `(^|[^\\p{L}])${l.label.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`,
          'u',
        ).test(title),
      );
      if (labelled) problems.push(`level name shown to students in ${v.level}`);
    }
    const maxLength = Math.max(input.text.length * 4, 8000);
    for (const v of output.versions) {
      if (!v.text.trim()) problems.push(`empty text for ${v.level}`);
      if (v.text.length > maxLength) problems.push(`text too long for ${v.level}`);
      if (v.glossary.length > 20) problems.push(`glossary too long for ${v.level}`);
      if (v.questions.length > 10) problems.push(`too many questions for ${v.level}`);
      if (v.visualSupports.length > 8) problems.push(`too many visual supports for ${v.level}`);
    }
    return problems;
  },

  fake(input: DifferentiateInput): DifferentiateOutput {
    const sentences = input.text.split(/(?<=[.!?])\s+/).filter(Boolean);
    const words = [...new Set(input.text.match(/\p{L}{7,}/gu) ?? [])].slice(0, 3);
    return {
      objective: input.objective || `Comprendre les idées principales de « ${input.title} ».`,
      versions: input.levels.map((level, i) => {
        const share = (i + 1) / input.levels.length;
        const kept = sentences.slice(0, Math.max(1, Math.ceil(sentences.length * share)));
        const last = i === input.levels.length - 1;
        return {
          level: level.key,
          title: input.title,
          text: kept.join(' ') + (last ? '\n\nPour aller plus loin : explique ton idée.' : ''),
          glossary:
            i === 0
              ? words.map((term) => ({ term, definition: `Définition simple de « ${term} ».` }))
              : [],
          visualSupports: i === 0 ? ['Une image pour chaque idée importante.'] : [],
          questions: [
            'De quoi parle le texte ?',
            ...(last ? ['Qu’en penses-tu ? Pourquoi ?'] : []),
          ],
          teacherNote: `Version ${level.label} préparée sans IA (mode démonstration).`,
        };
      }),
    };
  },
};
