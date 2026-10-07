/**
 * Small text helpers for the plan builder (internal: not exported from the package).
 */

/** Shortens text to at most `max` characters, ending with an ellipsis when it was cut. */
export function clip(text: string, max: number): string {
  const value = text.trim();
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

/** Like `clip`, but blank or missing text becomes null. */
export function clipOrNull(text: string | null | undefined, max: number): string | null {
  if (text == null) return null;
  const value = text.trim();
  return value.length === 0 ? null : clip(value, max);
}

/** Lowercase without accents, for matching words ("Création" matches "creation"). */
export function foldForMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

const STOP_WORDS = new Set(
  'au aux avec dans de des du en et la le les par pour sur un une'.split(' '),
);

/**
 * Meaningful words of a text, folded, with a plural `s` or `x` dropped ("Sciences" ->
 * "science"). Short words and French articles and prepositions are left out.
 */
export function matchWords(text: string): string[] {
  return foldForMatch(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
    .map((w) => (w.length > 3 && /[sx]$/.test(w) ? w.slice(0, -1) : w));
}

/** Stable comparison for French names ("Élodie" sorts with "E"). */
export function compareFr(a: string, b: string): number {
  return a.localeCompare(b, 'fr', { sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0);
}
