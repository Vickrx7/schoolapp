/**
 * « Traduire en anglais (IA) » for an « Info-parents » message (DECISIONS D-139, amending D-038,
 * D-052 and D-072): the English of the French paragraphs whose English is missing or out of date
 * (or of every paragraph, on request), for the families of a French-language Catholic school.
 *
 * The input is built by the database from the stored message (`app.newsletter_ai_input`): its
 * paragraphs in order, each with a key (`P1`…), its section and its French, and the class's grade
 * labels. No class, school, staff name, signature or id goes into the message (the paragraph ids
 * stay in Canada, to put each answer back on its paragraph).
 *
 * Stricter than the other features, under the rule that nothing personal leaves Canada:
 * - a paragraph holding a personal detail (`findBlockedDetails`) is not sent and listed as
 *   « Non envoyé », as substitute plans do (D-052), instead of refusing the whole request;
 * - so is a paragraph where a title is followed by a name the app does not know (« Merci à Mme
 *   Dupuis », `findTitledUnknownNames`, run on the redacted text: the people the app knows are
 *   already markers);
 * - the preview lists the remaining capitalized words for the teacher to check
 *   (`capitalizedWords`), and she confirms before anything is sent;
 * - the request carries the keys of the paragraphs the preview showed as sent (`sendKeys`): the
 *   worker sends no other, and the last check runs the title rule on the whole message again
 *   (`outboundFindings`).
 *
 * Pure (Zod only): the web server imports it for its preview.
 */
import { z } from 'zod';
import {
  findTitledUnknownNames,
  type BlockedFinding,
  type BlockedKind,
  type Redactor,
} from '../privacy';
import type { FeatureDefinition } from '../types';
import { tagged } from './shared';

export const NEWSLETTER_TRANSLATE = 'newsletter_translate';

/** The message's sections, in order (as @lynx/domain `NEWSLETTER_SECTIONS`; a test checks). */
export const NEWSLETTER_TRANSLATE_SECTIONS = [
  'message',
  'thisWeek',
  'nextWeek',
  'dates',
  'reminders',
  'atHome',
  'faith',
  'closing',
] as const;
export type NewsletterTranslateSection = (typeof NEWSLETTER_TRANSLATE_SECTIONS)[number];

/** As the message's limits (@lynx/domain `NEWSLETTER_LIMITS`): 60 paragraphs, 1,000 and 1,500. */
export const NEWSLETTER_TRANSLATE_LIMITS = { items: 60, fr: 1000, en: 1500 } as const;

/** The sections' headings as the families read them (`newsletterText.sections`, French). */
const HEADINGS_FR: Record<NewsletterTranslateSection, string> = {
  message: 'Message',
  thisWeek: 'Cette semaine en classe',
  nextWeek: 'La semaine prochaine',
  dates: 'Dates à retenir',
  reminders: 'Rappels',
  atHome: 'Pour aider à la maison',
  faith: 'Moment de foi',
  closing: 'Mot de la fin',
};

const paragraphKey = z.string().regex(/^P(?:[1-9]|[1-5]\d|60)$/);

export const newsletterTranslateItemSchema = z.object({
  /** P1…P60, in the message's order; the only way the model refers to a paragraph. */
  key: paragraphKey,
  /** Stays in Canada: never in the message. */
  itemId: z.string().regex(/^[a-z0-9]{8}$/),
  section: z.enum(NEWSLETTER_TRANSLATE_SECTIONS),
  text: z
    .string()
    .max(NEWSLETTER_TRANSLATE_LIMITS.fr)
    .refine((s) => s.trim() !== '', 'required'),
});
export type NewsletterTranslateItem = z.infer<typeof newsletterTranslateItemSchema>;

export const newsletterTranslateInputSchema = z
  .object({
    newsletterId: z.uuid(),
    /** The message's revision: the answer is applied only while it is unchanged. */
    revision: z.number().int().positive(),
    scope: z.enum(['missing', 'all']),
    /** « 3e année »: French labels, from the database. */
    gradeLabels: z.array(z.string().max(40)).max(4),
    items: z.array(newsletterTranslateItemSchema).min(1).max(NEWSLETTER_TRANSLATE_LIMITS.items),
    /**
     * The keys of the paragraphs the preview showed as sent, which the teacher confirmed: the
     * request sends no other. Null in the preview itself (every paragraph the rules allow).
     */
    sendKeys: z.array(paragraphKey).min(1).max(NEWSLETTER_TRANSLATE_LIMITS.items).nullable(),
  })
  .superRefine((input, ctx) => {
    const keys = input.items.map((i) => i.key);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: 'custom', path: ['items'], message: 'duplicate' });
    }
    const ids = input.items.map((i) => i.itemId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', path: ['items'], message: 'duplicate' });
    }
    if (
      input.sendKeys &&
      (new Set(input.sendKeys).size !== input.sendKeys.length ||
        input.sendKeys.some((k) => !keys.includes(k)))
    ) {
      ctx.addIssue({ code: 'custom', path: ['sendKeys'], message: 'invalid' });
    }
  });
export type NewsletterTranslateInput = z.infer<typeof newsletterTranslateInputSchema>;

export interface NewsletterTranslateOutput {
  items: { key: string; text: string }[];
}

/** The answer's schema: plain strings (`validate` checks the keys and every text). */
export const newsletterTranslateOutputSchema = z.object({
  items: z.array(z.object({ key: z.string(), text: z.string() })),
}) as z.ZodType<NewsletterTranslateOutput>;

// ---------------------------------------------------------------------------------------
// Words that are never a person, for the title rule and the preview's capitalized words
// ---------------------------------------------------------------------------------------

const foldWord = (s: string) =>
  s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae');

/**
 * Capitalized words that never name a person in a message to families (folded): the faith, the
 * feasts and seasons, places, school subjects and days off, and English days and months (the
 * plan's allowlist, **Assumption**). « Marie » is not in it: it is a first name too.
 */
export const NEVER_A_PERSON: ReadonlySet<string> = new Set(
  [
    // Faith, feasts and seasons
    'dieu jesus christ seigneur vierge esprit saint sainte st ste tout puissant eglise',
    'noel paques avent careme pentecote toussaint epiphanie ascension assomption cendres',
    'action grace souvenir famille fetes fete terre halloween carnaval',
    // Places
    'canada ontario quebec ottawa toronto',
    // Subjects and school words
    'francais anglais mathematiques sciences technologie etudes sociales education physique',
    'sante arts musique danse histoire geographie religieux enseignement info parents',
    'ecole conseil paroisse classe',
    'english french math',
    // English days and months
    'monday tuesday wednesday thursday friday saturday sunday',
    'january february march april may june july august september october november december',
  ]
    .join(' ')
    .split(' '),
);

/** Function words that may start a sentence: there, never a name (folded). */
const COMMON_WORDS = new Set(
  [
    'le la les l un une des du de d au aux ce cet cette ces mon ma mes ton ta tes son sa ses',
    'notre nos votre vos leur leurs je j tu il elle on nous vous ils elles c ca qui que qu quoi',
    'et ou mais donc or ni car si s en a dans par pour sur sous avec sans chez vers entre apres',
    'avant depuis pendant tous toutes chaque merci bonjour bonsoir bravo felicitations bienvenue',
    'bonne bon bonnes bons cher chere cheres chers rappel rappels attention important',
    'the a an we our you your this these that please thank thanks dear hello',
  ]
    .join(' ')
    .split(' '),
);

/** « Élève A », « Adulte B »: the markers the redactor puts in place of people. */
const MARKER =
  /(?<![\p{L}\p{M}\p{N}])([ÉEée]l[èe]ve|[Aa]dulte)\s+([A-Z]{1,3})(?![\p{L}\p{M}\p{N}])/gu;
/** Words without their elision: « Hélène » in « d’Hélène ». */
const WORD = /[\p{L}\p{M}]+/gu;
/** What may come right before a word that starts a sentence or a quotation. */
const STARTS = /(?:^|[.!?…:;«“"([\n—–]|^\s*-|\s-)\s*$/u;

/**
 * The capitalized words of the texts that the teacher should check before sending (D-139): a
 * name the app does not know (a parent's, a volunteer's) is sent as it is, so the preview asks
 * her to look at every word that may be one. Words in the middle of a sentence, never markers,
 * short acronyms (« PA »), titles (« Mme »), common words or `NEVER_A_PERSON`; a word that starts
 * a sentence or a quotation (« Les », « Demain ») only when the next word is listed too (« Julie
 * Dupuis viendra »). In order of appearance, each once.
 */
export function capitalizedWords(texts: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (word: string) => {
    const key = foldWord(word);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(word);
    }
  };
  for (const text of texts) {
    const markers = new Set<number>();
    for (const m of text.matchAll(MARKER)) {
      markers.add(m.index);
      markers.add(m.index + m[0].length - m[2]!.length);
    }
    const words = [...text.matchAll(WORD)].map((m) => ({ word: m[0], index: m.index }));
    const candidate = (i: number) => {
      const w = words[i];
      if (!w || markers.has(w.index) || !/^\p{Lu}/u.test(w.word)) return false;
      const letters = w.word;
      if (letters.length < 2) return false;
      if (letters.length <= 3 && letters === letters.toUpperCase()) return false;
      const folded = foldWord(letters);
      if (NEVER_A_PERSON.has(folded)) return false;
      return !/^(?:m|mme|mlle|mr|mrs|ms|mx|dr|dre|mgr)$/.test(folded);
    };
    // Inside a sentence, a capitalized « Son » or « Bon » is a name: only a sentence's first word
    // may be a common word.
    const common = (i: number) => COMMON_WORDS.has(foldWord(words[i]!.word));
    const atStart = (i: number) => STARTS.test(text.slice(0, words[i]!.index));
    words.forEach((w, i) => {
      if (!candidate(i)) return;
      if (!atStart(i)) return add(w.word);
      // A sentence's first word is listed with the next when both are capitalized (a full name),
      // unless it is a common word (« Les Dupuis viendront »: Dupuis only).
      const next = words[i + 1];
      if (
        !common(i) &&
        next &&
        candidate(i + 1) &&
        /^\s+$/u.test(text.slice(w.index + w.word.length, next.index))
      ) {
        add(w.word);
      }
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// De-identification: one redactor for the whole request; a paragraph with a personal detail
// or a title before an unknown name is left out
// ---------------------------------------------------------------------------------------

/** A paragraph left out (« Non envoyé »), and why. */
export interface NewsletterNotSent {
  key: string;
  itemId: string;
  section: NewsletterTranslateSection;
  kinds: BlockedKind[];
  /** What was found, for the teacher's own preview only (never logged). */
  findings: BlockedFinding[];
}

export interface RedactedNewsletterInput {
  /** The input as sent: the kept paragraphs, de-identified. */
  input: NewsletterTranslateInput;
  notSent: NewsletterNotSent[];
  /** Kept by the rules but not confirmed in the preview (`sendKeys`): not sent either. */
  unconfirmed: string[];
}

/**
 * De-identifies the paragraphs in order with the request's redactor (so the markers are the same
 * in the preview and in the request), then leaves out every paragraph with a personal detail or a
 * title before a name the app does not know, and, in a request, every paragraph the teacher did
 * not see as sent.
 */
export function redactNewsletterTranslateInput(
  input: NewsletterTranslateInput,
  redactor: Redactor,
): RedactedNewsletterInput {
  const notSent: NewsletterNotSent[] = [];
  const unconfirmed: string[] = [];
  const items: NewsletterTranslateItem[] = [];
  const gradeLabels = input.gradeLabels.map((label) => {
    const r = redactor.redact(label);
    return r.blocked.length || findTitledUnknownNames(r.text, NEVER_A_PERSON).length ? '' : r.text;
  });
  for (const item of input.items) {
    const r = redactor.redact(item.text);
    const findings = [...r.blocked, ...findTitledUnknownNames(r.text, NEVER_A_PERSON)];
    if (findings.length) {
      notSent.push({
        key: item.key,
        itemId: item.itemId,
        section: item.section,
        kinds: [...new Set(findings.map((f) => f.kind))],
        findings,
      });
    } else if (input.sendKeys && !input.sendKeys.includes(item.key)) {
      unconfirmed.push(item.key);
    } else {
      items.push({ ...item, text: r.text });
    }
  }
  return { input: { ...input, gradeLabels, items }, notSent, unconfirmed };
}

// ---------------------------------------------------------------------------------------
// The message
// ---------------------------------------------------------------------------------------

/** The request in French, as the model reads it (and as the preview shows it). No ids. */
export function newsletterTranslateUserMessage(input: NewsletterTranslateInput): string {
  const grades = input.gradeLabels.filter((g) => g.trim());
  const lines = [
    'Message hebdomadaire d’une classe à ses familles, à traduire en anglais.',
    `Année d’études : ${grades.length ? grades.join(', ') : 'non précisée'}.`,
    `Paragraphes à traduire : ${input.items.length}. Réponds avec la clé de chacun (« P1 »…).`,
  ];
  let section: NewsletterTranslateSection | null = null;
  for (const item of input.items) {
    if (item.section !== section) {
      section = item.section;
      lines.push('', `Section : ${HEADINGS_FR[section]}`);
    }
    lines.push(tagged(item.key, item.text));
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------
// Normalizing and checking an answer
// ---------------------------------------------------------------------------------------

const SPACE = '[ \\t\\u00a0\\u202f]';

/**
 * Free fixes of form (D-080): trimmed; French quotation marks become English curly quotes; no
 * space before a colon, semicolon, question or exclamation mark (a French habit); keys trimmed.
 */
export function normalizeNewsletterTranslation(
  output: NewsletterTranslateOutput,
): NewsletterTranslateOutput {
  return {
    items: output.items.map((item) => ({
      key: item.key.trim().toUpperCase(),
      text: item.text
        .trim()
        .replace(new RegExp(`«${SPACE}*`, 'g'), '“')
        .replace(new RegExp(`${SPACE}*»`, 'g'), '”')
        .replace(new RegExp(`${SPACE}+(?=[:;?!])`, 'g'), ''),
    })),
  };
}

/** The markers of a text (« Élève A », « Adulte B »), each as many times as it appears. */
export function markerCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of text.matchAll(MARKER)) {
    const name = `${/^[Aa]/.test(m[1]!) ? 'Adulte' : 'Élève'} ${m[2]}`;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

/** A marker translated into English (« Student A »): its person could not be put back. */
const ENGLISH_MARKER =
  /(?<![\p{L}\p{N}])(?:Student|Pupil|Adult|Child)\s+[A-Z]{1,3}(?![\p{L}\p{N}])/u;

/** A time of day in minutes; `either`: written without a.m. or p.m. (« 8:30 »: 8:30 or 20:30). */
interface Time {
  minutes: number;
  either: boolean;
}

const FRENCH_TIME =
  /(?<![\p{L}\p{N}])([01]?\d|2[0-3])[ \u00a0\u202f]?h(?:[ \u00a0\u202f]?([0-5]\d))?(?![\p{L}\p{N}])/gu;
const FRENCH_NOON = /(?<![\p{L}\p{N}-])à[ \u00a0\u202f]+(midi|minuit)(?![\p{L}\p{N}-])/giu;
const ENGLISH_MERIDIEM =
  /(?<![\p{L}\p{N}:.])(1[0-2]|0?[1-9])(?::([0-5]\d))?[ \u00a0\u202f]?([ap])\.?[ \u00a0\u202f]?m(?![\p{L}])\.?/giu;
const ENGLISH_CLOCK = /(?<![\p{L}\p{N}:.])([01]?\d|2[0-3]):([0-5]\d)(?![\p{N}])/gu;
const ENGLISH_NOON = /(?<![\p{L}\p{N}-])(noon|midday|midnight)(?![\p{L}\p{N}-])/giu;

/** The times of a text and the text without them (for the numbers). */
export function timesOf(text: string, lang: 'fr' | 'en'): { times: Time[]; rest: string } {
  const times: Time[] = [];
  let rest = text;
  const take = (pattern: RegExp, toTime: (m: RegExpMatchArray) => Time) => {
    rest = rest.replace(pattern, (...args) => {
      times.push(toTime(args as unknown as RegExpMatchArray));
      return ' ';
    });
  };
  // French clock times may stay in an English text: they still count.
  take(FRENCH_TIME, (m) => ({ minutes: Number(m[1]) * 60 + Number(m[2] ?? 0), either: false }));
  if (lang === 'fr') {
    take(FRENCH_NOON, (m) => ({ minutes: /^midi$/i.test(m[1]!) ? 720 : 0, either: false }));
  } else {
    take(ENGLISH_MERIDIEM, (m) => {
      const hour = Number(m[1]) % 12;
      const pm = /p/i.test(m[3]!);
      return { minutes: (hour + (pm ? 12 : 0)) * 60 + Number(m[2] ?? 0), either: false };
    });
    take(ENGLISH_CLOCK, (m) => {
      const hour = Number(m[1]);
      return { minutes: hour * 60 + Number(m[2]), either: hour >= 1 && hour <= 12 };
    });
    take(ENGLISH_NOON, (m) => ({ minutes: /night/i.test(m[1]!) ? 0 : 720, either: false }));
  }
  return { times, rest };
}

/** Whether two lists of times are the same, an unmarked English time matching either half-day. */
export function sameTimes(french: readonly Time[], english: readonly Time[]): boolean {
  if (french.length !== english.length) return false;
  const left = [...english];
  for (const t of french) {
    const i = left.findIndex(
      (e) => e.minutes === t.minutes || (e.either && (e.minutes + 720) % 1440 === t.minutes),
    );
    if (i < 0) return false;
    left.splice(i, 1);
  }
  return true;
}

/**
 * The numbers of a text (times left out) as digit strings: separators inside a number do not
 * count, so « 1 000 » is "1,000" and « 2,50 » is "2.50"; « 1er » is "1st".
 */
export function numbersOf(text: string): string[] {
  return [...text.matchAll(/\d+(?:(?:[ \u00a0\u202f]|,)\d{3}(?!\d))*(?:[.,]\d+)?/gu)]
    .map((m) => m[0].replace(/\D/g, '').replace(/^0+(?=\d)/, ''))
    .sort();
}

/** French words that an English text does not use (folded; elisions such as « l’ » count too). */
const FRENCH_WORDS = new Set(
  (
    'le la les des du et au aux un une pour dans sur avec nous vous est sont ce cette ces qui que ' +
    'ne pas il elle ils elles leur leurs notre nos votre vos mais ou tres de en chez cet aussi'
  ).split(' '),
);
const ELIDED = /^(?:l|d|j|qu|n|s|c)['’]\p{L}/u;

/** The share of an English text's words that are French (quoted titles and markers left out). */
export function frenchShare(text: string): { words: number; share: number } {
  const plain = text.replace(/«[^»]*»|“[^”]*”|"[^"]*"/gu, ' ').replace(MARKER, ' ');
  const words = [...plain.matchAll(/[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu)].map((m) => ({
    raw: m[0].toLowerCase(),
    folded: foldWord(m[0]),
  }));
  if (!words.length) return { words: 0, share: 0 };
  const french = words.filter(
    (w) => FRENCH_WORDS.has(w.folded) || w.raw === 'à' || ELIDED.test(w.folded),
  ).length;
  return { words: words.length, share: french / words.length };
}

const comparable = (s: string) =>
  foldWord(s)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * What is wrong with one paragraph's English (codes, never content): `empty`, `tooLong` (more
 * than twice the French plus 80 characters, or over 1,500), `markers` (not the same markers, as
 * many times), `englishMarker` (« Student A »), `numbers`, `times` (« 13 h 35 » is "1:35 p.m."),
 * `french` (the French itself, or 30 % French words in 8 words or more).
 */
export function translationProblems(source: string, english: string): string[] {
  const problems: string[] = [];
  if (!english.trim()) return ['empty'];
  if (english.length > Math.min(2 * source.length + 80, NEWSLETTER_TRANSLATE_LIMITS.en)) {
    problems.push('tooLong');
  }
  const a = markerCounts(source);
  const b = markerCounts(english);
  if (a.size !== b.size || [...a].some(([name, n]) => b.get(name) !== n)) {
    problems.push('markers');
  }
  if (ENGLISH_MARKER.test(english)) problems.push('englishMarker');
  const fr = timesOf(source, 'fr');
  const en = timesOf(english, 'en');
  if (!sameTimes(fr.times, en.times)) problems.push('times');
  if (numbersOf(fr.rest).join(' ') !== numbersOf(en.rest).join(' ')) problems.push('numbers');
  const share = frenchShare(english);
  const identical = comparable(source) === comparable(english) && frenchShare(source).share > 0;
  if (identical || (share.words >= 8 && share.share > 0.3)) problems.push('french');
  return problems;
}

/** Every problem of an answer: the keys sent, each once, then each paragraph's English. */
export function validateNewsletterTranslation(
  output: NewsletterTranslateOutput,
  input: NewsletterTranslateInput,
): string[] {
  const problems: string[] = [];
  const sent = new Map(input.items.map((i) => [i.key, i]));
  const seen = new Set<string>();
  output.items.forEach((item, n) => {
    const source = sent.get(item.key);
    if (!source) {
      problems.push(`items.${n}: unknown key`);
      return;
    }
    if (seen.has(item.key)) {
      problems.push(`${item.key}: duplicate`);
      return;
    }
    seen.add(item.key);
    problems.push(...translationProblems(source.text, item.text).map((p) => `${item.key}: ${p}`));
  });
  for (const key of sent.keys()) if (!seen.has(key)) problems.push(`${key}: missing`);
  return problems;
}

// ---------------------------------------------------------------------------------------
// The school's words, and the fake answer
// ---------------------------------------------------------------------------------------

/**
 * The prompt's glossary of Ontario school words that an English version must use (the evaluation
 * checks them), and French days and months: `fr` matches in the French, `en` must be in the
 * English (in any case).
 */
export const NEWSLETTER_GLOSSARY: readonly { fr: RegExp; en: string }[] = [
  { fr: /journ[ée]es? p[ée]dagogiques?/iu, en: 'PA day' },
  { fr: /bulletins? de progr[èe]s/iu, en: 'Progress Report Card' },
  { fr: /bulletins? scolaires?/iu, en: 'Report Card' },
  { fr: /d[ée]parts? h[âa]tifs?/iu, en: 'early dismissal' },
  { fr: /entr[ée]es? retard[ée]es?/iu, en: 'late start' },
  { fr: /sorties? [ée]ducatives?/iu, en: 'field trip' },
  { fr: /rencontres? parents?-enseignants?/iu, en: 'parent-teacher' },
  { fr: /mercredi des Cendres/iu, en: 'Ash Wednesday' },
  { fr: /(?<![\p{L}])messes?(?![\p{L}])/iu, en: 'Mass' },
  { fr: /(?<![\p{L}])Avent(?![\p{L}])/u, en: 'Advent' },
  { fr: /(?<![\p{L}])Car[êe]me(?![\p{L}])/u, en: 'Lent' },
  ...(
    [
      ['lundi', 'Monday'],
      ['mardi', 'Tuesday'],
      ['mercredi', 'Wednesday'],
      ['jeudi', 'Thursday'],
      ['vendredi', 'Friday'],
      ['janvier', 'January'],
      ['février', 'February'],
      ['mars', 'March'],
      ['avril', 'April'],
      ['mai', 'May'],
      ['juin', 'June'],
      ['juillet', 'July'],
      ['août', 'August'],
      ['septembre', 'September'],
      ['octobre', 'October'],
      ['novembre', 'November'],
      ['décembre', 'December'],
    ] as const
  ).map(([fr, en]) => ({ fr: new RegExp(`(?<![\\p{L}])${fr}(?![\\p{L}])`, 'iu'), en })),
];

/** « 3e année », « 1re année »: "Grade 3", "Grade 1" (the evaluation checks it too). */
export const GRADE = /(?<![\p{L}\p{N}])(\d{1,2})(?:e|re|er)[ \u00a0\u202f]+ann[ée]e(?![\p{L}])/giu;

function englishTime(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const m = minutes % 60;
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${hour < 12 ? 'a.m.' : 'p.m.'}`;
}

/** « 1 000 » → "1,000", « 2,50 » → "2.50". */
function englishNumber(raw: string): string {
  return raw.replace(/[ \u00a0\u202f](?=\d{3})/g, ',').replace(/,(?=\d{1,2}(?!\d))/g, '.');
}

const NUMBER = /\d+(?:(?:[ \u00a0\u202f]|,)\d{3}(?!\d))*(?:[.,]\d+)?/gu;

/**
 * "Demo translation:" and, in the paragraph's order, its times, grades, school words, days and
 * months, numbers and markers in English form: it passes `validate` and the evaluation's checks
 * (tests, demos and CI never call a model).
 */
function fakeEnglish(text: string): string {
  const pieces: { at: number; text: string }[] = [];
  // Each match is blanked (same length) so nothing is read twice and positions stay.
  let rest = text;
  const take = (pattern: RegExp, english: (m: RegExpExecArray) => string) => {
    const global = new RegExp(
      pattern.source,
      pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`,
    );
    for (const m of rest.matchAll(global)) {
      pieces.push({ at: m.index, text: english(m as RegExpExecArray) });
      rest = rest.slice(0, m.index) + ' '.repeat(m[0].length) + rest.slice(m.index + m[0].length);
    }
  };
  take(FRENCH_TIME, (m) => englishTime(Number(m[1]) * 60 + Number(m[2] ?? 0)));
  take(FRENCH_NOON, (m) => (/^midi$/i.test(m[1]!) ? 'noon' : 'midnight'));
  take(GRADE, (m) => `Grade ${m[1]}`);
  for (const entry of NEWSLETTER_GLOSSARY) take(entry.fr, () => entry.en);
  take(NUMBER, (m) => englishNumber(m[0]));
  take(MARKER, (m) => `${/^[Aa]/.test(m[1]!) ? 'Adulte' : 'Élève'} ${m[2]}`);
  pieces.sort((a, b) => a.at - b.at);
  const body = pieces.map((p) => p.text).join(', ');
  return body ? `Demo translation: ${body}${body.endsWith('.') ? '' : '.'}` : 'Demo translation.';
}

export function fakeNewsletterTranslation(
  input: NewsletterTranslateInput,
): NewsletterTranslateOutput {
  return { items: input.items.map((item) => ({ key: item.key, text: fakeEnglish(item.text) })) };
}

export const newsletterTranslateFeature: FeatureDefinition<
  NewsletterTranslateInput,
  NewsletterTranslateOutput
> = {
  name: NEWSLETTER_TRANSLATE,
  promptVersion: 'v1',
  inputSchema: newsletterTranslateInputSchema,
  outputSchema: newsletterTranslateOutputSchema,
  // Short answers: at most 60 paragraphs of at most 1,500 characters of English (the request is
  // at most 32 KB of French), about 10k tokens at the largest, plus adaptive thinking, which
  // counts toward this limit. Under D-045's 64,000, and well within the job's 13 minutes.
  maxTokens: 32_000,

  redactInput(input, redactor) {
    const { input: clean, notSent, unconfirmed } = redactNewsletterTranslateInput(input, redactor);
    // Paths only (they are logged): the paragraph keys.
    const dropped = [
      ...notSent.map((n) => `items.${n.key}`),
      ...unconfirmed.map((key) => `items.${key} unconfirmed`),
    ];
    // Nothing left to send: the request is refused (personalInfo), with what was found. Every
    // confirmed key is either kept or left out with a finding, so there is always one.
    const blocked = clean.items.length ? [] : notSent.flatMap((n) => n.findings);
    return { input: clean, blocked, dropped };
  },

  /** The last check before sending runs the title rule on the whole message again. */
  outboundFindings: (message) => findTitledUnknownNames(message, NEVER_A_PERSON),

  buildUserMessage: newsletterTranslateUserMessage,
  normalize: normalizeNewsletterTranslation,
  validate: validateNewsletterTranslation,
  fake: fakeNewsletterTranslation,
};
