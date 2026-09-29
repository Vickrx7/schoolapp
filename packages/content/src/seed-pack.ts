/**
 * The content-pack format (DECISIONS P-11, P-21): `content/library/<pack>/pack.json` plus one
 * JSON file per item in `items/` (`seedItemFile`). It is the demo seed today and the
 * export/import format later. References to the database are by code (board and school slugs,
 * user e-mails, subject, grade and attente codes, level codes, Catholic reference titles, tag
 * slugs), never by id.
 */
import { z } from 'zod';
import { validateAnswerKey } from './answer-key';
import { LIBRARY_ITEM_TYPES, subFriendlyAllowed, TYPE_INFO } from './catalog';
import { issueKey } from './kit';
import { questionsOf } from './questions-of';
import { safetyNotesSchema } from './safety';
import { answerKeySchema, contentSchema, GRADE_CODE_PATTERN } from './schemas';

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const slug = z.string().regex(SLUG_PATTERN, 'invalid');
const email = z.email('invalid');
/** A board language level code (`debutant`, `intermediaire`, `avance`, `enrichi`). */
const levelCode = z.string().regex(/^[a-z0-9_]{2,32}$/, 'invalid');

export const seedPackSchema = z.strictObject({
  slug,
  version: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(160),
  publisher: z.string().trim().max(120).nullable().default(null),
  /** Slug of the board that receives the pack. */
  board: slug,
  /** Global tags (no board) the items may use. */
  tags: z
    .array(z.strictObject({ slug, labelFr: z.string().trim().min(1).max(60) }))
    .max(100)
    .default([]),
  /** Item slugs, in load order; each has its file at `seedItemFile(slug)`. */
  items: z.array(slug).min(1).max(500),
});
export type SeedPack = z.output<typeof seedPackSchema>;

/** Folder of a pack's item files, next to its `pack.json`. */
export const SEED_ITEMS_DIR = 'items';

/** Path of an item file, relative to the pack folder (`items/<slug>.json`). */
export function seedItemFile(slug: string): string {
  return `${SEED_ITEMS_DIR}/${slug}.json`;
}

const versionSchema = z.strictObject({
  /** Null for the base version. */
  level: levelCode.nullable(),
  content: z.record(z.string(), z.unknown()),
  answerKey: z.record(z.string(), z.unknown()).nullable().default(null),
});

export const seedItemSchema = z
  .strictObject({
    slug,
    type: z.enum(LIBRARY_ITEM_TYPES),
    title: z.string().trim().min(1).max(200),
    summary: z.string().trim().max(1000).default(''),
    source: z.enum(['board_created', 'teacher_created', 'ai_generated']),
    /** Null for board items. */
    author: email.nullable().default(null),
    /** School slug; required for school sharing. */
    school: slug.nullable().default(null),
    status: z.enum(['draft', 'teacher_reviewed', 'board_approved']),
    shareScope: z.enum(['private', 'school', 'board']),
    /** Waiting in the reviewers' queue (requested by the author). */
    reviewRequested: z.boolean().default(false),
    /** The content reviewer who approved it. */
    approvedBy: email.nullable().default(null),
    /** Faith content reviewed, by the same reviewer. */
    faithReviewed: z.boolean().default(false),
    gradeCodes: z.array(z.string().regex(GRADE_CODE_PATTERN)).min(1).max(4),
    subjectCode: z.string().regex(/^[a-z0-9_]{2,32}$/),
    /** Attentes by grade and code (`{ "grade": "3", "code": "C1.2" }`) of the item's subject. */
    expectations: z
      .array(
        z.strictObject({
          grade: z.string().regex(GRADE_CODE_PATTERN),
          code: z.string().min(1).max(20),
        }),
      )
      .max(12)
      .default([]),
    durationMinutes: z.number().int().min(1).max(600),
    materials: z.string().trim().min(1).max(4000),
    keywords: z.string().trim().max(300).default(''),
    tags: z.array(slug).max(10).default([]),
    formats: z.strictObject({
      printable: z.boolean(),
      projectable: z.boolean(),
      interactive: z.boolean(),
    }),
    subFriendly: z.boolean().default(false),
    safetyNotes: safetyNotesSchema('final').nullable().default(null),
    faithContent: z.boolean().default(false),
    faithOnStudentSheet: z.boolean().default(false),
    catholicConnection: z.string().trim().max(2000).default(''),
    /** Title of a Catholic reference of the board (or a global one). */
    catholicReference: z.string().trim().min(1).max(160).nullable().default(null),
    licence: z.string().trim().max(200).nullable().default(null),
    promptVersion: z.string().trim().max(40).nullable().default(null),
    model: z.string().trim().max(80).nullable().default(null),
    versions: z.array(versionSchema).min(1).max(8),
  })
  .superRefine((item, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    const info = TYPE_INFO[item.type];

    const levels = item.versions.map((v) => v.level ?? 'base');
    if (levels.filter((l) => l === 'base').length !== 1) issue(['versions'], 'baseVersion');
    levels.forEach((level, i) => {
      if (levels.indexOf(level) !== i) issue(['versions', i, 'level'], 'duplicateLevel');
    });
    if (!info.levelable && levels.length > 1) issue(['versions'], 'notLevelable');

    item.versions.forEach((version, i) => {
      const content = contentSchema(item.type, 'final').safeParse(version.content);
      if (!content.success) {
        for (const e of content.error.issues)
          issue(['versions', i, 'content', ...(e.path as (string | number)[])], issueKey(e));
        return;
      }
      if (!version.answerKey) {
        if (info.keyed || questionsOf(item.type, content.data).length) {
          issue(['versions', i, 'answerKey'], 'required');
        }
        return;
      }
      if (!info.mayHaveQuestions) {
        issue(['versions', i, 'answerKey'], 'notAllowed');
        return;
      }
      const key = answerKeySchema('final').safeParse(version.answerKey);
      if (!key.success) {
        for (const e of key.error.issues)
          issue(['versions', i, 'answerKey', ...(e.path as (string | number)[])], issueKey(e));
        return;
      }
      for (const e of validateAnswerKey(item.type, content.data, key.data)) {
        issue(['versions', i, e.where === 'key' ? 'answerKey' : 'content', ...e.path], e.code);
      }
    });

    // Provenance and workflow, as the database's constraints and workflow functions require.
    if (item.source === 'board_created' ? item.author !== null : item.author === null) {
      issue(['author'], 'authorForSource');
    }
    if (item.source === 'ai_generated' && (!item.promptVersion || !item.model)) {
      issue(['promptVersion'], 'provenanceRequired');
    }
    if (item.shareScope !== 'private' && item.status === 'draft')
      issue(['shareScope'], 'sharedNeedsReview');
    if (item.shareScope === 'school' && !item.school) issue(['school'], 'required');
    if (item.status === 'board_approved') {
      if (item.shareScope !== 'board') issue(['shareScope'], 'approvedIsBoard');
      if (!item.approvedBy) issue(['approvedBy'], 'required');
    } else if (item.approvedBy) {
      issue(['approvedBy'], 'notApproved');
    }
    if (item.reviewRequested && item.status !== 'teacher_reviewed') {
      issue(['reviewRequested'], 'requestNeedsReview');
    }
    if (item.faithReviewed && !item.approvedBy) issue(['faithReviewed'], 'faithReviewerRequired');
    // Faith content reaches the whole board only once faith-reviewed (P-4).
    if (item.shareScope === 'board' && seedItemRequiresFaithReview(item) && !item.faithReviewed) {
      issue(['faithReviewed'], 'faithReviewRequired');
    }
    if (item.status !== 'draft') {
      if (!info.expectationsOptional && !item.expectations.length)
        issue(['expectations'], 'required');
      if (!item.keywords && !item.tags.length) issue(['tags'], 'required');
      if (info.needsSafety && !item.safetyNotes) issue(['safetyNotes'], 'required');
    }
    if (item.subFriendly && !subFriendlyAllowed(item.type, item.safetyNotes)) {
      issue(['subFriendly'], 'subFriendlyNotAllowed');
    }
    if (item.faithOnStudentSheet && !item.catholicConnection) {
      issue(['faithOnStudentSheet'], 'noConnection');
    }
  });
export type SeedItem = z.output<typeof seedItemSchema>;

/** True when faith review applies, as `app.library_items_before_write` computes it. */
export function seedItemRequiresFaithReview(item: SeedItem): boolean {
  return (
    item.type === 'catholic_reflection' ||
    item.faithContent ||
    item.catholicConnection.trim() !== '' ||
    item.catholicReference !== null ||
    item.subjectCode === 'ere'
  );
}
