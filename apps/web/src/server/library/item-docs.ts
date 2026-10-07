/**
 * The documents of one version of an item (DECISIONS D-062, D-075): the student sheet, the
 * teacher copy (« Guide et corrigé ») and the answer key, each a `RenderedDoc` drawn by
 * `DocView` on screen and on the print page. Stored content may fail the schemas (an older
 * shape, a write that skipped the app): what can be read is rendered and `partial` says the
 * rest could not be (« Une partie de cette ressource ne peut pas être affichée. »).
 *
 * The student sheet takes no key: `studentVersionDocs` has no key parameter, and its loader
 * (`loadItemForStudentSheet`) never reads the key table. Pure, so it is unit-tested.
 */
import {
  CURRENT_SCHEMA_VERSION,
  TYPE_INFO,
  answerKeySchema,
  contentSchema,
  parseAnswerKey,
  parseVersionContent,
  questionsOf,
  renderAnswerKeyDoc,
  renderStudentDoc,
  renderTeacherDoc,
  type LibraryItemType,
  type RenderedDoc,
  type TeacherDocMeta,
} from '@lynx/content';
import type { LibraryItemView } from './view-model';

export interface StoredVersion {
  number: number;
  schemaVersion?: number;
  content: unknown;
}

interface ReadContent {
  content: Record<string, unknown> | null;
  /** Something stored could not be read. */
  partial: boolean;
}

/**
 * The content as the renderers can use it. A version of another schema version, or content
 * that is not this type's, cannot be read at all; content that fails the `draft` schema is read
 * leniently (what has the right shape is kept). Content that only fails `final` (an unfinished
 * draft) is complete as far as it goes: it is not « partial ».
 */
function readContent(type: LibraryItemType, version: StoredVersion): ReadContent {
  if ((version.schemaVersion ?? CURRENT_SCHEMA_VERSION) !== CURRENT_SCHEMA_VERSION) {
    return { content: null, partial: true };
  }
  const parsed = parseVersionContent(type, version.content);
  if (!parsed.ok) return { content: null, partial: true };
  return {
    content: parsed.content as Record<string, unknown>,
    partial: !contentSchema(type, 'draft').safeParse(version.content).success,
  };
}

export interface StudentDocSource {
  type: LibraryItemType;
  title: string;
  faith: { connection: string | null; onStudentSheet: boolean };
}

export interface StudentVersionDocs {
  /** Null for types without a student sheet (`lesson_plan`, `teacher_guide`) or unreadable content. */
  student: RenderedDoc | null;
  partial: boolean;
}

/** The student sheet of a version: no key, no teacher-only field, no level name (D-042). */
export function studentVersionDocs(
  item: StudentDocSource,
  version: StoredVersion,
): StudentVersionDocs {
  const read = readContent(item.type, version);
  if (!read.content) return { student: null, partial: read.partial };
  return {
    student: renderStudentDoc(item.type, read.content, {
      itemTitle: item.title,
      number: version.number,
      faith: item.faith,
    }),
    partial: read.partial,
  };
}

/** What the teacher copy says about the item, in French like the document itself. */
export function teacherDocMeta(item: LibraryItemView, number: number): TeacherDocMeta {
  return {
    itemTitle: item.title,
    number,
    subjectCode: item.subject?.code ?? null,
    subjectLabel: item.subject?.labelFr ?? null,
    gradeLabels: item.grades.map((g) => g.labelFr),
    durationMinutes: item.durationMinutes,
    materials: item.materials,
    expectations: item.expectations.map((e) => ({
      code: e.code,
      text: e.textFr,
      verified: e.verified,
    })),
    safetyNotes: item.safetyNotes,
    faith: item.faith.connection
      ? { connection: item.faith.connection, referenceTitle: item.faith.referenceTitle }
      : null,
  };
}

export interface TeacherVersionDocs {
  teacher: RenderedDoc | null;
  /**
   * « Corrigé — version n »: for types that may carry a key, when the version has questions or
   * a solution (even before its key is written: missing answers say « Réponse à ajouter »).
   */
  answerKey: RenderedDoc | null;
  partial: boolean;
}

/** The teacher copy and the answer key of a version (staff only). */
export function teacherVersionDocs(
  item: LibraryItemView,
  version: StoredVersion,
  rawKey: unknown,
): TeacherVersionDocs {
  const read = readContent(item.type, version);
  if (!read.content) return { teacher: null, answerKey: null, partial: read.partial };
  const teacher = renderTeacherDoc(teacherDocMeta(item, version.number), item.type, read.content);

  let answerKey: RenderedDoc | null = null;
  let keyPartial = false;
  if (TYPE_INFO[item.type].mayHaveQuestions) {
    const parsedKey = rawKey === undefined || rawKey === null ? null : parseAnswerKey(rawKey);
    if (parsedKey && !parsedKey.ok) keyPartial = true;
    if (parsedKey?.ok && !answerKeySchema('draft').safeParse(rawKey).success) keyPartial = true;
    const key = parsedKey?.ok ? parsedKey.key : null;
    const hasQuestions = questionsOf(item.type, read.content).length > 0;
    if (hasQuestions || key?.solution.trim() || TYPE_INFO[item.type].keyed) {
      answerKey = renderAnswerKeyDoc(item.type, read.content, key, {
        number: version.number,
        itemTitle: item.title,
      });
    }
  }
  return { teacher, answerKey, partial: read.partial || keyPartial };
}
