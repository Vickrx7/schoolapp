/**
 * Database helpers for the « Info-parents » specs (DECISIONS D-136 to D-138), as the database
 * owner (see db.ts). The seed has no message: each spec makes its own and deletes them.
 */
import {
  addDays,
  emptyNewsletterContent,
  mondayOf,
  newsletterReminderDue,
  schoolWeeks,
  typedItem,
  type CalendarEventType,
} from '@lynx/domain';
import { query } from './db';
import { torontoToday } from './db-report-comments';

/** Deletes every message of a class. */
export async function deleteNewsletters(classId: string): Promise<void> {
  await query('delete from public.class_newsletters where class_id = $1', [classId]);
}

/** A class's message for a week, as stored. */
export async function newsletterOf(
  classId: string,
  weekOf: string,
): Promise<{ id: string; status: string; revision: number; content: unknown } | undefined> {
  const [row] = await query<{ id: string; status: string; revision: number; content: unknown }>(
    `select id, status, revision, content from public.class_newsletters
     where class_id = $1 and week_of = $2`,
    [classId, weekOf],
  );
  return row;
}

/** A minimal message (one typed paragraph), as the owner (no author). */
export async function insertNewsletter(classId: string, weekOf: string, text: string) {
  const content = emptyNewsletterContent('Mme Tremblay');
  content.sections[0]!.items.push(typedItem('e2eitem1', text));
  await query(
    `insert into public.class_newsletters (class_id, week_of, content) values ($1, $2, $3)
     on conflict (class_id, week_of) do update set content = excluded.content`,
    [classId, weekOf, JSON.stringify(content)],
  );
}

/** This week's Monday and the next, on the demo board's clock. */
export async function demoWeeks(): Promise<{ today: string; thisWeek: string; nextWeek: string }> {
  const today = await torontoToday();
  const thisWeek = mondayOf(today);
  return { today, thisWeek, nextWeek: addDays(thisWeek, 7) };
}

/**
 * Whether « Aujourd'hui » reminds about a class's message today (D-142): today is one of the last
 * two school days of its week, by the demo board's calendar (newsletterReminderDue is unit tested;
 * the browser test checks the page agrees, whatever the day it runs).
 */
export async function newsletterReminderDueToday(classId: string): Promise<boolean> {
  const today = await torontoToday();
  const monday = mondayOf(today);
  const friday = addDays(monday, 4);
  const [cls] = await query<{
    school_id: string;
    board_id: string;
    starts_on: string;
    ends_on: string;
  }>(
    `select c.school_id, s.board_id, y.starts_on::text, y.ends_on::text
     from public.classes c
     join public.schools s on s.id = c.school_id
     join public.school_years y on y.id = c.school_year_id
     where c.id = $1`,
    [classId],
  );
  const startsOn = cls!.starts_on > monday ? cls!.starts_on : monday;
  const endsOn = cls!.ends_on < friday ? cls!.ends_on : friday;
  if (endsOn < startsOn) return false;
  const events = await query<{
    id: string;
    school_id: string | null;
    class_id: string | null;
    event_type: CalendarEventType;
    title: string;
    starts_on: string;
    ends_on: string;
    affects_schedule: boolean;
  }>(
    `select id, school_id, class_id, event_type::text as event_type, title, starts_on::text,
            ends_on::text, affects_schedule
     from public.school_calendar_events
     where board_id = $1 and starts_on <= $3 and ends_on >= $2`,
    [cls!.board_id, startsOn, endsOn],
  );
  const [week] = schoolWeeks({
    startsOn,
    endsOn,
    events: events.map((e) => ({
      id: e.id,
      eventType: e.event_type,
      title: e.title,
      startsOn: e.starts_on,
      endsOn: e.ends_on,
      startTime: null,
      endTime: null,
      affectsSchedule: e.affects_schedule,
      classId: e.class_id,
      schoolId: e.school_id,
    })),
    schoolId: cls!.school_id,
    classId,
  });
  return week ? newsletterReminderDue(week, today) : false;
}
