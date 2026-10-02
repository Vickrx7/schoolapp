/**
 * Failed jobs in the logs, scrubbed (DECISIONS D-111; Phase 6 slice S3a writes it):
 * `runner.events.on('job:failed')` logs `{task, attempts, error: scrubError(error)}`, and
 * graphile-worker's own log output goes through `graphileLogger` (`@lynx/observability`), so no
 * error message can carry a name or an e-mail into the logs.
 *
 * `index.ts` spreads `graphileLogOptions(logger)` into `run()` and calls `reportJobFailures` once
 * the runner exists. Both do nothing until S3a fills them.
 */
import type { Runner, RunnerOptions } from 'graphile-worker';
import type { Logger } from './logger';

/** graphile-worker's `logger` option (empty: its default logger). */
export function graphileLogOptions(_logger: Logger): Pick<RunnerOptions, 'logger'> {
  return {};
}

export function reportJobFailures(_runner: Runner, _logger: Logger): void {}
