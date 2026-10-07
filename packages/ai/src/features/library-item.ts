/**
 * « Créer avec l’IA » (SPEC 9.3, DECISIONS D-072, D-074, D-080): a new library resource of any of
 * the 25 types of `LIBRARY_ITEM_AI_TYPES` (every type but the comment bank, which has its own
 * feature, D-132), written from the curriculum, with versions per language level when asked, and
 * a link with the faith when asked. The answer becomes a private draft of the teacher who asked
 * (the database's trigger on `ai_jobs`), which she reviews before using or sharing it.
 *
 * The input is built by the database from ids (`app.library_item_ai_input`): labels, attente
 * texts, level descriptions and the Catholic reference are read from its tables, never taken
 * from the browser. Ids never enter the message; the keys `E1`…, `L1`… and `R1` do. The teacher's
 * note is the only text she typed, and it is de-identified with the rest (D-038).
 *
 * Library content is reusable: the answer may name no one. It may contain no person marker
 * (« Élève A »), and a character takes a first name from a fixed fictional list, minus any name
 * that belongs to someone the request knows.
 */
import {
  BUCKET_LABELS_FR,
  GRADE_CODE_PATTERN,
  LIBRARY_ITEM_AI_TYPES,
  TYPE_INFO,
  aiFaithContent,
  normalizeFrenchTypography,
  normalizeSafetyNotes,
  safetyNotesSchema,
  sampleKey,
  sampleLevels,
  sampleSafetyNotes,
  sampleVersion,
  subFriendlyAllowed,
  type ItemFormats,
  type LibraryItemType,
} from '@lynx/content';
import { z } from 'zod';
import type { BlockedFinding, Redactor } from '../privacy';
import { selectPromptSections } from '../prompt-sections';
import type { FeatureDefinition } from '../types';
import {
  aiLevelSchema,
  aiVersionSchema,
  characterNamesFor,
  levelLabelsOf,
  levelParityProblems,
  levelSetProblems,
  libraryLevelSchema,
  normalizeLibraryVersion,
  proseStrings,
  versionProblems,
  versionTexts,
  wordingProblems,
  type LibraryAiLevel,
  type LibraryAiVersion,
} from './library-shared';
import { tagged } from './shared';

export const LIBRARY_ITEM = 'library_item';

export { libraryLevelSchema };

export const libraryExpectationSchema = z.object({
  /** E1…E5, in the order the teacher chose; the attente's id stays in Canada. */
  key: z.string().regex(/^E[1-5]$/),
  expectationId: z.uuid(),
  code: z.string().max(20),
  text: z.string().max(2000),
});

export const libraryCatholicSchema = z.object({
  key: z.literal('R1'),
  referenceId: z.uuid(),
  /** virtue, graduate_expectation, reflection, prayer, scripture. */
  type: z.string().max(40),
  title: z.string().max(160),
  text: z.string().max(4000),
});

/** Maternelle to 8e année: the grade codes of `public.grades`. */
const gradeCode = z.string().regex(GRADE_CODE_PATTERN);

export const libraryItemInputSchema = z
  .object({
    /** Every type but the comment bank, which has its own feature (D-132). */
    itemType: z.enum(LIBRARY_ITEM_AI_TYPES),
    gradeCodes: z.array(gradeCode).min(1).max(2),
    /** « 3e année »: French labels, from the database. */
    gradeLabels: z.array(z.string().max(40)).min(1).max(2),
    subjectId: z.uuid(),
    subjectLabel: z.string().max(80),
    /** The domaine of the first attente. */
    strandLabel: z.string().max(200).nullable(),
    expectations: z.array(libraryExpectationSchema).max(5),
    levels: z.array(libraryLevelSchema).max(6),
    catholic: libraryCatholicSchema.nullable(),
    durationMinutes: z.number().int().min(5).max(240),
    subFriendly: z.boolean(),
    teacherNote: z.string().trim().max(1000),
    /**
     * The first names characters may take: set by `redactInput` for each request (the list
     * minus anyone the request knows), never by the database.
     */
    characterNames: z.array(z.string().max(40)).max(40).default([]),
  })
  .superRefine((input, ctx) => {
    const info = TYPE_INFO[input.itemType];
    if (input.gradeLabels.length !== input.gradeCodes.length) {
      ctx.addIssue({ code: 'custom', path: ['gradeLabels'], message: 'invalid' });
    }
    input.expectations.forEach((e, i) => {
      if (e.key !== `E${i + 1}`) {
        ctx.addIssue({ code: 'custom', path: ['expectations', i, 'key'], message: 'invalid' });
      }
    });
    if (!input.expectations.length && !info.expectationsOptional) {
      ctx.addIssue({ code: 'custom', path: ['expectations'], message: 'required' });
    }
    if (input.levels.length && !info.levelable) {
      ctx.addIssue({ code: 'custom', path: ['levels'], message: 'invalid' });
    }
    const keys = input.levels.map((l) => l.key);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: 'custom', path: ['levels'], message: 'duplicate' });
    }
    if (input.itemType === 'catholic_reflection' && !input.catholic) {
      ctx.addIssue({ code: 'custom', path: ['catholic'], message: 'required' });
    }
    if (input.subFriendly && !info.subFriendlyAllowed) {
      ctx.addIssue({ code: 'custom', path: ['subFriendly'], message: 'invalid' });
    }
  });
export type LibraryItemInput = z.infer<typeof libraryItemInputSchema>;

/** Safety notes as answered (`ai` mode: the supervision level is any string until checked). */
export interface LibraryAiSafetyNotes {
  ageSuitability: string;
  allergyAwareMaterials: string;
  supervision: string;
  hazards: string[];
  notes: string;
}

/**
 * The answer. Content and keys are in the `ai` shape as answered, and canonical once
 * normalized; everything else is plain text and flags, checked by `validate`.
 */
export interface LibraryItemAiOutput {
  title: string;
  summary: string;
  /** Free words for the search, separated by commas. */
  keywords: string;
  durationMinutes: number;
  materials: string;
  formats: ItemFormats;
  /** Experiments and STEM challenges only; null otherwise. */
  safetyNotes: LibraryAiSafetyNotes | null;
  /** One or two sentences tied to the reference `R1`; '' when no link was asked for. */
  catholicConnection: string;
  /** The resource contains prayer or religious text (« Contient du contenu de foi »). */
  faithContent: boolean;
  base: LibraryAiVersion;
  levels: LibraryAiLevel[];
}

const formatsSchema = z.object({
  printable: z.boolean(),
  projectable: z.boolean(),
  interactive: z.boolean(),
});

const OUTPUT_SCHEMAS = new Map<LibraryItemType, z.ZodType<LibraryItemAiOutput>>();

/**
 * The output schema of a type (D-080), in `ai` mode: the type's content schema for the base and
 * each level, with no enum, pattern or size constraint (structured outputs ignore them, and a
 * violation would fail with no path): `validate` checks them all.
 */
export function libraryItemOutputSchema(type: LibraryItemType): z.ZodType<LibraryItemAiOutput> {
  let schema = OUTPUT_SCHEMAS.get(type);
  if (!schema) {
    schema = z.object({
      title: z.string(),
      summary: z.string(),
      keywords: z.string(),
      durationMinutes: z.number(),
      materials: z.string(),
      formats: formatsSchema,
      safetyNotes: safetyNotesSchema('ai').nullable(),
      catholicConnection: z.string(),
      faithContent: z.boolean(),
      base: aiVersionSchema(type),
      levels: z.array(aiLevelSchema(type)),
    }) as unknown as z.ZodType<LibraryItemAiOutput>;
    OUTPUT_SCHEMAS.set(type, schema);
  }
  return schema;
}

/** Types the answer only: every request uses its type's schema (`outputSchemaFor`). */
const looseVersion = z.object({
  content: z.record(z.string(), z.unknown()),
  answerKey: z.record(z.string(), z.unknown()).nullable(),
});
export const libraryItemOutputSchemaAnyType = z.object({
  title: z.string(),
  summary: z.string(),
  keywords: z.string(),
  durationMinutes: z.number(),
  materials: z.string(),
  formats: formatsSchema,
  safetyNotes: safetyNotesSchema('ai').nullable(),
  catholicConnection: z.string(),
  faithContent: z.boolean(),
  base: looseVersion,
  levels: z.array(looseVersion.extend({ level: z.string() })),
}) as unknown as z.ZodType<LibraryItemAiOutput>;

/** Longest parts of an answer (characters), as the library stores them. */
export const LIBRARY_ITEM_OUTPUT_LIMITS = {
  title: 200,
  summary: 1000,
  materials: 4000,
  keywords: 300,
  catholicConnection: 600,
} as const;

// ---------------------------------------------------------------------------------------
// De-identification
// ---------------------------------------------------------------------------------------

/**
 * De-identifies every text of the request with one redactor (the teacher's note is the text most
 * likely to name someone; labels, attentes, level descriptions and the reference come from the
 * database, and are checked all the same), and sets the character names it may use.
 */
export function redactLibraryItemInput(
  input: LibraryItemInput,
  redactor: Redactor,
): { input: LibraryItemInput; blocked: BlockedFinding[] } {
  const blocked: BlockedFinding[] = [];
  const clean = (value: string) => {
    const r = redactor.redact(value);
    blocked.push(...r.blocked);
    return r.text;
  };
  const cleanOrNull = (value: string | null) => (value === null ? null : clean(value));
  return {
    input: {
      ...input,
      gradeLabels: input.gradeLabels.map(clean),
      subjectLabel: clean(input.subjectLabel),
      strandLabel: cleanOrNull(input.strandLabel),
      expectations: input.expectations.map((e) => ({
        ...e,
        code: clean(e.code),
        text: clean(e.text),
      })),
      levels: input.levels.map((l) => ({
        ...l,
        label: clean(l.label),
        description: cleanOrNull(l.description),
      })),
      catholic: input.catholic && {
        ...input.catholic,
        title: clean(input.catholic.title),
        text: clean(input.catholic.text),
      },
      teacherNote: clean(input.teacherNote),
      characterNames: characterNamesFor(redactor),
    },
    blocked,
  };
}

// ---------------------------------------------------------------------------------------
// The message
// ---------------------------------------------------------------------------------------

const REFERENCE_TYPES_FR: Record<string, string> = {
  virtue: 'vertu',
  graduate_expectation: 'attente du diplômé',
  reflection: 'réflexion',
  prayer: 'prière',
  scripture: 'Écriture sainte',
};

const present = (value: string | null | undefined): value is string => !!value?.trim();

/** The request in French, as the model reads it (and as the preview shows it). */
export function libraryItemUserMessage(input: LibraryItemInput): string {
  const info = TYPE_INFO[input.itemType];
  const expectations = input.expectations.length
    ? input.expectations.map((e) => `- ${e.key} — ${e.code} : ${e.text}`)
    : ['- aucune (cette ressource peut ne viser aucune attente précise)'];
  const levels = input.levels.length
    ? input.levels.map(
        (l) =>
          `- ${l.key} — ${l.label}${l.mostAccessible ? ' (niveau le plus accessible)' : ''}${
            l.description ? ` : ${l.description}` : ''
          }`,
      )
    : ['- aucune (version de base seulement : levels doit être vide)'];
  const faith = input.catholic
    ? [
        `Lien avec la foi : ${input.catholic.key} — « ${input.catholic.title} » (${
          REFERENCE_TYPES_FR[input.catholic.type] ?? input.catholic.type
        }) : ${input.catholic.text}`,
      ]
    : ['Lien avec la foi : aucun (catholicConnection doit être vide).'];
  const names = input.characterNames.length
    ? `Prénoms permis pour les personnages : ${input.characterNames.join(', ')}.`
    : 'Prénoms permis pour les personnages : aucun. Désigne les personnages autrement (« une amie », « le fermier »).';
  return [
    `Type de ressource : ${info.labelFr} (catégorie ${BUCKET_LABELS_FR[info.bucket]})`,
    `Année d'études : ${input.gradeLabels.join(', ')}`,
    `Matière : ${input.subjectLabel}${present(input.strandLabel) ? ` · Domaine : ${input.strandLabel}` : ''}`,
    'Attentes visées :',
    ...expectations,
    `Durée visée : ${input.durationMinutes} minutes · Pour une personne suppléante : ${input.subFriendly ? 'oui' : 'non'}`,
    'Versions par niveau, dans cet ordre :',
    ...levels,
    ...faith,
    names,
    '',
    present(input.teacherNote)
      ? tagged('precisions', input.teacherNote)
      : "Précisions de l'enseignant·e : aucune.",
  ].join('\n');
}

// ---------------------------------------------------------------------------------------
// Normalizing and checking an answer
// ---------------------------------------------------------------------------------------

const tidy = (text: string) => normalizeFrenchTypography(text.trim());

/**
 * Canonical content and keys, typography, safety notes only where they belong, the faith link
 * only when asked for, and « Contient du contenu de foi » when faith words appear (D-080).
 */
export function normalizeLibraryItem(
  output: LibraryItemAiOutput,
  input: LibraryItemInput,
): LibraryItemAiOutput {
  const type = input.itemType;
  const base = normalizeLibraryVersion(type, output.base);
  const levels = output.levels.map((l) =>
    normalizeLibraryVersion(type, { ...l, level: l.level.trim() }),
  );
  const safetyNotes = TYPE_INFO[type].needsSafety
    ? (normalizeSafetyNotes(output.safetyNotes) as LibraryAiSafetyNotes | null)
    : null;
  return {
    ...output,
    title: tidy(output.title),
    summary: tidy(output.summary),
    keywords: tidy(output.keywords),
    materials: tidy(output.materials),
    durationMinutes: Number.isFinite(output.durationMinutes)
      ? Math.round(output.durationMinutes)
      : output.durationMinutes,
    safetyNotes,
    // A link nobody asked for is dropped rather than paid for with a retry.
    catholicConnection: input.catholic ? tidy(output.catholicConnection) : '',
    faithContent: aiFaithContent(
      type,
      [base.content, ...levels.map((l) => l.content)],
      output.faithContent,
    ),
    base,
    levels,
  };
}

/** Every rule a stored draft needs, with paths and codes (never content). */
export function validateLibraryItem(
  output: LibraryItemAiOutput,
  input: LibraryItemInput,
): string[] {
  const type = input.itemType;
  const L = LIBRARY_ITEM_OUTPUT_LIMITS;
  const problems: string[] = [];
  const labels = levelLabelsOf(input.levels);

  // What the store needs.
  problems.push(...versionProblems(type, 'base', output.base, labels));
  output.levels.forEach((level, i) => {
    problems.push(...versionProblems(type, `levels.${i}`, level, labels));
    problems.push(...levelParityProblems(type, output.base.content, level.content, `levels.${i}`));
  });
  problems.push(
    ...levelSetProblems(
      input.levels.map((l) => l.key),
      output.levels.map((l) => l.level),
    ),
  );

  // Safety: complete notes for experiments and STEM challenges, standard supervision when a
  // substitute may run it (D-077).
  if (TYPE_INFO[type].needsSafety) {
    if (!safetyNotesSchema('final').safeParse(output.safetyNotes).success) {
      problems.push('safetyNotes: incomplete');
    } else if (input.subFriendly && !subFriendlyAllowed(type, output.safetyNotes)) {
      problems.push('safetyNotes.supervision: not standard for a substitute');
    }
  }

  // The faith link: exactly when asked for, short (D-074).
  const connection = output.catholicConnection.trim();
  if (input.catholic && !connection) problems.push('catholicConnection: missing');
  if (!input.catholic && connection) problems.push('catholicConnection: not asked for');
  if (connection.length > L.catholicConnection) problems.push('catholicConnection: tooLong');

  // Sizes.
  const d = output.durationMinutes;
  if (!Number.isFinite(d) || d < 0.5 * input.durationMinutes || d > 1.5 * input.durationMinutes) {
    problems.push(
      `durationMinutes: ${Number.isFinite(d) ? d : 'invalid'} for ${input.durationMinutes}`,
    );
  }
  if (!output.title.trim()) problems.push('title: required');
  if (output.title.length > L.title) problems.push('title: tooLong');
  if (output.summary.length > L.summary) problems.push('summary: tooLong');
  if (output.materials.length > L.materials) problems.push('materials: tooLong');
  if (output.keywords.length > L.keywords) problems.push('keywords: tooLong');

  // Words: Canadian French, curriculum codes given, no one named, no copied source.
  const itemTexts = [
    output.title,
    output.summary,
    output.keywords,
    output.materials,
    output.catholicConnection,
    ...proseStrings(output.safetyNotes),
  ];
  const allowed = {
    markers: new Set<string>(),
    codes: new Set(input.expectations.map((e) => e.code.trim())),
  };
  problems.push(...wordingProblems('item', { french: itemTexts, all: itemTexts }, allowed));
  problems.push(...wordingProblems('base', versionTexts(type, output.base), allowed));
  output.levels.forEach((level, i) => {
    problems.push(...wordingProblems(`levels.${i}`, versionTexts(type, level), allowed));
  });
  return problems;
}

// ---------------------------------------------------------------------------------------
// The fake provider's answer
// ---------------------------------------------------------------------------------------

const clip = (text: string, max: number) => {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
};

/**
 * A complete answer without a model: the type's sample, with the first attente as its objective
 * and title, a sample version per level asked for, safety notes for experiments and STEM
 * challenges, and a faith link when one was asked for. Deterministic, and it passes `normalize`
 * and `validate` for every type, with and without levels and faith.
 */
export function fakeLibraryItem(input: LibraryItemInput): LibraryItemAiOutput {
  const type = input.itemType;
  const info = TYPE_INFO[type];
  const first = input.expectations[0];
  const objective = first ? clip(first.text, 300) : undefined;
  const topic = first ? clip(first.text, 150) : input.subjectLabel;
  const content = sampleVersion(type, { title: '', ...(objective ? { objective } : {}) });
  const answerKey = sampleKey(type, content);
  return {
    title: clip(`${info.labelFr} : ${topic}`, 200),
    summary: clip(
      `Ressource de démonstration pour ${input.gradeLabels.join(' et ')} en ${input.subjectLabel}.`,
      1000,
    ),
    keywords: [input.subjectLabel, ...input.expectations.map((e) => e.code)].join(', '),
    durationMinutes: input.durationMinutes,
    materials: 'Crayons, feuilles et le matériel habituel de la classe.',
    formats: info.defaultFormats,
    safetyNotes: info.needsSafety ? sampleSafetyNotes() : null,
    catholicConnection: input.catholic
      ? `Aujourd’hui, pensons à « ${input.catholic.title} » : comment ce que nous apprenons peut-il nous aider à prendre soin des autres?`
      : '',
    faithContent: false,
    base: { content, answerKey },
    levels: sampleLevels(
      type,
      content,
      input.levels.map((l) => l.key),
    ),
  };
}

export const libraryItemFeature: FeatureDefinition<LibraryItemInput, LibraryItemAiOutput> = {
  name: LIBRARY_ITEM,
  promptVersion: 'v1',
  inputSchema: libraryItemInputSchema,
  outputSchema: libraryItemOutputSchemaAnyType,
  // Room for adaptive thinking plus the whole answer at the largest request: a resource with a
  // base version and six level versions (a 20-question reading passage is about 4k tokens of
  // French per version, keys included), about 30k tokens before any thinking. Opus 5.5 always
  // thinks and thinking counts toward this limit; a cut-off answer is not retried (aiTooLong).
  // Needs a streamed call (see providers.ts), and keeps within the job's 13 minutes.
  maxTokens: 64_000,

  outputSchemaFor: (input) => libraryItemOutputSchema(input.itemType),
  systemPrompt: (prompt, input) => selectPromptSections(prompt, [`type:${input.itemType}`]),
  redactInput: redactLibraryItemInput,
  buildUserMessage: libraryItemUserMessage,
  normalize: normalizeLibraryItem,
  validate: validateLibraryItem,
  fake: fakeLibraryItem,
};
