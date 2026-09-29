/**
 * Join codes and class links for « Quiz sur les appareils » (Phase 5 plan, decision P-3).
 *
 * - A join code has 6 characters from a 22-character alphabet with no look-alikes (no 0/O/Q,
 *   1/I/L, 2/Z, 5/S, 6/G or 8/B), so a child copying it from the board cannot mix two letters
 *   up. `app.class_join_code()` draws it; `class_sessions.join_code` stores it in the clear.
 *   Because both letters of every look-alike pair are left out, nothing is « read as » another
 *   letter: anything outside the alphabet is refused here, without a database call.
 * - A class link (« Lien de la classe ») carries a random 32-byte token, 43 base64url characters.
 *
 * Pure (no server-only import) so it is unit-tested; `class_portal.join` checks the same shapes.
 */

/** Same letters as `app.class_join_code()` and `class_portal.join`. */
export const JOIN_CODE_ALPHABET = 'ACDEFHJKMNPRTUVWXY3479';
export const JOIN_CODE_LENGTH = 6;
export const JOIN_CODE_PATTERN = /^[ACDEFHJKMNPRTUVWXY3479]{6}$/;

/** `class_mode_links.token`: 32 random bytes in base64url, without padding. */
export const CLASS_LINK_PATTERN = /^[A-Za-z0-9_-]{43}$/;

// Spaces (any, including no-break spaces), hyphens and dashes (autocorrect turns « - » into
// « – »), dots and middle dots: what people type between the two groups of « K7M 4R9 ».
const SEPARATORS = /[\s.\u00b7\-\u2010-\u2015\u2212]/g;

/** Longer input is not a code, whatever it holds. */
const MAX_INPUT_LENGTH = 64;

/**
 * What a student typed, as a join code: uppercase, with spaces, hyphens and dots removed. Null
 * when a character outside the alphabet is left or the length is wrong, so a malformed code
 * never reaches the database.
 */
export function normalizeJoinCode(input: string): string | null {
  if (typeof input !== 'string' || input.length > MAX_INPUT_LENGTH) return null;
  const code = input.normalize('NFKC').toUpperCase().replace(SEPARATORS, '');
  return JOIN_CODE_PATTERN.test(code) ? code : null;
}

/**
 * « K7M 4R9 »: the code in two groups of three for the projector, joined by a no-break space so
 * it never wraps.
 */
export function formatJoinCode(code: string): string {
  const normalized = normalizeJoinCode(code);
  if (!normalized) throw new RangeError('invalid join code');
  return `${normalized.slice(0, 3)}\u00a0${normalized.slice(3)}`;
}

/** Whether a value has the shape of a class link token (`#k=` in the link). */
export function isClassLinkToken(value: unknown): value is string {
  return typeof value === 'string' && CLASS_LINK_PATTERN.test(value);
}
