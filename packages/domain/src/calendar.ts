import type { LocalDate, LocalTime } from './dates';

export type CalendarEventType =
  | 'pa_day'
  | 'holiday'
  | 'early_dismissal'
  | 'late_start'
  | 'mass'
  | 'liturgy'
  | 'assembly'
  | 'field_trip'
  | 'other';

export interface CalendarEvent {
  id: string;
  eventType: CalendarEventType;
  title: string;
  startsOn: LocalDate;
  endsOn: LocalDate;
  startTime: LocalTime | null;
  endTime: LocalTime | null;
  affectsSchedule: boolean;
  /** Null for board-wide or school-wide events. */
  classId: string | null;
}

/** Event types that mean there are no classes at all that day. */
export const NO_SCHOOL_EVENT_TYPES: readonly CalendarEventType[] = ['pa_day', 'holiday'];

/** Event types that cut blocks short or cancel them (vs. replacing them with an activity). */
export const SHORTENING_EVENT_TYPES: readonly CalendarEventType[] = [
  'early_dismissal',
  'late_start',
];

export function occursOn(event: CalendarEvent, date: LocalDate): boolean {
  return event.startsOn <= date && date <= event.endsOn;
}

/** Events on a date that apply to the whole school or to the given class. */
export function eventsOn(
  events: readonly CalendarEvent[],
  date: LocalDate,
  classId?: string | null,
): CalendarEvent[] {
  return events.filter(
    (e) => occursOn(e, date) && (e.classId === null || (classId != null && e.classId === classId)),
  );
}

/** The event that closes school on this date (PA day, holiday), if any. School-wide only. */
export function noSchoolEventOn(
  events: readonly CalendarEvent[],
  date: LocalDate,
): CalendarEvent | null {
  return (
    events.find(
      (e) =>
        e.classId === null &&
        e.affectsSchedule &&
        NO_SCHOOL_EVENT_TYPES.includes(e.eventType) &&
        occursOn(e, date),
    ) ?? null
  );
}
