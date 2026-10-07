/**
 * « Avant de marquer comme révisée » (DECISIONS D-067): what an item needs before it can be
 * marked reviewed, and before board approval. SQL checks the same metadata
 * (`app.library_assert_ready`, `LXL01`/`LXL02`); the `final` schemas and key completeness are
 * checked here only, since SQL cannot run Zod. Every problem is listed, not just the first.
 * A type that is not teaching material (the comment bank, D-129) needs no duration or
 * materials, and its subject follows its scope (`scope`).
 */
import { validateAnswerKey, type KeyIssueCode } from './answer-key';
import { TYPE_INFO, type LibraryItemType } from './catalog';
import { parseAnswerKey, parseVersionContent } from './parse';
import { questionsOf, type ContentPath } from './questions-of';
import { safetyNotesComplete } from './safety';
import { entryQualifierProblems } from './report-comments';
import { contentSchema } from './schemas';

export type ReadinessBlockingCode =
  | 'grades'
  | 'subject'
  | 'duration'
  | 'materials'
  | 'tags'
  | 'base'
  | 'expectations'
  | 'key'
  | 'safety'
  | 'content'
  | 'levels'
  | 'scope';
export type ReadinessWarningCode = 'sampleAnswer' | 'subNotes' | 'baseOnly' | 'qualifier';

export interface ReadinessIssue<C extends string = ReadinessBlockingCode | ReadinessWarningCode> {
  code: C;
  /** The version concerned (index in `versions`). */
  versionIndex?: number;
  /** Where in the content or key (`content`: the first failing path). */
  path?: ContentPath;
  questionId?: string;
  /** `key`: what is wrong with it. */
  keyIssue?: KeyIssueCode | 'missingKey';
  /** `levels`: the board level without a version. */
  levelId?: string;
}

export interface ReadinessItem {
  type: LibraryItemType;
  gradeCodes: readonly string[];
  subjectId: string | null;
  /**
   * The subject's code, for a comment bank's scope (religion is `ere`, a subject is not).
   * Undefined when the caller does not know it: that part of the check is skipped.
   */
  subjectCode?: string | null;
  durationMinutes: number | null;
  materials: string | null;
  keywords: string | null;
  tagIds: readonly string[];
  expectationIds: readonly string[];
  safetyNotes: unknown;
  subFriendly: boolean;
}

export interface ReadinessVersion {
  /** Null for the base version. */
  languageLevelId: string | null;
  content: unknown;
  answerKey: unknown;
}

export interface ReadinessInput {
  item: ReadinessItem;
  versions: readonly ReadinessVersion[];
  /** The board's active board-wide levels (not personal ones). */
  boardLevelIds: readonly string[];
  forApproval: boolean;
}

export interface Readiness {
  ready: boolean;
  blocking: ReadinessIssue<ReadinessBlockingCode>[];
  warnings: ReadinessIssue<ReadinessWarningCode>[];
}

const blank = (value: string | null | undefined) => !value || !value.trim();

export function reviewReadiness({
  item,
  versions,
  boardLevelIds,
  forApproval,
}: ReadinessInput): Readiness {
  const info = TYPE_INFO[item.type];
  const blocking: ReadinessIssue<ReadinessBlockingCode>[] = [];
  const warnings: ReadinessIssue<ReadinessWarningCode>[] = [];

  const base = versions.find((v) => v.languageLevelId === null);
  // A comment bank's scope: learning skills have no subject, religion is `ere`, a subject is not.
  const scope =
    item.type === 'report_comments'
      ? (base?.content as { scope?: unknown } | undefined)?.scope
      : undefined;

  if (!item.gradeCodes.length) blocking.push({ code: 'grades' });
  if (!item.subjectId && scope !== 'learning_skills') blocking.push({ code: 'subject' });
  if (item.type === 'report_comments') {
    const code = item.subjectCode;
    const wrong =
      scope === 'learning_skills'
        ? item.subjectId !== null
        : item.subjectId !== null &&
          code !== undefined &&
          (scope === 'religion' ? code !== 'ere' : code === 'ere');
    if (wrong) blocking.push({ code: 'scope' });
  }
  if (info.teachingMaterial) {
    if (item.durationMinutes == null) blocking.push({ code: 'duration' });
    if (blank(item.materials)) blocking.push({ code: 'materials' });
  }
  if (blank(item.keywords) && !item.tagIds.length) blocking.push({ code: 'tags' });
  if (!versions.some((v) => v.languageLevelId === null)) blocking.push({ code: 'base' });
  if (!info.expectationsOptional && !item.expectationIds.length) {
    blocking.push({ code: 'expectations' });
  }

  versions.forEach((version, versionIndex) => {
    const final = contentSchema(item.type, 'final').safeParse(version.content);
    if (!final.success) {
      blocking.push({
        code: 'content',
        versionIndex,
        path: (final.error.issues[0]?.path ?? []) as ContentPath,
      });
    }
    const parsed = parseVersionContent(item.type, version.content);
    if (!parsed.ok) return;
    if (item.type === 'report_comments') {
      const entries = (parsed.content as { entries?: unknown }).entries;
      (Array.isArray(entries) ? entries : []).forEach((entry, i) => {
        if (entryQualifierProblems(entry as Parameters<typeof entryQualifierProblems>[0]).length) {
          warnings.push({ code: 'qualifier', versionIndex, path: ['entries', i] });
        }
      });
    }
    const questions = questionsOf(item.type, parsed.content);
    const key = version.answerKey == null ? null : parseAnswerKey(version.answerKey);
    if (!key || !key.ok) {
      if (info.keyed || questions.length) {
        blocking.push({ code: 'key', versionIndex, keyIssue: 'missingKey' });
      }
      return;
    }
    for (const issue of validateAnswerKey(item.type, parsed.content, key.key)) {
      blocking.push({
        code: 'key',
        versionIndex,
        path: issue.path,
        keyIssue: issue.code,
        ...(issue.questionId ? { questionId: issue.questionId } : {}),
      });
    }
    for (const entry of key.key.answers) {
      if (entry.kind === 'short_answer' && blank(entry.sampleAnswer)) {
        warnings.push({ code: 'sampleAnswer', versionIndex, questionId: entry.questionId });
      }
    }
  });

  if (info.needsSafety && !safetyNotesComplete(item.safetyNotes)) blocking.push({ code: 'safety' });

  const levelIds = new Set(versions.flatMap((v) => (v.languageLevelId ? [v.languageLevelId] : [])));
  if (forApproval && info.levelsForApproval) {
    for (const levelId of boardLevelIds) {
      if (!levelIds.has(levelId)) blocking.push({ code: 'levels', levelId });
    }
  }
  if (info.levelable && !levelIds.size && !blocking.some((b) => b.code === 'levels')) {
    warnings.push({ code: 'baseOnly' });
  }

  if (item.type === 'lesson_plan' && item.subFriendly) {
    const subNotes = (base?.content as { subNotes?: unknown } | undefined)?.subNotes;
    if (typeof subNotes !== 'string' || blank(subNotes)) warnings.push({ code: 'subNotes' });
  }

  return { ready: blocking.length === 0, blocking, warnings };
}
