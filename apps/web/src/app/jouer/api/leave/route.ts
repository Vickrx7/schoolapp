import { classPortalConfigured } from '@/server/class-portal/db';
import {
  busyResponse,
  jsonResponse,
  portalErrorResponse,
  sameOrigin,
} from '@/server/class-portal/http';
import { leaveSession } from '@/server/class-portal/portal';
import { clearDeviceTokenCookie, readDeviceToken } from '@/server/class-portal/session';
import { serverEnv } from '@/server/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * « Quitter la partie »: the device's token stops working and the cookie is forgotten. Its answers
 * stay until the session ends (they count for its team, D-087); joining again from the same device
 * gives its number and team back.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request.headers.get('origin'), serverEnv().APP_BASE_URL)) {
    return jsonResponse({ status: 'forbidden' }, 403);
  }
  const token = await readDeviceToken();
  if (token && classPortalConfigured()) {
    let result;
    try {
      result = await leaveSession(token);
    } catch (e) {
      return portalErrorResponse('leave', e);
    }
    if (result.status === 'busy') return busyResponse();
  }
  await clearDeviceTokenCookie();
  return jsonResponse({ status: 'left' });
}
