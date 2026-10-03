import { z } from 'zod';
import { classPortalConfigured } from '@/server/class-portal/db';
import {
  busyResponse,
  jsonResponse,
  portalErrorResponse,
  readJsonBody,
  sameOrigin,
} from '@/server/class-portal/http';
import { chooseTeam } from '@/server/class-portal/portal';
import { CLASS_TEAM_KEYS } from '@/server/class-portal/schemas';
import { clearDeviceTokenCookie, readDeviceToken } from '@/server/class-portal/session';
import { serverEnv } from '@/server/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ team: z.enum(CLASS_TEAM_KEYS) });

/**
 * « Choisis ton équipe » (DECISIONS D-088), when the teacher let students choose: a fixed team
 * key, never a name typed by a student. The database checks the team belongs to the session and
 * that the device may still choose.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request.headers.get('origin'), serverEnv().APP_BASE_URL)) {
    return jsonResponse({ status: 'forbidden' }, 403);
  }
  if (!classPortalConfigured()) return jsonResponse({ status: 'notConfigured' }, 503);
  const token = await readDeviceToken();
  if (!token) return jsonResponse({ status: 'gone' });

  const body = bodySchema.safeParse(await readJsonBody(request));
  if (!body.success) return jsonResponse({ status: 'ok', outcome: 'invalid' }, 400);

  let result;
  try {
    result = await chooseTeam(token, body.data.team);
  } catch (e) {
    return portalErrorResponse('team', e);
  }
  if (result.status === 'busy') return busyResponse();
  const value = result.value;
  if ('status' in value && (value.status === 'gone' || value.status === 'ended')) {
    await clearDeviceTokenCookie();
  }
  return jsonResponse(value);
}
