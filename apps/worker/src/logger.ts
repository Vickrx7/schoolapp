/**
 * The worker's logger: JSON lines through `@lynx/observability` (DECISIONS D-111), every string
 * scrubbed and every error reduced to its name, code, scrubbed message and frames. Lines carry
 * ids, counts and codes only.
 */
import { appReleaseFrom } from '@lynx/config';
import { createLogger as createJsonLogger, guardConsole, type Logger } from '@lynx/observability';

export type { Logger };

export function createLogger(scope: string): Logger {
  return createJsonLogger(scope, { component: 'worker', release: appReleaseFrom(process.env) });
}

/**
 * Called once when the worker starts: what libraries print on the console (pg, graphile-worker,
 * the AI and Auth clients) becomes scrubbed lines too.
 */
export function guardWorkerConsole(): void {
  guardConsole(createLogger('console'));
}
