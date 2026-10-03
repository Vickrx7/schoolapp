/**
 * Substitute access codes (DECISIONS D-050): 10 characters of Crockford Base32 (no I, L, O or
 * U), about 50 bits, shown as XXXXX-XXXXX so they can be read over the phone and typed from
 * paper. Randomness is injected (the web server passes node:crypto's randomBytes); the codes
 * themselves are only ever stored as a keyed hash.
 */

export const ACCESS_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const ACCESS_CODE_LENGTH = 10;

/** A new code. `byte & 31` is uniform because 256 is a multiple of the 32-letter alphabet. */
export function generateAccessCode(randomBytes: (n: number) => Uint8Array): string {
  const bytes = randomBytes(ACCESS_CODE_LENGTH);
  if (bytes.length < ACCESS_CODE_LENGTH) throw new RangeError('not enough random bytes');
  let code = '';
  for (let i = 0; i < ACCESS_CODE_LENGTH; i++) code += ACCESS_CODE_ALPHABET[bytes[i]! & 31];
  return code;
}

/**
 * What a person typed, as a code: uppercase, spaces and hyphens (or dashes) removed, O read
 * as 0 and I or L as 1. Null when anything else is left or the length is wrong, so a
 * malformed code never reaches the database.
 */
export function normalizeAccessCode(input: string): string | null {
  const code = input
    .toUpperCase()
    .replace(/[\s\-‐-―−]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (code.length !== ACCESS_CODE_LENGTH) return null;
  for (const ch of code) if (!ACCESS_CODE_ALPHABET.includes(ch)) return null;
  return code;
}

/** « 7KQ4M-9TDXA » for display and print. */
export function formatAccessCode(code: string): string {
  const normalized = normalizeAccessCode(code);
  if (!normalized) throw new RangeError('invalid access code');
  return `${normalized.slice(0, 5)}-${normalized.slice(5)}`;
}
