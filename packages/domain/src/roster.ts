/**
 * Roster import: keep first names (or nicknames) only.
 *
 * CSV files are parsed in the teacher's browser. Only the column the teacher picks is ever
 * sent to the server, and every value is cleaned and checked here first (SPEC section 6).
 */

export const MAX_FIRST_NAME_LENGTH = 40;

export type ColumnKind = 'first_name' | 'sensitive' | 'other';

const strip = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const FIRST_NAME_HEADERS = [
  /^prenom( usuel| legal)?$/,
  /^first( name)?$/,
  /^given( name)?$/,
  /^surnom$/,
  /^nickname$/,
  /^preferred( first)? name$/,
  /^prenom de l eleve$/,
];

// Columns that must never be imported. Matching them lets the UI say so explicitly.
const SENSITIVE_HEADERS = [
  /\bnom de famille\b/,
  /^nom$/,
  /\bnom complet\b/,
  /\blast( name)?\b/,
  /\bsurname\b/,
  /\bfamily( name)?\b/,
  /\bfull name\b/,
  /\bniso\b/,
  /\boen\b/,
  /\bnumero\b/,
  /\bmatricule\b/,
  /\bid\b/,
  /\bnaissance\b/,
  /\bbirth/,
  /\bdob\b/,
  /\bdate\b/,
  /\bage\b/,
  /\badresse\b/,
  /\baddress\b/,
  /\bcourriel\b/,
  /\bemail\b/,
  /\btelephone\b/,
  /\bphone\b/,
  /\bparent\b/,
  /\btuteur\b/,
  /\bguardian\b/,
  /\bsexe\b/,
  /\bgenre\b/,
  /\bgender\b/,
  /\bphoto\b/,
  /\bsante\b/,
  /\bhealth\b/,
  /\bmedical\b/,
  /\ballergie/,
];

export function classifyColumn(header: string): ColumnKind {
  const h = strip(header);
  if (FIRST_NAME_HEADERS.some((re) => re.test(h))) return 'first_name';
  if (SENSITIVE_HEADERS.some((re) => re.test(h))) return 'sensitive';
  return 'other';
}

/** Index of the column that most likely holds first names, or -1. */
export function suggestFirstNameColumn(headers: readonly string[]): number {
  return headers.findIndex((h) => classifyColumn(h) === 'first_name');
}

export type NameWarning =
  | 'empty'
  | 'too_long'
  | 'contains_comma'
  | 'contains_digits'
  | 'looks_like_email'
  | 'looks_like_full_name';

export interface CleanName {
  value: string;
  warnings: NameWarning[];
}

/** Trims, collapses spaces and flags values that might be more than a first name. */
export function cleanFirstName(raw: string): CleanName {
  const value = raw.replace(/\s+/g, ' ').trim();
  const warnings: NameWarning[] = [];
  if (value.length === 0) warnings.push('empty');
  if (value.length > MAX_FIRST_NAME_LENGTH) warnings.push('too_long');
  if (value.includes('@')) warnings.push('looks_like_email');
  if (value.includes(',')) warnings.push('contains_comma');
  if (/\d/.test(value)) warnings.push('contains_digits');
  // Two or more capitalized words ("Marie Tremblay") often means first + last name.
  // Compound first names are usually hyphenated ("Marie-Ève"), so this is only a warning.
  const words = value.split(' ').filter(Boolean);
  if (words.length >= 2 && words.every((w) => /^\p{Lu}/u.test(w)))
    warnings.push('looks_like_full_name');
  return { value, warnings };
}

/** Warnings that block import outright (the teacher must fix the value first). */
export const BLOCKING_WARNINGS: readonly NameWarning[] = ['empty', 'too_long', 'looks_like_email'];

export interface RosterCandidate extends CleanName {
  row: number;
  /** Same name appears earlier in the file or already exists in the class. */
  duplicate: boolean;
  blocked: boolean;
}

export function prepareRosterImport(
  rows: readonly (readonly string[])[],
  columnIndex: number,
  existingNames: readonly string[] = [],
): RosterCandidate[] {
  const seen = new Set(existingNames.map((n) => n.toLocaleLowerCase('fr-CA')));
  return rows.map((row, i) => {
    const cleaned = cleanFirstName(row[columnIndex] ?? '');
    const key = cleaned.value.toLocaleLowerCase('fr-CA');
    const duplicate = cleaned.value.length > 0 && seen.has(key);
    seen.add(key);
    return {
      ...cleaned,
      row: i,
      duplicate,
      blocked: cleaned.warnings.some((w) => BLOCKING_WARNINGS.includes(w)),
    };
  });
}

/**
 * Decodes an uploaded CSV. Excel in French often saves Windows-1252, not UTF-8,
 * so try strict UTF-8 first and fall back.
 */
export function decodeCsvBytes(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(view);
  } catch {
    text = new TextDecoder('windows-1252').decode(view);
  }
  return text.replace(/^\uFEFF/, '');
}

/** Splits pasted text (one name per line) into rows for prepareRosterImport. */
export function rowsFromPastedText(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => [line]);
}
