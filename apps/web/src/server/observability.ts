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
 * A request that failed on the server (`instrumentation.ts#onRequestError`): one line with the
 * route template, its type and the scrubbed error (its digest is the « Référence » the page
 * shows). Next prints the same error right after; the console guard drops that copy.
 */
export function reportServerError(
  error: unknown,
  context: { routePath: string; routeType: string },
): void {
  markLogged(error);
  webLogger.error('request failed', {
    route: routeTemplate(context.routePath),
    type: context.routeType,
    error: scrubError(error),
  });
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
