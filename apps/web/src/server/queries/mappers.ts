import 'server-only';
import type { Tables } from '@lynx/db';
import {
  normalizeTime,
  type CalendarEvent,
  type CycleAnchor,
  type ScheduleConfig,
  type TimetableBlock,
} from '@lynx/domain';
import type { SchoolContext } from '../session';

export function toCalendarEvent(
  row: Pick<
    Tables<'school_calendar_events'>,
    | 'id'
    | 'event_type'
    | 'title'
    | 'starts_on'
    | 'ends_on'
    | 'start_time'
    | 'end_time'
    | 'affects_schedule'
    | 'class_id'
  >,
): CalendarEvent {
  return {
    id: row.id,
    eventType: row.event_type,
    title: row.title,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    startTime: row.start_time ? normalizeTime(row.start_time) : null,
    endTime: row.end_time ? normalizeTime(row.end_time) : null,
    affectsSchedule: row.affects_schedule,
    classId: row.class_id,
  };
}

export function toTimetableBlock(
  row: Pick<
    Tables<'timetable_blocks'>,
    | 'id'
    | 'class_id'
    | 'day_key'
    | 'start_time'
    | 'end_time'
    | 'kind'
    | 'subject_id'
    | 'title'
    | 'teacher_id'
    | 'room_id'
  >,
): TimetableBlock {
  return {
    id: row.id,
    classId: row.class_id,
    dayKey: row.day_key,
    startTime: normalizeTime(row.start_time),
    endTime: normalizeTime(row.end_time),
    kind: row.kind,
    subjectId: row.subject_id,
    title: row.title,
    teacherId: row.teacher_id,
    roomId: row.room_id,
  };
}

export function scheduleFor(school: SchoolContext, anchors: CycleAnchor[]): ScheduleConfig {
  return school.scheduleType === 'cycle' && school.cycleLength
    ? { type: 'cycle', cycleLength: school.cycleLength, anchors }
    : { type: 'weekly' };
}

/** Events that apply to a school: board-wide ones of its board, plus its own. */
export function eventsForSchool<E extends { board_id: string; school_id: string | null }>(
  rows: readonly E[],
  school: SchoolContext,
): E[] {
  return rows.filter(
    (r) => (r.school_id === null && r.board_id === school.boardId) || r.school_id === school.id,
  );
}
