import type { Logger } from './logger';
import { scrubError, scrubText } from './scrub';

/** One graphile-worker log call (its `LogFunction`; levels `error`, `warning`, `info`, `debug`). */
export type GraphileLogFunction = (
  level: string,
  message: string,
  meta?: Record<string, unknown>,
) => void;

/**
 * graphile-worker's log function factory (its `LogFunctionFactory`), for `new Logger(…)` in the
 * worker: its messages pass through `scrubText` into `logger`.
 */
export type GraphileLogFunctionFactory = (scope: Record<string, unknown>) => GraphileLogFunction;

/** A scope value worth keeping (graphile's labels, task names and ids), scrubbed. */
const scopeValue = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' ? scrubText(String(value), 80) : undefined;

/**
 * graphile-worker's own messages (« Failed task 12 (dispatch_outbox…) with error '…' » and its
 * stack, worker start and stop, cron) as scrubbed lines of `logger`. Its metadata holds the whole
 * job (payload included) and the raw error: only the error is kept, through `scrubError`, and the
 * message is cut before the stack it carries. Debug messages are dropped.
 */
export function graphileLogger(logger: Logger): GraphileLogFunctionFactory {
  return (scope) => {
    const context = {
      label: scopeValue(scope.label),
      task: scopeValue(scope.taskIdentifier),
      jobId: scopeValue(scope.jobId),
      workerId: scopeValue(scope.workerId),
    };
    return (level, message, meta) => {
      if (level === 'debug') return;
      const error = meta && 'error' in meta ? scrubError(meta.error) : undefined;
      const text = error ? String(message).split('\n', 1)[0]! : String(message);
      const data = error ? { ...context, error } : context;
      if (level === 'error') logger.error(text, data);
      else if (level === 'warning') logger.warn(text, data);
      else logger.info(text, data);
    };
  };
}
