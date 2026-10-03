/**
 * The device draft of « Bulletins » (DECISIONS D-130, amending D-044): what a teacher composes for
 * a class and a report period, kept in her browser only (`localStorage`), never sent to our
 * servers or to the AI. Per student id (never the name): the wording, the grade in a combined
 * class, her notes, and per subject the mark, the chosen entries and the comment, in template
 * form: the student's first name written `{prénom}` and every other first name of the class
 * `{élève:…}` (`unfillDraftText`); other names the teacher types stay as typed.
 *
 * Read tolerantly (post-MVP review): one unreadable comment or student is left out, a field out of
 * range takes its default and a text too long is clipped, so one bad entry never costs the
 * class's other comments.
 */
import {
  COMMENT_FORMS,
  LEARNING_SKILL_RATINGS,
  LEARNING_SKILLS,
  PROGRESS_MARKS,
  clipDraftText,
  commentLength,
  fillDraftText,
  type RosterName,
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

/**
 * What a teacher may type: « Mes notes » up to 4,000 characters, a comment up to twice its
 * « Limite de caractères » and at least 4,000 (`commentMaxLength`).
 */
export const REPORT_NOTES_MAX = 4_000;
export const REPORT_COMMENT_MIN_MAX = 4_000;

export function commentMaxLength(limit: number): number {
  return Math.max(2 * limit, REPORT_COMMENT_MIN_MAX);
}

/**
 * What a stored text may hold: `{prénom}` and `{élève:…}` take more room than a name, so a text
 * typed at its limit always fits. Longer is clipped when read and when written.
 */
export const STORED_TEXT_MAX = 60_000;

const storedText = z
  .string()
  .transform((text) => clipDraftText(text, STORED_TEXT_MAX))
  .catch('');

const pickSchema = z.object({
  itemId: z.uuid(),
  revision: z.number().int().min(1),
  index: z.number().int().min(0).max(159),
});

const commentSchema = z.object({
  level: z.number().int().min(1).max(4).nullable().catch(null),
  progress: z.enum(PROGRESS_MARKS).nullable().catch(null),
  ratings: z.partialRecord(z.enum(LEARNING_SKILLS), z.enum(LEARNING_SKILL_RATINGS)).catch({}),
  picks: z.array(pickSchema).max(160).catch([]),
  /** Template form: `{prénom}` for the student's first name, `{élève:…}` for a classmate's. */
  text: storedText,
  /** The teacher changed the text by hand: new picks ask before replacing it. */
  edited: z.boolean().catch(false),
});

/** A subject's key: a subject's id or `learning_skills`. */
const subjectKey = z.string().min(1).max(64);

const studentSchema = z.object({
  /** A combined class: the student's grade (device only). */
  gradeCode: z.string().max(4).nullable().catch(null),
  form: z.enum(COMMENT_FORMS).catch('neutral'),
  /** « Mes notes », in template form. */
  notes: storedText,
  /** By subject key: each comment read on its own (an unreadable one is left out). */
  comments: z
    .record(z.string(), z.unknown())
    .catch({})
    .transform((raw) => {
      const comments: Record<string, z.output<typeof commentSchema>> = {};
      for (const [key, value] of Object.entries(raw)) {
        const comment = commentSchema.safeParse(value);
        if (subjectKey.safeParse(key).success && comment.success) comments[key] = comment.data;
      }
      return comments;
    }),
});

const studentId = z.uuid();

export const reportDraftSchema = z.object({
  v: z.literal(1),
  /** The last day it is kept (60 days after the « remise », `draftExpiresOn`). */
  expiresOn: z.string().refine(isLocalDate),
  limit: z
    .number()
    .int()
    .min(COMMENT_LIMIT_MIN)
    .max(COMMENT_LIMIT_MAX)
    .catch(COMMENT_LIMIT_DEFAULT),
  /** « Espaces simples à la copie » (on by default, **Assumption**). */
  plainSpaces: z.boolean().catch(true),
  /** By student id: each student read on its own (an unreadable one is left out). */
  students: z
    .record(z.string(), z.unknown())
    .catch({})
    .transform((raw) => {
      const students: Record<string, z.output<typeof studentSchema>> = {};
      for (const [id, value] of Object.entries(raw)) {
        const student = studentSchema.safeParse(value);
        if (studentId.safeParse(id).success && student.success) students[id] = student.data;
      }
      return students;
    }),
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

/**
 * A stored draft, or null when it is not one (not an object, another version, no expiry date).
 * Inside one, an unreadable student or comment is left out and the rest is kept.
 */
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
 * copied, with the first names (the student's and her classmates').
 */
export function commentStatus(
  comment: ReportDraftComment | undefined,
  firstName: string,
  limit: number,
  classmates: readonly RosterName[] = [],
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
  const length = commentLength(fillDraftText(text, firstName, classmates));
  return length > limit
    ? { kind: 'over', length, over: length - limit }
    : { kind: 'ready', length };
}

/**
 * The students the draft holds anything for (a comment, a mark, entries or notes, and in a
 * combined class her grade, or a wording other than the neutral one): what the device keeps.
 */
export function studentsWithWork(draft: ReportDraft): string[] {
  return Object.entries(draft.students)
    .filter(
      ([, s]) =>
        s.notes.trim() !== '' ||
        s.gradeCode !== null ||
        s.form !== 'neutral' ||
        Object.values(s.comments).some((c) => commentStatus(c, '', 1).kind !== 'todo'),
    )
    .map(([id]) => id);
}
