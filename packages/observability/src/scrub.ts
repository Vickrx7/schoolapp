/**
 * Scrubbers for log lines (DECISIONS D-111). Logs are for finding faults, never for reading what
 * people wrote: everything that could name or reach a person (an e-mail, a phone number, a
 * postal code, an identification number), open a door (a token, a key, a code in a URL) or carry
 * typed content (anything in quotes, the values Postgres echoes back) is replaced before a line
 * is written. Names in free text cannot be recognized, which is why `scrubError` never reads an
 * error's other properties and browsers send a hash of their message instead of the message.
 */

/** UUIDs are ids, not personal data, and make a line useful: they are kept. */
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
/** Placeholders for the kept UUIDs while the other rules run (control characters are removed). */
// eslint-disable-next-line no-control-regex -- the placeholder is a control character on purpose
const KEPT = /\u0000(\d+)\u0000/g;
// eslint-disable-next-line no-control-regex -- removing control characters is the point
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const JWT = /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g;
const AUTHORIZATION = /\b(?:Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]+/gi;
/** `token=…`, `code: …` and the like, wherever they appear. */
const SECRET_PAIR =
  /\b(token_hash|access_token|refresh_token|token|code|otp|password|passwd|secret|api_?key|apikey|key|email|courriel)(\s*[=:]\s*)(?!\[)[^\s&;,"'«»)]+/gi;
/** A URL (any scheme) or an absolute path followed by a query or a fragment: both are dropped. */
const URL_QUERY = /((?:\b[a-z][a-z0-9+.-]*:|\/)[^\s?#"'`<>«»()]*)[?#][^\s"'`<>«»()]*/gi;

/** Postgres echoes the values of a key or a whole row back in its messages. */
const PG_KEY_SUFFIXED =
  /(Key \([^)\n]*\)=)\((?!…\)).*?\)(?=\s+(?:already exists|is not present|is still referenced|conflicts with))/g;
const PG_KEY = /(Key \([^)\n]*\)=)\((?!…\))[^\n]*/g;
const PG_ROW = /(Failing row contains )\([^\n]*/g;

/** Pairs are blanked; a quotation the message cuts short is blanked to the end of its line. */
const QUOTES: [RegExp, string, string][] = [
  [/"[^"\n]*("|$)/gm, '"…"', '"…'],
  [/“[^”\n]*(”|$)/gm, '“…”', '“…'],
  [/«[^»\n]*(»|$)/gm, '« … »', '« …'],
  [/`[^`\n]*(`|$)/gm, '`…`', '`…'],
  [/‘[^’\n]*(’|$)/gm, '‘…’', '‘…'],
  // Single quotes, but not apostrophes (« l'élève », "can't"): the opening quote follows no
  // letter, and only pairs count.
  [/(?<![\p{L}\p{N}])'[^'\n]*(')(?![\p{L}\p{N}])/gu, "'…'", "'…'"],
];

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu;
/** Canadian postal codes (the letters D, F, I, O, Q and U are never used; W and Z never first). */
const POSTAL_CODE = /\b[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d\b/gi;
/** North American numbers: 613-555-0100, (613) 555-0100, +1 613 555 0100, 613.555.0100. */
const PHONE =
  /(?<![\p{L}\p{N}])(?:\+?1[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]\d{4}(?![\p{N}])/gu;
/** Local numbers written with a separator: 555-0100. */
const LOCAL_PHONE = /(?<![\p{L}\p{N}])\d{3}[.-]\d{4}(?![\p{L}\p{N}])/gu;
/** Ontario health card numbers as usually written: 1234-567-890 (with or without the version). */
const HEALTH_CARD = /(?<![\p{L}\p{N}])\d{4}[\s-]\d{3}[\s-]\d{3}(?:[\s-]?[A-Z]{2})?(?![\p{N}])/gu;
/** Nine digits or more: an Ontario Education Number, a health card, a phone number, a card. */
const LONG_NUMBER = /\d{9,}/g;
const HEX_SECRET = /\b[0-9a-f]{32,}\b/gi;
const BASE64_RUN = /[A-Za-z0-9+/_-]{32,}={0,2}/g;

/**
 * Text with what could identify a person or open a door removed: e-mails, phone numbers, postal
 * codes, long digit runs, tokens and secrets, quoted values (`"…"`, `'…'`, « … »), the values in
 * Postgres' `Key (x)=(…)` and `Failing row contains (…)`, and URL queries and fragments; UUIDs
 * are kept. At most `max` characters.
 */
export function scrubText(input: unknown, max = 500): string {
  const limit = Math.max(1, Math.floor(max));
  let text = typeof input === 'string' ? input : input == null ? '' : String(input);
  // Bounds the work of the rules below; the end is cut anyway.
  text = text.slice(0, Math.max(limit * 4, 2000)).replace(CONTROL, ' ');

  const kept: string[] = [];
  text = text.replace(UUID, (id) => `\u0000${kept.push(id.toLowerCase()) - 1}\u0000`);

  text = text
    .replace(JWT, '[jeton]')
    .replace(AUTHORIZATION, '[jeton]')
    .replace(SECRET_PAIR, '$1$2[…]')
    .replace(URL_QUERY, '$1')
    .replace(PG_KEY_SUFFIXED, '$1(…)')
    .replace(PG_KEY, '$1(…)')
    .replace(PG_ROW, '$1(…)');
  for (const [pattern, pair, open] of QUOTES) {
    text = text.replace(pattern, (_, close: string) => (close ? pair : open));
  }
  text = text
    .replace(EMAIL, '[courriel]')
    .replace(POSTAL_CODE, '[code postal]')
    .replace(PHONE, '[téléphone]')
    .replace(LOCAL_PHONE, '[téléphone]')
    .replace(HEALTH_CARD, '[nombre]')
    .replace(LONG_NUMBER, '[nombre]')
    .replace(HEX_SECRET, '[secret]')
    .replace(BASE64_RUN, (run) => (/\d/.test(run) && /[A-Za-z]/.test(run) ? '[secret]' : run));

  text = text.replace(KEPT, (_, index: string) => kept[Number(index)] ?? '');
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/**
 * An error reference shown to users (« Référence : … ») and logged with the error, so a report
 * can be matched to its log line: Next's digest (a number, `@E…` for its own errors) or the
 * random 8-character reference a browser makes. Hashes, not personal data: kept as they are.
 */
export const REFERENCE_PATTERN = /^(?:[0-9a-z]{8}|\d{1,20}(?:@E\d{1,6})?)$/;

export function isReference(value: unknown): value is string {
  return typeof value === 'string' && REFERENCE_PATTERN.test(value);
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

/** Errors already scrubbed (shared by every copy of this module in a process). */
const SCRUBBED_KEY = Symbol.for('lynx.observability.scrubbed');
const shared = globalThis as { [SCRUBBED_KEY]?: WeakSet<object> };
const scrubbed = (shared[SCRUBBED_KEY] ??= new WeakSet<object>());

export function isScrubbedError(value: unknown): value is ScrubbedError {
  return typeof value === 'object' && value !== null && scrubbed.has(value);
}

const ERROR_NAME = /^[A-Za-z_$][\w$]{0,59}$/;
const ERROR_CODE = /^[0-9A-Z]{5}$/;
const MAX_FRAMES = 30;

/** One property, read without running into a throwing getter or a proxy. */
function read(error: object, key: 'name' | 'message' | 'code' | 'digest' | 'stack'): unknown {
  try {
    return (error as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/**
 * A stack frame with the machine's own paths removed: everything before the repository's
 * `apps/`, `packages/` or `node_modules/` (or a home directory), and any query.
 */
function cleanFrame(line: string): string {
  return (
    line
      .trim()
      .replace(/file:\/\//g, '')
      .replace(/(^|[\s(])\/[^\s():]*?\/(?=(?:apps|packages|node_modules|tools|supabase)\/)/g, '$1')
      .replace(/(^|[\s(])\/(?:home|Users)\/[^/\s():]+\//g, '$1~/')
      .replace(/\?[^\s():]*/g, '')
      // pnpm's store (`.pnpm/next@16…_react@19…/node_modules/`) and a standalone build's own copy.
      .replace(/node_modules\/\.pnpm\/[^/\s()]+\/node_modules\//g, 'node_modules/')
      .replace(/(^|[\s(])(?:[^\s()]*\/)?\.next\/standalone\//g, '$1')
      .slice(0, 300)
  );
}

/** Reads `name`, `message`, `code`, `digest` and `stack` only, each scrubbed. */
export function scrubError(error: unknown): ScrubbedError {
  let result: ScrubbedError;
  if (typeof error !== 'object' || error === null) {
    result = { name: 'Error', message: scrubText(error), frames: [] };
  } else {
    const name = read(error, 'name');
    const message = read(error, 'message');
    const code = read(error, 'code');
    const digest = read(error, 'digest');
    const stack = read(error, 'stack');
    result = {
      name: typeof name === 'string' && ERROR_NAME.test(name) ? name : 'Error',
    } as ScrubbedError;
    if (typeof code === 'string' && ERROR_CODE.test(code)) result.code = code;
    if (isReference(digest)) result.digest = digest;
    result.message = scrubText(typeof message === 'string' ? message : '');
    result.frames =
      typeof stack === 'string'
        ? stack
            .split('\n')
            .filter((line) => /^\s*at\s/.test(line))
            .slice(0, MAX_FRAMES)
            .map(cleanFrame)
        : [];
  }
  scrubbed.add(result);
  return result;
}
