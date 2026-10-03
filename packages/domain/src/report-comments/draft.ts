/**
 * The device draft of « Bulletins » (DECISIONS D-130, amending D-044): what a teacher composes for
 * a class and a report period, kept in her browser only (`localStorage`), never sent to our
 * servers or to the AI. Per student id (never the name): the wording, the grade in a combined
 * class, her notes, and per subject the mark, the chosen entries and the comment, in template
 * form (the first name written as `{prénom}`), so the device holds no first name.
 */
import {
  COMMENT_FORMS,
  LEARNING_SKILL_RATINGS,
  LEARNING_SKILLS,
  PROGRESS_MARKS,
  commentLength,
  fillComment,
} from '@lynx/content';
import { z } from 'zod';
import { isLocalDate, type LocalDate } from '../dates';

/** The draft's key under `lynx-draft:` (see apps/web/src/hooks/draft-storage.ts). */
export const REPORT_DRAFT_PREFIX = 'report:';

/** `report:{userId}:{classId}:{periodKey}`. */
export function reportDraftKey(userId: string, classId: string, periodKey: string): string {
  return `${REPORT_DRAFT_PREFIX}${userId}:${classId}:${periodKey}`;
}

/** The parts of a report draft's key (without `lynx-draft:`), or null for another key. */
export function parseReportDraftKey(
  key: string,
): { userId: string; classId: string; periodKey: string } | null {
  if (!key.startsWith(REPORT_DRAFT_PREFIX)) return null;
  const [userId, classId, periodKey, ...rest] = key.slice(REPORT_DRAFT_PREFIX.length).split(':');
  if (!userId || !classId || !periodKey || rest.length > 0) return null;
  return { userId, classId, periodKey };
}

/** « Limite de caractères »: 1,000 by default (**Assumption**, D-130), adjustable. */
export const COMMENT_LIMIT_MIN = 100;
export const COMMENT_LIMIT_MAX = 5000;
export const COMMENT_LIMIT_DEFAULT = 1000;

/** What a long comment or note may hold on the device. */
const TEXT_MAX = 20_000;

const pickSchema = z.object({
  itemId: z.uuid(),
  revision: z.number().int().min(1),
  index: z.number().int().min(0).max(159),
});

const commentSchema = z.object({
  level: z.number().int().min(1).max(4).nullable().default(null),
  progress: z.enum(PROGRESS_MARKS).nullable().default(null),
  ratings: z.partialRecord(z.enum(LEARNING_SKILLS), z.enum(LEARNING_SKILL_RATINGS)).default({}),
  picks: z.array(pickSchema).max(160).default([]),
  /** Template form: `{prénom}` for the student's first name. */
  text: z.string().max(TEXT_MAX).default(''),
  /** The teacher changed the text by hand: new picks ask before replacing it. */
  edited: z.boolean().default(false),
});

const studentSchema = z.object({
  /** A combined class: the student's grade (device only). */
  gradeCode: z.string().max(4).nullable().default(null),
  form: z.enum(COMMENT_FORMS).default('neutral'),
  /** « Mes notes », in template form. */
  notes: z.string().max(TEXT_MAX).default(''),
  /** By subject key: a subject's id or `learning_skills`. */
  comments: z.record(z.string().min(1).max(64), commentSchema).default({}),
});

export const reportDraftSchema = z.object({
  v: z.literal(1),
  /** The last day it is kept (60 days after the « remise », `draftExpiresOn`). */
  expiresOn: z.string().refine(isLocalDate),
  limit: z
    .number()
    .int()
    .min(COMMENT_LIMIT_MIN)
    .max(COMMENT_LIMIT_MAX)
    .default(COMMENT_LIMIT_DEFAULT),
  /** « Espaces simples à la copie » (on by default, **Assumption**). */
  plainSpaces: z.boolean().default(true),
  students: z.record(z.uuid(), studentSchema).default({}),
});

export type ReportDraft = z.output<typeof reportDraftSchema>;
export type ReportDraftStudent = ReportDraft['students'][string];
export type ReportDraftComment = ReportDraftStudent['comments'][string];
export type ReportDraftPick = ReportDraftComment['picks'][number];

export function emptyReportDraft(expiresOn: LocalDate): ReportDraft {
  return {
    v: 1,
    expiresOn,
    limit: COMMENT_LIMIT_DEFAULT,
    plainSpaces: true,
    students: {},
  };
}

export const emptyDraftStudent = (): ReportDraftStudent => ({
  gradeCode: null,
  form: 'neutral',
  notes: '',
  comments: {},
});

export const emptyDraftComment = (): ReportDraftComment => ({
  level: null,
  progress: null,
  ratings: {},
  picks: [],
  text: '',
  edited: false,
});

/** A stored draft, or null when it is not one (unreadable, another version). */
export function parseReportDraft(value: unknown): ReportDraft | null {
  const parsed = reportDraftSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * The draft without the picks of an earlier revision of the bank (its entries may have moved);
 * the comments' text stays.
 */
export function dropStalePicks(
  draft: ReportDraft,
  bank: { itemId: string; revision: number },
): ReportDraft {
  let changed = false;
  const students: ReportDraft['students'] = {};
  for (const [id, student] of Object.entries(draft.students)) {
    const comments: ReportDraftStudent['comments'] = {};
    for (const [key, comment] of Object.entries(student.comments)) {
      const picks = comment.picks.filter(
        (p) => p.itemId !== bank.itemId || p.revision === bank.revision,
      );
      if (picks.length !== comment.picks.length) changed = true;
      comments[key] = picks.length === comment.picks.length ? comment : { ...comment, picks };
    }
    students[id] = { ...student, comments };
  }
  return changed ? { ...draft, students } : draft;
}

export type CommentStatus =
  | { kind: 'todo' }
  | { kind: 'started' }
  | { kind: 'ready'; length: number }
  | { kind: 'over'; length: number; over: number };

/**
 * A student's status for a subject: « À faire » (nothing yet), « Commencé » (a mark or entries,
 * no text), « Prêt · 612 / 1 000 », or « Dépasse de 112 caractères ». Counted on the comment as
 * copied, with the first name.
 */
export function commentStatus(
  comment: ReportDraftComment | undefined,
  firstName: string,
  limit: number,
): CommentStatus {
  if (!comment) return { kind: 'todo' };
  const text = comment.text.trim();
  if (!text) {
    const started =
      comment.level !== null ||
      comment.progress !== null ||
      Object.keys(comment.ratings).length > 0 ||
      comment.picks.length > 0;
    return started ? { kind: 'started' } : { kind: 'todo' };
  }
  const length = commentLength(fillComment(text, firstName));
  return length > limit
    ? { kind: 'over', length, over: length - limit }
    : { kind: 'ready', length };
}

/** The students the draft holds anything for (a comment, a mark, entries or notes). */
export function studentsWithWork(draft: ReportDraft): string[] {
  return Object.entries(draft.students)
    .filter(
      ([, s]) =>
        s.notes.trim() !== '' ||
        Object.values(s.comments).some((c) => commentStatus(c, '', 1).kind !== 'todo'),
    )
    .map(([id]) => id);
}
