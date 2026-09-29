import 'server-only';
import {
  LIBRARY_BUCKETS,
  LIBRARY_ITEM_TYPES,
  type LibraryBucket,
  type LibraryItemType,
} from '@lynx/content';
import { Constants } from '@lynx/db';
import { cache } from 'react';
import { z } from 'zod';
import { localized } from '@/i18n/config';
import { reportError } from '../errors';
import { MAX_STATS_ITEMS } from '../library/growth';
import {
  buildCurriculumTree,
  type CurriculumStrandView,
  type ExpectationCounts,
} from '../library/curriculum-tree';
import {
  DURATION_BANDS,
  FORMAT_KEYS,
  PAGE_SIZE,
  subjectsForGrade,
  toRpcFilters,
  type DurationBand,
  type FormatKey,
  type LibrarySearch,
} from '../library/search-params';
import type { AttachTarget, LibraryCardView } from '../library/view-model';
import { aiOn, librarySchools, type SessionContext } from '../session';
import { createSupabaseServerClient } from '../supabase';
import { loadLanguageLevels, type LevelOption } from './differentiate';
import { loadCardStats } from './library-growth';

/**
 * Searching and browsing the library (DECISIONS D-068, D-069): the hub, the results with their
 * facets, and « Parcourir le curriculum ». Everything is read as the user: `search_library` and
 * `library_expectation_counts` apply the usable rule themselves (items waiting for review never
 * appear), and the curriculum, subjects and levels come through row level security.
 */

// ---------------------------------------------------------------------------------------
// The options of the hub and of the filter panel
// ---------------------------------------------------------------------------------------

export interface GradeOption {
  code: string;
  /** « 3e année ». */
  label: string;
  /** K1 = -1, K2 = 0, 1re…8e = 1…8. */
  ordinal: number;
}

export interface SubjectOption {
  id: string;
  code: string;
  label: string;
  gradeMin: number;
  gradeMax: number;
}

export interface LibrarySearchOptions {
  grades: GradeOption[];
  /** Standard subjects and the board's own, active ones, in their order. */
  subjects: SubjectOption[];
  /** Board levels, then the user's own personal levels (inactive ones included, marked). */
  levels: LevelOption[];
  /** The grades of the user's classes at a library school (« Mes années d’études »). */
  myGrades: string[];
  /** Anglais is offered from this grade (the user's board setting, D-069). */
  anglaisStartGrade: number;
}

/** The board whose settings apply: a library school's, else the first board as a reviewer. */
function libraryBoard(session: SessionContext) {
  const boardId =
    librarySchools(session)[0]?.boardId ??
    session.libraryReviewer[0]?.boardId ??
    session.boards[0]?.id;
  return session.boards.find((b) => b.id === boardId) ?? null;
}

/**
 * Grades, subjects, levels and the user's own grades, for the hub's chips, the filter panel and
 * the cards (grade labels). Cached per request.
 */
export const loadLibrarySearchOptions = cache(
  async (session: SessionContext, locale: string): Promise<LibrarySearchOptions> => {
    const supabase = await createSupabaseServerClient();
    const librarySchoolIds = new Set(librarySchools(session).map((s) => s.id));
    const [grades, subjects, levels, classes] = await Promise.all([
      supabase.from('grades').select('code, label_fr, label_en, ordinal').order('ordinal'),
      supabase
        .from('subjects')
        .select('id, code, label_fr, label_en, grade_min, grade_max, sort_order')
        .eq('active', true)
        .order('sort_order')
        .order('label_fr'),
      loadLanguageLevels(locale),
      supabase
        .from('class_teachers')
        .select('classes!inner(school_id, class_grades(grade_code))')
        .eq('user_id', session.userId),
    ]);
    const gradeOptions = (grades.data ?? []).map((g) => ({
      code: g.code,
      label: localized(locale, g.label_fr, g.label_en),
      ordinal: g.ordinal,
    }));
    const mine = new Set(
      (classes.data ?? [])
        .filter((row) => librarySchoolIds.has(row.classes.school_id))
        .flatMap((row) => row.classes.class_grades.map((g) => g.grade_code)),
    );
    return {
      grades: gradeOptions,
      subjects: (subjects.data ?? []).map((s) => ({
        id: s.id,
        code: s.code,
        label: localized(locale, s.label_fr, s.label_en),
        gradeMin: s.grade_min,
        gradeMax: s.grade_max,
      })),
      levels,
      myGrades: gradeOptions.filter((g) => mine.has(g.code)).map((g) => g.code),
      anglaisStartGrade: libraryBoard(session)?.settings.anglaisStartGrade ?? 4,
    };
  },
);

// ---------------------------------------------------------------------------------------
// Search (public.search_library)
// ---------------------------------------------------------------------------------------

/** A result card: the search's card, and whether the user's own item waits for approval. */
export interface LibraryResultCard extends LibraryCardView {
  requested: boolean;
}

export interface LibraryFacets {
  type: Partial<Record<LibraryItemType, number>>;
  bucket: Partial<Record<LibraryBucket, number>>;
  duration: Record<DurationBand, number>;
  format: Record<FormatKey, number>;
  subFriendly: number;
  approved: number;
  /** Items with a version for each level (board levels and the user's own). */
  level: Record<string, number>;
}

export interface LibrarySearchResult {
  total: number;
  cards: LibraryResultCard[];
  facets: LibraryFacets;
}

const count = z.number().int().nonnegative();

const searchResultSchema = z.object({
  total: count,
  items: z.array(
    z.object({
      id: z.uuid(),
      type: z.enum(LIBRARY_ITEM_TYPES),
      bucket: z.enum(LIBRARY_BUCKETS),
      title: z.string(),
      summary: z.string().nullable(),
      status: z.enum(Constants.public.Enums.library_item_status),
      source: z.enum(Constants.public.Enums.library_source),
      durationMinutes: z.number().int().nullable(),
      subFriendly: z.boolean(),
      printable: z.boolean(),
      projectable: z.boolean(),
      interactive: z.boolean(),
      requiresFaithReview: z.boolean(),
      mine: z.boolean(),
      requested: z.boolean(),
      gradeCodes: z.array(z.string()),
      levelIds: z.array(z.uuid()),
      updatedAt: z.string(),
    }),
  ),
  facets: z.object({
    type: z.partialRecord(z.enum(LIBRARY_ITEM_TYPES), count),
    bucket: z.partialRecord(z.enum(LIBRARY_BUCKETS), count),
    duration: z.object(
      Object.fromEntries(DURATION_BANDS.map((d) => [d, count])) as {
        [K in DurationBand]: typeof count;
      },
    ),
    format: z.object(
      Object.fromEntries(FORMAT_KEYS.map((f) => [f, count])) as {
        [K in FormatKey]: typeof count;
      },
    ),
    subFriendly: count,
    approved: count,
    level: z.record(z.string(), count),
  }),
});

type SearchResultRow = z.infer<typeof searchResultSchema>;

/** The database returns at most 50 items per call: two pages at a time. */
const PAGES_PER_CALL = 2;

/**
 * The results of a search: its first `search.page` pages (24 items each, « Afficher plus »),
 * the total and the facets, board-approved items first (D-068), each card with its opinions and
 * usage (D-093; one call per 50 cards). Null when the search failed: the page then says so and
 * keeps the search field.
 */
export async function searchLibrary(search: LibrarySearch): Promise<LibrarySearchResult | null> {
  const supabase = await createSupabaseServerClient();
  const filters = toRpcFilters(search);
  const wanted = search.page * PAGE_SIZE;
  const calls = Math.ceil(search.page / PAGES_PER_CALL);
  const responses = await Promise.all(
    Array.from({ length: calls }, (_, i) =>
      supabase.rpc('search_library', {
        p_filters: filters,
        p_limit: Math.min(PAGE_SIZE * PAGES_PER_CALL, wanted - i * PAGE_SIZE * PAGES_PER_CALL),
        p_offset: i * PAGE_SIZE * PAGES_PER_CALL,
      }),
    ),
  );
  const rows: SearchResultRow[] = [];
  for (const { data, error } of responses) {
    if (error) {
      reportError('searchLibrary', error);
      return null;
    }
    const parsed = searchResultSchema.safeParse(data);
    if (!parsed.success) {
      // Paths and issue codes only: never the content of a resource.
      reportError('searchLibrary', {
        code: 'invalid_result',
        message: parsed.error.issues.map((i) => `${i.path.join('.')}:${i.code}`).join(','),
      });
      return null;
    }
    rows.push(parsed.data);
  }
  const [firstRow] = rows;
  if (!firstRow) return null;
  // Pages are read in parallel: an item that moved between two calls is shown once.
  const seen = new Set<string>();
  const cards: LibraryResultCard[] = [];
  for (const item of rows.flatMap((r) => r.items)) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    cards.push({
      id: item.id,
      type: item.type,
      bucket: item.bucket,
      title: item.title,
      summary: item.summary,
      status: item.status,
      source: item.source,
      durationMinutes: item.durationMinutes,
      subFriendly: item.subFriendly,
      formats: {
        printable: item.printable,
        projectable: item.projectable,
        interactive: item.interactive,
      },
      requiresFaithReview: item.requiresFaithReview,
      mine: item.mine,
      requested: item.requested,
      gradeCodes: item.gradeCodes,
      levelIds: item.levelIds,
      updatedAt: item.updatedAt,
    });
  }
  const shown = cards.slice(0, wanted);
  // Opinions and usage: one call per 50 cards, in parallel. Cards keep no stats when they fail.
  const chunks = Array.from({ length: Math.ceil(shown.length / MAX_STATS_ITEMS) }, (_, i) =>
    shown.slice(i * MAX_STATS_ITEMS, (i + 1) * MAX_STATS_ITEMS).map((c) => c.id),
  );
  const stats = await Promise.all(chunks.map((ids) => loadCardStats(ids)));
  for (const card of shown) {
    card.stats = stats.find((m) => m.has(card.id))?.get(card.id) ?? null;
  }
  return { total: firstRow.total, cards: shown, facets: firstRow.facets };
}

/** What the domaine and attente filters name, for the chips above the results. */
export interface SearchFilterLabels {
  strand: { code: string; label: string } | null;
  expectation: { code: string; kind: 'overall' | 'specific' } | null;
}

export async function loadSearchFilterLabels(
  search: Pick<LibrarySearch, 'strand' | 'exp'>,
  locale: string,
): Promise<SearchFilterLabels> {
  if (!search.strand && !search.exp) return { strand: null, expectation: null };
  const supabase = await createSupabaseServerClient();
  const [strand, expectation] = await Promise.all([
    search.strand
      ? supabase
          .from('strands')
          .select('code, label_fr, label_en')
          .eq('id', search.strand)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    search.exp
      ? supabase
          .from('curriculum_expectations')
          .select('code, kind')
          .eq('id', search.exp)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return {
    strand: strand.data
      ? {
          code: strand.data.code,
          label: localized(locale, strand.data.label_fr, strand.data.label_en),
        }
      : null,
    expectation: expectation.data
      ? { code: expectation.data.code, kind: expectation.data.kind }
      : null,
  };
}

// ---------------------------------------------------------------------------------------
// The hub
// ---------------------------------------------------------------------------------------

export interface LibraryHub {
  options: LibrarySearchOptions;
  /** Resources the user can use, in all and per category (the category tiles). */
  total: number;
  bucketCounts: Partial<Record<LibraryBucket, number>>;
}

/** « Banque de ressources » before any search: the options and the counts per category. */
export async function loadLibraryHub(session: SessionContext, locale: string): Promise<LibraryHub> {
  const supabase = await createSupabaseServerClient();
  const [options, counts] = await Promise.all([
    loadLibrarySearchOptions(session, locale),
    supabase.rpc('search_library', { p_filters: {}, p_limit: 1, p_offset: 0 }),
  ]);
  if (counts.error) reportError('loadLibraryHub', counts.error);
  const parsed = searchResultSchema.safeParse(counts.data);
  return {
    options,
    total: parsed.success ? parsed.data.total : 0,
    bucketCounts: parsed.success ? parsed.data.facets.bucket : {},
  };
}

// ---------------------------------------------------------------------------------------
// The lesson a resource is being chosen for
// ---------------------------------------------------------------------------------------

/**
 * The lesson of Planification's « Joindre une ressource » (`?attachTo=<lessonId>`), or null
 * when the user cannot see it (row level security: the teachers of its class).
 */
export async function loadAttachTarget(lessonId: string): Promise<AttachTarget | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('unit_lessons')
    .select(
      'id, title, sequence_number, units!inner(id, title, class_id, subject_id), unit_lesson_expectations(expectation_id)',
    )
    .eq('id', lessonId)
    .maybeSingle();
  if (!data) return null;
  return {
    lessonId: data.id,
    lessonTitle: data.title,
    sequenceNumber: data.sequence_number,
    unitId: data.units.id,
    unitTitle: data.units.title,
    classId: data.units.class_id,
    subjectId: data.units.subject_id,
    expectationIds: data.unit_lesson_expectations.map((e) => e.expectation_id),
  };
}

// ---------------------------------------------------------------------------------------
// « Parcourir le curriculum »
// ---------------------------------------------------------------------------------------

export interface CurriculumBrowse {
  options: LibrarySearchOptions;
  grade: GradeOption | null;
  /** The subjects of the chosen grade. */
  subjects: SubjectOption[];
  subject: SubjectOption | null;
  /** The chosen grade and subject's attentes by domaine, with their resource counts. */
  strands: CurriculumStrandView[];
  /** « Créer avec l’IA pour cette attente »: AI is on for one of the user's library schools. */
  canGenerate: boolean;
}

/**
 * Grade → subject → domaines → attentes (D-069). Only what was chosen is loaded: the subjects
 * once a grade is chosen (Anglais from the board's start grade), the attentes and their counts
 * once a subject is. Maternelle and Jardin have no resources in the pilot (D-008): the page says
 * so instead of listing subjects.
 */
export async function loadCurriculumTree(
  { gradeCode, subjectId }: { gradeCode: string | null; subjectId: string | null },
  session: SessionContext,
  locale: string,
): Promise<CurriculumBrowse> {
  const options = await loadLibrarySearchOptions(session, locale);
  const grade = options.grades.find((g) => g.code === gradeCode) ?? null;
  const subjects = grade && grade.ordinal >= 1 ? subjectsForGrade(options, grade.ordinal) : [];
  const subject = subjects.find((s) => s.id === subjectId) ?? null;
  const canGenerate = librarySchools(session).some((s) => aiOn(session, s));
  if (!grade || !subject) {
    return { options, grade, subjects, subject, strands: [], canGenerate };
  }

  const supabase = await createSupabaseServerClient();
  const [strands, expectations, counts] = await Promise.all([
    supabase
      .from('strands')
      .select('id, code, label_fr, label_en, sort_order')
      .eq('subject_id', subject.id),
    supabase
      .from('curriculum_expectations')
      .select('id, strand_id, parent_id, kind, code, text_fr, text_en, is_verified, sort_order')
      .eq('grade_code', grade.code)
      .eq('subject_id', subject.id),
    supabase.rpc('library_expectation_counts', {
      p_grade_code: grade.code,
      p_subject_id: subject.id,
    }),
  ]);
  if (counts.error) reportError('loadCurriculumTree', counts.error);
  const countMap: ExpectationCounts = new Map(
    (counts.data ?? []).map((c) => [
      c.expectation_id,
      { itemCount: c.item_count, approvedCount: c.approved_count },
    ]),
  );
  return {
    options,
    grade,
    subjects,
    subject,
    strands: buildCurriculumTree(
      (strands.data ?? []).map((s) => ({
        id: s.id,
        code: s.code,
        label: localized(locale, s.label_fr, s.label_en),
        sortOrder: s.sort_order,
      })),
      (expectations.data ?? []).map((e) => ({
        id: e.id,
        strandId: e.strand_id,
        parentId: e.parent_id,
        kind: e.kind,
        code: e.code,
        text: localized(locale, e.text_fr, e.text_en),
        verified: e.is_verified,
        sortOrder: e.sort_order,
      })),
      countMap,
    ),
    canGenerate,
  };
}
