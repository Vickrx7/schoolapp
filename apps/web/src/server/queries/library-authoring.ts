import 'server-only';
import { TYPE_INFO, isLibraryItemType, type LibraryItemType } from '@lynx/content';
import type { LibraryItemStatus, ShareScope } from '@lynx/db';
import { cache } from 'react';
import { localized } from '@/i18n/config';
import { reportError } from '../errors';
import type { EditorContext, EditorExpectation, EditorLevel } from '../library/editor-context';
import { librarySchools, type SessionContext } from '../session';
import { createSupabaseServerClient } from '../supabase';
import { loadLibrarySearchOptions } from './library-search';

/**
 * Writing library resources and moving them through review (DECISIONS D-063 to D-067): the
 * editor's choices, « Mes ressources » and « Approbation des ressources ». Everything is read
 * as the user, under row level security: levels, tags and Catholic references of the user's
 * boards, the user's own items, and the review queues through `library_review_queue`, which
 * answers only to designated reviewers.
 */

export type { EditorContext, EditorExpectation, EditorLevel } from '../library/editor-context';

/**
 * The attentes of some grades in a subject, for the editor's picker: grouped later by grade and
 * domaine, overall attentes before their specific ones. At most 4 grades (an item's limit).
 */
export async function loadExpectations(
  gradeCodes: readonly string[],
  subjectId: string | null,
  locale: string,
): Promise<EditorExpectation[]> {
  if (!subjectId || !gradeCodes.length) return [];
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('curriculum_expectations')
    .select(
      'id, grade_code, parent_id, kind, code, text_fr, text_en, is_verified, sort_order, strands(id, code, label_fr, label_en, sort_order)',
    )
    .eq('subject_id', subjectId)
    .in('grade_code', gradeCodes.slice(0, 4))
    .order('sort_order')
    .limit(1000);
  if (error) reportError('loadExpectations', error);
  return (data ?? []).map((e) => ({
    id: e.id,
    gradeCode: e.grade_code,
    parentId: e.parent_id,
    kind: e.kind,
    code: e.code,
    text: localized(locale, e.text_fr, e.text_en),
    verified: e.is_verified,
    sortOrder: e.sort_order,
    strand: e.strands
      ? {
          id: e.strands.id,
          code: e.strands.code,
          label: localized(locale, e.strands.label_fr, e.strands.label_en),
          sortOrder: e.strands.sort_order,
        }
      : null,
  }));
}

/**
 * Everything the editor offers for an item of a board: the user's library schools, grades and
 * subjects, the board's levels (and the user's own), the curated tags (global and the board's),
 * the Catholic references (the board's and global ones, by title) and the attentes of the
 * item's grades and subject.
 */
export async function loadEditorContext(
  session: SessionContext,
  locale: string,
  {
    boardId,
    gradeCodes,
    subjectId,
  }: { boardId: string; gradeCodes: string[]; subjectId: string | null },
): Promise<EditorContext> {
  const supabase = await createSupabaseServerClient();
  const [options, tags, references, expectations] = await Promise.all([
    loadLibrarySearchOptions(session, locale),
    supabase.from('tags').select('id, board_id, slug, label_fr').order('label_fr'),
    supabase
      .from('catholic_references')
      .select('id, board_id, type, title, grade_min, grade_max')
      .eq('active', true)
      .order('title'),
    loadExpectations(gradeCodes, subjectId, locale),
  ]);
  const levels: EditorLevel[] = options.levels
    .filter((l) => l.boardId === boardId)
    .map((l) => ({
      id: l.id,
      label: l.label,
      description: l.description,
      personal: l.personal,
      active: l.active,
    }));
  return {
    userId: session.userId,
    schools: librarySchools(session).map((s) => ({ id: s.id, name: s.name, boardId: s.boardId })),
    grades: options.grades,
    subjects: options.subjects,
    anglaisStartGrade: options.anglaisStartGrade,
    myGrades: options.myGrades,
    levels,
    tags: (tags.data ?? [])
      .filter((t) => t.board_id === null || t.board_id === boardId)
      .map((t) => ({ id: t.id, label: t.label_fr }))
      .sort((a, b) => a.label.localeCompare(b.label, 'fr-CA')),
    references: (references.data ?? [])
      .filter((r) => r.board_id === null || r.board_id === boardId)
      .map((r) => ({
        id: r.id,
        title: r.title,
        type: r.type,
        gradeMin: r.grade_min,
        gradeMax: r.grade_max,
      }))
      .sort((a, b) => a.title.localeCompare(b.title, 'fr-CA')),
    expectations,
  };
}

// ---------------------------------------------------------------------------------------
// « Mes ressources »
// ---------------------------------------------------------------------------------------

export const MINE_TABS = [
  'drafts',
  'reviewed',
  'shared',
  'approved',
  'rework',
  'archived',
] as const;
export type MineTab = (typeof MINE_TABS)[number];

export interface MineItem {
  id: string;
  type: LibraryItemType;
  title: string;
  status: LibraryItemStatus;
  shareScope: ShareScope;
  requested: boolean;
  /** The reviewer's note (« À retravailler »). */
  reviewNote: string | null;
  source: 'teacher_created' | 'ai_generated' | 'board_created';
  gradeCodes: string[];
  updatedAt: string;
}

export interface OpenAiRequest {
  id: string;
  feature: string;
  status: 'queued' | 'running';
  createdAt: string;
  /** The item a « versions par niveau » request is for. */
  itemId: string | null;
}

export interface MyLibrary {
  items: MineItem[];
  /** AI requests still being prepared (« En préparation »). */
  preparing: OpenAiRequest[];
}

/** Which tab of « Mes ressources » an item belongs to. */
export function mineTabOf(item: Pick<MineItem, 'status' | 'shareScope'>): MineTab {
  switch (item.status) {
    case 'draft':
      return 'drafts';
    case 'teacher_reviewed':
      return item.shareScope === 'private' ? 'reviewed' : 'shared';
    case 'board_approved':
      return 'approved';
    case 'rejected':
      return 'rework';
    case 'archived':
      return 'archived';
  }
}

/** The user's own resources, newest first, and her open library AI requests. Cached per request. */
export const loadMyLibrary = cache(async (session: SessionContext): Promise<MyLibrary> => {
  const supabase = await createSupabaseServerClient();
  const [items, jobs] = await Promise.all([
    supabase
      .from('library_items')
      .select(
        'id, type, title, status, share_scope, review_requested_at, review_note, source, updated_at, library_item_grades(grade_code)',
      )
      .eq('author_id', session.userId)
      .order('updated_at', { ascending: false })
      .limit(300),
    supabase
      .from('ai_jobs')
      .select('id, feature, status, created_at, input')
      .eq('user_id', session.userId)
      .in('feature', ['library_item', 'library_levels'])
      .in('status', ['queued', 'running'])
      .order('created_at', { ascending: false })
      .limit(20),
  ]);
  if (items.error) reportError('loadMyLibrary', items.error);
  return {
    items: (items.data ?? [])
      .filter((i) => isLibraryItemType(i.type))
      .map((i) => ({
        id: i.id,
        type: i.type,
        title: i.title,
        status: i.status,
        shareScope: i.share_scope,
        requested: i.review_requested_at !== null,
        reviewNote: i.review_note,
        source: i.source,
        gradeCodes: i.library_item_grades.map((g) => g.grade_code).sort(),
        updatedAt: i.updated_at,
      })),
    preparing: (jobs.data ?? []).flatMap((j) =>
      j.status === 'queued' || j.status === 'running'
        ? [
            {
              id: j.id,
              feature: j.feature,
              status: j.status,
              createdAt: j.created_at,
              itemId:
                typeof (j.input as { itemId?: unknown } | null)?.itemId === 'string'
                  ? (j.input as { itemId: string }).itemId
                  : null,
            },
          ]
        : [],
    ),
  };
});

// ---------------------------------------------------------------------------------------
// « Approbation des ressources »
// ---------------------------------------------------------------------------------------

export interface ReviewQueueRow {
  itemId: string;
  title: string;
  type: LibraryItemType;
  contentRevision: number;
  requestedAt: string;
  /** « Mme Tremblay »; null for the board's own items (« Conseil scolaire »). */
  authorName: string | null;
  schoolName: string | null;
  gradeCodes: string[];
  requiresFaithReview: boolean;
  faithReviewed: boolean;
  /** An experiment or a STEM challenge: safety notes to read. */
  safety: boolean;
}

export interface ReviewQueues {
  /** Null when the user does not approve content for any board. */
  content: ReviewQueueRow[] | null;
  /** Null when the user does not review faith content for any board. */
  faith: ReviewQueueRow[] | null;
}

async function queue(kind: 'content' | 'faith'): Promise<ReviewQueueRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('library_review_queue', { p_kind: kind });
  if (error) {
    reportError('loadReviewQueues', error);
    return [];
  }
  return (data ?? [])
    .filter((r) => isLibraryItemType(r.type))
    .map((r) => ({
      itemId: r.item_id,
      title: r.title,
      type: r.type,
      contentRevision: r.content_revision,
      requestedAt: r.requested_at,
      authorName: r.author_name,
      schoolName: r.school_name,
      gradeCodes: r.grade_codes ?? [],
      requiresFaithReview: r.requires_faith_review,
      faithReviewed: r.faith_reviewed,
      safety: TYPE_INFO[r.type].needsSafety,
    }));
}

/** The queues the user reviews (D-064), oldest request first. Cached per request. */
export const loadReviewQueues = cache(async (session: SessionContext): Promise<ReviewQueues> => {
  const content = session.libraryReviewer.some((r) => r.approvesContent);
  const faith = session.libraryReviewer.some((r) => r.reviewsFaith);
  const [contentRows, faithRows] = await Promise.all([
    content ? queue('content') : Promise.resolve(null),
    faith ? queue('faith') : Promise.resolve(null),
  ]);
  return { content: contentRows, faith: faithRows };
});

// ---------------------------------------------------------------------------------------
// Readiness on the item page (« Avant de marquer comme révisée »)
// ---------------------------------------------------------------------------------------

/** The board's active board-wide levels (every one needs a version before approval, D-067). */
export async function loadBoardLevelIds(boardId: string): Promise<string[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('language_levels')
    .select('id')
    .eq('board_id', boardId)
    .is('owner_user_id', null)
    .eq('active', true)
    .order('sort_order');
  return (data ?? []).map((l) => l.id);
}
