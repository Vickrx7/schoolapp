import { serverEnv } from '@/server/env';
import {
  CLIENT_ERROR_MAX_BYTES,
  createWindowLimiter,
  parseClientError,
  readLimitedText,
} from '@/server/client-error';
import { webLogger } from '@/server/observability';
import { clientIp } from '@/server/sub-portal/client-ip';

/**
 * Error reports from the app's own pages (DECISIONS D-111; lib/report-client-error.ts): from
 * this site only (`Origin` must be APP_BASE_URL's), at most 2 KB, 30 a minute per client address.
 * One log line each: the error's name, its reference, the route template and the message's
 * hash. Public (the substitute portal and class devices report too), never cached.
 */
export const dynamic = 'force-dynamic';

const holder = globalThis as unknown as {
  lynxClientErrorLimiter?: ReturnType<typeof createWindowLimiter>;
};
const limiter = () =>
  (holder.lynxClientErrorLimiter ??= createWindowLimiter({
    limit: 30,
    windowMs: 60_000,
    maxKeys: 10_000,
  }));

const reply = (status: number) =>
  new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: Request): Promise<Response> {
  const env = serverEnv();
  if (request.headers.get('origin') !== new URL(env.APP_BASE_URL).origin) return reply(403);
  const address = clientIp(request.headers, env.CLIENT_IP_HEADER, env.TRUSTED_PROXY_HOPS);
  if (!limiter().take(address)) return reply(429);
  const body = await readLimitedText(request, CLIENT_ERROR_MAX_BYTES);
  if (body === null) return reply(413);
  const report = parseClientError(body);
  if (!report) return reply(400);
  webLogger.error('browser error', { ...report });
  return reply(204);
}
