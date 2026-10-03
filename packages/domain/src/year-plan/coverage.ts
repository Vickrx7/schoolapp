/**
 * « Couverture des attentes » (DECISIONS D-125): what a class planned and taught, per attente,
 * computed from the class's own units, lessons and progress. Statuses, best first:
 * 1. `taught`: a lesson linked to the attente was given (with a period: on a day inside it);
 * 2. `taught_pending`: a substitute reported such a lesson, not yet confirmed (D-054);
 * 3. `taught_unit`: a finished unit aims at it (« Enseignée (unité terminée) », Assumption;
 *    with a period: the unit's window overlaps it; a unit without a window counts for the whole
 *    year only);
 * 4. `planned`: a unit not archived aims at it, or a lesson linked to it is not given yet (with a
 *    period: the unit's window overlaps it);
 * 5. `taught_earlier`: with a period, given (or its unit finished) before the period only;
 * 6. `not_planned`.
 * Skipped lessons and archived units count for nothing. The counting unit is D-094's: a specific
 * attente, or an overall attente without specific ones (`isCoverageUnit`).
 */
import type { LocalDate } from '../dates';
import type { ProgressStatus } from '../lessons';
import type { YearPlanUnitStatus } from './placement';
import type { DateWindow } from './weeks';

export const COVERAGE_STATUSES = [
  'taught',
  'taught_pending',
  'taught_unit',
  'planned',
  'taught_earlier',
  'not_planned',
] as const;
export type CoverageStatus = (typeof COVERAGE_STATUSES)[number];

export interface CoverageExpectation {
  id: string;
  kind: 'overall' | 'specific';
  parentId: string | null;
}

export interface CoverageLesson {
  id: string;
  expectationIds: readonly string[];
}

export interface CoverageUnit {
  id: string;
  title: string;
  status: YearPlanUnitStatus;
  /** Its planned window, when it has one. */
  startsOn: LocalDate | null;
  endsOn: LocalDate | null;
  /** Unit-level attentes (`unit_expectations`). */
  expectationIds: readonly string[];
  lessons: readonly CoverageLesson[];
}

export interface CoverageProgress {
  status: ProgressStatus;
  taughtOn: LocalDate | null;
}

export interface CoverageInput {
  expectations: readonly CoverageExpectation[];
  units: readonly CoverageUnit[];
  /** The class's progress, by lesson. */
  progress: ReadonlyMap<string, CoverageProgress>;
  /** Null: the whole year. */
  period?: DateWindow | null;
}

export interface CoverageEvidenceUnit {
  id: string;
  title: string;
  status: YearPlanUnitStatus;
  startsOn: LocalDate | null;
  endsOn: LocalDate | null;
}

export interface CoverageEvidence {
  /** Lessons given that count (inside the period, when there is one). */
  lessonsTaught: number;
  /** The last day one of them was given. */
  lastTaughtOn: LocalDate | null;
  /** Lessons a substitute reported, not yet confirmed, that count. */
  lessonsPending: number;
  /** The units that aim at the attente or hold a lesson linked to it, that count. */
  units: CoverageEvidenceUnit[];
}

export interface ExpectationCoverage {
  status: CoverageStatus;
  evidence: CoverageEvidence;
}

/** D-094's counting unit: a specific attente, or an overall attente without specific ones. */
export function isCoverageUnit(kind: 'overall' | 'specific', hasChildren: boolean): boolean {
  return kind === 'specific' || !hasChildren;
}

const inside = (date: LocalDate | null, period: DateWindow) =>
  date !== null && date >= period.startsOn && date <= period.endsOn;

/** Whether a unit counts within a period: its window overlaps it (no window: whole year only). */
const unitInPeriod = (unit: CoverageUnit, period: DateWindow | null) =>
  period === null ||
  (unit.startsOn !== null &&
    unit.endsOn !== null &&
    unit.startsOn <= period.endsOn &&
    unit.endsOn >= period.startsOn);

const unitBefore = (unit: CoverageUnit, period: DateWindow) =>
  unit.endsOn !== null && unit.endsOn < period.startsOn;

/** The coverage of each attente given, by id. */
export function expectationCoverage(input: CoverageInput): Map<string, ExpectationCoverage> {
  const period = input.period ?? null;
  const result = new Map<string, ExpectationCoverage>();
  const evidenceUnit = (u: CoverageUnit): CoverageEvidenceUnit => ({
    id: u.id,
    title: u.title,
    status: u.status,
    startsOn: u.startsOn,
    endsOn: u.endsOn,
  });

  for (const e of input.expectations) {
    let taught = 0;
    let pending = 0;
    let lastTaughtOn: LocalDate | null = null;
    let finishedUnit = false;
    let planned = false;
    let earlier = false;
    const units = new Map<string, CoverageEvidenceUnit>();

    for (const unit of input.units) {
      if (unit.status === 'archived') continue;
      const counts = unitInPeriod(unit, period);
      if (unit.expectationIds.includes(e.id)) {
        if (unit.status === 'completed' && counts) {
          finishedUnit = true;
          units.set(unit.id, evidenceUnit(unit));
        } else if (unit.status === 'completed' && period && unitBefore(unit, period)) {
          earlier = true;
        } else if (unit.status !== 'completed' && counts) {
          planned = true;
          units.set(unit.id, evidenceUnit(unit));
        }
      }
      for (const lesson of unit.lessons) {
        if (!lesson.expectationIds.includes(e.id)) continue;
        const progress = input.progress.get(lesson.id);
        if (progress?.status === 'skipped') continue;
        if (progress?.status === 'completed' || progress?.status === 'pending_confirmation') {
          const given = period === null ? true : inside(progress.taughtOn, period);
          if (given) {
            if (progress.status === 'completed') {
              taught += 1;
              if (progress.taughtOn && (!lastTaughtOn || progress.taughtOn > lastTaughtOn)) {
                lastTaughtOn = progress.taughtOn;
              }
            } else {
              pending += 1;
            }
            units.set(unit.id, evidenceUnit(unit));
          } else if (period && progress.taughtOn !== null && progress.taughtOn < period.startsOn) {
            earlier = true;
          }
        } else if (counts && unit.status !== 'completed') {
          // A lesson not given yet; in a finished unit it was left out, so it counts for nothing.
          planned = true;
          units.set(unit.id, evidenceUnit(unit));
        }
      }
    }

    const status: CoverageStatus =
      taught > 0
        ? 'taught'
        : pending > 0
          ? 'taught_pending'
          : finishedUnit
            ? 'taught_unit'
            : planned
              ? 'planned'
              : earlier
                ? 'taught_earlier'
                : 'not_planned';
    result.set(e.id, {
      status,
      evidence: {
        lessonsTaught: taught,
        lastTaughtOn,
        lessonsPending: pending,
        units: [...units.values()],
      },
    });
  }
  return result;
}

const TAUGHT: ReadonlySet<CoverageStatus> = new Set(['taught', 'taught_pending', 'taught_unit']);

/**
 * The attentes taught (`taught`, `taught_pending`, `taught_unit`), within the period when one is
 * given: the hook for the report-comment composer.
 */
export function taughtExpectationIds(
  input: Omit<CoverageInput, 'period'>,
  period: DateWindow | null = null,
): string[] {
  return [...expectationCoverage({ ...input, period })]
    .filter(([, c]) => TAUGHT.has(c.status))
    .map(([id]) => id);
}

export interface CoverageCounts {
  /** Counting units (D-094). */
  total: number;
  /** `taught`, `taught_pending` and `taught_unit`. */
  taught: number;
  planned: number;
  taughtEarlier: number;
  notPlanned: number;
}

/** Counts the counting units among the attentes given (an overall attente with children is not one). */
export function coverageCounts(
  expectations: readonly CoverageExpectation[],
  coverage: ReadonlyMap<string, ExpectationCoverage>,
): CoverageCounts {
  const parents = new Set(expectations.map((e) => e.parentId).filter(Boolean));
  const counts: CoverageCounts = {
    total: 0,
    taught: 0,
    planned: 0,
    taughtEarlier: 0,
    notPlanned: 0,
  };
  for (const e of expectations) {
    if (!isCoverageUnit(e.kind, parents.has(e.id))) continue;
    const status = coverage.get(e.id)?.status ?? 'not_planned';
    counts.total += 1;
    if (TAUGHT.has(status)) counts.taught += 1;
    else if (status === 'planned') counts.planned += 1;
    else if (status === 'taught_earlier') counts.taughtEarlier += 1;
    else counts.notPlanned += 1;
  }
  return counts;
}
