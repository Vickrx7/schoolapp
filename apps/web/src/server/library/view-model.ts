/**
 * What the library's screens receive (DECISIONS D-061 to D-079): the item page's view, search
 * cards, the lesson a resource is being chosen for, and the small rules the screens share (the
 * order and numbers of versions, who may edit, which badges show, the print page's address).
 * Pure: no server-only import, so the rules are unit-tested and client components can use the
 * types. Loaded by `server/queries/library.ts`.
 */
import {
  TYPE_INFO,
  type ItemFormats,
  type LibraryBucket,
  type LibraryItemType,
} from '@lynx/content';
import type { LibraryItemStatus, LibrarySource, ShareScope } from '@lynx/db';
import type { ItemStats } from './growth';

/** The user's own designation by a board (`library_reviewers`, D-064). */
export interface LibraryReviewerRole {
  boardId: string;
  approvesContent: boolean;
  reviewsFaith: boolean;
}

export type ReviewerKind = 'content' | 'faith';

export interface LibraryVersionView {
  id: string;
  /** Null for the base version. */
  languageLevelId: string | null;
  /**
   * The level's name, on screen for staff only (never printed, D-042). Null for the base version
   * and for a level the user cannot read (a colleague's personal level).
   */
  levelLabel: string | null;
  /** One of the author's own personal levels (D-066: keeps the item private). */
  personalLevel: boolean;
  /** The small number printed on sheets: 1 for the base version, then `versionOrder`. */
  number: number;
  schemaVersion: number;
  /** As stored; screens read it with `parseVersionContent` (it may fail the schemas). */
  content: unknown;
  hasKey: boolean;
}

export interface LibraryExpectationView {
  id: string;
  code: string;
  /** In the interface language when the curriculum has it. */
  text: string;
  /** Documents are in the content's language, French (D-075). */
  textFr: string;
  /** « À vérifier » while false (D-030). */
  verified: boolean;
  kind: 'overall' | 'specific';
}

export interface LibraryItemView {
  id: string;
  boardId: string;
  schoolId: string | null;
  /** Null when the user cannot see the school (another school of the board). */
  schoolName: string | null;
  type: LibraryItemType;
  bucket: LibraryBucket;
  title: string;
  summary: string | null;
  status: LibraryItemStatus;
  shareScope: ShareScope;
  source: LibrarySource;
  /** Waiting for board approval (« En attente d’approbation »). */
  requested: boolean;
  /** The user wrote it. */
  mine: boolean;
  /** The board's own item (`board_owned`: no author), kept by its content reviewers (D-091). */
  boardOwn: boolean;
  /** « Mme Tremblay »; null for the board's own items and authors the user cannot see. */
  authorName: string | null;
  subject: { id: string; code: string; label: string; labelFr: string } | null;
  grades: { code: string; label: string; labelFr: string }[];
  expectations: LibraryExpectationView[];
  tags: { id: string; label: string }[];
  keywords: string | null;
  durationMinutes: number | null;
  materials: string | null;
  licence: string | null;
  formats: ItemFormats;
  subFriendly: boolean;
  /** As stored (experiments and STEM challenges, D-067); the teacher document renders it. */
  safetyNotes: unknown;
  faith: {
    /** « Contient du contenu de foi », ticked by the author or flagged by a reviewer. */
    content: boolean;
    connection: string | null;
    referenceId: string | null;
    referenceTitle: string | null;
    /** « Afficher le lien sur la feuille de l’élève ». */
    onStudentSheet: boolean;
    /** A faith review applies before the whole board sees it (D-064). */
    requiresReview: boolean;
    reviewed: boolean;
  };
  provenance: {
    /** The AI feature and prompt version (`library_item/v1`); the feature only when readable. */
    aiFeature: string | null;
    promptVersion: string | null;
    model: string | null;
    packTitle: string | null;
    packVersion: string | null;
    createdAt: string;
    updatedAt: string;
    approvedAt: string | null;
    /** The number of units whose lessons link the item (D-076). */
    usageCount: number;
  };
  /** Sent with every save and decision (`LXL07` when it moved on). */
  contentRevision: number;
  /** The author, or a content reviewer for the board's own items, while not approved (D-063). */
  canEdit: boolean;
  /** The kinds of review the user holds for the item's board. */
  reviewerKinds: ReviewerKind[];
  /** Review state and the reviewer's note: shown to the item's keeper and to reviewers only. */
  review: {
    requestedAt: string | null;
    note: string | null;
    faithReviewedAt: string | null;
    /** A reviewer flagged faith content the author had not ticked. */
    faithFlagged: boolean;
  } | null;
  /** In `versionOrder`: the base version first. */
  versions: LibraryVersionView[];
  /** Whether any version has an answer key (staff views only, D-062). */
  hasKeys: boolean;
  /** « Adapter » (D-092). */
  adaptation: {
    /** Adapted from another resource (the credit line is loaded by the lineage slot). */
    isAdaptation: boolean;
    /**
     * An adaptation of a resource shared with one school may be shared at most with that school
     * (null: no cap).
     */
    shareCapSchoolId: string | null;
    /** Its licence forbids adapting it (a content pack's choice). */
    noDerivatives: boolean;
  };
}

/** A search result (`public.search_library`, S4), as the cards show it. */
export interface LibraryCardView {
  id: string;
  type: LibraryItemType;
  bucket: LibraryBucket;
  title: string;
  /** At most 200 characters. */
  summary: string | null;
  status: LibraryItemStatus;
  source: LibrarySource;
  durationMinutes: number | null;
  subFriendly: boolean;
  formats: ItemFormats;
  requiresFaithReview: boolean;
  mine: boolean;
  gradeCodes: string[];
  /** Levels with a version (board levels and the user's own). */
  levelIds: string[];
  updatedAt: string;
  /** Opinions and usage (D-093), loaded for the page of results; absent when they failed. */
  stats?: ItemStats | null;
}

/**
 * The lesson a resource is being chosen for, from Planification's « Joindre une ressource »
 * (`/library?attachTo=<lessonId>`): « Vous choisissez une ressource pour la leçon 4 « … » ».
 */
export interface AttachTarget {
  lessonId: string;
  lessonTitle: string;
  sequenceNumber: number;
  unitId: string;
  unitTitle: string;
  classId: string;
  subjectId: string | null;
  expectationIds: string[];
}

// ---------------------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------------------

export interface VersionOrderInput {
  id: string;
  languageLevelId: string | null;
  /** Null for the base version, or for a level the user cannot read. */
  level: { sortOrder: number; personal: boolean } | null;
}

/**
 * The base version first, then board levels, then the author's personal levels (each by their
 * configured order), then levels the user cannot read; ties by id so the order never changes
 * between loads. Each version gets its printed number: 1 for the first, and so on. The same
 * numbers are used on the item page, the print page and in PDFs, so « 2 » is always the same
 * version of an item.
 */
export function versionOrder<T extends VersionOrderInput>(
  versions: readonly T[],
): (T & {
  number: number;
})[] {
  const rank = (v: T) =>
    v.languageLevelId === null ? 0 : v.level === null ? 3 : v.level.personal ? 2 : 1;
  return [...versions]
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (a.level?.sortOrder ?? 0) - (b.level?.sortOrder ?? 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .map((v, i) => ({ ...v, number: i + 1 }));
}

// ---------------------------------------------------------------------------------------
// Who may do what (mirrors app.library_item_editable_by and app.library_reviewer, D-063–D-065)
// ---------------------------------------------------------------------------------------

export interface AccessInput {
  boardId: string;
  authorId: string | null;
  /** The board's own item (`board_owned`, D-091). */
  boardOwned: boolean;
  status: LibraryItemStatus;
}

export interface LibraryAccess {
  mine: boolean;
  /** The author, or a content reviewer of the board for the board's own items (no author). */
  keeper: boolean;
  canEdit: boolean;
  reviewerKinds: ReviewerKind[];
}

const EDITABLE_STATUSES: readonly LibraryItemStatus[] = ['draft', 'teacher_reviewed', 'rejected'];

/**
 * What the screens offer the user for an item. The database decides in the end (every write is
 * a function that checks again); this only hides actions that would be refused.
 */
export function libraryAccess(
  item: AccessInput,
  userId: string,
  reviewer: readonly LibraryReviewerRole[],
): LibraryAccess {
  const role = reviewer.find((r) => r.boardId === item.boardId);
  const reviewerKinds: ReviewerKind[] = [
    ...(role?.approvesContent ? (['content'] as const) : []),
    ...(role?.reviewsFaith ? (['faith'] as const) : []),
  ];
  const mine = item.authorId !== null && item.authorId === userId;
  const boardOwn = item.boardOwned && item.authorId === null && reviewerKinds.includes('content');
  const keeper = mine || boardOwn;
  return {
    mine,
    keeper,
    canEdit: keeper && EDITABLE_STATUSES.includes(item.status),
    reviewerKinds,
  };
}

// ---------------------------------------------------------------------------------------
// Badges (text, never colour alone: D-034)
// ---------------------------------------------------------------------------------------

export type ItemBadgeKey =
  | 'approved'
  | 'requested'
  | 'draft'
  | 'teacher_reviewed'
  | 'rejected'
  | 'archived'
  | 'subFriendly'
  | 'levels'
  | 'baseOnly'
  | 'ai'
  | 'faith';

export interface ItemBadge {
  key: ItemBadgeKey;
  tone: 'neutral' | 'brand' | 'success' | 'warning' | 'danger';
  /** `levels`: the number of level versions. */
  count?: number;
}

export interface BadgeInput {
  type: LibraryItemType;
  status: LibraryItemStatus;
  requested: boolean;
  source: LibrarySource;
  subFriendly: boolean;
  requiresFaithReview: boolean;
  /** Versions for a language level (the base version not counted). */
  levelCount: number;
}

/**
 * The badges of an item, in display order: « Approuvée par le conseil » first, the workflow
 * status when asked (the item page and the author's own cards), then « Suppléance », the levels
 * (« 4 niveaux », or « Version de base seulement » for a type that has levels), « IA » and
 * « Foi ».
 */
export function itemBadges(
  input: BadgeInput,
  { withStatus }: { withStatus: boolean },
): ItemBadge[] {
  const badges: ItemBadge[] = [];
  if (input.status === 'board_approved') badges.push({ key: 'approved', tone: 'success' });
  if (withStatus && input.status !== 'board_approved') {
    const tone: ItemBadge['tone'] =
      input.status === 'rejected'
        ? 'warning'
        : input.status === 'teacher_reviewed'
          ? 'brand'
          : 'neutral';
    badges.push({ key: input.status, tone });
    if (input.requested) badges.push({ key: 'requested', tone: 'brand' });
  }
  if (input.subFriendly) badges.push({ key: 'subFriendly', tone: 'brand' });
  if (input.levelCount > 0)
    badges.push({ key: 'levels', tone: 'neutral', count: input.levelCount });
  else if (TYPE_INFO[input.type].levelable) badges.push({ key: 'baseOnly', tone: 'neutral' });
  if (input.source === 'ai_generated') badges.push({ key: 'ai', tone: 'neutral' });
  if (input.requiresFaithReview) badges.push({ key: 'faith', tone: 'neutral' });
  return badges;
}

// ---------------------------------------------------------------------------------------
// The print page's address (`/library/items/[id]/print?doc=student|teacher&v=<ids>`)
// ---------------------------------------------------------------------------------------

export type PrintDoc = 'student' | 'teacher';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Her own text saved from « Texte différencié » (DECISIONS D-073, D-078): a teacher whose school
 * has AI but not the Library module can still open it, print it, download it and delete it
 * (Phase 2's saved texts), without the library's other screens and actions.
 */
export function isSavedDifferentiation(
  item: Pick<LibraryItemView, 'mine' | 'source' | 'provenance'>,
): boolean {
  return (
    item.mine && item.source === 'ai_generated' && item.provenance.aiFeature === 'differentiate'
  );
}

/** The print page of an item for some of its versions (all of them when none are given). */
export function printHref(itemId: string, doc: PrintDoc, versionIds: readonly string[] = []) {
  // Ids are hex and dashes: the list reads as it is, commas included.
  const ids = versionIds.filter((v) => UUID.test(v));
  return `/library/items/${itemId}/print?doc=${doc}${ids.length ? `&v=${ids.join(',')}` : ''}`;
}

/**
 * Reads the print page's parameters: `doc` (student unless « teacher »), and `v` as one
 * comma-separated value or repeated. Anything that is not an id is dropped, and duplicates too.
 */
export function parsePrintParams(params: { doc?: string | string[]; v?: string | string[] }): {
  doc: PrintDoc;
  versionIds: string[];
} {
  const doc =
    (Array.isArray(params.doc) ? params.doc[0] : params.doc) === 'teacher' ? 'teacher' : 'student';
  const raw = Array.isArray(params.v) ? params.v : params.v ? [params.v] : [];
  const versionIds = [
    ...new Set(
      raw
        .flatMap((v) => v.split(','))
        .map((v) => v.trim().toLowerCase())
        .filter((v) => UUID.test(v)),
    ),
  ];
  return { doc, versionIds };
}

/**
 * The versions to print, in version order: those asked for that belong to the item, else every
 * version.
 */
export function selectVersions<T extends { id: string }>(
  versions: readonly T[],
  wanted: readonly string[],
): T[] {
  const chosen = versions.filter((v) => wanted.includes(v.id));
  return chosen.length ? chosen : [...versions];
}
