/**
 * Failed jobs in the logs, scrubbed (DECISIONS D-111): graphile-worker's own log output (every
 * failed attempt, start and stop, cron) goes through `graphileLogger` (`@lynx/observability`)
 * instead of its console logger, which printed each error's message and stack as they were, and
 * a job that failed for good (`job:failed`, after its last attempt) gets one line with its task,
 * attempts and `scrubError(error)`. No error message can carry a name or an e-mail into the logs.
 *
 * `index.ts` spreads `graphileLogOptions(logger)` into `run()` and calls `reportJobFailures` once
 * the runner exists.
 */
import { graphileLogger, scrubError } from '@lynx/observability';
import { Logger as GraphileLogger, type Runner, type RunnerOptions } from 'graphile-worker';
import type { Logger } from './logger';

/** graphile-worker's `logger` option: its messages, scrubbed, as lines of `logger`. */
export function graphileLogOptions(logger: Logger): Pick<RunnerOptions, 'logger'> {
  return { logger: new GraphileLogger(graphileLogger(logger)) };
}

/** The part of a runner this needs (its event emitter), so tests can pass a plain emitter. */
type JobEvents = Pick<Runner['events'], 'on'>;

export function reportJobFailures(runner: { events: JobEvents }, logger: Logger): void {
  runner.events.on('job:failed', ({ job, error }) => {
    logger.error('job failed for good', {
      task: job.task_identifier,
      jobId: job.id,
      attempts: job.attempts,
      maxAttempts: job.max_attempts,
      error: scrubError(error),
    });
  });
}
