/**
 * The student sheet (DECISIONS D-062, D-075). It takes no answer key, renders from
 * `studentContent` (no teacher-only field can reach it) and never shows a level name: only the
 * small version number (D-042). A sheet students fill in (questions or writing lines) starts
 * with « Nom : ____  Date : ____ », so collected sheets can be told apart.
 */
import type { LibraryItemType } from '../catalog';
import { studentContent } from '../project';
import { str } from './builder';
import { renderContentBlocks } from './content';
import type { DocBlock, LeafBlock, RenderedDoc } from './doc';
import { DOC_LABELS_FR } from './labels-fr';

export interface StudentDocOptions {
  /** Used when the version has no title of its own. */
  itemTitle: string;
  /** The small number printed on the page (1 = base version, 2… = levels). */
  number: number | null;
  /**
   * The item's faith link. It is printed for students only when the author chose
   * « Afficher le lien sur la feuille de l’élève », and always for a Catholic reflection.
   */
  faith?: { connection: string | null; onStudentSheet: boolean } | null;
}

/** Whether students write on the sheet: a question or writing lines, in any section. */
function filledIn(blocks: readonly DocBlock[]): boolean {
  const writes = (b: LeafBlock) => b.type === 'question' || b.type === 'lines';
  return blocks.some((b) => (b.type === 'section' ? b.blocks.some(writes) : writes(b)));
}

/** Null for teacher-only types (`lesson_plan`, `teacher_guide`). */
export function renderStudentDoc(
  type: LibraryItemType,
  content: unknown,
  options: StudentDocOptions,
): RenderedDoc | null {
  const student = studentContent(type, content);
  if (!student) return null;
  const blocks: DocBlock[] = [];
  const objective = str(student.objective);
  if (objective) {
    blocks.push({
      type: 'callout',
      tone: 'info',
      title: DOC_LABELS_FR.objective,
      text: objective,
      items: [],
    });
  }
  const connection = str(options.faith?.connection);
  if (connection && (options.faith?.onStudentSheet || type === 'catholic_reflection')) {
    blocks.push({
      type: 'callout',
      tone: 'faith',
      title: DOC_LABELS_FR.faith,
      text: connection,
      items: [],
    });
  }
  blocks.push(...renderContentBlocks(type, student, 'student'));
  if (filledIn(blocks)) {
    blocks.unshift({ type: 'nameLine', labels: [DOC_LABELS_FR.name, DOC_LABELS_FR.date] });
  }
  return {
    kind: 'student',
    lang: 'fr-CA',
    title: str(student.title) || options.itemTitle.trim(),
    subtitle: '',
    number: options.number,
    blocks,
  };
}
