/**
 * Database helpers for the « Info-parents » specs (DECISIONS D-136 to D-138), as the database
 * owner (see db.ts). The seed has no message: each spec makes its own and deletes them.
 */
import { addDays, emptyNewsletterContent, mondayOf, typedItem } from '@lynx/domain';
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
