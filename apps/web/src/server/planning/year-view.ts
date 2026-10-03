/**
 * « Mon année » (DECISIONS D-126): what the year view shows, computed from the class's school
 * weeks, report periods and units. Pure (no database, no messages), so the desktop grid and the
 * phone's month list read the same model and the unit tests check it.
 *
 * - The grid: one column per week (Monday to Friday), grouped by month; a « Calendrier » row
 *   (weeks without school, partial weeks, masses), a « Bulletins » row (report dates), a « Temps
 *   liturgique » row (seasons, each week taken by its Wednesday) and one row per subject with
 *   units or timetable blocks. A subject gets a second lane when two of its units share a week.
 * - The month list (phones): per month, its school days, days off, events, report dates, seasons
 *   and the units that touch it.
 * - What needs the teacher's eye: overlaps, units over weeks without school, units outside the
 *   year, units dated from their lessons (« Dates d'après les leçons données ») and units
 *   without dates.
 */
import {
  addDays,
  liturgicalBands,
  mondayOf,
  placeUnits,
  reportMarkers,
  weeksOf,
  type CalendarEvent,
  type CalendarEventType,
  type DateWindow,
  type LiturgicalBand,
  type LiturgicalBandSeason,
  type LocalDate,
  type PlacedUnit,
  type PlacementUnit,
  type ReportMarker,
  type ReportPeriod,
  type SchoolWeek,
} from '@lynx/domain';

export interface YearViewSubject {
  id: string;
  label: string;
  color: string | null;
}

/** Event types the grid marks as « Messe ». */
const MASS_TYPES: ReadonlySet<CalendarEventType> = new Set(['mass', 'liturgy']);

export interface YearWeek {
  index: number;
  monday: LocalDate;
  /** Its first weekday in the year (the Monday, except in the year's first week). */
  first: LocalDate;
  /** Its last weekday in the year. */
  last: LocalDate;
  /** Weekdays inside the year, and how many have school. */
  days: number;
  schoolDays: number;
  /** No school at all that week (« Pas d'école »). */
  noSchool: boolean;
  /** The PA days and holidays that close days of the week, by title, first first. */
  closures: string[];
  /** Masses and liturgies that week. */
  masses: CalendarEvent[];
  /** Report dates that week (Monday to Sunday). */
  markers: ReportMarker[];
  /** The liturgical season of its Wednesday (null: Ordinary Time). */
  season: LiturgicalBandSeason | null;
  /** The week of `today`. */
  current: boolean;
}

/** Consecutive columns under one header (a month, a season). */
export interface ColumnSpan<K> {
  key: K;
  start: number;
  span: number;
}

export interface SeasonSpan extends ColumnSpan<LiturgicalBandSeason | null> {
  /** The season's dates (null for Ordinary Time). */
  band: LiturgicalBand | null;
}

export type GridCell<U extends PlacementUnit> =
  | { kind: 'empty'; week: number }
  | { kind: 'unit'; placed: PlacedUnit<U>; start: number; span: number };

export interface GridRow<U extends PlacementUnit> {
  subject: YearViewSubject;
  /** One or more lanes, each a full row of cells (units span their weeks). */
  lanes: GridCell<U>[][];
}

export interface OverlapWarning<U extends PlacementUnit> {
  subject: YearViewSubject;
  first: U;
  second: U;
  from: LocalDate;
  to: LocalDate;
}

export interface BreakWarning<U extends PlacementUnit> {
  placed: PlacedUnit<U>;
  /** The breaks' titles (« Congé des Fêtes »). */
  titles: string[];
  /** How many of its weeks have no school. */
  weeks: number;
}

export interface MonthDayOff {
  title: string;
  from: LocalDate;
  to: LocalDate;
}

export interface MonthEvent {
  id: string;
  title: string;
  type: CalendarEventType;
  from: LocalDate;
  to: LocalDate;
}

export interface YearMonth<U extends PlacementUnit> {
  /** The month's first day (YYYY-MM-01). */
  month: LocalDate;
  schoolDays: number;
  current: boolean;
  /** Days off, consecutive school days with one title taken together. */
  daysOff: MonthDayOff[];
  events: MonthEvent[];
  markers: ReportMarker[];
  seasons: LiturgicalBand[];
  units: PlacedUnit<U>[];
}

export interface YearView<U extends PlacementUnit> {
  weeks: YearWeek[];
  months: ColumnSpan<LocalDate>[];
  seasons: SeasonSpan[];
  rows: GridRow<U>[];
  monthList: YearMonth<U>[];
  overlaps: OverlapWarning<U>[];
  breaks: BreakWarning<U>[];
  /** Units not wholly inside the school year (« Hors de l'année scolaire »). */
  outsideYear: PlacedUnit<U>[];
  /** Units dated from their lessons, to confirm (« Enregistrer ces dates »). */
  inferred: PlacedUnit<U>[];
  /** Units with no dates at all (« Unités sans dates »). */
  unplaced: U[];
}

const monthOf = (date: LocalDate): LocalDate => `${date.slice(0, 7)}-01`;

function nextMonth(month: LocalDate): LocalDate {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

const lastOfMonth = (month: LocalDate): LocalDate => addDays(nextMonth(month), -1);

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

/** Groups consecutive equal keys into column spans. */
function spans<K>(keys: readonly K[]): ColumnSpan<K>[] {
  const out: ColumnSpan<K>[] = [];
  keys.forEach((key, index) => {
    const last = out[out.length - 1];
    if (last && last.key === key) last.span += 1;
    else out.push({ key, start: index, span: 1 });
  });
  return out;
}

const overlapsWindow = (a: DateWindow, from: LocalDate, to: LocalDate) =>
  a.startsOn <= to && a.endsOn >= from;

export function buildYearView<U extends PlacementUnit>(input: {
  year: DateWindow;
  weeks: readonly SchoolWeek[];
  periods: readonly ReportPeriod[];
  units: readonly U[];
  /** The rows' subjects, in order; one shows when it has units or timetable blocks. */
  subjects: readonly YearViewSubject[];
  /** Subjects with timetable blocks in the class. */
  blockSubjectIds: ReadonlySet<string>;
  today: LocalDate;
}): YearView<U> {
  const { year, today } = input;
  const markers = reportMarkers([...input.periods]);
  const bands = liturgicalBands(year.startsOn, year.endsOn);
  const bandOn = (date: LocalDate) => bands.find((b) => b.from <= date && date <= b.to) ?? null;
  const thisMonday = mondayOf(today);

  const weeks: YearWeek[] = input.weeks.map((w, index) => {
    const sunday = addDays(w.monday, 6);
    return {
      index,
      monday: w.monday,
      first: w.days[0] ?? w.monday,
      last: w.days[w.days.length - 1] ?? addDays(w.monday, 4),
      days: w.days.length,
      schoolDays: w.schoolDays,
      noSchool: w.days.length > 0 && w.schoolDays === 0,
      closures: unique(w.daysOff.map((d) => d.title)),
      masses: w.events.filter((e) => MASS_TYPES.has(e.eventType)),
      markers: markers.filter((m) => m.date >= w.monday && m.date <= sunday),
      season: bandOn(addDays(w.monday, 2))?.season ?? null,
      current: w.monday === thisMonday,
    };
  });

  const months = spans(weeks.map((w) => monthOf(w.first)));
  const seasons: SeasonSpan[] = spans(weeks.map((w) => w.season)).map((s) => ({
    ...s,
    band: s.key ? (bandOn(addDays(weeks[s.start]!.monday, 2)) ?? null) : null,
  }));

  // Units on the year (the domain's placement: windows, inferred dates, overlaps).
  const placement = placeUnits(input.units, input.weeks, today);
  const placed = [...placement.bySubject.values()].flat(2);
  const weekIndex = new Map(input.weeks.map((w, i) => [w.monday, i]));
  const columnsOf = (p: PlacedUnit<U>): { start: number; span: number } | null => {
    const touched = weeksOf(p, input.weeks).map((w) => weekIndex.get(w.monday)!);
    if (touched.length === 0) return null;
    return { start: touched[0]!, span: touched[touched.length - 1]! - touched[0]! + 1 };
  };

  // Rows: subjects with units (archived ones aside) or timetable blocks.
  const withUnits = new Set(
    input.units.filter((u) => u.status !== 'archived').map((u) => u.subjectId),
  );
  const subjectById = new Map(input.subjects.map((s) => [s.id, s]));
  const rows: GridRow<U>[] = input.subjects
    .filter((s) => withUnits.has(s.id) || input.blockSubjectIds.has(s.id))
    .map((subject) => {
      const own = (placement.bySubject.get(subject.id) ?? [])
        .flat()
        .map((p) => ({ p, columns: columnsOf(p) }))
        .filter(
          (x): x is { p: PlacedUnit<U>; columns: { start: number; span: number } } =>
            x.columns !== null,
        )
        .sort(
          (a, b) => a.columns.start - b.columns.start || a.p.startsOn.localeCompare(b.p.startsOn),
        );
      // Lanes by week: two units sharing a week never share a lane.
      const lanes: { end: number; units: typeof own }[] = [];
      for (const x of own) {
        const lane = lanes.find((l) => l.end < x.columns.start);
        if (lane) {
          lane.units.push(x);
          lane.end = x.columns.start + x.columns.span - 1;
        } else {
          lanes.push({ end: x.columns.start + x.columns.span - 1, units: [x] });
        }
      }
      if (lanes.length === 0) lanes.push({ end: -1, units: [] });
      return {
        subject,
        lanes: lanes.map((lane) => {
          const cells: GridCell<U>[] = [];
          let next = 0;
          for (const { p, columns } of lane.units) {
            for (; next < columns.start; next++) cells.push({ kind: 'empty', week: next });
            cells.push({ kind: 'unit', placed: p, ...columns });
            next = columns.start + columns.span;
          }
          for (; next < weeks.length; next++) cells.push({ kind: 'empty', week: next });
          return cells;
        }),
      };
    });

  const unitById = new Map(input.units.map((u) => [u.id, u]));
  const overlaps: OverlapWarning<U>[] = placement.overlaps.flatMap((o) => {
    const subject = subjectById.get(o.subjectId);
    const first = unitById.get(o.first);
    const second = unitById.get(o.second);
    return subject && first && second ? [{ subject, first, second, from: o.from, to: o.to }] : [];
  });

  const breaks: BreakWarning<U>[] = placed
    .map((p) => {
      const closed = weeksOf(p, input.weeks).filter((w) => w.days.length > 0 && w.schoolDays === 0);
      return {
        placed: p,
        titles: unique(closed.flatMap((w) => w.daysOff.map((d) => d.title))),
        weeks: closed.length,
      };
    })
    .filter((b) => b.weeks > 0)
    .sort((a, b) => a.placed.startsOn.localeCompare(b.placed.startsOn));

  // The month list.
  const allDays = input.weeks.flatMap((w) => w.days);
  const dayIndex = new Map(allDays.map((d, i) => [d, i]));
  const offTitle = new Map(input.weeks.flatMap((w) => w.daysOff.map((d) => [d.date, d.title])));
  const events = new Map<string, CalendarEvent>();
  for (const w of input.weeks) for (const e of w.events) events.set(e.id, e);
  const subjectOrder = new Map(input.subjects.map((s, i) => [s.id, i]));
  const byStart = (a: PlacedUnit<U>, b: PlacedUnit<U>) =>
    a.startsOn.localeCompare(b.startsOn) ||
    (subjectOrder.get(a.unit.subjectId) ?? 999) - (subjectOrder.get(b.unit.subjectId) ?? 999) ||
    a.unit.title.localeCompare(b.unit.title, 'fr-CA');

  const monthList: YearMonth<U>[] = [];
  for (let month = monthOf(year.startsOn); month <= year.endsOn; month = nextMonth(month)) {
    const end = lastOfMonth(month);
    const days = allDays.filter((d) => d >= month && d <= end);
    const daysOff: MonthDayOff[] = [];
    for (const day of days) {
      const title = offTitle.get(day);
      if (title === undefined) continue;
      const last = daysOff[daysOff.length - 1];
      if (last && last.title === title && dayIndex.get(last.to)! + 1 === dayIndex.get(day)) {
        last.to = day;
      } else {
        daysOff.push({ title, from: day, to: day });
      }
    }
    monthList.push({
      month,
      schoolDays: days.filter((d) => !offTitle.has(d)).length,
      current: today >= month && today <= end,
      daysOff,
      events: [...events.values()]
        .filter((e) => e.startsOn <= end && e.endsOn >= month)
        .sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.title.localeCompare(b.title))
        .map((e) => ({
          id: e.id,
          title: e.title,
          type: e.eventType,
          from: e.startsOn,
          to: e.endsOn,
        })),
      markers: markers.filter((m) => m.date >= month && m.date <= end),
      seasons: bands.filter((b) => b.from <= end && b.to >= month),
      units: placed.filter((p) => overlapsWindow(p, month, end)).sort(byStart),
    });
  }

  return {
    weeks,
    months,
    seasons,
    rows,
    monthList,
    overlaps,
    breaks,
    outsideYear: [...placement.outsideYear].sort(byStart),
    inferred: placed.filter((p) => p.inferred).sort(byStart),
    unplaced: placement.unplaced,
  };
}
