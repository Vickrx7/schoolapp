/**
 * Database helpers for the « Commentaires de bulletin » specs (DECISIONS D-129 to D-135), as the
 * database owner (see db.ts).
 */
import { query } from './db';

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
