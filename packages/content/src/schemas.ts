/**
 * One versioned content schema per item type (SPEC 9.3, DECISIONS P-1). Content is stored in
 * `library_item_versions.content` with `schema_version = CURRENT_SCHEMA_VERSION`; answer keys in
 * `library_item_answer_keys.answer_key`. A new field needs schema version 2 plus a conversion.
 */
import { z } from 'zod';
import { LIBRARY_ITEM_TYPES, subFriendlyAllowed, type LibraryItemType } from './catalog';
import { emptyFromSchema } from './conform';
import { issueKey, kit, type SchemaMode } from './kit';
import { ACHIEVEMENT_CATEGORIES, questionSchemas, type AnswerKey } from './questions';
import { safetyNotesSchema } from './safety';
import { anchorChart, lessonPlan, teacherGuide, workedExample } from './types/enseigner';
import { experiment, outdoorActivity, project, stemChallenge } from './types/explorer';
import { diagnostic, quiz, rubric, unitTest } from './types/evaluer';
import { brainBreak, game, riddle, song, weeklyChallenge } from './types/jouer';
import {
  exitTicket,
  learningCentre,
  readingPassage,
  vocabularyBank,
  worksheet,
} from './types/pratiquer';
import { catholicReflection, cultureHook, parentGuide } from './types/relier';
import type { SchemaContext } from './types/shared';

export const CURRENT_SCHEMA_VERSION = 1;

const FACTORIES = {
  lesson_plan: lessonPlan,
  anchor_chart: anchorChart,
  worked_example: workedExample,
  teacher_guide: teacherGuide,
  worksheet,
  learning_centre: learningCentre,
  reading_passage: readingPassage,
  vocabulary_bank: vocabularyBank,
  exit_ticket: exitTicket,
  experiment,
  stem_challenge: stemChallenge,
  project,
  outdoor_activity: outdoorActivity,
  quiz,
  unit_test: unitTest,
  diagnostic,
  rubric,
  game,
  brain_break: brainBreak,
  song,
  riddle,
  weekly_challenge: weeklyChallenge,
  catholic_reflection: catholicReflection,
  culture_hook: cultureHook,
  parent_guide: parentGuide,
} satisfies Record<LibraryItemType, (ctx: SchemaContext) => z.ZodObject>;

export type ContentSchemaOf<T extends LibraryItemType> = ReturnType<(typeof FACTORIES)[T]>;
/** The canonical content of a type (`draft` and `final` share it). */
export type ContentOf<T extends LibraryItemType> = z.output<ContentSchemaOf<T>>;
export type AnyContent = { [T in LibraryItemType]: ContentOf<T> }[LibraryItemType];
export type { AnswerKey };

const CACHE = new Map<string, z.ZodObject>();

/** The object schema of a type in a mode (cached; schemas are immutable). */
export function contentObject<T extends LibraryItemType>(
  type: T,
  mode: SchemaMode,
): ContentSchemaOf<T> {
  const cacheKey = `${type}:${mode}`;
  let schema = CACHE.get(cacheKey);
  if (!schema) {
    const factory = FACTORIES[type] as (ctx: SchemaContext) => z.ZodObject;
    schema = factory({ k: kit(mode), q: questionSchemas(mode) });
    CACHE.set(cacheKey, schema);
  }
  return schema as ContentSchemaOf<T>;
}

export function contentSchema<T extends LibraryItemType>(
  type: T,
  mode: 'draft' | 'final',
): z.ZodType<ContentOf<T>>;
/** In `ai` mode the output is not canonical: pass it to `normalizeAiContent`. */
export function contentSchema(type: LibraryItemType, mode: 'ai'): z.ZodType<unknown>;
export function contentSchema(type: LibraryItemType, mode: SchemaMode): z.ZodType<unknown>;
export function contentSchema(type: LibraryItemType, mode: SchemaMode): z.ZodType<unknown> {
  return contentObject(type, mode) as z.ZodType<unknown>;
}

export function answerKeySchema(mode: 'draft' | 'final'): z.ZodType<AnswerKey>;
export function answerKeySchema(mode: 'ai'): z.ZodType<unknown>;
export function answerKeySchema(mode: SchemaMode): z.ZodType<unknown>;
export function answerKeySchema(mode: SchemaMode): z.ZodType<unknown> {
  return questionSchemas(mode).answerKey;
}

/**
 * Empty content of a type, valid in `draft`. A rubric starts with one criterion per
 * achievement-chart category.
 */
export function emptyContent<T extends LibraryItemType>(type: T): ContentOf<T> {
  const content = emptyFromSchema(contentObject(type, 'draft')) as Record<string, unknown>;
  if (type === 'rubric') {
    content.criteria = ACHIEVEMENT_CATEGORIES.map((category) => ({
      category,
      criterion: '',
      levels: { level1: '', level2: '', level3: '', level4: '' },
    }));
  }
  return content as ContentOf<T>;
}

export function emptyAnswerKey(): AnswerKey {
  return { answers: [], solution: '' };
}

// ---------------------------------------------------------------------------------------
// The save form
// ---------------------------------------------------------------------------------------

export const GRADE_CODE_PATTERN = /^(K1|K2|[1-8])$/;

/** Error keys of the save form, on top of the content keys (`CONTENT_ERROR_KEYS`). */
export const FORM_ERROR_KEYS = ['baseVersion', 'duplicateLevel', 'subFriendlyNotAllowed'] as const;

const trimmed = (max: number) => z.string({ error: 'invalid' }).trim().max(max, 'tooLong');

const versionFormSchema = z.strictObject({
  /** Null for the base version. */
  languageLevelId: z.uuid({ error: 'invalid' }).nullable(),
  content: z.record(z.string(), z.unknown(), { error: 'invalid' }),
  answerKey: z.record(z.string(), z.unknown(), { error: 'invalid' }).nullable(),
});

/**
 * What the editor saves, after `fromAuthoring` (the payload of `save_library_item`). Content
 * and keys are checked in `draft` mode for the form's type; issues carry their full path
 * (`versions.0.content.questions.2.prompt`) and an error key as message.
 */
export const libraryItemFormSchema = z
  .strictObject({
    type: z.enum(LIBRARY_ITEM_TYPES, { error: 'invalid' }),
    boardId: z.uuid({ error: 'invalid' }),
    schoolId: z.uuid({ error: 'invalid' }).nullable(),
    title: trimmed(200).min(1, 'required'),
    summary: trimmed(1000),
    licence: trimmed(200),
    subjectId: z.uuid({ error: 'invalid' }).nullable(),
    gradeCodes: z
      .array(z.string().regex(GRADE_CODE_PATTERN, 'invalid'), { error: 'invalid' })
      .max(4, 'tooMany'),
    expectationIds: z.array(z.uuid({ error: 'invalid' })).max(12, 'tooMany'),
    tagIds: z.array(z.uuid({ error: 'invalid' })).max(10, 'tooMany'),
    keywords: trimmed(300),
    durationMinutes: z
      .number({ error: 'invalid' })
      .int('invalid')
      .min(1, 'tooSmall')
      .max(600, 'tooLarge')
      .nullable(),
    materials: trimmed(4000),
    isPrintable: z.boolean(),
    isProjectable: z.boolean(),
    isInteractive: z.boolean(),
    subFriendly: z.boolean(),
    safetyNotes: safetyNotesSchema('draft').nullable(),
    faithContent: z.boolean(),
    faithOnStudentSheet: z.boolean(),
    catholicConnection: trimmed(2000),
    catholicReferenceId: z.uuid({ error: 'invalid' }).nullable(),
    versions: z.array(versionFormSchema).min(1, 'required').max(8, 'tooMany'),
  })
  .superRefine((form, ctx) => {
    const levels = form.versions.map((v) => v.languageLevelId ?? 'base');
    if (levels.filter((l) => l === 'base').length !== 1) {
      ctx.addIssue({ code: 'custom', path: ['versions'], message: 'baseVersion' });
    }
    levels.forEach((level, index) => {
      if (levels.indexOf(level) !== index) {
        ctx.addIssue({
          code: 'custom',
          path: ['versions', index, 'languageLevelId'],
          message: 'duplicateLevel',
        });
      }
    });
    if (form.subFriendly && !subFriendlyAllowed(form.type, form.safetyNotes)) {
      ctx.addIssue({ code: 'custom', path: ['subFriendly'], message: 'subFriendlyNotAllowed' });
    }
    form.versions.forEach((version, index) => {
      const content = contentSchema(form.type, 'draft').safeParse(version.content);
      if (!content.success) {
        for (const issue of content.error.issues) {
          ctx.addIssue({
            code: 'custom',
            path: ['versions', index, 'content', ...issue.path],
            message: issueKey(issue),
          });
        }
      }
      if (version.answerKey) {
        const key = answerKeySchema('draft').safeParse(version.answerKey);
        if (!key.success) {
          for (const issue of key.error.issues) {
            ctx.addIssue({
              code: 'custom',
              path: ['versions', index, 'answerKey', ...issue.path],
              message: issueKey(issue),
            });
          }
        }
      }
    });
  });
export type LibraryItemForm = z.output<typeof libraryItemFormSchema>;
