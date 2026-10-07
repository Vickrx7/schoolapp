import { serverEnv } from '@/server/env';
import { checkReady, type Readiness } from '@/server/health';
import { webLogger } from '@/server/observability';
import { pingClassPortal } from '@/server/class-portal/db';
import { pingSubPortal } from '@/server/sub-portal/db';

/**
 * Readiness (DECISIONS D-112), for the external monitor: 200 when Supabase Auth, PostgREST and
 * the configured portal connections answer within 2 s each, else 503. The answer never says what
 * failed; the server's log does, once each time the set of failing checks changes.
 */
export const dynamic = 'force-dynamic';

const holder = globalThis as unknown as { lynxReadyFailing?: string };

export async function GET(): Promise<Response> {
  let readiness: Readiness;
  try {
    const env = serverEnv();
    readiness = await checkReady({
      supabaseUrl: env.SUPABASE_URL,
      anonKey: env.SUPABASE_ANON_KEY,
      portalPools: [
        ...(env.SUB_PORTAL_DATABASE_URL ? [{ name: 'subPortal', ping: pingSubPortal }] : []),
        ...(env.CLASS_PORTAL_DATABASE_URL ? [{ name: 'classPortal', ping: pingClassPortal }] : []),
      ],
    });
  } catch {
    readiness = { ok: false, failing: ['configuration'] };
  }
  const failing = readiness.failing.join(',');
  if (failing !== (holder.lynxReadyFailing ?? '')) {
    if (failing) webLogger.warn('not ready', { failing: readiness.failing });
    else webLogger.info('ready again');
    holder.lynxReadyFailing = failing;
  }
  return Response.json(
    { status: readiness.ok ? 'ok' : 'unavailable' },
    { status: readiness.ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
