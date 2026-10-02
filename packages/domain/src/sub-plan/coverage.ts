/**
 * What a substitute covers on one day (DECISIONS D-055): the teacher's own blocks (assigned to
 * her, or unassigned in her homeroom classes, so her duty and prep blocks too) plus handovers
 * (homeroom blocks another adult teaches), after calendar events are applied. Half days keep
 * the blocks that start before (morning) or at/after (afternoon) the split.
 */
import { NO_SCHOOL_EVENT_TYPES, SHORTENING_EVENT_TYPES, occursOn } from '../calendar';
import {
  datesInRange,
  isWeekend,
  minutesToTime,
  timeToMinutes,
  type LocalDate,
  type LocalTime,
} from '../dates';
import { dayKeyFor, type DayKeyResult, type ScheduleConfig } from '../schedule';
import { isTeachersBlock, resolveSchoolDay, type ResolvedBlock } from '../school-day';
import { formalStaffName } from './compose';
import type { AbsencePart, PlanWarningCode } from './schema';
import type { SubPlanSourceEvent, SubPlanSources } from './sources';
import { compareFr } from './text';

export function scheduleOf(sources: SubPlanSources): ScheduleConfig {
  const { school } = sources;
  return school.scheduleType === 'cycle' && school.cycleLength
    ? { type: 'cycle', cycleLength: school.cycleLength, anchors: sources.anchors }
    : { type: 'weekly' };
}

/**
 * The weekdays of an absence with what kind of day each is: a school day (`instructional`, or
 * `unknown_cycle_day` for a rotating-day school without an anchor), or no school (PA day,
 * holiday). Weekends are skipped.
 */
export function absenceSchoolDays(
  sources: SubPlanSources,
  startsOn: LocalDate,
  endsOn: LocalDate,
): { date: LocalDate; day: DayKeyResult }[] {
  const schedule = scheduleOf(sources);
  return datesInRange(startsOn, endsOn)
    .filter((date) => !isWeekend(date))
    .map((date) => ({ date, day: dayKeyFor(date, schedule, sources.events) }));
}

/**
 * Where morning ends: the school setting if set; else the start of the first lunch block; else
 * the start of the nutrition break nearest the middle of the day (a guess). With no break at
 * all, the middle of the day (also a guess). Null when the day has no blocks.
 */
export function halfDaySplit(
  blocks: readonly Pick<ResolvedBlock, 'kind' | 'startTime' | 'endTime'>[],
  override: LocalTime | null,
): { time: LocalTime | null; guessed: boolean } {
  if (override) return { time: override, guessed: false };
  if (blocks.length === 0) return { time: null, guessed: false };

  const byStart = [...blocks].sort(
    (a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime),
  );
  const lunch = byStart.find((b) => b.kind === 'lunch');
  if (lunch) return { time: lunch.startTime, guessed: false };

  const dayStart = timeToMinutes(byStart[0]!.startTime);
  const dayEnd = Math.max(...byStart.map((b) => timeToMinutes(b.endTime)));
  const middle = (dayStart + dayEnd) / 2;
  let nearest: (typeof byStart)[number] | null = null;
  for (const b of byStart) {
    if (b.kind !== 'nutrition_break') continue;
    const distance = Math.abs(timeToMinutes(b.startTime) - middle);
    if (!nearest || distance < Math.abs(timeToMinutes(nearest.startTime) - middle)) nearest = b;
  }
  if (nearest) return { time: nearest.startTime, guessed: true };
  return { time: minutesToTime(Math.floor(middle / 5) * 5), guessed: true };
}

/**
 * The teacher's classes whose school year includes `date` (DECISIONS D-055, as amended in the
 * Phase 6 review): a class kept from an earlier year, with its timetable, is never covered on a
 * later day. A class without its year's dates (older sources) counts.
 */
export function classesOn(sources: SubPlanSources, date: LocalDate): SubPlanSources['classes'] {
  return sources.classes.filter(
    (c) =>
      (c.yearStartsOn === null || c.yearStartsOn <= date) &&
      (c.yearEndsOn === null || date <= c.yearEndsOn),
  );
}

/** A block of the plan day, with the names the plan shows. */
export interface CoverageBlock extends ResolvedBlock {
  /** 'covered': the substitute teaches or supervises; 'handover': another adult takes the group. */
  role: 'covered' | 'handover';
  className: string;
  /** timetable_blocks.notes */
  notes: string | null;
  /** The block's room, else the class's room. */
  roomName: string | null;
  subjectLabel: string | null;
  /** For handovers: « M. Leblanc ». */
  otherAdult: string | null;
  /** Notes of the event in `affectedBy`, if any. */
  eventNotes: string | null;
}

export interface DayCoverage {
  date: LocalDate;
  part: AbsencePart;
  day: DayKeyResult;
  /** The teacher's blocks in the part of day, in time order (cancelled blocks left out). */
  covered: CoverageBlock[];
  handovers: CoverageBlock[];
  /** `covered` and `handovers` together, in time order. */
  blocks: CoverageBlock[];
  /** The teacher's own blocks outside a half day: they only keep lesson sequencing right. */
  outsidePart: ResolvedBlock[];
  /** Classes with a covered or handover block (homeroom classes when the cycle day is unknown). */
  classIds: string[];
  /** Events of the day that change none of these blocks (assemblies elsewhere, notices...). */
  dayEvents: SubPlanSourceEvent[];
  window: { start: LocalTime; end: LocalTime };
  split: LocalTime | null;
  endOfDay: LocalTime;
  warnings: PlanWarningCode[];
}

function byTime(a: CoverageBlock, b: CoverageBlock): number {
  return (
    timeToMinutes(a.effectiveStart) - timeToMinutes(b.effectiveStart) ||
    compareFr(a.className, b.className) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

export function coverageForDay(input: {
  date: LocalDate;
  sources: SubPlanSources;
  part: AbsencePart;
}): DayCoverage {
  const { date, sources, part } = input;
  const teacherId = sources.teacher.id;
  const settings = sources.school.settings;
  const schedule = scheduleOf(sources);
  const day = dayKeyFor(date, schedule, sources.events);

  const classes = classesOn(sources, date).sort((a, b) => compareFr(a.name, b.name));
  const homeroom = new Set(classes.filter((c) => c.role === 'homeroom').map((c) => c.id));
  const rooms = new Map(sources.rooms.map((r) => [r.id, r.name]));
  const subjects = new Map(sources.subjects.map((s) => [s.id, s.labelFr]));
  const notes = new Map(sources.blocks.map((b) => [b.id, b.notes]));
  const eventNotes = new Map(sources.events.map((e) => [e.id, e.notes]));
  const people = new Map(sources.team.map((m) => [m.userId, m]));

  const allBlocks: ResolvedBlock[] = [];
  const own: CoverageBlock[] = [];
  const handovers: CoverageBlock[] = [];
  for (const cls of classes) {
    const resolved = resolveSchoolDay({
      date,
      classId: cls.id,
      schedule,
      events: sources.events,
      blocks: sources.blocks,
    });
    for (const b of resolved.blocks) {
      allBlocks.push(b);
      const mine = isTeachersBlock(b, teacherId, homeroom);
      const handover = !mine && homeroom.has(b.classId) && b.teacherId !== null;
      if ((!mine && !handover) || b.status === 'cancelled') continue;
      const other = handover ? people.get(b.teacherId!) : undefined;
      const block: CoverageBlock = {
        ...b,
        role: mine ? 'covered' : 'handover',
        className: cls.name,
        notes: notes.get(b.id) ?? null,
        roomName:
          (b.roomId ? rooms.get(b.roomId) : undefined) ??
          (cls.roomId ? (rooms.get(cls.roomId) ?? null) : null),
        subjectLabel: b.subjectId ? (subjects.get(b.subjectId) ?? null) : null,
        otherAdult: other ? formalStaffName(other.displayName, other.honorific) : null,
        eventNotes: b.affectedBy ? (eventNotes.get(b.affectedBy.id) ?? null) : null,
      };
      (mine ? own : handovers).push(block);
    }
  }

  const splitResult = halfDaySplit(allBlocks, settings.substitute.halfDaySplit);
  const split = splitResult.time;
  const inPart = (b: ResolvedBlock) =>
    part === 'full_day' ||
    split === null ||
    (part === 'am'
      ? timeToMinutes(b.effectiveStart) < timeToMinutes(split)
      : timeToMinutes(b.effectiveStart) >= timeToMinutes(split));

  const covered = own.filter(inPart).sort(byTime);
  const keptHandovers = handovers.filter(inPart).sort(byTime);
  const blocks = [...covered, ...keptHandovers].sort(byTime);
  const outsidePart = own.filter((b) => !inPart(b));

  // The window: the blocks' span, cut at the split for half days; school hours without blocks.
  const firstStart = blocks[0]?.effectiveStart ?? settings.dayStart;
  const lastEnd = blocks.reduce<LocalTime>(
    (max, b) => (timeToMinutes(b.effectiveEnd) > timeToMinutes(max) ? b.effectiveEnd : max),
    blocks[0]?.effectiveEnd ?? settings.dayEnd,
  );
  const window =
    part === 'am'
      ? { start: blocks.length ? firstStart : settings.dayStart, end: split ?? settings.dayEnd }
      : part === 'pm'
        ? { start: split ?? settings.dayStart, end: blocks.length ? lastEnd : settings.dayEnd }
        : { start: firstStart, end: lastEnd };

  const classIds =
    day.status === 'unknown_cycle_day'
      ? classes.filter((c) => homeroom.has(c.id)).map((c) => c.id)
      : classes.filter((c) => blocks.some((b) => b.classId === c.id)).map((c) => c.id);

  // Events that changed a block show on it. The rest are listed if they touch the window, and
  // an early dismissal or late start always is (it explains why the day is shorter).
  const onBlocks = new Set(blocks.flatMap((b) => (b.affectedBy ? [b.affectedBy.id] : [])));
  const windowStart = timeToMinutes(window.start);
  const windowEnd = timeToMinutes(window.end);
  const dayEvents = sources.events
    .filter(
      (e) =>
        occursOn(e, date) &&
        !NO_SCHOOL_EVENT_TYPES.includes(e.eventType) &&
        (e.classId === null || classIds.includes(e.classId)) &&
        !onBlocks.has(e.id) &&
        (SHORTENING_EVENT_TYPES.includes(e.eventType) ||
          ((e.startTime ? timeToMinutes(e.startTime) : 0) < windowEnd &&
            (e.endTime ? timeToMinutes(e.endTime) : 24 * 60) > windowStart)),
    )
    .sort(
      (a, b) =>
        (a.startTime ?? '').localeCompare(b.startTime ?? '') ||
        compareFr(a.title, b.title) ||
        (a.id < b.id ? -1 : 1),
    );

  const warnings: PlanWarningCode[] = [];
  if (classes.length === 0) warnings.push('no_classes');
  if (day.status === 'unknown_cycle_day') warnings.push('unknown_cycle_day');
  if (part !== 'full_day' && splitResult.guessed) warnings.push('half_day_split_guessed');

  return {
    date,
    part,
    day,
    covered,
    handovers: keptHandovers,
    blocks,
    outsidePart,
    classIds,
    dayEvents,
    window,
    split,
    endOfDay: window.end,
    warnings,
  };
}
