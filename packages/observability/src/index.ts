/**
 * Logs without personal details, for the web server, the worker and the scripts (DECISIONS
 * D-111): JSON lines on stdout (kept 14 days by journald, in Canada; D-119), a text scrubber and an
 * error scrubber. No third-party error service. No dependencies, so every app can use it.
 *
 * Phase 6's slice S3a writes the bodies (and their tests: at least 30 scrub vectors); this
 * skeleton fixes the interface the other slices build on. Until then nothing is written and no
 * text passes the scrubbers.
 */

export type LogLevel = 'info' | 'warn' | 'error';

/** Ids, counts and codes only: never a name, an e-mail, an input or an answer. */
export type LogData = Record<string, unknown>;

export interface Logger {
  info(message: string, data?: LogData): void;
  warn(message: string, data?: LogData): void;
  error(message: string, data?: LogData): void;
}

export interface LoggerOptions {
  /** `web`, `worker`, `admin`, `backup`… */
  component: string;
  /** APP_RELEASE (D-117). */
  release: string;
}

/**
 * A logger writing `{time, level, component, release, scope, message, ...data}` as one JSON line
 * per entry (errors on stderr).
 */
export function createLogger(_scope: string, _options: LoggerOptions): Logger {
  const nothing = () => undefined;
  return { info: nothing, warn: nothing, error: nothing };
}

/**
 * Text with what could identify a person or open a door removed: e-mails, phone numbers, postal
 * codes, long digit runs, tokens and secrets, quoted values (`"…"`, `'…'`, « … »), the values in
 * Postgres' `Key (x)=(…)` and `Failing row contains (…)`, and URL queries and fragments; UUIDs
 * are kept. At most `max` characters.
 */
export function scrubText(_input: string, _max = 500): string {
  return '';
}

/** What a log keeps of an error. Never its other own properties (a privacy error holds names). */
export interface ScrubbedError {
  name: string;
  /** A SQLSTATE or a five-character code (`^[0-9A-Z]{5}$`) only. */
  code?: string;
  /** Next's digest, which the error page shows as « Référence ». */
  digest?: string;
  /** `scrubText` of the message. */
  message: string;
  /** At most 30 stack frames, with paths relative to the repository. */
  frames: string[];
}

/** Reads `name`, `message`, `code`, `digest` and `stack` only, each scrubbed. */
export function scrubError(_error: unknown): ScrubbedError {
  return { name: 'Error', message: '', frames: [] };
}

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

export function graphileLogger(_logger: Logger): GraphileLogFunctionFactory {
  return () => () => undefined;
}
