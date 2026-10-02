/**
 * Logs without personal details, for the web server, the worker and the scripts (DECISIONS
 * D-111): JSON lines on stdout (kept 14 days by journald, in Canada; D-119), a text scrubber, an
 * error scrubber and a console guard. No third-party error service. No dependencies, so every
 * app can use it.
 */
export {
  createLogger,
  guardConsole,
  markLogged,
  originalConsole,
  type LogData,
  type GuardOptions,
  type Logger,
  type LoggerOptions,
  type LogLevel,
} from './logger';
export {
  isReference,
  isScrubbedError,
  REFERENCE_PATTERN,
  scrubError,
  scrubText,
  type ScrubbedError,
} from './scrub';
export {
  graphileLogger,
  type GraphileLogFunction,
  type GraphileLogFunctionFactory,
} from './graphile';
