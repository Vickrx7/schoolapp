/**
 * Canadian French style (SPEC 10, DECISIONS P-20): typographic apostrophes, non-breaking spaces
 * inside « » and before `:`, « 3e année » rather than « 3ème », no European grade names
 * (CP, CE1…) or expressions (« week-end »). Normalizing typography is free; the word-level
 * problems need a person (or a retry).
 */
import type { LibraryItemType } from './catalog';
import { isPlainObject } from './conform';

export const NBSP = '\u00a0';
export const NARROW_NBSP = '\u202f';

/** `«\u00a0text\u00a0»`. */
export function guillemets(text: string): string {
  return `«${NBSP}${text}${NBSP}»`;
}

/** Keys whose values are machine values (ids, kinds, enum values), never prose. */
export const MACHINE_KEYS: ReadonlySet<string> = new Set([
  'id',
  'kind',
  'questionId',
  'leftId',
  'rightId',
  'correctChoiceIds',
  'orderedIds',
  'category',
  'space',
  'stage',
  'supervision',
  'wordClass',
  'gender',
  'schema',
]);

/** Applies `fn` to every prose string of a JSON value (machine keys are left alone). */
export function mapStrings<T>(value: T, fn: (text: string) => string): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return fn(v);
    if (Array.isArray(v)) return v.map(walk);
    if (isPlainObject(v)) {
      const result: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(v)) {
        result[key] = MACHINE_KEYS.has(key) ? inner : walk(inner);
      }
      return result;
    }
    return v;
  };
  return walk(value) as T;
}

/** Like `mapStrings`, but only over French strings: the English half of a family guide is kept. */
export function mapFrenchStrings<T>(
  type: LibraryItemType,
  content: T,
  fn: (s: string) => string,
): T {
  if (type === 'parent_guide' && isPlainObject(content)) {
    const { en, ...rest } = content;
    return { ...mapStrings(rest, fn), en } as T;
  }
  return mapStrings(content, fn);
}

/** Every French prose string of a content (everything but `parent_guide.en`), in order. */
export function frenchStrings(type: LibraryItemType, content: unknown): string[] {
  const strings: string[] = [];
  mapFrenchStrings(type, content, (s) => {
    strings.push(s);
    return s;
  });
  return strings;
}

/**
 * Fixes French typography without changing words: `'` → `’` between letters, « 3ème » → « 3e »,
 * « 1ère » → « 1re », non-breaking spaces inside « » and before a colon that ends a phrase.
 * Idempotent.
 */
export function normalizeFrenchTypography(text: string): string {
  return (
    text
      .replace(/(?<=\p{L})['`´](?=\p{L})/gu, '’')
      .replace(/(?<![\p{L}\p{N}])1\s?(?:ère|ere)(?!\p{L})/giu, '1re')
      .replace(/(?<![\p{L}\p{N}])(\d+)\s?(?:ième|ieme|ème|eme|è)(?!\p{L})/giu, '$1e')
      .replace(/«[ \t\u00a0\u202f]*/g, `«${NBSP}`)
      .replace(/[ \t\u00a0\u202f]*»/g, `${NBSP}»`)
      // A colon that ends a phrase (not 8:45, not https://).
      .replace(/(?<=[\p{L}\p{N}»)\]%])[ \t\u202f]*:(?=\s|$)/gu, `${NBSP}:`)
  );
}

/** European French words and anglicisms to avoid in Ontario French schools. */
export const NOT_CANADIAN = [
  'septante',
  'nonante',
  'week-end',
  'weekend',
  'e-mail',
  'email',
  'parking',
  'shopping',
  'petit-dej',
] as const;

export type StyleProblemCode =
  | 'straightApostrophe'
  | 'ordinal'
  | 'europeanGrade'
  | 'notCanadian'
  | 'guillemetSpacing'
  | 'colonSpacing';

export interface StyleProblem {
  code: StyleProblemCode;
  match: string;
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const STYLE_RULES: { code: StyleProblemCode; pattern: RegExp }[] = [
  { code: 'straightApostrophe', pattern: /\p{L}['`´]\p{L}/gu },
  {
    code: 'ordinal',
    pattern: /(?<![\p{L}\p{N}])\d+\s?(?:ième|ieme|ème|eme|ère|ere|è)(?!\p{L})/giu,
  },
  { code: 'europeanGrade', pattern: /(?<![\p{L}\p{N}])(?:CP|CE1|CE2|CM1|CM2)(?![\p{L}\p{N}])/gu },
  { code: 'guillemetSpacing', pattern: /«(?![\u00a0\u202f])|(?<![\u00a0\u202f])»/gu },
  { code: 'colonSpacing', pattern: /(?<=[\p{L}\p{N}»)\]%])[ \t\u202f]*:(?=\s|$)/gu },
];

const NOT_CANADIAN_PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${NOT_CANADIAN.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}])`,
  'gu',
);

/** Words a Canadian reader would stumble on (folded match: « Week-end » counts). */
export function notCanadianWords(text: string): string[] {
  return [...fold(text).matchAll(NOT_CANADIAN_PATTERN)].map((m) => m[0]);
}

/** Style problems of one French string, in rule order. */
export function frenchStyleProblems(text: string): StyleProblem[] {
  const problems: StyleProblem[] = [];
  for (const { code, pattern } of STYLE_RULES) {
    for (const m of text.matchAll(pattern)) problems.push({ code, match: m[0] });
  }
  for (const match of notCanadianWords(text)) problems.push({ code: 'notCanadian', match });
  return problems;
}

/**
 * Words that suggest faith content (prayer, religious text), to suggest the « Contient du
 * contenu de foi » checkbox. Accents matter (« marié » is not « Marie »), and a word joined by a
 * hyphen is a place or a compound name (« Saint-Laurent », « Anne-Marie »), not faith content.
 */
const FAITH_WORDS = [
  'prière',
  'prières',
  'priere',
  'prieres',
  'prier',
  'prions',
  'dieu',
  'jésus',
  'jesus',
  'jésus-christ',
  'christ',
  'marie',
  'messe',
  'messes',
  'avent',
  'carême',
  'careme',
  'pâques',
  'paques',
  'noël',
  'noel',
  'évangile',
  'évangiles',
  'evangile',
  'bible',
  'biblique',
  'psaume',
  'psaumes',
  'communion',
  'baptême',
  'bapteme',
  'saint',
  'sainte',
  'saints',
  'saintes',
  'seigneur',
  'chapelet',
  'eucharistie',
  'sacrement',
  'sacrements',
  'amen',
  'paroisse',
  'liturgie',
  'liturgique',
  'apôtre',
  'apôtres',
] as const;

const FAITH_PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}-])(?:${[...FAITH_WORDS]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|')})(?![\\p{L}\\p{N}-])`,
  'u',
);

export function suggestsFaithContent(text: string): boolean {
  return FAITH_PATTERN.test(text.normalize('NFC').toLowerCase());
}
