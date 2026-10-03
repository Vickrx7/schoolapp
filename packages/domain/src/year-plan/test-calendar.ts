/**
 * The demo board's 2026-2027 calendar, read from supabase/seed.sql (its board-wide PA days and
 * holidays), for the year-plan tests: what the demo shows is what the tests check.
 */
import { readFileSync } from 'node:fs';
import type { CalendarEventType } from '../calendar';
import type { YearCalendarEvent } from './weeks';

export const YEAR = { startsOn: '2026-09-02', endsOn: '2027-06-25' } as const;
export const SCHOOL = 'c0000000-0000-4000-8000-000000000001';
export const CLASS = 'e0000000-0000-4000-8000-000000000003';

const ROW =
  /\('b0000000-0000-4000-8000-000000000001', null, '(pa_day|holiday)', '((?:[^']|'')+)', '(\d{4}-\d{2}-\d{2})', '(\d{4}-\d{2}-\d{2})'/g;

/** The seed's board-wide days off. */
export function seededDaysOff(): YearCalendarEvent[] {
  const seed = readFileSync(new URL('../../../../supabase/seed.sql', import.meta.url), 'utf8');
  return [...seed.matchAll(ROW)].map((m, i) => ({
    id: `seed-${i}`,
    eventType: m[1] as CalendarEventType,
    title: m[2]!.replaceAll("''", "'"),
    startsOn: m[3]!,
    endsOn: m[4]!,
    startTime: null,
    endTime: null,
    affectsSchedule: true,
    classId: null,
    schoolId: null,
  }));
}

export const event = (
  id: string,
  overrides: Partial<YearCalendarEvent> & Pick<YearCalendarEvent, 'startsOn'>,
): YearCalendarEvent => ({
  id,
  eventType: 'other',
  title: id,
  endsOn: overrides.startsOn,
  startTime: null,
  endTime: null,
  affectsSchedule: true,
  classId: null,
  schoolId: null,
  ...overrides,
});
