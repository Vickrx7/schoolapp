import { redirect } from 'next/navigation';
import { subPortalConfigured } from '@/server/sub-portal/db';
import { loadDay } from '@/server/sub-portal/portal';
import { clearSubSessionCookie, readSubToken } from '@/server/sub-portal/session';

export const dynamic = 'force-dynamic';

/**
 * Where a portal page sends a session that no longer works (pages cannot change cookies): the
 * cookie is forgotten and « Accès suppléance » says the access ended. A session that still
 * works goes back to its plan, so a link to this address cannot sign anyone out.
 */
export async function GET() {
  const token = await readSubToken();
  if (token && subPortalConfigured() && (await loadDay(token, null, 'poll'))) {
    redirect('/suppleance/plan');
  }
  if (token) await clearSubSessionCookie();
  redirect('/suppleance?ended=1');
}
