/**
 * Error reports from browsers (`POST /api/client-error`, DECISIONS D-111). A report holds the
 * error's name, its reference (Next's digest, or a random one the page made), the route template
 * and a 16-character SHA-256 of the message: never the message, which can hold page text. Pure,
 * so it is unit tested; the route handler adds the origin check and the size limit.
 */
import { isReference } from '@lynx/observability';
import { z } from 'zod';
import { routeTemplate } from '../lib/route-template';

/** The largest body accepted, in bytes. */
export const CLIENT_ERROR_MAX_BYTES = 2048;

const reportSchema = z.strictObject({
  name: z.string().regex(/^[A-Za-z_$][\w$]{0,59}$/),
  ref: z.string().refine(isReference),
  route: z.string().max(300),
  messageHash: z
    .string()
    .regex(/^[0-9a-f]{16}$/)
    .optional(),
});

export interface ClientErrorReport {
  name: string;
  ref: string;
  /** The route template, made again here: a browser's word is not trusted. */
  route: string;
  messageHash?: string;
}

/** The report in a request's body, or null when it is not one. */
export function parseClientError(body: string): ClientErrorReport | null {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }
  const parsed = reportSchema.safeParse(json);
  if (!parsed.success) return null;
  const { name, ref, route, messageHash } = parsed.data;
  return { name, ref, route: routeTemplate(route), ...(messageHash ? { messageHash } : {}) };
}

/**
 * A request's body as text, or null when it is larger than `maxBytes` (declared or streamed): a
 * large body is never read into memory.
 */
export async function readLimitedText(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (!Number.isFinite(declared) || declared > maxBytes) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * At most `limit` reports per `windowMs` from one client address (fixed windows, in memory: a
 * report storm from one browser cannot flood the logs). The table forgets everything when it
 * grows past `maxKeys`.
 */
export function createWindowLimiter(options: { limit: number; windowMs: number; maxKeys: number }) {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    take(key: string, now = Date.now()): boolean {
      const current = windows.get(key);
      if (!current || now - current.start >= options.windowMs) {
        if (!current && windows.size >= options.maxKeys) windows.clear();
        windows.set(key, { start: now, count: 1 });
        return true;
      }
      current.count += 1;
      return current.count <= options.limit;
    },
  };
}
