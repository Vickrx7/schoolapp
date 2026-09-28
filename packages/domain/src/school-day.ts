/**
 * Resolves what a school day actually looks like for one class: which timetable blocks run,
 * and how calendar events (PA days, early dismissals, masses, assemblies) change them.
 * Used by the "today" view now and by the substitute plan generator in Phase 3.
 */
import { eventsOn, SHORTENING_EVENT_TYPES, type CalendarEvent } from './calendar';
import { minutesToTime, timeToMinutes, type LocalDate, type LocalTime } from './dates';
import { dayKeyFor, type DayKeyResult, type ScheduleConfig } from './schedule';

export type BlockKind =
  'subject' | 'routine' | 'recess' | 'lunch' | 'nutrition_break' | 'prep' | 'duty' | 'other';

export interface TimetableBlock {
  id: string;
  classId: string;
  dayKey: number;
  startTime: LocalTime;
  endTime: LocalTime;
  kind: BlockKind;
  subjectId: string | null;
  title: string | null;
  teacherId: string | null;
  roomId: string | null;
}

export type BlockStatus =
  /** Runs as scheduled. */
  | 'normal'
  /** Does not happen (early dismissal or late start covers it entirely). */
  | 'cancelled'
  /** Happens but is cut short by an early dismissal or late start. */
  | 'shortened'
  /** An event (mass, assembly...) takes the whole block. */
  | 'replaced'
  /** An event takes part of the block. */
  | 'interrupted';

export interface ResolvedBlock extends TimetableBlock {
  status: BlockStatus;
  effectiveStart: LocalTime;
  effectiveEnd: LocalTime;
  /** The calendar event that changed this block, if any. */
  affectedBy: CalendarEvent | null;
}

export interface ResolvedSchoolDay {
  date: LocalDate;
  day: DayKeyResult;
  /** Events on this date for this class (including informational ones). */
  events: CalendarEvent[];
  blocks: ResolvedBlock[];
}

const DAY_START = 0;
const DAY_END = 24 * 60;

function eventWindow(event: CalendarEvent): [number, number] {
  return [
    event.startTime ? timeToMinutes(event.startTime) : DAY_START,
    event.endTime ? timeToMinutes(event.endTime) : DAY_END,
  ];
}

const STATUS_PRIORITY: Record<BlockStatus, number> = {
  normal: 0,
  interrupted: 1,
  replaced: 2,
  shortened: 3,
  cancelled: 4,
};

function applyEvent(block: ResolvedBlock, event: CalendarEvent): ResolvedBlock {
  const start = timeToMinutes(block.effectiveStart);
  const end = timeToMinutes(block.effectiveEnd);
  const [from, to] = eventWindow(event);
  if (to <= start || from >= end) return block; // no overlap

  let next: ResolvedBlock;
  if (SHORTENING_EVENT_TYPES.includes(event.eventType)) {
    if (from <= start && to >= end) {
      next = { ...block, status: 'cancelled', affectedBy: event };
    } else if (from > start) {
      // Early dismissal: classes end at `from`.
      next = {
        ...block,
        status: 'shortened',
        effectiveEnd: minutesToTime(from),
        affectedBy: event,
      };
    } else {
      // Late start: classes begin at `to`.
      next = {
        ...block,
        status: 'shortened',
        effectiveStart: minutesToTime(to),
        affectedBy: event,
      };
    }
  } else if (from <= start && to >= end) {
    next = { ...block, status: 'replaced', affectedBy: event };
  } else {
    next = { ...block, status: 'interrupted', affectedBy: event };
  }

  return STATUS_PRIORITY[next.status] >= STATUS_PRIORITY[block.status] ? next : block;
}

export function resolveSchoolDay(input: {
  date: LocalDate;
  classId: string;
  schedule: ScheduleConfig;
  /** All events that might apply (board, school and class level). */
  events: readonly CalendarEvent[];
  /** The class's whole timetable (all day keys). */
  blocks: readonly TimetableBlock[];
}): ResolvedSchoolDay {
  const { date, classId, schedule } = input;
  const events = eventsOn(input.events, date, classId);
  const day = dayKeyFor(date, schedule, input.events);

  if (day.status !== 'instructional') {
    return { date, day, events, blocks: [] };
  }

  const scheduleEvents = events.filter((e) => e.affectsSchedule);
  const blocks = input.blocks
    .filter((b) => b.classId === classId && b.dayKey === day.dayKey)
    .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime))
    .map((b) => {
      let resolved: ResolvedBlock = {
        ...b,
        status: 'normal',
        effectiveStart: b.startTime,
        effectiveEnd: b.endTime,
        affectedBy: null,
      };
      for (const event of scheduleEvents) resolved = applyEvent(resolved, event);
      return resolved;
    });

  return { date, day, events, blocks };
}

/** Whether a block still involves teaching its subject (so a lesson can happen). */
export function isTeachable(block: ResolvedBlock): boolean {
  return (
    block.kind === 'subject' &&
    (block.status === 'normal' || block.status === 'shortened' || block.status === 'interrupted')
  );
}

/**
 * Blocks a given teacher is responsible for: blocks assigned to them, plus unassigned blocks
 * of classes where they are a homeroom teacher.
 */
export function isTeachersBlock(
  block: Pick<TimetableBlock, 'teacherId' | 'classId'>,
  teacherId: string,
  homeroomClassIds: ReadonlySet<string>,
): boolean {
  if (block.teacherId !== null) return block.teacherId === teacherId;
  return homeroomClassIds.has(block.classId);
}

/** Pairs of blocks that overlap in time on the same day (a warning, not an error). */
export function findOverlaps(
  blocks: readonly Pick<TimetableBlock, 'id' | 'dayKey' | 'startTime' | 'endTime'>[],
): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const sorted = [...blocks].sort(
    (a, b) => a.dayKey - b.dayKey || timeToMinutes(a.startTime) - timeToMinutes(b.startTime),
  );
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i]!;
      const b = sorted[j]!;
      if (b.dayKey !== a.dayKey) break;
      if (timeToMinutes(b.startTime) >= timeToMinutes(a.endTime)) break;
      out.push([a.id, b.id]);
    }
  }
  return out;
}
