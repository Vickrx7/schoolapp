/**
 * What a library PDF prints (`/library/items/[id]/pdf?doc=student|teacher&v=<ids>`, DECISIONS
 * D-062, D-075, D-042): the same documents as the print page, one per page (a long one runs over
 * several), each with its small version number and never a level name.
 *
 * - « Feuille de l’élève » (`doc=student`): each chosen version's student sheet. It is built from
 *   what `loadItemForStudentSheet` reads, which never touches the answer keys, and
 *   `buildStudentPdfModel` takes no key: a key cannot reach a student's copy.
 * - « Guide et corrigé » (`doc=teacher`): the guide once, then « Corrigé — version n » for each
 *   chosen version (staff only, like the item page's « Guide et corrigé »).
 *
 * The document properties and the file name are the item's title and the document, in French like
 * the documents; the file name also has the chosen version numbers when only some are printed.
 * Pure and not server-only, so it can be unit tested.
 */
import { TYPE_INFO, type DocLang, type RenderedDoc } from '@lynx/content';
import {
  studentVersionDocs,
  teacherVersionDocs,
  type StoredVersion,
  type StudentDocSource,
} from '../library/item-docs';
import {
  parsePrintParams,
  type LibraryItemView,
  type LibraryVersionView,
  type PrintDoc,
} from '../library/view-model';

export type LibraryPdfDoc = PrintDoc;

export interface LibraryPdfPage {
  key: string;
  doc: RenderedDoc;
}

export interface LibraryPdfModel {
  doc: LibraryPdfDoc;
  /** Document properties: the item's title (and « Guide et corrigé » for the teacher's copy). */
  info: { title: string; language: DocLang };
  /** ASCII only, never a level name: `le-huard-oiseau-des-lacs-eleves.pdf`. */
  fileName: string;
  /** Each starts a page; empty when no chosen version can be read (the route says so instead). */
  pages: LibraryPdfPage[];
  /** Something stored could not be read. Never printed: the item page says it. */
  partial: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The PDF of an item for some of its versions (all of them when none are given). Opened through
 * a plain link (`PdfLink`), which adds `download=1` to save the file (D-053).
 */
export function libraryPdfHref(
  itemId: string,
  doc: LibraryPdfDoc,
  versionIds: readonly string[] = [],
): string {
  // Ids are hex and dashes: the list reads as it is, commas included (as `printHref`).
  const ids = versionIds.filter((v) => UUID.test(v));
  return `/library/items/${itemId}/pdf?doc=${doc}${ids.length ? `&v=${ids.join(',')}` : ''}`;
}

/**
 * The route's parameters: `doc` (the student sheet when absent) and `v` as on the print page.
 * Null for a document that does not exist (the route answers 404).
 */
export function libraryPdfRequest(url: URL): { doc: LibraryPdfDoc; versionIds: string[] } | null {
  const doc = url.searchParams.get('doc') ?? 'student';
  if (doc !== 'student' && doc !== 'teacher') return null;
  const { versionIds } = parsePrintParams({ v: url.searchParams.getAll('v') });
  return { doc, versionIds };
}

/** The title as a file name: lower-case ASCII words joined by dashes, at most 60 characters. */
export function pdfFileSlug(title: string): string {
  const slug = title
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'OE')
    .replace(/æ/g, 'ae')
    .replace(/Æ/g, 'AE')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug || 'ressource';
}

/** `le-huard-eleves.pdf`, `le-huard-guide-corrige-v2-3.pdf` (versions 2 and 3 only). */
export function libraryPdfFileName(
  title: string,
  document: 'eleves' | 'guide' | 'guide-corrige',
  numbers: readonly number[] | null,
): string {
  const versions = numbers?.length ? `-v${numbers.join('-')}` : '';
  return `${pdfFileSlug(title)}-${document}${versions}.pdf`;
}

/** The versions printed are some, not all, of the item's: say which in the file name. */
const someOf = (numbers: number[], totalVersions: number) =>
  numbers.length < totalVersions ? numbers : null;

export interface StudentPdfSource extends StudentDocSource {
  /** The chosen versions, in version order (`loadItemForStudentSheet`). */
  versions: readonly (StoredVersion & { id: string })[];
}

/**
 * « Feuille de l’élève »: one sheet per chosen version. Empty for the types that have no student
 * sheet (`lesson_plan`, `teacher_guide`): the route prints their guide instead.
 */
export function buildStudentPdfModel(
  source: StudentPdfSource,
  totalVersions: number,
): LibraryPdfModel {
  const pages: LibraryPdfPage[] = [];
  let partial = false;
  for (const version of source.versions) {
    const docs = studentVersionDocs(source, version);
    partial ||= docs.partial;
    if (docs.student) pages.push({ key: version.id, doc: docs.student });
  }
  const title = source.title.trim();
  return {
    doc: 'student',
    info: { title, language: 'fr-CA' },
    fileName: libraryPdfFileName(
      title,
      'eleves',
      someOf(
        source.versions.map((v) => v.number),
        totalVersions,
      ),
    ),
    pages,
    partial,
  };
}

/**
 * « Guide et corrigé »: the guide of the first chosen version that can be read, then each chosen
 * version's key on its own pages (for the types that may carry one), as on the print page.
 */
export function buildTeacherPdfModel(
  item: LibraryItemView,
  versions: readonly LibraryVersionView[],
  keys: ReadonlyMap<string, unknown>,
): LibraryPdfModel {
  const guide: LibraryPdfPage[] = [];
  const answerKeys: LibraryPdfPage[] = [];
  let partial = false;
  for (const version of versions) {
    const docs = teacherVersionDocs(item, version, keys.get(version.id));
    partial ||= docs.partial;
    if (!guide.length && docs.teacher)
      guide.push({ key: `${version.id}:guide`, doc: docs.teacher });
    if (docs.answerKey) answerKeys.push({ key: `${version.id}:key`, doc: docs.answerKey });
  }
  const title = item.title.trim();
  const withKeys = TYPE_INFO[item.type].mayHaveQuestions;
  return {
    doc: 'teacher',
    info: { title: `${title} — ${withKeys ? 'Guide et corrigé' : 'Guide'}`, language: 'fr-CA' },
    fileName: libraryPdfFileName(
      title,
      withKeys ? 'guide-corrige' : 'guide',
      someOf(
        versions.map((v) => v.number),
        item.versions.length,
      ),
    ),
    pages: [...guide, ...answerKeys],
    partial,
  };
}
