import { routeTemplate } from './route-template';

/**
 * Reports an error a page could not recover from to `/api/client-error` (DECISIONS D-111), and
 * gives the reference the page shows (« Référence : … ») so a report or a phone call can be
 * matched to a log line. The report holds the error's name, the reference (Next's digest for a
 * server error, else a random 8-character one), the route template and the first 16 hex
 * characters of the message's SHA-256: never the message, which can hold page text.
 *
 * Sent with `fetch(…, { keepalive: true })` rather than `navigator.sendBeacon`: a beacon's
 * `Origin` is `null` on pages sent with `Referrer-Policy: no-referrer` (the substitute portal and
 * class devices), and the server only accepts reports from its own origin.
 */

export interface ReportableError {
  name?: string;
  message?: string;
  digest?: string;
}

const REFERENCE_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';
const DIGEST = /^\d{1,20}(?:@E\d{1,6})?$/;

/** A random 8-character reference (lowercase letters and digits). */
export function newReference(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => REFERENCE_CHARS[b % REFERENCE_CHARS.length]).join('');
}

/** Next's digest when the error came from the server, else a new random reference. */
export function referenceFor(error: ReportableError): string {
  return typeof error.digest === 'string' && DIGEST.test(error.digest)
    ? error.digest
    : newReference();
}

/** The first 16 hex characters of the message's SHA-256, when the browser can compute it. */
export async function messageHash(message: string): Promise<string | undefined> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));
    return Array.from(new Uint8Array(digest).slice(0, 8), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
  } catch {
    return undefined;
  }
}

const ERROR_NAME = /^[A-Za-z_$][\w$]{0,59}$/;

/** The report's body: no message, no address beyond the route template. */
export async function clientErrorReport(
  error: ReportableError,
  ref: string,
  pathname: string,
): Promise<{ name: string; ref: string; route: string; messageHash?: string }> {
  const hash = await messageHash(String(error.message ?? ''));
  return {
    name: typeof error.name === 'string' && ERROR_NAME.test(error.name) ? error.name : 'Error',
    ref,
    route: routeTemplate(pathname),
    ...(hash ? { messageHash: hash } : {}),
  };
}

const sent = new WeakSet<object>();

/** Sends the report once per error object; never throws. */
export async function reportClientError(error: ReportableError, ref: string): Promise<void> {
  try {
    if (typeof error === 'object' && error !== null) {
      if (sent.has(error)) return;
      sent.add(error);
    }
    const body = JSON.stringify(await clientErrorReport(error, ref, window.location.pathname));
    await fetch('/api/client-error', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      keepalive: true,
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch {
    // Reporting is best effort: the page already says what to do.
  }
}
