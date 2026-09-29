/**
 * What every device route handler (`/jouer/api/*`, DECISIONS D-083 to D-085) shares: answers
 * that are never cached, 503 with `Retry-After` when the portal is busy, the same-origin check
 * on POSTs, and a request body read with a size limit. Pure (no server-only import) so it is
 * unit-tested; the route handlers pass their own request and settings.
 */
import { BUSY_RETRY_AFTER_SECONDS } from './gate';

/** A device's POST body is tiny (a code, a team or one answer). */
export const MAX_BODY_BYTES = 4096;

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/** A JSON answer that no browser, proxy or CDN keeps. */
export function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

/** Too many calls wait for the portal (D-083): the device's poller backs off and retries. */
export function busyResponse(): Response {
  return jsonResponse({ status: 'busy' }, 503, {
    'Retry-After': String(BUSY_RETRY_AFTER_SECONDS),
  });
}

/**
 * A portal call failed (a timeout, the database down, a result that does not parse): logged with
 * its SQLSTATE only, never its message (it could quote what a device sent), and answered 500 so
 * the device retries.
 */
export function portalErrorResponse(context: string, error: unknown): Response {
  const code = (error as { code?: unknown } | null)?.code;
  console.error(
    JSON.stringify({
      level: 'error',
      context: `classPortal.${context}`,
      code: typeof code === 'string' ? code : null,
      error: error instanceof Error ? error.name : 'unknown',
    }),
  );
  return jsonResponse({ status: 'error' }, 500);
}

/**
 * Whether a POST comes from the app's own pages: its `Origin` is `APP_BASE_URL`'s origin. A
 * missing Origin is refused too (browsers send one on every POST from a page).
 */
export function sameOrigin(origin: string | null, appBaseUrl: string): boolean {
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(appBaseUrl).origin;
  } catch {
    return false;
  }
}

/**
 * The request's JSON body, or undefined when it is missing, too large or not JSON. Reads at most
 * `maxBytes`, whatever `Content-Length` says.
 */
export async function readJsonBody(
  request: Request,
  maxBytes = MAX_BODY_BYTES,
): Promise<unknown | undefined> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) return undefined;
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return undefined;
      }
      chunks.push(value);
    }
  } catch {
    return undefined;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    return undefined;
  }
}
