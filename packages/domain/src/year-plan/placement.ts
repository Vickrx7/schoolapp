/**
 * Units on the year (« Mon année », DECISIONS D-123, D-126): each unit on its planned window,
 * or, for a unit under way or finished without one, on the dates its lessons were taught
 * (« Dates d'après les leçons données », saved only when the teacher confirms). Units of a
 * subject that overlap go on separate lanes, and the overlap is named.
 */
import type { LocalDate } from '../dates';
import type { DateWindow, SchoolWeek } from './weeks';

export type YearPlanUnitStatus = 'planned' | 'active' | 'completed' | 'archived';

export interface PlacementUnit {
  id: string;
  subjectId: string;
  title: string;
  status: YearPlanUnitStatus;
  plannedStartOn: LocalDate | null;
  plannedEndOn: LocalDate | null;
  /** When its lessons were taught (completed lessons with a date), in any order. */
  taughtOn: readonly LocalDate[];
}

export interface PlacedUnit<U extends PlacementUnit = PlacementUnit> extends DateWindow {
  unit: U;
  /** True when the window comes from the lessons taught, not from a saved plan. */
  inferred: boolean;
  /** A planned unit whose start has passed (« Pas encore commencée »). */
  lateStart: boolean;
  /** Its lane within the subject (0 first). */
  lane: number;
}

export interface UnitOverlap {
  subjectId: string;
  first: string;
  second: string;
  from: LocalDate;
  to: LocalDate;
}

export interface YearPlacement<U extends PlacementUnit = PlacementUnit> {
  /** Per subject, its lanes, each in date order. */
  bySubject: Map<string, PlacedUnit<U>[][]>;
  overlaps: UnitOverlap[];
  /** Placed units whose window is not inside the school year (« Hors de l'année scolaire »). */
  outsideYear: PlacedUnit<U>[];
  /** Units with neither a window nor a lesson taught (« Unités sans dates »). */
  unplaced: U[];
}

/** The window of a unit: its plan, else (under way or finished) the days its lessons were taught. */
export function unitWindow(
  unit: PlacementUnit,
  today: LocalDate,
): (DateWindow & { inferred: boolean }) | null {
  if (unit.plannedStartOn && unit.plannedEndOn) {
    return { startsOn: unit.plannedStartOn, endsOn: unit.plannedEndOn, inferred: false };
  }
  if ((unit.status !== 'active' && unit.status !== 'completed') || unit.taughtOn.length === 0) {
    return null;
  }
  const sorted = [...unit.taughtOn].sort();
  const first = sorted[0]!;
  let last = sorted[sorted.length - 1]!;
  if (unit.status === 'active' && today > last) last = today;
  return { startsOn: first, endsOn: last, inferred: true };
}

const overlapOf = (a: DateWindow, b: DateWindow): DateWindow | null => {
  const startsOn = a.startsOn > b.startsOn ? a.startsOn : b.startsOn;
  const endsOn = a.endsOn < b.endsOn ? a.endsOn : b.endsOn;
  return startsOn <= endsOn ? { startsOn, endsOn } : null;
};

/** Places a class's units (archived ones are left out) on its school year's weeks. */
export function placeUnits<U extends PlacementUnit>(
  units: readonly U[],
  weeks: readonly Pick<SchoolWeek, 'days'>[],
  today: LocalDate,
): YearPlacement<U> {
  const days = weeks.flatMap((w) => w.days);
  const year: DateWindow | null =
    days.length > 0 ? { startsOn: days[0]!, endsOn: days[days.length - 1]! } : null;
  const placed: PlacedUnit<U>[] = [];
  const unplaced: U[] = [];
  for (const unit of units) {
    if (unit.status === 'archived') continue;
    const window = unitWindow(unit, today);
    if (!window) {
      unplaced.push(unit);
      continue;
    }
    placed.push({
      unit,
      startsOn: window.startsOn,
      endsOn: window.endsOn,
      inferred: window.inferred,
      lateStart: unit.status === 'planned' && window.startsOn < today,
      lane: 0,
    });
  }
  placed.sort(
    (a, b) =>
      a.startsOn.localeCompare(b.startsOn) ||
      a.endsOn.localeCompare(b.endsOn) ||
      a.unit.title.localeCompare(b.unit.title, 'fr-CA'),
  );

  const bySubject = new Map<string, PlacedUnit<U>[][]>();
  const overlaps: UnitOverlap[] = [];
  for (const p of placed) {
    const lanes = bySubject.get(p.unit.subjectId) ?? [];
    for (const other of lanes.flat()) {
      const both = overlapOf(p, other);
      if (both) {
        overlaps.push({
          subjectId: p.unit.subjectId,
          first: other.unit.id,
          second: p.unit.id,
          from: both.startsOn,
          to: both.endsOn,
        });
      }
    }
    let lane = lanes.findIndex((l) => l[l.length - 1]!.endsOn < p.startsOn);
    if (lane < 0) {
      lane = lanes.length;
      lanes.push([]);
    }
    p.lane = lane;
    lanes[lane]!.push(p);
    bySubject.set(p.unit.subjectId, lanes);
  }

  return {
    bySubject,
    overlaps,
    outsideYear: placed.filter(
      (p) => !year || p.startsOn < year.startsOn || p.endsOn > year.endsOn,
    ),
    unplaced,
  };
}
