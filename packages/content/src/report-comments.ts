/**
 * Report card comments (DECISIONS D-129, D-131): the placeholder `{prénom}` and French elision,
 * the wording a teacher picks for a student (neutral, feminine or masculine), how a comment is
 * counted and copied, and the achievement-chart qualifiers of an entry. Pure: the composer runs
 * in the teacher's browser, and the device stores comments with `{prénom}`, never the name.
 */
import type { AchievementCategory } from './questions';
import { FIRST_NAME_TOKEN } from './types/report-comments';

export type CommentForm = 'neutral' | 'feminine' | 'masculine';
export const COMMENT_FORMS: readonly CommentForm[] = ['neutral', 'feminine', 'masculine'];

const VOWELS = 'aàâäeéèêëiîïoôöuùûüæœ';
const isVowel = (c: string | undefined) => c !== undefined && VOWELS.includes(c.toLowerCase());
const isLetter = (c: string | undefined) => c !== undefined && /\p{L}/u.test(c);

/**
 * Whether « de », « que », « lorsque » and « puisque » elide before this first name: before a
 * vowel (accented ones too) and before H (taken as mute: « d’Hugo », **Assumption**); before Y
 * followed by a consonant (« d’Yves ») but not by a vowel (« de Youssef »).
 */
export function elidesBefore(firstName: string): boolean {
  const [first, second] = [...firstName.trim().normalize('NFC')];
  if (!isLetter(first)) return false;
  const lower = first!.toLowerCase();
  if (lower === 'y') return isLetter(second) && !isVowel(second);
  if (lower === 'h') return true;
  return isVowel(first);
}

/** The full and elided forms of the articles that elide before a name. */
const ARTICLES: readonly (readonly [string, string])[] = [
  ['de', 'd'],
  ['que', 'qu'],
  ['lorsque', 'lorsqu'],
  ['puisque', 'puisqu'],
];
const FULL_TO_ELIDED = new Map(ARTICLES.map(([full, elided]) => [full, elided]));
const ELIDED_TO_FULL = new Map(ARTICLES.map(([full, elided]) => [elided, full]));

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TOKEN = escapeRegExp(FIRST_NAME_TOKEN);
const BEFORE = '(?<![\\p{L}\\p{N}])';
const FULL_BEFORE_TOKEN = new RegExp(`${BEFORE}(de|que|lorsque|puisque)[ \\u00a0]+${TOKEN}`, 'giu');
const ELIDED_BEFORE_TOKEN = new RegExp(`${BEFORE}(d|qu|lorsqu|puisqu)(['’])${TOKEN}`, 'giu');

/** `word` with the case of the first letter of `like` (« De » → « D », « de » → « d »). */
function caseLike(word: string, like: string): string {
  const upper = like[0] !== undefined && like[0] === like[0].toUpperCase();
  return upper ? word[0]!.toUpperCase() + word.slice(1) : word;
}

/**
 * A comment with the student's first name in place of `{prénom}`. « de, que, lorsque, puisque »
 * before the name elide when it calls for it, keeping a capital at a sentence start (« D’Aïcha »),
 * with the typographic apostrophe; an elided article written in the template becomes the full
 * one before a name that does not elide (« d’{prénom} » → « de Samuel »). Both ' and ’ are read.
 */
export function fillComment(template: string, firstName: string): string {
  const name = firstName.trim();
  const elides = elidesBefore(name);
  return template
    .replace(FULL_BEFORE_TOKEN, (match, article: string) => {
      if (!elides) return match.replace(FIRST_NAME_TOKEN, name);
      const elided = FULL_TO_ELIDED.get(article.toLowerCase())!;
      return `${caseLike(elided, article)}’${name}`;
    })
    .replace(ELIDED_BEFORE_TOKEN, (match, article: string, apostrophe: string) => {
      if (elides) return `${article}${apostrophe}${name}`;
      const full = ELIDED_TO_FULL.get(article.toLowerCase())!;
      return `${caseLike(full, article)} ${name}`;
    })
    .replaceAll(FIRST_NAME_TOKEN, name);
}

/**
 * A comment as the device stores it: the student's first name, written with its capital as a
 * whole word, becomes `{prénom}`; an article before it stays as written. Other names, and the
 * name in lower case (« une rose » for Rose), are left as they are. `fillComment(unfillComment(t,
 * n), n) === t` for a comment written correctly; a wrong elision is corrected on the way back
 * (« de Aïcha » as typed comes back as « d’Aïcha », « d’Samuel » as « de Samuel »).
 */
export function unfillComment(text: string, firstName: string): string {
  const name = firstName.trim();
  if (!name) return text;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}-])${escapeRegExp(name)}(?![\\p{L}\\p{N}-])`, 'gu');
  return text.replace(pattern, FIRST_NAME_TOKEN);
}

/** The words of an entry in the chosen wording: the neutral text when that one is empty. */
export function entryText(
  entry: { neutral: string; feminine: string; masculine: string },
  form: CommentForm,
): string {
  const text = entry[form].trim();
  return text || entry.neutral.trim();
}

/**
 * The length of a comment as report card systems count it (**Assumption**): Unicode code points
 * after NFC normalization, a line break counting one.
 */
export function commentLength(text: string): number {
  return [...text.normalize('NFC').replace(/\r\n?/g, '\n')].length;
}

/** No-break spaces (U+00A0, U+202F) as plain spaces, for older report card systems. */
export function plainSpaces(text: string): string {
  return text.replace(/[\u00a0\u202f]/g, ' ');
}

// ---------------------------------------------------------------------------------------
// Achievement-chart qualifiers of a report card comment
// ---------------------------------------------------------------------------------------

export type AchievementLevel = 1 | 2 | 3 | 4;

/**
 * The qualifier of each level in a report card comment (**Assumption**, to be checked with pilot
 * teachers, D-030): the knowledge category qualifies what the student knows or understands; the
 * three others say how effectively the student works.
 */
export const REPORT_CARD_QUALIFIERS: Record<
  AchievementCategory,
  readonly [string, string, string, string]
> = {
  connaissance: ['limitée', 'partielle', 'bonne', 'approfondie'],
  habiletes: [
    'avec une efficacité limitée',
    'avec une certaine efficacité',
    'avec beaucoup d’efficacité',
    'avec un très haut degré d’efficacité',
  ],
  communication: [
    'avec une efficacité limitée',
    'avec une certaine efficacité',
    'avec beaucoup d’efficacité',
    'avec un très haut degré d’efficacité',
  ],
  application: [
    'avec une efficacité limitée',
    'avec une certaine efficacité',
    'avec beaucoup d’efficacité',
    'avec un très haut degré d’efficacité',
  ],
};

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[’`´]/g, "'")
    .replace(/[\u00a0\u202f]/g, ' ');

// « connaissance(s) / compréhension limitée », « une bonne compréhension », « approfondie ».
const KNOWLEDGE: readonly [RegExp, RegExp, RegExp, RegExp] = [
  /(?<!\p{L})limitee?s?(?!\p{L})/u,
  /(?<!\p{L})partiel(?:le)?s?(?!\p{L})/u,
  /(?<!\p{L})(?:bonnes? (?:connaissances?|comprehensions?)|genera(?:l|le|ux|les))(?!\p{L})/u,
  /(?<!\p{L})approfondie?s?(?!\p{L})/u,
];
// The longest phrase first: « un très haut degré d'efficacité » before « efficacité limitée ».
const EFFECTIVENESS: readonly (readonly [AchievementLevel, RegExp])[] = [
  [4, /(?:tres )?haut degre d'efficacite/u],
  [3, /beaucoup d'efficacite/u],
  [2, /certaine efficacite/u],
  [1, /efficacite limitee/u],
];

/** The levels whose report card qualifier appears in a text. */
export function reportQualifierLevels(
  category: AchievementCategory,
  text: string,
): AchievementLevel[] {
  const folded = fold(text);
  if (category === 'connaissance') {
    return ([1, 2, 3, 4] as const).filter((level) => KNOWLEDGE[level - 1]!.test(folded));
  }
  const levels: AchievementLevel[] = [];
  for (const [level, phrase] of EFFECTIVENESS) {
    if (phrase.test(folded)) levels.push(level);
  }
  return levels.sort((a, b) => a - b);
}

export interface EntryQualifierProblem {
  field: CommentForm;
  /** The qualifier of another level, found in that text. */
  foundLevel: AchievementLevel;
}

/**
 * An entry for one achievement level must not carry another level's qualifier (« avec beaucoup
 * d’efficacité » in a level 2 entry). Only entries with a level and a category are checked.
 */
export function entryQualifierProblems(entry: {
  level: number | null;
  category: AchievementCategory | null;
  neutral: string;
  feminine: string;
  masculine: string;
}): EntryQualifierProblem[] {
  if (entry.level === null || entry.category === null) return [];
  const problems: EntryQualifierProblem[] = [];
  for (const field of COMMENT_FORMS) {
    for (const found of reportQualifierLevels(entry.category, entry[field])) {
      if (found !== entry.level) problems.push({ field, foundLevel: found });
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------
// The placeholder as the AI (or a hurried author) writes it
// ---------------------------------------------------------------------------------------

/** `{prenom}`, `{Prénom}`, `[prénom]`, `{ prénom }`: the placeholder, spelled loosely. */
const LOOSE_TOKEN = /[{[]\s*pr[ée]nom\s*[}\]]/giu;
const ELIDED_ARTICLE_BEFORE_TOKEN = new RegExp(`${BEFORE}(d|qu|lorsqu|puisqu)['’]${TOKEN}`, 'giu');

/**
 * The placeholder spelled `{prénom}`, and an article before it written in full (« d’{prénom} » →
 * « de {prénom} »), so the device elides it for each name (`fillComment`).
 */
export function normalizeCommentTemplate(text: string): string {
  return text
    .replace(LOOSE_TOKEN, FIRST_NAME_TOKEN)
    .replace(
      ELIDED_ARTICLE_BEFORE_TOKEN,
      (_m, article: string) =>
        `${caseLike(ELIDED_TO_FULL.get(article.toLowerCase())!, article)} ${FIRST_NAME_TOKEN}`,
    );
}
