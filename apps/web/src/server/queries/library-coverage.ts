import 'server-only';
import { isLibraryItemType } from '@lynx/content';
import { cache } from 'react';
import { localized } from '@/i18n/config';
import { reportError } from '../errors';
import {
  buildCoverageSummary,
  groupCoverage,
  type CoverageFilter,
  type CoverageRow,
  type CoverageStrand,
  type CoverageSummaryView,
  type CoverageView,
} from '../library/coverage-view';
import { subjectsForGrade } from '../library/search-params';
import { aiOn, librarySchools, type SessionContext } from '../session';
import { createSupabaseServerClient } from '../supabase';
import {
  loadLibrarySearchOptions,
  type GradeOption,
  type LibrarySearchOptions,
  type SubjectOption,
} from './library-search';

/**
 * « Couverture du curriculum » (DECISIONS D-094): the attentes of a grade and subject with the
 * number of the board's approved resources, and the summary per grade and subject. Read as the
 * user through `public.library_coverage` and `public.library_coverage_summary`, which decide what
 * counts, refuse another board, and fill « en révision » only for the board's content reviewers.
 */

/**
 * The board whose coverage the page shows: a library school's board, else the board the user
 * reviews for (the same board whose settings the library follows).
 */
export function coverageBoardId(session: SessionContext): string | null {
  return librarySchools(session)[0]?.boardId ?? session.libraryReviewer[0]?.boardId ?? null;
}

export interface CoveragePage {
  options: LibrarySearchOptions;
  grade: GradeOption | null;
  /** The subjects of the chosen grade (Anglais from the board's start grade). */
  subjects: SubjectOption[];
  subject: SubjectOption | null;
  /**
   * The chosen grade and subject's attentes by domaine; null until both are chosen, or when the
   * coverage could not be read (`failed`).
   */
  view: CoverageView | null;
  failed: boolean;
  /** Whether the rows carry « en révision » (the board's content reviewers). */
  inReview: boolean;
  /** « Créer une ressource »: the user can create at a library school. */
  canCreate: boolean;
  /** « Créer avec l’IA pour cette attente »: AI is on for one of the user's library schools. */
  canGenerate: boolean;
}

/**
 * Grade → subject → the attentes by domaine (D-094). Only what was chosen is loaded; kindergarten
 * has no resources in the pilot (D-008), so it gets no subjects, as in « Parcourir le curriculum ».
 */
export async function loadCoverage(
  {
    gradeCode,
    subjectId,
    min,
    show,
  }: { gradeCode: string | null; subjectId: string | null; min: number; show: CoverageFilter },
  session: SessionContext,
  locale: string,
): Promise<CoveragePage> {
  const options = await loadLibrarySearchOptions(session, locale);
  const grade = options.grades.find((g) => g.code === gradeCode) ?? null;
  const subjects = grade && grade.ordinal >= 1 ? subjectsForGrade(options, grade.ordinal) : [];
  const subject = subjects.find((s) => s.id === subjectId) ?? null;
  const schools = librarySchools(session);
  const base = {
    options,
    grade,
    subjects,
    subject,
    canCreate: schools.length > 0,
    canGenerate: schools.some((s) => aiOn(session, s)),
  };
  const boardId = coverageBoardId(session);
  if (!grade || !subject || !boardId) {
    return { ...base, view: null, failed: false, inReview: false };
  }

  const supabase = await createSupabaseServerClient();
  const [strands, coverage] = await Promise.all([
    supabase
      .from('strands')
      .select('id, code, label_fr, label_en, sort_order')
      .eq('subject_id', subject.id),
    supabase.rpc('library_coverage', {
      p_board_id: boardId,
      p_grade_code: grade.code,
      p_subject_id: subject.id,
    }),
  ]);
  if (coverage.error || strands.error) {
    reportError('loadCoverage', coverage.error ?? strands.error);
    return { ...base, view: null, failed: true, inReview: false };
  }
  const rows: CoverageRow[] = (coverage.data ?? []).map((raw) => {
    // Null where the curriculum has none, and for everyone but reviewers (the generated types
    // cannot know).
    const r = raw as { [K in keyof typeof raw]: (typeof raw)[K] | null };
    return {
      expectationId: raw.expectation_id,
      parentId: r.parent_id,
      strandId: r.strand_id,
      kind: raw.kind,
      code: raw.code,
      text: localized(locale, raw.text_fr, r.text_en),
      verified: raw.is_verified,
      sortOrder: raw.sort_order,
      hasChildren: raw.has_children,
      approvedCount: raw.approved_count,
      inReviewCount: r.in_review_count,
      approvedTypes: (raw.approved_types ?? []).filter(isLibraryItemType),
    };
  });
  const strandRows: CoverageStrand[] = (strands.data ?? []).map((s) => ({
    id: s.id,
    code: s.code,
    label: localized(locale, s.label_fr, s.label_en),
    sortOrder: s.sort_order,
  }));
  return {
    ...base,
    view: groupCoverage(rows, strandRows, { min, show }),
    failed: false,
    inReview: rows.some((r) => r.inReviewCount !== null),
  };
}

/**
 * « Vue d’ensemble »: per grade and subject of the board, how many attentes have no, few or
 * enough approved resources at the threshold `min`; null when it could not be read. Cached per
 * request.
 */
export const loadCoverageSummary = cache(
  async (
    boardId: string,
    min: number,
    options: LibrarySearchOptions,
  ): Promise<CoverageSummaryView<GradeOption, SubjectOption> | null> => {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc('library_coverage_summary', {
      p_board_id: boardId,
      p_min_approved: min,
    });
    if (error) {
      reportError('loadCoverageSummary', error);
      return null;
    }
    return buildCoverageSummary(
      (data ?? []).map((r) => ({
        gradeCode: r.grade_code,
        subjectId: r.subject_id,
        units: r.unit_count,
        none: r.none_count,
        few: r.few_count,
        covered: r.covered_count,
      })),
      options,
    );
  },
);
