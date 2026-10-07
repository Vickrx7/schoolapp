/**
 * Report card comments (DECISIONS D-129, D-131): the placeholder `{prénom}` and French elision,
 * the wording a teacher picks for a student (neutral, feminine or masculine), how a comment is
 * counted and copied, and the achievement-chart qualifiers of an entry. Pure: the composer runs
 * in the teacher's browser, and the device stores comments with `{prénom}`, never the name.
 */
import type { AchievementCategory } from './questions';
import { ACHIEVEMENT_QUALIFIERS, qualifierLevels, type RubricLevel } from './rubric';
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

// ---------------------------------------------------------------------------------------
// The device draft: every first name of the class in template form (post-MVP review)
// ---------------------------------------------------------------------------------------

/** A student of the class, as the composer knows them: never stored, read from the roster. */
export interface RosterName {
  id: string;
  firstName: string;
}

/** Another student of the class in a stored comment: `{élève:<the first 8 hex of the id>}`. */
export function classmateToken(id: string): string {
  return `{élève:${id.slice(0, 8).toLowerCase()}}`;
}
const CLASSMATE_TOKEN = /\{élève:([0-9a-f]{8})\}/gu;
/** A classmate's token whose student left the class: no name to put back. */
export const CLASSMATE_GONE = '[élève]';

/**
 * First names that are also everyday words (folded): matched in lower case only when written
 * exactly as the roster spells them, so « une rose », « une explication claire » and « fait preuve
 * de patience » stay as typed.
 */
const NAMES_THAT_ARE_WORDS = new Set(
  [
    'aime aimee ambre amour ange aurore belle blanche bonheur capucine celeste cerise chance ciel',
    'claire clemence colombe constance constant desire divine esperance etoile faith felicite',
    'fidele fleur flore gloire grace honore hope iris jade jean joie joy juste lilas lis lumiere',
    'lune lys marguerite marine max may melodie merveille miracle modeste neige oceane olive',
    'paix parfait patience perle pierre precieuse prince princesse prudence prune roman rose sage',
    'soleil tresor victoire violette will avril mai lui son ton',
  ]
    .join(' ')
    .split(' '),
);

/** One character folded, keeping the text's length: « É » → « e », « - » (any dash) → « - ». */
function foldChar(c: string): string {
  if (/\p{Pd}/u.test(c)) return '-';
  if (/\s/u.test(c)) return ' ';
  const base = c.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  if (base.length === c.length) return base;
  const lower = c.toLowerCase();
  return lower.length === c.length ? lower : c;
}

const foldKeepingLength = (text: string) => [...text].map(foldChar).join('');
const foldName = (name: string) => foldKeepingLength(name.trim().normalize('NFC'));

/**
 * A text as the device stores it (D-130 as amended in the post-MVP review): the student's own
 * first name becomes `{prénom}` and every other first name of the class `{élève:…}`, whatever
 * their case and accents (« LÉA », « Lea », « léa »), as whole words; a first name that is also an
 * everyday word is replaced in lower case only when written as the roster spells it (« une rose »
 * stays). Other names the teacher types (a parent's, a nickname) stay as typed. The text comes
 * back with `fillDraftText`, with the roster's spelling.
 */
export function unfillDraftText(
  text: string,
  student: RosterName,
  classmates: readonly RosterName[],
): string {
  const source = text.normalize('NFC');
  const folded = foldKeepingLength(source);
  const names = [
    { token: FIRST_NAME_TOKEN, name: student.firstName.trim().normalize('NFC') },
    ...classmates
      .filter((c) => c.id !== student.id)
      .map((c) => ({ token: classmateToken(c.id), name: c.firstName.trim().normalize('NFC') })),
  ]
    .filter((n) => [...n.name].some((c) => /\p{L}/u.test(c)))
    // The longest names first (« Marie-Ève » before « Marie »); the student's own first.
    .map((n, order) => ({ ...n, order, key: foldName(n.name) }))
    .sort((a, b) => b.key.length - a.key.length || a.order - b.order);
  const taken: { start: number; end: number; token: string }[] = [];
  for (const { token, name, key } of names) {
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{M}\\p{N}-])${escapeRegExp(key).replace(/[- ]/g, '[- ]')}(?![\\p{L}\\p{M}\\p{N}-])`,
      'gu',
    );
    for (const m of folded.matchAll(pattern)) {
      const start = m.index;
      const end = start + m[0].length;
      if (taken.some((t) => start < t.end && t.start < end)) continue;
      const written = source.slice(start, end);
      const lower = !/^\p{Lu}/u.test(written);
      if (lower && written !== name && NAMES_THAT_ARE_WORDS.has(key.replace(/[- ]/g, ''))) continue;
      taken.push({ start, end, token });
    }
  }
  taken.sort((a, b) => a.start - b.start);
  let out = '';
  let last = 0;
  for (const t of taken) {
    out += source.slice(last, t.start) + t.token;
    last = t.end;
  }
  return out + source.slice(last);
}

/** A stored text with the names back: `{prénom}` (with elision, `fillComment`) and `{élève:…}`. */
export function fillDraftText(
  template: string,
  firstName: string,
  classmates: readonly RosterName[],
): string {
  return fillComment(template, firstName).replace(CLASSMATE_TOKEN, (_, short: string) => {
    const mate = classmates.find((c) => c.id.toLowerCase().startsWith(short));
    return mate?.firstName.trim() || CLASSMATE_GONE;
  });
}

/**
 * At most `max` characters of a stored text, never cutting a token in two (a text too long for
 * the device is clipped, never refused: D-130 as amended).
 */
export function clipDraftText(template: string, max: number): string {
  if (template.length <= max) return template;
  const cut = template.slice(0, max);
  const open = cut.lastIndexOf('{');
  return open > cut.lastIndexOf('}') ? cut.slice(0, open) : cut;
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

export type AchievementLevel = RubricLevel;

/**
 * The qualifier of each level in a report card comment: the achievement chart's, the same as a
 * rubric's (`ACHIEVEMENT_QUALIFIERS`, one source of truth, D-131). The knowledge category
 * qualifies what the student knows or understands (« limitée, partielle, générale,
 * approfondie »); the three others say how effectively the student works (« avec une efficacité
 * limitée, avec une certaine efficacité, avec efficacité, avec beaucoup d’efficacité »).
 * **À vérifier** against the official chart (D-030).
 */
export const REPORT_CARD_QUALIFIERS = ACHIEVEMENT_QUALIFIERS;

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[’`´]/g, "'")
    .replace(/[\u00a0\u202f]/g, ' ');

/**
 * « Une bonne compréhension »: what teachers often write for knowledge at level 3. Accepted as
 * level 3 when checking a bank (rubrics keep the chart's word only); banks and the AI write
 * « générale ».
 */
const KNOWLEDGE_LEVEL_3_SYNONYM = /(?<!\p{L})bonnes? (?:connaissances?|comprehensions?)(?!\p{L})/u;

/**
 * The levels whose report card qualifier appears in a text: the rubric's detection
 * (`qualifierLevels`), plus « bonne connaissance / compréhension » as level 3 for knowledge.
 */
export function reportQualifierLevels(
  category: AchievementCategory,
  text: string,
): AchievementLevel[] {
  const levels = new Set(qualifierLevels(category, plainSpaces(text)));
  if (category === 'connaissance' && KNOWLEDGE_LEVEL_3_SYNONYM.test(fold(text))) levels.add(3);
  return [...levels].sort((a, b) => a - b);
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
