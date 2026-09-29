/**
 * « Couverture du curriculum » (DECISIONS D-094): which attentes of a grade and
 * subject have few or no board-approved resources, by domaine.
 *
 * What counts is decided in SQL (`public.library_coverage`): for a specific attente, the
 * board-approved items linked to it; for an overall attente, the items linked to it or to one
 * of its children, each once. Browsing also matches parents, so its numbers can be higher; the
 * page says so (« Comment on compte »).
 *
 * The coverage units, which the totals count, are the specific attentes plus the overall
 * attentes without children, as in `public.library_coverage_summary`. An overall attente with
 * children is a heading for them.
 *
 * Pure so it is unit-tested; loaded by `server/queries/library-coverage.ts`.
 */
import type { LibraryItemType } from '@lynx/content';

/** « Seuil » : an attente with fewer approved resources has « Peu de ressources ». */
export const COVERAGE_MIN_DEFAULT = 2;
export const COVERAGE_MIN_RANGE = { min: 1, max: 5 } as const;

/** « Aucune ressource approuvée », fewer than the threshold, or enough. */
export type CoverageLevel = 'none' | 'few' | 'covered';

/**
 * The list filter: « Sans ressource approuvée » (none), « Peu de ressources » (below the
 * threshold, none included) and « Toutes ».
 */
export const COVERAGE_FILTERS = ['none', 'few', 'all'] as const;
export type CoverageFilter = (typeof COVERAGE_FILTERS)[number];

/** The threshold from the page's `min` parameter: a whole number from 1 to 5, else 2. */
export function coverageMin(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= COVERAGE_MIN_RANGE.min && n <= COVERAGE_MIN_RANGE.max
    ? n
    : COVERAGE_MIN_DEFAULT;
}

/** The list filter from the page's `show` parameter, « Toutes » when missing or unknown. */
export function coverageFilter(value: unknown): CoverageFilter {
  const raw = Array.isArray(value) ? value[0] : value;
  return (COVERAGE_FILTERS as readonly unknown[]).includes(raw) ? (raw as CoverageFilter) : 'all';
}

/** The level of an attente with `approved` board-approved resources, for a threshold of `min`. */
export function coverageLevel(approved: number, min: number = COVERAGE_MIN_DEFAULT): CoverageLevel {
  const threshold = Math.min(
    COVERAGE_MIN_RANGE.max,
    Math.max(COVERAGE_MIN_RANGE.min, Math.floor(Number.isFinite(min) ? min : COVERAGE_MIN_DEFAULT)),
  );
  if (!(approved > 0)) return 'none';
  return approved < threshold ? 'few' : 'covered';
}

/** A row of `public.library_coverage`, as the query maps it. */
export interface CoverageRow {
  expectationId: string;
  parentId: string | null;
  strandId: string | null;
  kind: 'overall' | 'specific';
  code: string;
  /** The attente's text (the curriculum is in French). */
  text: string;
  /** « À vérifier » while false (D-030). */
  verified: boolean;
  sortOrder: number;
  hasChildren: boolean;
  approvedCount: number;
  /** « En révision »: null unless the viewer is a content reviewer of the board. */
  inReviewCount: number | null;
  /** The types of the approved resources. */
  approvedTypes: LibraryItemType[];
}

/** A domaine of the subject (`strands`). */
export interface CoverageStrand {
  id: string;
  code: string;
  label: string;
  sortOrder: number;
}

export interface CoverageExpectation extends CoverageRow {
  /** Counted in the totals: a specific attente, or an overall attente without children. */
  unit: boolean;
  level: CoverageLevel;
}

/** An overall attente with its specific attentes, or an attente on its own. */
export interface CoverageEntry {
  expectation: CoverageExpectation;
  children: CoverageExpectation[];
}

export interface CoverageCounts {
  units: number;
  none: number;
  few: number;
  covered: number;
}

export interface CoverageGroup {
  /** Null for attentes without a known domaine (listed last). */
  strand: CoverageStrand | null;
  entries: CoverageEntry[];
  /** Over every unit of the domaine, whatever the filter. */
  counts: CoverageCounts;
}

export interface CoverageView {
  groups: CoverageGroup[];
  /** Over every unit of the grade and subject, whatever the filter. */
  counts: CoverageCounts;
}

const emptyCounts = (): CoverageCounts => ({ units: 0, none: 0, few: 0, covered: 0 });

function addTo(counts: CoverageCounts, e: CoverageExpectation) {
  if (!e.unit) return;
  counts.units++;
  counts[e.level]++;
}

const byOrder = (a: CoverageRow, b: CoverageRow) =>
  a.sortOrder - b.sortOrder ||
  a.code.localeCompare(b.code, 'fr', { numeric: true }) ||
  (a.expectationId < b.expectationId ? -1 : a.expectationId > b.expectationId ? 1 : 0);

function matches(e: CoverageExpectation, show: CoverageFilter): boolean {
  if (!e.unit) return false;
  if (show === 'none') return e.level === 'none';
  if (show === 'few') return e.level !== 'covered';
  return true;
}

/**
 * The attentes by domaine (in the domaines' order, then those without one), each overall
 * attente followed by its specific attentes, all in curriculum order. With a filter, only the
 * units that match are listed, under their overall attente; empty domaines are left out. The
 * counts always cover every unit, so « 14 attentes sur 22 » does not change with the filter.
 */
export function groupCoverage(
  rows: readonly CoverageRow[],
  strands: readonly CoverageStrand[],
  { min = COVERAGE_MIN_DEFAULT, show = 'all' }: { min?: number; show?: CoverageFilter } = {},
): CoverageView {
  const view = (row: CoverageRow): CoverageExpectation => ({
    ...row,
    unit: row.kind === 'specific' || !row.hasChildren,
    level: coverageLevel(row.approvedCount, min),
  });
  const all = [...rows].sort(byOrder).map(view);
  const byId = new Map(all.map((e) => [e.expectationId, e]));

  // Specific attentes go under their overall attente when it is listed; the rest stand alone.
  const childrenOf = new Map<string, CoverageExpectation[]>();
  const tops: CoverageExpectation[] = [];
  for (const e of all) {
    const parent = e.parentId ? byId.get(e.parentId) : undefined;
    if (e.kind === 'specific' && parent && parent.kind === 'overall') {
      childrenOf.set(parent.expectationId, [...(childrenOf.get(parent.expectationId) ?? []), e]);
    } else {
      tops.push(e);
    }
  }

  const strandById = new Map(strands.map((s) => [s.id, s]));
  const groups = new Map<string | null, CoverageGroup>();
  const total = emptyCounts();
  for (const top of tops) {
    const strand = (top.strandId && strandById.get(top.strandId)) || null;
    const key = strand?.id ?? null;
    let group = groups.get(key);
    if (!group) {
      group = { strand, entries: [], counts: emptyCounts() };
      groups.set(key, group);
    }
    const children = childrenOf.get(top.expectationId) ?? [];
    for (const e of [top, ...children]) {
      addTo(group.counts, e);
      addTo(total, e);
    }
    const shown = children.filter((c) => matches(c, show));
    if (show === 'all' || matches(top, show) || shown.length) {
      group.entries.push({ expectation: top, children: show === 'all' ? children : shown });
    }
  }

  const ordered = [...groups.values()]
    .filter((g) => g.entries.length > 0)
    .sort((a, b) => {
      if (!a.strand || !b.strand) return a.strand ? -1 : b.strand ? 1 : 0;
      return (
        a.strand.sortOrder - b.strand.sortOrder ||
        a.strand.code.localeCompare(b.strand.code, 'fr', { numeric: true })
      );
    });
  return { groups: ordered, counts: total };
}
