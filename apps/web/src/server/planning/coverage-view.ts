/**
 * « Couverture des attentes » of a class (DECISIONS D-125): what the class's units and lessons
 * planned and taught, per attente, for display. The statuses and their evidence come from the
 * domain (`expectationCoverage`, packages/domain/src/year-plan/coverage.ts); this module reads
 * the page's address (subject, grade, period, what to show), groups the attentes by domaine as
 * the library's coverage does (`groupExpectationsByDomaine`, D-094's counting unit) and counts.
 *
 * Pure and imported relatively (no `@/` alias), so it is unit-tested and the list is drawn in
 * unit tests.
 */
import {
  coverageCounts,
  isCoverageUnit,
  isLocalDate,
  REPORT_PERIOD_KINDS,
  type CoverageCounts,
  type CoverageEvidence,
  type CoverageStatus,
  type DateWindow,
  type ExpectationCoverage,
  type LocalDate,
  type ReportPeriod,
  type ReportPeriodKind,
} from '@lynx/domain';
import {
  groupExpectationsByDomaine,
  type CurriculumRow,
  type CurriculumStrand,
} from '../curriculum-groups';

// ---------------------------------------------------------------------------------------
// The page's address
// ---------------------------------------------------------------------------------------

/** « Afficher » : « Toutes », « Pas encore prévues », « Prévues », « Enseignées ». */
export const CLASS_COVERAGE_SHOWS = ['all', 'not_planned', 'planned', 'taught'] as const;
export type ClassCoverageShow = (typeof CLASS_COVERAGE_SHOWS)[number];

/** « Période » : the whole year, one of the board's report periods, or « Dates choisies ». */
export type CoveragePeriodChoice = 'year' | ReportPeriodKind | 'custom';

export interface CoveragePeriodSelection {
  choice: CoveragePeriodChoice;
  /** The dates the statuses are computed for; null for the whole year. */
  window: DateWindow | null;
  /** « Dates choisies »: the dates typed, when they are dates. */
  from: LocalDate | null;
  to: LocalDate | null;
  /** « Dates choisies » without two dates in order: the whole year is shown instead. */
  invalid: boolean;
}

const first = (value: unknown): string | null => {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
};

/** `show`, « Toutes » when missing or unknown. */
export function classCoverageShow(value: unknown): ClassCoverageShow {
  const raw = first(value);
  return (CLASS_COVERAGE_SHOWS as readonly (string | null)[]).includes(raw)
    ? (raw as ClassCoverageShow)
    : 'all';
}

/**
 * The period of `period`, `from` and `to`: a report period the board has set (its evaluation
 * window), « Dates choisies » (both dates, the first not after the second), else the whole year.
 * A report period the board has not set is the whole year.
 */
export function coveragePeriod(
  params: { period?: unknown; from?: unknown; to?: unknown },
  periods: readonly ReportPeriod[],
): CoveragePeriodSelection {
  const choice = first(params.period);
  const whole: CoveragePeriodSelection = {
    choice: 'year',
    window: null,
    from: null,
    to: null,
    invalid: false,
  };
  if (choice === 'custom') {
    const from = first(params.from);
    const to = first(params.to);
    const dates = {
      from: from && isLocalDate(from) ? from : null,
      to: to && isLocalDate(to) ? to : null,
    };
    if (dates.from && dates.to && dates.from <= dates.to) {
      return {
        choice: 'custom',
        window: { startsOn: dates.from, endsOn: dates.to },
        ...dates,
        invalid: false,
      };
    }
    return { choice: 'custom', window: null, ...dates, invalid: true };
  }
  const period = periods.find((p) => p.kind === choice);
  return period
    ? {
        ...whole,
        choice: period.kind,
        window: { startsOn: period.startsOn, endsOn: period.endsOn },
      }
    : whole;
}

/** The board's report periods, in Ontario's order. */
export const orderedPeriods = (periods: readonly ReportPeriod[]): ReportPeriod[] =>
  REPORT_PERIOD_KINDS.flatMap((kind) => periods.filter((p) => p.kind === kind));

/**
 * The page's address (`/classes/<id>/planning/coverage?subject=<id>&grade=3&period=term1`),
 * leaving out the defaults (the whole year, « Toutes ») so a plain link stays short. `grade` only
 * matters for a class of several grades.
 */
export function classCoverageHref(
  classId: string,
  {
    subject = null,
    grade = null,
    period = 'year',
    from = null,
    to = null,
    show = 'all',
  }: {
    subject?: string | null;
    grade?: string | null;
    period?: CoveragePeriodChoice;
    from?: LocalDate | null;
    to?: LocalDate | null;
    show?: ClassCoverageShow;
  } = {},
): string {
  const params = new URLSearchParams();
  if (subject) params.set('subject', subject);
  if (grade) params.set('grade', grade);
  if (period !== 'year') params.set('period', period);
  if (period === 'custom') {
    if (from) params.set('from', from);
    if (to) params.set('to', to);
  }
  if (show !== 'all') params.set('show', show);
  const query = params.toString();
  const base = `/classes/${classId}/planning/coverage`;
  return query ? `${base}?${query}` : base;
}

// ---------------------------------------------------------------------------------------
// The overview: one line per subject (and grade) with attentes loaded
// ---------------------------------------------------------------------------------------

/** What counting needs of an attente, for every subject of the class's grades. */
export interface CoverageCountRow {
  expectationId: string;
  subjectId: string;
  gradeCode: string;
  kind: 'overall' | 'specific';
  parentId: string | null;
  /** « À vérifier » while false (D-030). */
  verified: boolean;
}

export interface OverviewSubject<S extends { id: string }> {
  subject: S;
  /** Over the class's grades. */
  counts: CoverageCounts;
  /** Per grade of the class that has attentes in the subject, in the class's order. */
  grades: { gradeCode: string; counts: CoverageCounts }[];
}

export interface CoverageOverview<S extends { id: string }> {
  /** The subjects with at least one attente loaded, in the subjects' order. */
  subjects: OverviewSubject<S>[];
  /** The class's subjects without any attente loaded (« Arts », « ERE »…). */
  without: S[];
}

const asCoverageExpectation = (r: CoverageCountRow) => ({
  id: r.expectationId,
  kind: r.kind,
  parentId: r.parentId,
});

/** « Mathématiques : 46 attentes · 9 enseignées · 14 prévues · 23 pas encore prévues ». */
export function coverageOverview<S extends { id: string }>(
  rows: readonly CoverageCountRow[],
  coverage: ReadonlyMap<string, ExpectationCoverage>,
  subjects: readonly S[],
  gradeCodes: readonly string[],
): CoverageOverview<S> {
  const out: CoverageOverview<S> = { subjects: [], without: [] };
  for (const subject of subjects) {
    const own = rows.filter((r) => r.subjectId === subject.id && gradeCodes.includes(r.gradeCode));
    const counts = coverageCounts(own.map(asCoverageExpectation), coverage);
    if (counts.total === 0) {
      out.without.push(subject);
      continue;
    }
    out.subjects.push({
      subject,
      counts,
      grades: gradeCodes
        .map((gradeCode) => ({
          gradeCode,
          counts: coverageCounts(
            own.filter((r) => r.gradeCode === gradeCode).map(asCoverageExpectation),
            coverage,
          ),
        }))
        .filter((g) => g.counts.total > 0),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// The list: domaines, then attentes, each with its status and evidence
// ---------------------------------------------------------------------------------------

/** An attente of the chosen subject and grade, as the query maps it. */
export interface ClassCoverageRow extends CurriculumRow {
  /** The attente's text (the curriculum is in French). */
  text: string;
  /** « À vérifier » while false (D-030). */
  verified: boolean;
}

export interface ClassCoverageItem extends ClassCoverageRow {
  /** Counted in the totals: a specific attente, or an overall attente without children (D-094). */
  unit: boolean;
  status: CoverageStatus;
  evidence: CoverageEvidence;
}

export interface ClassCoverageEntry {
  /** An overall attente with specific attentes is a heading for them (`unit` false). */
  expectation: ClassCoverageItem;
  children: ClassCoverageItem[];
  /** For a heading: its specific attentes, and how many are taught (whatever the filter). */
  childCount: number;
  childTaught: number;
}

export interface ClassCoverageGroup {
  strand: CurriculumStrand | null;
  entries: ClassCoverageEntry[];
  /** Over every unit of the domaine, whatever the filter. */
  counts: CoverageCounts;
}

export interface ClassCoverageView {
  groups: ClassCoverageGroup[];
  /** Over every unit of the subject and grade, whatever the filter. */
  counts: CoverageCounts;
  /** Some attente is a summary still « À vérifier » (D-030). */
  unverified: boolean;
}

/** The statuses that count as taught (« Enseignée », « à confirmer », « unité terminée »). */
export const TAUGHT_STATUSES: ReadonlySet<CoverageStatus> = new Set([
  'taught',
  'taught_pending',
  'taught_unit',
]);

const NO_EVIDENCE: CoverageEvidence = {
  lessonsTaught: 0,
  lastTaughtOn: null,
  lessonsPending: 0,
  units: [],
};

/** Whether an attente's status is one « Afficher » asks for. */
export function showsStatus(status: CoverageStatus, show: ClassCoverageShow): boolean {
  if (show === 'taught') return TAUGHT_STATUSES.has(status);
  if (show === 'planned') return status === 'planned';
  if (show === 'not_planned') return status === 'not_planned';
  return true;
}

/**
 * The attentes by domaine, each overall attente that has specific attentes a heading for them
 * (« 2 sur 3 enseignées »), every other attente with its status and evidence. With a filter, only
 * the units that match are listed (under their heading); empty domaines are left out. The counts
 * always cover every unit, so the summary line does not change with the filter.
 */
export function groupClassCoverage(
  rows: readonly ClassCoverageRow[],
  strands: readonly CurriculumStrand[],
  coverage: ReadonlyMap<string, ExpectationCoverage>,
  show: ClassCoverageShow = 'all',
): ClassCoverageView {
  const parents = new Set(rows.map((r) => r.parentId).filter(Boolean));
  const items = rows.map((r): ClassCoverageItem => ({
    ...r,
    unit: isCoverageUnit(r.kind, parents.has(r.expectationId)),
    status: coverage.get(r.expectationId)?.status ?? 'not_planned',
    evidence: coverage.get(r.expectationId)?.evidence ?? NO_EVIDENCE,
  }));
  const asCounted = (e: ClassCoverageItem) => ({
    id: e.expectationId,
    kind: e.kind,
    parentId: e.parentId,
  });
  const matches = (e: ClassCoverageItem) => e.unit && showsStatus(e.status, show);

  const groups: ClassCoverageGroup[] = [];
  for (const group of groupExpectationsByDomaine(items, strands)) {
    const all = group.entries.flatMap((e) => [e.expectation, ...e.children]);
    const entries: ClassCoverageEntry[] = [];
    for (const { expectation, children } of group.entries) {
      const shown = show === 'all' ? children : children.filter(matches);
      if (show === 'all' || matches(expectation) || shown.length) {
        entries.push({
          expectation,
          children: shown,
          childCount: children.length,
          childTaught: children.filter((c) => TAUGHT_STATUSES.has(c.status)).length,
        });
      }
    }
    if (entries.length) {
      groups.push({
        strand: group.strand,
        entries,
        counts: coverageCounts(all.map(asCounted), coverage),
      });
    }
  }
  return {
    groups,
    counts: coverageCounts(items.map(asCounted), coverage),
    unverified: rows.some((r) => !r.verified),
  };
}
