/**
 * Database helpers for the « Commentaires de bulletin » specs (DECISIONS D-129 to D-135), as the
 * database owner (see db.ts).
 */
import { seedItemId } from '@lynx/content';
import { deleteLibraryItems, query } from './db';

/**
 * Deletes a staff member's « Créer une banque avec l’IA » requests (`ai_jobs`), so a spec starts
 * and ends with none open (the hub lists open ones under « En préparation »).
 */
export async function deleteBankRequests(email: string): Promise<void> {
  await query(
    `delete from public.ai_jobs j using public.users u
     where j.user_id = u.id and u.email = $1 and j.feature = 'report_comment_bank'`,
    [email],
  );
}

/** The demo pack's banks (`content/library/demo/items/commentaires-*.json`) by slug. */
export function bankItemId(slug: string): string {
  return seedItemId('demo', slug);
}

/** Deletes the comment banks whose title starts with `prefix` (a spec's « E2E-… » banks). */
export async function deleteCommentBanks(prefix: string): Promise<void> {
  const rows = await query<{ id: string }>(
    `select id from public.library_items where type = 'report_comments' and title like $1 || '%'`,
    [prefix],
  );
  await deleteLibraryItems({ ids: rows.map((r) => r.id) });
}

/** The demo teachers' user ids (supabase/seed.sql). */
export const DEMO_USER_IDS = {
  isabelle: 'd0000000-0000-4000-8000-000000000001',
  marc: 'd0000000-0000-4000-8000-000000000002',
  paul: 'd0000000-0000-4000-8000-000000000003',
};

/** The school-local date in the demo board (America/Toronto), as the app reads it. */
export async function torontoToday(): Promise<string> {
  const [row] = await query<{ today: string }>(
    "select ((now() at time zone 'America/Toronto')::date)::text as today",
  );
  return row!.today;
}
