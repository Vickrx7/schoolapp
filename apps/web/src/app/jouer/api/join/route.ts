import { z } from 'zod';
import { isClassLinkToken, normalizeJoinCode } from '@/server/class-portal/code';
import { deviceKey, networkKey } from '@/server/class-portal/crypto';
import { classPortalConfigured } from '@/server/class-portal/db';
import {
  busyResponse,
  jsonResponse,
  portalErrorResponse,
  readJsonBody,
  sameOrigin,
} from '@/server/class-portal/http';
import { classPortalHmacKey } from '@/server/class-portal/keys';
import { networkPrefix } from '@/server/class-portal/network';
import { joinClassSession } from '@/server/class-portal/portal';
import { deviceCookieValue, setDeviceTokenCookie } from '@/server/class-portal/session';
import { serverEnv } from '@/server/env';
import { clientIp } from '@/server/sub-portal/client-ip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A typed code (« K7M 4R9 », any case, spaces or hyphens) or the class link's token (`#k=`).
const bodySchema = z.object({
  code: z.string().max(64).optional(),
  link: z.string().max(64).optional(),
});

/**
 * « Rejoindre » (DECISIONS D-084): joins this device to the lobby of the session a typed code or
 * the class link points to. A malformed code or link is refused here without a database call.
 * The throttle keys are HMACs of the device cookie and of the network (an IPv6 address by its
 * /64); the database records failures only. On success the device token goes into an HttpOnly
 * cookie and never into the answer: `{ outcome: 'ok' }`, then the page opens /jouer/partie.
 */
export async function POST(request: Request) {
  const env = serverEnv();
  if (!sameOrigin(request.headers.get('origin'), env.APP_BASE_URL)) {
    return jsonResponse({ outcome: 'forbidden' }, 403);
  }
  const key = classPortalHmacKey();
  if (!key || !classPortalConfigured()) return jsonResponse({ outcome: 'notConfigured' }, 503);

  const body = bodySchema.safeParse(await readJsonBody(request));
  if (!body.success || (body.data.code === undefined) === (body.data.link === undefined)) {
    return jsonResponse({ outcome: 'invalid' }, 400);
  }
  let code: string | null = null;
  let link: string | null = null;
  if (body.data.link !== undefined) {
    if (!isClassLinkToken(body.data.link)) return jsonResponse({ outcome: 'invalid_link' });
    link = body.data.link;
  } else {
    code = normalizeJoinCode(body.data.code ?? '');
    if (!code) return jsonResponse({ outcome: 'invalid' });
  }

  const device = deviceKey(await deviceCookieValue(), key);
  const network = networkKey(
    networkPrefix(clientIp(request.headers, env.CLIENT_IP_HEADER, env.TRUSTED_PROXY_HOPS)),
    key,
  );
  let result;
  try {
    result = await joinClassSession({ code, link, deviceKey: device, networkKey: network });
  } catch (e) {
    return portalErrorResponse('join', e);
  }
  if (result.status === 'busy') return busyResponse();

  const row = result.value;
  switch (row.outcome) {
    case 'ok':
      if (!row.token || !row.expires_at) return portalErrorResponse('join', null);
      await setDeviceTokenCookie(row.token, row.expires_at);
      return jsonResponse({ outcome: 'ok' });
    case 'wait':
      // A short prefix of the keyed hashes only: enough to follow one device or network.
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'class_portal.throttled',
          device: device.slice(0, 8),
          network: network.slice(0, 8),
          retryAfter: row.retry_after,
        }),
      );
      return jsonResponse({ outcome: 'wait', retryAfter: Math.max(1, row.retry_after ?? 30) });
    default:
      return jsonResponse({ outcome: row.outcome });
  }
}
