import { isReference, isScrubbedError, scrubError, scrubText } from './scrub';

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
  /** Where lines go (tests); by default stdout, and stderr for errors. */
  write?: (line: string, level: LogLevel) => void;
}

type ConsoleMethod = 'log' | 'info' | 'debug' | 'warn' | 'error';
type ConsoleMethods = Record<ConsoleMethod, (...args: unknown[]) => void>;

/**
 * The console as it was before `guardConsole` replaced its methods, kept once per process (a
 * server bundle can hold several copies of this module): the loggers write through it, so their
 * own lines never go through the guard.
 */
const CONSOLE_KEY = Symbol.for('lynx.observability.console');
const shared = globalThis as { [CONSOLE_KEY]?: ConsoleMethods };
export const originalConsole: ConsoleMethods = (shared[CONSOLE_KEY] ??= {
  log: console.log.bind(console),
  info: console.info.bind(console),
  debug: console.debug.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
});

const defaultWrite = (line: string, level: LogLevel) =>
  level === 'error' ? originalConsole.error(line) : originalConsole.log(line);

/** The fields every line has; data cannot overwrite them. */
const RESERVED = new Set(['time', 'level', 'component', 'release', 'scope', 'message']);
/**
 * Keys whose values are kept as they are when they have the expected shape: error references
 * (`isReference`) and the 16-hex-character hash of a browser error's message. Hashes, not
 * personal data; a digit run in them would otherwise read as an identification number.
 */
const SHAPED_KEYS = new Map<string, (value: string) => boolean>([
  ['digest', isReference],
  ['ref', isReference],
  ['reference', isReference],
  ['messageHash', (value) => /^[0-9a-f]{16}$/.test(value)],
]);
const MAX_DEPTH = 4;
const MAX_ITEMS = 50;

/**
 * A value made safe for a line: strings scrubbed (`scrubText`), errors reduced to `scrubError`,
 * plain objects and arrays walked (to a depth of 4, 50 items), anything else (class instances,
 * functions) reduced to a marker: an object's own properties are never enumerated unless it is a
 * plain object a caller built for the log.
 */
function sanitize(value: unknown, key: string, depth: number): unknown {
  switch (typeof value) {
    case 'string':
      return SHAPED_KEYS.get(key)?.(value) ? value : scrubText(value);
    case 'number':
      return Number.isFinite(value) ? value : String(value);
    case 'boolean':
      return value;
    case 'bigint':
      return value.toString();
    case 'undefined':
    case 'function':
    case 'symbol':
      return undefined;
  }
  if (value === null) return null;
  if (isScrubbedError(value)) return value;
  if (value instanceof Error) return scrubError(value);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (depth >= MAX_DEPTH) return '[…]';
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ITEMS).map((item) => sanitize(item, key, depth + 1) ?? null);
  }
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) return '[objet]';
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, MAX_ITEMS)) {
    const clean = sanitize(v, k, depth + 1);
    if (clean !== undefined) out[k] = clean;
  }
  return out;
}

/**
 * A logger writing `{time, level, component, release, scope, message, ...data}` as one JSON line
 * per entry (errors on stderr). Every string in the message and the data is scrubbed
 * (`scrubText`) and every error reduced (`scrubError`), so a careless call cannot put an e-mail
 * or a quoted value in the logs; callers still pass ids, counts and codes only. Logging never
 * throws.
 */
export function createLogger(scope: string, options: LoggerOptions): Logger {
  const write = options.write ?? defaultWrite;
  const component = scrubText(options.component, 40);
  const release = scrubText(options.release, 40);
  const cleanScope = scrubText(scope, 60);
  const emit = (level: LogLevel, message: string, data?: LogData) => {
    try {
      const entry: Record<string, unknown> = {
        time: new Date().toISOString(),
        level,
        component,
        release,
        scope: cleanScope,
        message: scrubText(message),
      };
      if (data && typeof data === 'object') {
        for (const [key, value] of Object.entries(data)) {
          if (RESERVED.has(key)) continue;
          const clean = sanitize(value, key, 0);
          if (clean !== undefined) entry[key] = clean;
        }
      }
      write(JSON.stringify(entry), level);
    } catch {
      // A log line is never worth a failed request or job.
    }
  };
  return {
    info: (message, data) => emit('info', message, data),
    warn: (message, data) => emit('warn', message, data),
    error: (message, data) => emit('error', message, data),
  };
}

/** Errors a request handler already logged with their route (shared by every module copy). */
const LOGGED_KEY = Symbol.for('lynx.observability.logged');
const sharedLogged = globalThis as { [LOGGED_KEY]?: WeakSet<object> };
const logged = (sharedLogged[LOGGED_KEY] ??= new WeakSet<object>());

/**
 * Marks an error as logged with its route, so the console guard drops the copy Next prints of the
 * same error (one line per failure).
 */
export function markLogged(error: unknown): void {
  if (typeof error === 'object' && error !== null) logged.add(error);
}

const GUARDED_KEY = Symbol.for('lynx.observability.guarded');
// eslint-disable-next-line no-control-regex -- terminal colour codes start with ESC
const ANSI = /\u001B\[[0-9;]*[A-Za-z]/g;
const LEVELS: Record<ConsoleMethod, LogLevel> = {
  log: 'info',
  info: 'info',
  debug: 'info',
  warn: 'warn',
  error: 'error',
};

function errorIn(args: unknown[]): object | undefined {
  for (const arg of args) {
    if (arg instanceof Error) return arg;
    if (typeof arg !== 'object' || arg === null) continue;
    try {
      if (typeof Reflect.get(arg, 'stack') === 'string') return arg;
    } catch {
      // A proxy or a throwing getter: not an error worth reading.
    }
  }
  return undefined;
}

export interface GuardOptions {
  /**
   * How long a printed error waits for its request handler's line (milliseconds). Next prints a
   * failed request's error, then calls `onRequestError`, which logs it with the route.
   */
  holdMs?: number;
}

/**
 * Replaces `console.log/info/debug/warn/error` with scrubbing versions writing through `logger`
 * (D-111): frameworks and libraries print errors with `console.error(error)`, which shows every
 * own property of the error (a privacy error's `findings` hold names) and its raw message. The
 * guard keeps the printed text (scrubbed) and the first error (`scrubError`) and never looks
 * inside other objects. A printed error is held for `holdMs` and dropped if a handler logged it
 * meanwhile (`markLogged`); held lines are written when the process exits. Installing it twice
 * does nothing.
 */
export function guardConsole(logger: Logger, options: GuardOptions = {}): void {
  const target = console as unknown as ConsoleMethods & { [GUARDED_KEY]?: true };
  if (target[GUARDED_KEY]) return;
  target[GUARDED_KEY] = true;
  const holdMs = options.holdMs ?? 250;
  const held = new Set<() => void>();
  if (typeof process !== 'undefined' && typeof process.once === 'function') {
    process.once('exit', () => {
      for (const flush of [...held]) flush();
    });
  }
  for (const method of Object.keys(LEVELS) as ConsoleMethod[]) {
    const level = LEVELS[method];
    target[method] = (...args: unknown[]) => {
      try {
        const error = errorIn(args);
        if (error && logged.has(error)) return;
        const text = args
          .filter((arg) => typeof arg === 'string' || typeof arg === 'number')
          .map(String)
          .join(' ')
          .replace(ANSI, '')
          .trim();
        const write = () =>
          logger[level](
            text || (error ? 'error' : '(empty)'),
            error ? { error: scrubError(error) } : {},
          );
        if (!error || level !== 'error') {
          write();
          return;
        }
        const flush = () => {
          held.delete(flush);
          clearTimeout(timer);
          if (!logged.has(error)) write();
        };
        const timer = setTimeout(flush, holdMs);
        (timer as { unref?: () => void }).unref?.();
        held.add(flush);
      } catch {
        // The console never throws because of the guard.
      }
    };
  }
}
