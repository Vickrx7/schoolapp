import { classPortalConfigured } from '@/server/class-portal/db';
import { busyResponse, jsonResponse, portalErrorResponse } from '@/server/class-portal/http';
import { loadDeviceState } from '@/server/class-portal/portal';
import { clearDeviceTokenCookie, readDeviceToken } from '@/server/class-portal/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The device's poll (DECISIONS D-085): `GET /jouer/api/state?v=<version>` every 1.5 s while the
 * page is visible. `{status: 'unchanged'}` unless the teacher moved the session on; otherwise the
 * device's own view (D-086: never a key, never another device). A session that ended, or a device
 * the teacher removed, forgets its token here.
 */
export async function GET(request: Request) {
  if (!classPortalConfigured()) return jsonResponse({ status: 'notConfigured' }, 503);
  const token = await readDeviceToken();
  if (!token) return jsonResponse({ status: 'gone' });

  const v = new URL(request.url).searchParams.get('v');
  const known = v !== null && /^\d{1,9}$/.test(v) ? Number(v) : null;
  let result;
  try {
    result = await loadDeviceState(token, known);
  } catch (e) {
    return portalErrorResponse('state', e);
  }
  if (result.status === 'busy') return busyResponse();
  if (result.value.status === 'gone' || result.value.status === 'ended') {
    await clearDeviceTokenCookie();
  }
  return jsonResponse(result.value);
}
