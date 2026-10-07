import { appReleaseFrom } from '@lynx/config';
import {
  createLogger,
  guardConsole,
  markLogged,
  scrubError,
  type Logger,
} from '@lynx/observability';
import { routeTemplate } from '../lib/route-template';

/**
 * The web server's logs (DECISIONS D-111): JSON lines, every string scrubbed, ids, counts and
 * codes only. The release is read like the app's name (`@lynx/config`), so logging works even
 * when the rest of the environment is wrong. Server code, but it holds no secret and is not
 * marked server-only, so pure modules that log (the class portal's `http.ts`) stay unit tested.
 */
const release = appReleaseFrom(process.env);

export const webLogger: Logger = createLogger('server', { component: 'web', release });

/**
 * What Next reports when the browser went away while a page was still streaming (a tap on
 * another link, a closed tab): nothing failed on the server, and nobody saw an error page. Only
 * Next's own message: a reset connection or an aborted call inside the server (the database,
 * Auth) is a real fault.
 */
export function isClientAbort(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === 'Error' &&
    error.message === 'The destination stream closed early.'
  );
}

/**
 * A request that failed on the server (`instrumentation.ts#onRequestError`): one line with the
 * route template, its type and the scrubbed error (its digest is the « Référence » the page
 * shows). Next prints the same error right after; the console guard drops that copy. A browser
 * that left mid-stream is an `info` line, so error lines stay faults to look at.
 */
export function reportServerError(
  error: unknown,
  context: { routePath: string; routeType: string },
): void {
  markLogged(error);
  const route = routeTemplate(context.routePath);
  if (isClientAbort(error)) {
    webLogger.info('request ended by the browser', { route, type: context.routeType });
    return;
  }
  webLogger.error('request failed', { route, type: context.routeType, error: scrubError(error) });
}

/**
 * Called once when the server starts (`instrumentation.ts#register`). In production, everything
 * printed on the console (Next's own error reports, libraries' warnings) becomes a scrubbed line:
 * Next prints a failed request's error with all its properties and its raw message.
 */
export function installServerLogging(): void {
  if (process.env.NODE_ENV !== 'production') return;
  guardConsole(createLogger('console', { component: 'web', release }));
}
