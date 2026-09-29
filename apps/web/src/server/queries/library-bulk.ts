import 'server-only';
import { isLibraryItemType, type LibraryItemType } from '@lynx/content';
import type { LibraryItemStatus } from '@lynx/db';
import { cache } from 'react';
import { reportError } from '../errors';
import { runSummary, type RunSummary } from '../library/bulk-view';
import type { PackLabel } from '../library/pack-provenance';
import type { SessionContext } from '../session';
import { createSupabaseServerClient } from '../supabase';

/**
 * « Brouillons du conseil » (DECISIONS D-095 to D-097, D-100): the board's own drafts for its
 * content reviewers, those of bulk generation runs grouped by run, then the others (a content
 * pack's resources imported before they were ready, D-100). Read as the user: row level security
 * shows runs and requests to the board's content reviewers only (never their inputs or what was
 * sent), and the drafts are the board's own items, which they read at any status.
 */

/** How many runs the tab lists (the most recent). */
export const BOARD_DRAFT_RUNS = 10;

/** How many board drafts without a run the tab lists (the most recent). */
export const OTHER_BOARD_DRAFTS = 50;

/** Statuses a board draft still has before its approval (or deletion). */
const PENDING: LibraryItemStatus[] = ['draft', 'rejected', 'teacher_reviewed'];

export interface BoardDraftView {
  itemId: string;
  title: string;
  type: LibraryItemType;
  status: LibraryItemStatus;
  /** Proposed to the board (waiting in « À approuver », e.g. for its faith review). */
  requested: boolean;
  gradeCodes: string[];
  /** « Titre semblable à une ressource existante » (D-097). */
  similarTitle: boolean;
  /** The answer holds a first name of a student of the board (a coincidence to check). */
  studentName: boolean;
}

/** A board draft that came from no bulk run, e.g. a pack resource imported before it was ready. */
export interface OtherBoardDraftView {
  itemId: string;
  title: string;
  type: LibraryItemType;
  status: LibraryItemStatus;
  gradeCodes: string[];
  /** « Ensemble : Ressources IP Lynx 2026.2 » when it came from a content pack (D-100). */
  pack: PackLabel | null;
}

export interface BoardDraftRunView {
  id: string;
  status: 'planned' | 'running' | 'completed' | 'cancelled' | 'failed';
  createdAt: string;
  /** Null until the run has ended. */
  summary: RunSummary | null;
  drafts: BoardDraftView[];
}

/** The most recent runs of the boards the user approves content for, with their pending drafts. */
export const loadBoardDraftRuns = cache(
  async (session: SessionContext): Promise<BoardDraftRunView[] | null> => {
    if (!session.libraryReviewer.some((r) => r.approvesContent)) return null;
    const supabase = await createSupabaseServerClient();
    const { data: runs, error } = await supabase
      .from('library_bulk_runs')
      .select('id, status, max_cost_usd, spent_usd, report, created_at')
      .order('created_at', { ascending: false })
      .limit(BOARD_DRAFT_RUNS);
    if (error) {
      reportError('loadBoardDraftRuns', error);
      return null;
    }
    if (!runs?.length) return [];
    const runIds = runs.map((r) => r.id);
    const [requests, items] = await Promise.all([
      supabase
        .from('library_bulk_requests')
        .select('item_id, problems')
        .in('run_id', runIds)
        .eq('status', 'created'),
      supabase
        .from('library_items')
        .select(
          'id, title, type, status, review_requested_at, bulk_run_id, created_at, library_item_grades(grade_code)',
        )
        .in('bulk_run_id', runIds)
        .eq('board_owned', true)
        .in('status', PENDING)
        .order('created_at'),
    ]);
    if (requests.error || items.error) {
      reportError('loadBoardDraftRuns', requests.error ?? items.error);
      return null;
    }
    const problems = new Map(
      (requests.data ?? [])
        .filter((r) => r.item_id !== null)
        .map((r) => [r.item_id as string, r.problems ?? []]),
    );
    return runs.map((run) => ({
      id: run.id,
      status: run.status as BoardDraftRunView['status'],
      createdAt: run.created_at,
      summary: runSummary(run.report, Number(run.max_cost_usd), Number(run.spent_usd)),
      drafts: (items.data ?? [])
        .filter((i) => i.bulk_run_id === run.id && isLibraryItemType(i.type))
        .map((i) => ({
          itemId: i.id,
          title: i.title,
          type: i.type,
          status: i.status,
          requested: i.review_requested_at !== null,
          gradeCodes: i.library_item_grades.map((g) => g.grade_code).sort(),
          similarTitle: problems.get(i.id)?.includes('similar_title') ?? false,
          studentName: problems.get(i.id)?.includes('student_name') ?? false,
        })),
    }));
  },
);

/**
 * The board's own drafts that came from no bulk run and are not proposed yet, most recent first:
 * a content pack's resources that were not ready when imported (D-100) wait here, since no other
 * list shows them. Those proposed to the board are in « À approuver » already.
 */
export const loadOtherBoardDrafts = cache(
  async (session: SessionContext): Promise<OtherBoardDraftView[] | null> => {
    if (!session.libraryReviewer.some((r) => r.approvesContent)) return null;
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('library_items')
      .select(
        'id, title, type, status, created_at, library_item_grades(grade_code), content_packs(title, version)',
      )
      .eq('board_owned', true)
      .is('bulk_run_id', null)
      .is('review_requested_at', null)
      .in('status', PENDING)
      .order('created_at', { ascending: false })
      .order('id')
      .limit(OTHER_BOARD_DRAFTS);
    if (error) {
      reportError('loadOtherBoardDrafts', error);
      return null;
    }
    return (data ?? [])
      .filter((i) => isLibraryItemType(i.type))
      .map((i) => ({
        itemId: i.id,
        title: i.title,
        type: i.type,
        status: i.status,
        gradeCodes: i.library_item_grades.map((g) => g.grade_code).sort(),
        pack: i.content_packs
          ? { title: i.content_packs.title, version: i.content_packs.version }
          : null,
      }));
  },
);

/**
 * What the review page needs for its tab: null (no tab) when there is neither a run nor another
 * board draft to show.
 */
export async function loadBoardDraftsQueue(
  session: SessionContext,
): Promise<{ count: number } | null> {
  const [runs, others] = await Promise.all([
    loadBoardDraftRuns(session),
    loadOtherBoardDrafts(session),
  ]);
  if (!runs?.length && !others?.length) return null;
  return {
    count: (runs ?? []).reduce((n, r) => n + r.drafts.length, 0) + (others?.length ?? 0),
  };
}

/** A board draft's flags from its bulk request (item page), or null when it did not come from one. */
export async function loadBoardDraftFlags(
  itemId: string,
): Promise<{ similarTitle: boolean; studentName: boolean } | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('library_bulk_requests')
    .select('problems')
    .eq('item_id', itemId)
    .maybeSingle();
  if (error) {
    reportError('loadBoardDraftFlags', error);
    return null;
  }
  if (!data) return null;
  return {
    similarTitle: data.problems.includes('similar_title'),
    studentName: data.problems.includes('student_name'),
  };
}
