/**
 * The library's search in the address (DECISIONS D-068, D-069): what `/library?…` asks for, read
 * back from the query string and written into links. The keys are `q, grade, subject, strand,
 * exp, type (repeated), bucket (repeated), dur, fmt (repeated), sub, approved, level, mine,
 * attachTo, page`. Reading never fails: a value that is not valid (an unknown type, an id that
 * is not an id, a page out of range) is dropped, so an old or hand-edited link still opens.
 * Pure: no server-only import, so the rules are unit-tested and client components can use them.
 */
import {
  LIBRARY_BUCKETS,
  LIBRARY_ITEM_TYPES,
  isLibraryItemType,
  type LibraryBucket,
  type LibraryItemType,
} from '@lynx/content';

/** « Durée » : 15 min ou moins, 16 à 30, 31 à 60, plus de 60 (`app.library_duration_band`). */
export const DURATION_BANDS = ['le15', 'le30', 'le60', 'gt60'] as const;
export type DurationBand = (typeof DURATION_BANDS)[number];

/** « Format » : à imprimer, à projeter, interactif. */
export const FORMAT_KEYS = ['printable', 'projectable', 'interactive'] as const;
export type FormatKey = (typeof FORMAT_KEYS)[number];

/** Results come 24 at a time (« Afficher plus »). */
export const PAGE_SIZE = 24;
/** « Afficher plus » stops after this many pages (480 results): refine the search instead. */
export const MAX_PAGES = 20;
/** The longest query the search reads (`app.library_tsquery` keeps 200 characters). */
export const MAX_QUERY_LENGTH = 200;

export interface LibrarySearch {
  /** The words typed, trimmed; '' for none. */
  q: string;
  /** A grade code (K1, K2, 1…8). */
  grade: string | null;
  subject: string | null;
  /** A domaine. */
  strand: string | null;
  /** An attente: its own items, its specific attentes' and its overall attente's (D-069). */
  exp: string | null;
  types: LibraryItemType[];
  buckets: LibraryBucket[];
  dur: DurationBand | null;
  fmt: FormatKey[];
  /** « Pour la suppléance ». */
  sub: boolean;
  /** « Approuvées par le conseil seulement ». */
  approved: boolean;
  /** A language level: items with a version for it. */
  level: string | null;
  /** The user's own resources only. */
  mine: boolean;
  /** The lesson a resource is being chosen for (Planification's « Joindre une ressource »). */
  attachTo: string | null;
  /** How many pages of results are shown (1 = the first 24). */
  page: number;
}

export const EMPTY_SEARCH: LibrarySearch = {
  q: '',
  grade: null,
  subject: null,
  strand: null,
  exp: null,
  types: [],
  buckets: [],
  dur: null,
  fmt: [],
  sub: false,
  approved: false,
  level: null,
  mine: false,
  attachTo: null,
  page: 1,
};

type RawParams = URLSearchParams | Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const GRADE = /^(K1|K2|[1-8])$/;

/** The raw values of a key, as the address gives them. */
function raw(params: RawParams, key: string): string[] {
  if (params instanceof URLSearchParams) return params.getAll(key);
  const value = params[key];
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

/** Every value of a key, repeated or comma-separated. */
const values = (params: RawParams, key: string): string[] =>
  raw(params, key)
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter(Boolean);

/** The first value of a key, trimmed. */
const first = (params: RawParams, key: string): string | null =>
  raw(params, key)[0]?.trim() ?? null;

const uuid = (value: string | null) => {
  const v = value?.toLowerCase() ?? null;
  return v && UUID.test(v) ? v : null;
};

const flag = (value: string | null) => value === '1' || value === 'true';

/** The allowed values that were asked for, once each, in their own order. */
const chosen = <T extends string>(allowed: readonly T[], asked: readonly string[]): T[] =>
  allowed.filter((v) => asked.includes(v));

/** Reads a search from the address. Invalid values are dropped, never refused. */
export function parseLibrarySearch(params: RawParams): LibrarySearch {
  const q = (first(params, 'q') ?? '').replace(/\s+/g, ' ').slice(0, MAX_QUERY_LENGTH).trim();
  const grade = first(params, 'grade')?.toUpperCase() ?? null;
  const dur = first(params, 'dur');
  const page = Number(first(params, 'page'));
  return {
    q,
    grade: grade && GRADE.test(grade) ? grade : null,
    subject: uuid(first(params, 'subject')),
    strand: uuid(first(params, 'strand')),
    exp: uuid(first(params, 'exp')),
    types: chosen(LIBRARY_ITEM_TYPES, values(params, 'type').filter(isLibraryItemType)),
    buckets: chosen(LIBRARY_BUCKETS, values(params, 'bucket')),
    dur: DURATION_BANDS.find((d) => d === dur) ?? null,
    fmt: chosen(FORMAT_KEYS, values(params, 'fmt')),
    sub: flag(first(params, 'sub')),
    approved: flag(first(params, 'approved')),
    level: uuid(first(params, 'level')),
    mine: flag(first(params, 'mine')),
    attachTo: uuid(first(params, 'attachTo')),
    page: Number.isInteger(page) && page >= 1 ? Math.min(page, MAX_PAGES) : 1,
  };
}

/**
 * The query string of a search (without « ? »), keys in a fixed order and defaults left out, so
 * the same search always gives the same link.
 */
export function toSearchParams(search: Partial<LibrarySearch>): URLSearchParams {
  const s = { ...EMPTY_SEARCH, ...search };
  const out = new URLSearchParams();
  if (s.q.trim()) out.set('q', s.q.trim());
  if (s.grade) out.set('grade', s.grade);
  if (s.subject) out.set('subject', s.subject);
  if (s.strand) out.set('strand', s.strand);
  if (s.exp) out.set('exp', s.exp);
  for (const t of chosen(LIBRARY_ITEM_TYPES, s.types)) out.append('type', t);
  for (const b of chosen(LIBRARY_BUCKETS, s.buckets)) out.append('bucket', b);
  if (s.dur) out.set('dur', s.dur);
  for (const f of chosen(FORMAT_KEYS, s.fmt)) out.append('fmt', f);
  if (s.sub) out.set('sub', '1');
  if (s.approved) out.set('approved', '1');
  if (s.level) out.set('level', s.level);
  if (s.mine) out.set('mine', '1');
  if (s.attachTo) out.set('attachTo', s.attachTo);
  if (s.page > 1) out.set('page', String(Math.min(s.page, MAX_PAGES)));
  return out;
}

/** The library page for a search: `/library`, or `/library?…`. */
export function libraryHref(search: Partial<LibrarySearch>): string {
  const query = toSearchParams(search).toString();
  return query ? `/library?${query}` : '/library';
}

/**
 * The same search with some filters changed, back on the first page (a new search never keeps
 * « Afficher plus »).
 */
export function withChanges(search: LibrarySearch, changes: Partial<LibrarySearch>): LibrarySearch {
  return { ...search, page: 1, ...changes };
}

/**
 * « Effacer les filtres »: every filter goes, the words typed and the lesson being chosen for
 * stay.
 */
export function clearFilters(search: LibrarySearch): LibrarySearch {
  return { ...EMPTY_SEARCH, q: search.q, attachTo: search.attachTo };
}

/**
 * Whether the page shows results rather than the hub: something was typed, a filter is set, or a
 * resource is being chosen for a lesson.
 */
export function showsResults(search: LibrarySearch): boolean {
  return search.q !== '' || search.attachTo !== null || hasFilters(search);
}

/** Whether any filter is set (the words typed and the lesson being chosen for are not filters). */
export function hasFilters(search: LibrarySearch): boolean {
  return (
    search.grade !== null ||
    search.subject !== null ||
    search.strand !== null ||
    search.exp !== null ||
    search.mine ||
    facetFilterCount(search) > 0
  );
}

/** How many choices the « Filtres » panel holds (« Filtres (3) »). */
export function facetFilterCount(search: LibrarySearch): number {
  return (
    search.types.length +
    search.buckets.length +
    (search.dur ? 1 : 0) +
    search.fmt.length +
    (search.sub ? 1 : 0) +
    (search.approved ? 1 : 0) +
    (search.level ? 1 : 0) +
    (search.grade ? 1 : 0) +
    (search.subject ? 1 : 0)
  );
}

/**
 * The filters of `public.search_library` (`p_filters`) for a search; defaults are left out. A type
 * rather than an interface, so it is accepted where JSON is expected.
 */
export type SearchLibraryFilters = {
  q?: string;
  gradeCode?: string;
  subjectId?: string;
  strandId?: string;
  expectationId?: string;
  types?: LibraryItemType[];
  buckets?: LibraryBucket[];
  duration?: DurationBand;
  formats?: FormatKey[];
  subFriendly?: true;
  approvedOnly?: true;
  languageLevelId?: string;
  mine?: true;
};

export function toRpcFilters(search: LibrarySearch): SearchLibraryFilters {
  return {
    ...(search.q ? { q: search.q } : {}),
    ...(search.grade ? { gradeCode: search.grade } : {}),
    ...(search.subject ? { subjectId: search.subject } : {}),
    ...(search.strand ? { strandId: search.strand } : {}),
    ...(search.exp ? { expectationId: search.exp } : {}),
    ...(search.types.length ? { types: search.types } : {}),
    ...(search.buckets.length ? { buckets: search.buckets } : {}),
    ...(search.dur ? { duration: search.dur } : {}),
    ...(search.fmt.length ? { formats: search.fmt } : {}),
    ...(search.sub ? { subFriendly: true as const } : {}),
    ...(search.approved ? { approvedOnly: true as const } : {}),
    ...(search.level ? { languageLevelId: search.level } : {}),
    ...(search.mine ? { mine: true as const } : {}),
  };
}

/**
 * The subjects taught in a grade (by ordinal: K1 = -1 … 8e = 8): by their grade range, and
 * Anglais only from the board's start grade (D-069).
 */
export function subjectsForGrade<S extends { code: string; gradeMin: number; gradeMax: number }>(
  options: { subjects: readonly S[]; anglaisStartGrade: number },
  ordinal: number,
): S[] {
  return options.subjects.filter(
    (s) =>
      s.gradeMin <= ordinal &&
      s.gradeMax >= ordinal &&
      (s.code !== 'ang' || ordinal >= options.anglaisStartGrade),
  );
}
