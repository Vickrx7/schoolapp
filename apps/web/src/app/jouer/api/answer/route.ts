import { classPortalConfigured } from '@/server/class-portal/db';
import {
  busyResponse,
  jsonResponse,
  portalErrorResponse,
  readJsonBody,
  sameOrigin,
} from '@/server/class-portal/http';
import { submitAnswer } from '@/server/class-portal/portal';
import { answerRequestSchema } from '@/server/class-portal/schemas';
import { clearDeviceTokenCookie, readDeviceToken } from '@/server/class-portal/session';
import { serverEnv } from '@/server/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One answer to the current question (DECISIONS D-086 to D-088). Its shape is checked here first
 * (`answerRequestSchema`: ids, a boolean or at most 100 characters; anything else in it is
 * dropped), then the database grades it in the transaction that receives it and keeps no typed
 * text. The device learns `recorded`, `already` (a resent answer), `closed` or `invalid`, with
 * its own view: its result only after « Afficher la réponse », and only when answers are shown.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request.headers.get('origin'), serverEnv().APP_BASE_URL)) {
    return jsonResponse({ status: 'forbidden' }, 403);
  }
  if (!classPortalConfigured()) return jsonResponse({ status: 'notConfigured' }, 503);
  const token = await readDeviceToken();
  if (!token) return jsonResponse({ status: 'gone' });

  const body = answerRequestSchema.safeParse(await readJsonBody(request));
  if (!body.success) return jsonResponse({ status: 'ok', outcome: 'invalid' }, 400);

  let result;
  try {
    result = await submitAnswer(token, body.data.index, body.data.response);
  } catch (e) {
    return portalErrorResponse('answer', e);
  }
  if (result.status === 'busy') return busyResponse();
  if (result.value.status === 'gone' || result.value.status === 'ended') {
    await clearDeviceTokenCookie();
  }
  return jsonResponse(result.value);
}
