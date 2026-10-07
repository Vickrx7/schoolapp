/**
 * « Créer les versions manquantes avec l’IA » (SPEC 9.2, DECISIONS D-073, D-080): from a library
 * resource's base version, the versions for 1 to 6 language levels it does not have yet, with
 * the same learning objective and, for assessments and student sheets, the same questions of the
 * same kinds in the same order. The database adds them to the resource only if it has not
 * changed since the request (`libraryChanged` otherwise).
 *
 * The input is built by the database (`app.library_levels_ai_input`) from the resource the
 * teacher may edit: its type, grades, subject, the levels asked for and its base version with
 * its key. Every string of the base version is de-identified, like everything else sent (D-038):
 * a name the author wrote comes back as she wrote it, and the answer may use no other marker.
 */
import {
  answerKeySchema,
  BUCKET_LABELS_FR,
  contentSchema,
  LIBRARY_ITEM_TYPES,
  MACHINE_KEYS,
  TYPE_INFO,
  type LibraryItemType,
} from '@lynx/content';
import { z } from 'zod';
import { redactStrings, type BlockedFinding, type Redactor } from '../privacy';
import { selectPromptSections } from '../prompt-sections';
import type { FeatureDefinition } from '../types';
import {
  aiLevelSchema,
  characterNamesFor,
  curriculumCodesIn,
  levelLabelsOf,
  levelParityProblems,
  levelSetProblems,
  libraryLevelSchema,
  markersIn,
  normalizeLibraryVersion,
  proseStrings,
  toAiVersion,
  versionProblems,
  versionTexts,
  wordingProblems,
  type LibraryAiLevel,
} from './library-shared';
import { tagged } from './shared';

export const LIBRARY_LEVELS = 'library_levels';

const record = z.record(z.string(), z.unknown());

export const libraryLevelsInputSchema = z
  .object({
    /** Stays in Canada: the database applies the answer to this resource only. */
    itemId: z.uuid(),
    /** The resource's revision when the request was made (`content_revision`). */
    baseRevision: z.number().int().min(1),
    itemType: z.enum(LIBRARY_ITEM_TYPES),
    gradeLabels: z.array(z.string().max(40)).max(4),
    subjectLabel: z.string().max(80).nullable(),
    levels: z.array(libraryLevelSchema).min(1).max(6),
    base: z.object({ content: record, answerKey: record.nullable() }),
    /** Set by `redactInput` (see library-item.ts), never by the database. */
    characterNames: z.array(z.string().max(40)).max(40).default([]),
  })
  .superRefine((input, ctx) => {
    if (!TYPE_INFO[input.itemType].levelable) {
      ctx.addIssue({ code: 'custom', path: ['itemType'], message: 'invalid' });
    }
    const keys = input.levels.map((l) => l.key);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: 'custom', path: ['levels'], message: 'duplicate' });
    }
    // The base version is what the teacher saved: it parses as a draft of its type.
    if (!contentSchema(input.itemType, 'draft').safeParse(input.base.content).success) {
      ctx.addIssue({ code: 'custom', path: ['base', 'content'], message: 'invalid' });
    }
    if (input.base.answerKey && !answerKeySchema('draft').safeParse(input.base.answerKey).success) {
      ctx.addIssue({ code: 'custom', path: ['base', 'answerKey'], message: 'invalid' });
    }
  });
export type LibraryLevelsInput = z.infer<typeof libraryLevelsInputSchema>;

/** The versions for the levels asked for (content and keys in the `ai` shape until normalized). */
export interface LibraryLevelsAiOutput {
  levels: LibraryAiLevel[];
}

const OUTPUT_SCHEMAS = new Map<LibraryItemType, z.ZodType<LibraryLevelsAiOutput>>();

/** The output schema of a type, in `ai` mode (D-080). */
export function libraryLevelsOutputSchema(type: LibraryItemType): z.ZodType<LibraryLevelsAiOutput> {
  let schema = OUTPUT_SCHEMAS.get(type);
  if (!schema) {
    schema = z.object({
      levels: z.array(aiLevelSchema(type)),
    }) as unknown as z.ZodType<LibraryLevelsAiOutput>;
    OUTPUT_SCHEMAS.set(type, schema);
  }
  return schema;
}

/** Types the answer only: every request uses its type's schema (`outputSchemaFor`). */
export const libraryLevelsOutputSchemaAnyType = z.object({
  levels: z.array(z.object({ level: z.string(), content: record, answerKey: record.nullable() })),
}) as unknown as z.ZodType<LibraryLevelsAiOutput>;

/**
 * Every string of the base version and its key, level names and descriptions, grades and
 * subject, de-identified with one redactor; ids and enumerated values stay as they are.
 */
export function redactLibraryLevelsInput(
  input: LibraryLevelsInput,
  redactor: Redactor,
): { input: LibraryLevelsInput; blocked: BlockedFinding[] } {
  const blocked: BlockedFinding[] = [];
  const clean = <T>(value: T): T => {
    const r = redactStrings(value, redactor, MACHINE_KEYS);
    blocked.push(...r.blocked);
    return r.value;
  };
  return {
    input: {
      ...input,
      gradeLabels: clean(input.gradeLabels),
      subjectLabel: clean(input.subjectLabel),
      levels: input.levels.map((l) => ({
        ...l,
        label: clean(l.label),
        description: clean(l.description),
      })),
      base: clean(input.base),
      characterNames: characterNamesFor(redactor),
    },
    blocked,
  };
}

/** The request in French: the resource, the levels asked for, then its base version as JSON. */
export function libraryLevelsUserMessage(input: LibraryLevelsInput): string {
  const info = TYPE_INFO[input.itemType];
  const levels = input.levels.map(
    (l) =>
      `- ${l.key} — ${l.label}${l.mostAccessible ? ' (niveau le plus accessible)' : ''}${
        l.description ? ` : ${l.description}` : ''
      }`,
  );
  return [
    `Type de ressource : ${info.labelFr} (catégorie ${BUCKET_LABELS_FR[info.bucket]})`,
    `Année d'études : ${input.gradeLabels.length ? input.gradeLabels.join(', ') : 'non précisée'}`,
    `Matière : ${input.subjectLabel?.trim() || 'non précisée'}`,
    'Versions à préparer, dans cet ordre :',
    ...levels,
    input.characterNames.length
      ? `Prénoms permis pour un nouveau personnage : ${input.characterNames.join(', ')}.`
      : 'Prénoms permis pour un nouveau personnage : aucun.',
    '',
    'Version de base (contenu) :',
    tagged('version_de_base', JSON.stringify(input.base.content, null, 1)),
    '',
    input.base.answerKey
      ? [
          'Corrigé de la version de base :',
          tagged('corrige_de_base', JSON.stringify(input.base.answerKey, null, 1)),
        ].join('\n')
      : 'Corrigé de la version de base : aucun.',
  ].join('\n');
}

/** Canonical content and keys for every level version (D-080). */
export function normalizeLibraryLevels(
  output: LibraryLevelsAiOutput,
  input: LibraryLevelsInput,
): LibraryLevelsAiOutput {
  return {
    levels: output.levels.map((l) =>
      normalizeLibraryVersion(input.itemType, { ...l, level: l.level.trim() }),
    ),
  };
}

/** Every rule the new versions need, with paths and codes (never content). */
export function validateLibraryLevels(
  output: LibraryLevelsAiOutput,
  input: LibraryLevelsInput,
): string[] {
  const type = input.itemType;
  const problems = levelSetProblems(
    input.levels.map((l) => l.key),
    output.levels.map((l) => l.level),
  );
  const labels = levelLabelsOf(input.levels);
  // Only the markers and codes the base version already had (names come back as written).
  const baseStrings = [...proseStrings(input.base.content), ...proseStrings(input.base.answerKey)];
  const allowed = { markers: markersIn(baseStrings), codes: curriculumCodesIn(baseStrings) };
  output.levels.forEach((level, i) => {
    const at = `levels.${i}`;
    problems.push(...versionProblems(type, at, level, labels));
    problems.push(...levelParityProblems(type, input.base.content, level.content, at));
    problems.push(...wordingProblems(at, versionTexts(type, level), allowed));
  });
  return problems;
}

/**
 * Without a model: the base version itself for each level asked for, in the `ai` shape. It
 * passes `normalize` and `validate` for every type that has levels.
 */
export function fakeLibraryLevels(input: LibraryLevelsInput): LibraryLevelsAiOutput {
  const version = toAiVersion(
    input.itemType,
    input.base.content,
    input.base.answerKey as Parameters<typeof toAiVersion>[2],
  );
  return {
    levels: input.levels.map((l) => ({
      level: l.key,
      content: structuredClone(version.content),
      answerKey: version.answerKey && structuredClone(version.answerKey),
    })),
  };
}

export const libraryLevelsFeature: FeatureDefinition<LibraryLevelsInput, LibraryLevelsAiOutput> = {
  name: LIBRARY_LEVELS,
  promptVersion: 'v1',
  inputSchema: libraryLevelsInputSchema,
  outputSchema: libraryLevelsOutputSchemaAnyType,
  // Each version is about the size of the base, so the database refuses a base whose JSON times
  // the number of levels exceeds 120,000 characters (LXL08): the answer stays under about 35k
  // tokens of French, with room for adaptive thinking (Opus 5.5 always thinks, and thinking
  // counts toward this limit). A cut-off answer is not retried (aiTooLong). Needs a streamed call
  // (see providers.ts), and keeps within the job's 13 minutes.
  maxTokens: 64_000,

  outputSchemaFor: (input) => libraryLevelsOutputSchema(input.itemType),
  systemPrompt: (prompt, input) => selectPromptSections(prompt, [`type:${input.itemType}`]),
  redactInput: redactLibraryLevelsInput,
  buildUserMessage: libraryLevelsUserMessage,
  normalize: normalizeLibraryLevels,
  validate: validateLibraryLevels,
  fake: fakeLibraryLevels,
};
