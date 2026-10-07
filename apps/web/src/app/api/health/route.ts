import { appReleaseFrom } from '@lynx/config';
import { buildHealth } from '@/server/health';

/**
 * Liveness (DECISIONS D-112): the server answers, and which release it runs (D-117). Public,
 * never cached, handled before any session is read (proxy.ts). HEAD works too.
 */
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return Response.json(buildHealth(appReleaseFrom(process.env)), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
