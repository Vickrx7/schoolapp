/**
 * De-identification for everything sent to an AI provider.
 *
 * Rule: nothing personal leaves Canada. Before any model call, known people (students and
 * staff) are replaced by neutral markers ("Élève A", "Adulte B"), and text that looks like a
 * personal detail (email, phone, student or health number, postal code, street address,
 * a child's birth date) blocks the request. Names are put back only after the answer is back
 * on our servers. `assertSafeOutbound` re-checks the final payload right before it is sent,
 * on its own normalized copy and with a stricter name check than the first pass.
 *
 * Every text is normalized before it is checked (invisible characters removed, hyphens inside
 * words made plain), and the normalized text is what gets sent.
 *
 * Pure functions: the web app uses them for the "what will be sent" preview and the worker
 * uses them again, authoritatively, with the roster of every school the requester works in.
 */

export type PersonKind = 'student' | 'staff';

export interface KnownPerson {
  /** A first name, nickname or full display name. */
  name: string;
  kind: PersonKind;
}

export type BlockedKind = 'email' | 'phone' | 'identifier' | 'postalCode' | 'address' | 'birthDate';

export interface BlockedFinding {
  kind: BlockedKind;
  match: string;
  index: number;
}

export interface Replacement {
  placeholder: string;
  original: string;
  kind: PersonKind;
}

export interface Segment {
  text: string;
  /** Set when this part of the text is a replaced name. */
  placeholder?: string;
}

export interface RedactedText {
  text: string;
  /** For previews: the de-identified text split around replaced names. */
  segments: Segment[];
  blocked: BlockedFinding[];
}

export class PrivacyViolation extends Error {
  constructor(readonly findings: readonly { kind: string; match: string }[]) {
    super(`refusing to send personal information (${findings.map((f) => f.kind).join(', ')})`);
    this.name = 'PrivacyViolation';
  }
}

// ---------------------------------------------------------------------------------------
// Normalization: pasted web, PDF and Word text carries characters that are invisible in the
// preview but split a name in two (a soft hyphen inside "Léa") or hide it from a pattern (a
// non-breaking hyphen in a phone number).
// ---------------------------------------------------------------------------------------

/**
 * Format characters (soft hyphen, zero-width space and joiners, BOM...) and blank letters. A
 * zero-width joiner right after an emoji is kept: it builds emoji such as the teacher emoji.
 */
const INVISIBLE =
  /(?<!\p{Extended_Pictographic}(?:\u{FE0F}|[\u{1F3FB}-\u{1F3FF}])?)\u200D|(?!\u200D)[\p{Cf}\u115F\u1160\u3164\uFFA0]/gu;
/** Hyphen-like dashes inside a word or number. Spaced dashes (incises, dialogue) are kept. */
const INNER_HYPHEN = /(?<=[\p{L}\p{M}\p{N}])[\u2010-\u2013\u2212\uFE63](?=[\p{L}\p{M}\p{N}])/gu;
/** Fullwidth ASCII, e.g. "６１３" in text typed with an Asian keyboard. */
const FULLWIDTH = /[\uFF01-\uFF5E]/g;

/** The form of a teacher's text that is checked and sent. */
function normalizeText(text: string): string {
  return text
    .normalize('NFC')
    .replace(INVISIBLE, '')
    .replace(FULLWIDTH, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(INNER_HYPHEN, '-');
}

/** A stricter copy, for the last check only: compatibility forms, all dashes and spaces plain. */
function normalizeForCheck(text: string): string {
  return normalizeText(text)
    .normalize('NFKC')
    .replace(/\p{Pd}/gu, '-')
    .replace(/\p{Zs}/gu, ' ');
}

// ---------------------------------------------------------------------------------------
// Name matching: the text is split into words and names are looked up by their first word
// (or first two words), so a whole school's roster costs almost nothing per request.
// ---------------------------------------------------------------------------------------

/**
 * Names that are also everyday words: matched only when capitalized. First names (Pierre,
 * Claire, Aimé, Roman...) and, for staff, surnames that stand alone in a text (Côté, Parent,
 * Plante, Racine...). Folded: no accents, lowercase.
 */
const EVERYDAY_WORDS = new Set(
  [
    // First names
    'aime ange aurore blanche capucine celeste cerise chance ciel claire clemence colombe',
    'constance constant desire divine esperance felicite fidele fleur flore gloire grace honore',
    'iris jade jean joie juste lilas lune marguerite marine max melodie merveille miracle',
    'modeste oceane olive parfait patience perle pierre precieuse prince princesse prudence',
    'prune roman rose sage soleil tresor victoire violette',
    // Surnames
    'avril baron berger blanc boucher boulanger bourgeois breton brun carriere champagne',
    'charpentier chevalier cote court cousin couture fontaine fort gagne grand grenier gris',
    'janvier jeune laurier leger long major marchand marin marquis masse meilleur meunier noir',
    'normand page papillon paquet paradis pare parent parisien pasteur petit picard pigeon',
    'plante poirier poisson racine renard roux sauve tardif vallee',
    'baker bell black brown cook forget green hill king stone white wood young',
    // Names that are also short everyday words: Son, Mai, Lui; Guy, Line, Joy, Hope...
    'lui mai sang son ton',
    'can day guy her hope joy line love may will',
  ]
    .join(' ')
    .split(' '),
);

/**
 * Particles in staff names (« De » in Marc De Grandpré, « La » in Marie La Salle, « D' » in
 * D'Amour, « Saint » in Saint-Pierre): everyday words, never a name on their own. Folded.
 */
const NAME_PARTICLES = new Set(
  (
    'abu al bin d da das de del della den der des di do dos du el ibn l la las le les los ' +
    'saint sainte st ste ten ter van von'
  ).split(' '),
);

const HONORIFICS = new Set([
  'm',
  'mme',
  'mlle',
  'monsieur',
  'madame',
  'mademoiselle',
  'mr',
  'mrs',
  'ms',
]);
const WORD = /[\p{L}\p{M}\p{N}]+/gu;
/** What may separate the words of one name: spaces, any dash, apostrophes, underscores. */
const NAME_GAP = /^[\s\p{Pd}_'’‘`´]+$/u;
/** Between an honorific and a name: "M. Roy", "Mme Roy". */
const HONORIFIC_GAP = /^\.?\s*$/u;
/** Scripts where one character can be a whole name. */
const IDEOGRAPHIC = /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/u;

/** Letters that have no accent to strip: "Łukasz" is also written "Lukasz". */
const TRANSLITERATION: Record<string, string> = {
  ł: 'l',
  ø: 'o',
  đ: 'd',
  ð: 'd',
  ı: 'i',
  æ: 'ae',
  œ: 'oe',
  ß: 'ss',
  þ: 'th',
  ħ: 'h',
  ŧ: 't',
  ŋ: 'n',
  ƒ: 'f',
  ς: 'σ',
};
const TRANSLITERATE = new RegExp(`[${Object.keys(TRANSLITERATION).join('')}]`, 'g');

function fold(s: string): string {
  return s
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{M}/gu, '')
    .replace(TRANSLITERATE, (c) => TRANSLITERATION[c] ?? c);
}

function nameWords(name: string): string[] {
  return fold(name)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Letters only, for the last check: "Lé.a" and "Marie_Ève" become "lea" and "marieeve". */
function squash(s: string): string {
  return fold(s).replace(/[^\p{L}\p{N}]/gu, '');
}

function significant(name: string): boolean {
  const letters = fold(name).replace(/\P{L}/gu, '');
  return letters.length >= 2 || IDEOGRAPHIC.test(letters);
}

interface NameEntry {
  person: number;
  /** Folded words, e.g. ["marie", "eve"]. */
  words: string[];
  /**
   * The word that must start with a capital letter, or -1 for none: the first word of a name
   * that is an everyday word (« Pierre », « Parent »), the word after a particle (« Salle » in
   * « La Salle »). An honorific lifts it: « Mme parent ».
   */
  capital: number;
  /**
   * Only after an honorific, and capitalized even then: particles and parts shorter than three
   * letters (« Mme Lê », « M. Au »). Alone they are everyday words (« le », « au », « de »).
   */
  titledOnly: boolean;
  /** One part of a staff name ("Tremblay", "Jean"), not the whole name. */
  partial: boolean;
  /** May follow an honorific: "Mme Tremblay", "Madame Isabelle" (staff only). */
  titled: boolean;
}

interface SquashedName {
  /** Also matched without an honorific. */
  standalone: boolean;
  capitalizedOnly: boolean;
  titled: boolean;
}

interface Word {
  start: number;
  end: number;
  raw: string;
  folded: string;
}

interface NameHit {
  start: number;
  end: number;
  /** The folded words of the matched text. */
  words: string[];
  /** Everyone the matched text can name: more than one when it is ambiguous. */
  persons: number[];
  /** A lone part of a staff name written in lowercase: it may be an everyday word. */
  loose: boolean;
}

// ---------------------------------------------------------------------------------------
// Personal details that block a request
// ---------------------------------------------------------------------------------------

const MONTHS = String.raw`(?:janvier|janv|f[ée]vrier|f[ée]vr|mars|avril|avr|mai|juin|juillet|juil|ao[ûu]t|septembre|sept|octobre|oct|novembre|nov|d[ée]cembre|d[ée]c|january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|october|november|december)(?!\p{L})\.?`;

/** Street types written after the street name: "450 Elgin Street", "98 Ridgewood Ave". */
const STREET_TYPES = [
  'street',
  'st',
  'avenue',
  'ave',
  'road',
  'rd',
  'drive',
  'dr',
  'boulevard',
  'blvd',
  'crescent',
  'cres',
  'court',
  'ct',
  'lane',
  'ln',
  'way',
  'place',
  'pl',
  'terrace',
  'parkway',
  'pkwy',
  'circle',
  'cir',
  'trail',
  'private',
  'square',
  'sq',
  'highway',
  'hwy',
  'gate',
];

/**
 * Street types that are also French words: capitalized only. « En 1980, Terry Fox court le
 * marathon », « Jacques Cartier place une croix » are not addresses.
 */
const FRENCH_WORD_STREET_TYPES = new Set(['court', 'place', 'square']);

/** "street" -> "[sS][tT][rR][eE][eE][tT]": the type in any case, the street name capitalized. */
function anyCase(word: string): string {
  return word.replace(/\p{L}/gu, (c) => `[${c}${c.toUpperCase()}]`);
}

function streetType(word: string): string {
  return FRENCH_WORD_STREET_TYPES.has(word)
    ? word.charAt(0).toUpperCase() + anyCase(word.slice(1))
    : anyCase(word);
}

interface Detector {
  kind: BlockedKind;
  pattern: RegExp;
  /** Optional extra check on a match (e.g. only recent birth years). */
  accept?: (match: RegExpExecArray) => boolean;
}

function detectors(now: Date): Detector[] {
  const recentYear = now.getUTCFullYear() - 25;
  const isRecent = (year: string | undefined) => !year || Number(year) >= recentYear;
  const isMonthDay = (month: string | undefined, day: string | undefined) =>
    Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= 31;
  const L = String.raw`[\p{L}\p{M}]`;
  // Separators inside numbers: any dash, including U+2011 and the en dash.
  const D = String.raw`\p{Pd}`;
  const streetWord = String.raw`(?:\p{Lu}[\p{L}\p{M}]{0,2}\.|\p{Lu}[\p{L}\p{M}'’${D}]*|\d{1,3}(?:st|nd|rd|th|e|er|re))`;
  return [
    {
      kind: 'email',
      pattern: /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu,
    },
    {
      kind: 'phone',
      pattern: new RegExp(
        String.raw`(?<!\p{N})(?:\+?1[\s.${D}]?\s?)?(?:\(\d{3}\)|\d{3})\s?[./${D}]?\s?\d{3}\s?[.${D}]?\s?\d{4}(?!\p{N})`,
        'gu',
      ),
    },
    // Student numbers (OEN), health cards and other long identifiers.
    { kind: 'identifier', pattern: /(?<!\p{N})\d{9,}(?!\p{N})/gu },
    {
      kind: 'identifier',
      pattern: new RegExp(String.raw`(?<![\p{N}${D}])\d{3}${D}\d{3}${D}\d{3}(?![\p{N}${D}])`, 'gu'),
    },
    {
      kind: 'identifier',
      pattern: new RegExp(
        String.raw`(?<!\p{N})\d{4}[\s.${D}]\d{3}[\s.${D}]\d{3}(?:[\s.${D}]?[A-Za-z]{2})?(?!\p{N})`,
        'gu',
      ),
    },
    {
      kind: 'identifier',
      pattern: new RegExp(
        String.raw`(?<!${L})(?:NISO|OEN|NAS|SIN|num[ée]ro d['’][ée]l[èe]ve|carte[- ]sant[ée]|health card|assurance[- ]maladie)(?!${L})[^\p{N}\n]{0,25}\p{N}`,
        'giu',
      ),
    },
    {
      kind: 'postalCode',
      pattern: new RegExp(
        String.raw`(?<![\p{L}\p{N}])[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][\s${D}]?\d[ABCEGHJ-NPRSTV-Z]\d(?![\p{L}\p{N}])`,
        'giu',
      ),
    },
    // French order: "12, rue des Érables", "1500 prom. Riverside".
    {
      kind: 'address',
      pattern: new RegExp(
        String.raw`(?<!\p{N})\d{1,5}[,\s${D}]+(?:rue|avenue|av\.|boulevard|boul\.|chemin|ch\.|route|rang|promenade|prom\.|croissant|cr\.|crescent|place|mont[ée]e|street|st\.|road|rd\.|drive|dr\.|lane|court|way)(?!${L})`,
        'giu',
      ),
    },
    // English order: "450 Elgin Street", "123 Bank St.", "12A St. Laurent Blvd".
    {
      kind: 'address',
      pattern: new RegExp(
        String.raw`(?<![\p{L}\p{N}])\d{1,5}[A-Za-z]?,?(?:\s+${streetWord}){1,4}\s+(?:${STREET_TYPES.map(streetType).join('|')})(?!${L})\.?`,
        'gu',
      ),
    },
    // Record-style dates (2016-04-12, 2016/04/12, 12/04/2016) with a recent year.
    {
      kind: 'birthDate',
      pattern: new RegExp(
        String.raw`(?<!\p{N})((?:19|20)\d{2})[/.${D}](\d{1,2})[/.${D}](\d{1,2})(?!\p{N})`,
        'gu',
      ),
      accept: (m) => isRecent(m[1]) && isMonthDay(m[2], m[3]),
    },
    {
      kind: 'birthDate',
      pattern: new RegExp(
        String.raw`(?<!\p{N})\d{1,2}[/.${D}]\d{1,2}[/.${D}]((?:19|20)\d{2})(?!\p{N})`,
        'gu',
      ),
      accept: (m) => isRecent(m[1]),
    },
    // "née le 3 mai 2017", "anniversaire : 14 février", "born May 3, 2017" (no year, or a
    // recent one).
    {
      kind: 'birthDate',
      pattern: new RegExp(
        String.raw`(?<!${L})(?:n[ée]e?s?|naissance|anniversaire|ddn|born|birthday|birth|dob)(?!${L})[^.\n]{0,30}?(?:(?<!\p{N})\d{1,2}(?:er|st|nd|rd|th)?(?:\s+of)?\s+${MONTHS}(?:\s+(\d{4}))?|${MONTHS}\s+\d{1,2}(?:st|nd|rd|th)?(?!\p{N})(?:,?\s+(\d{4}))?)`,
        'giu',
      ),
      accept: (m) => isRecent(m[1] ?? m[2]),
    },
  ];
}

export function findBlockedDetails(text: string, now = new Date()): BlockedFinding[] {
  const all: BlockedFinding[] = [];
  for (const d of detectors(now)) {
    for (const m of text.matchAll(d.pattern)) {
      if (!d.accept || d.accept(m)) all.push({ kind: d.kind, match: m[0], index: m.index });
    }
  }
  // One finding per span: several detectors can match the same number.
  all.sort((a, b) => a.index - b.index || b.match.length - a.match.length);
  const kept: BlockedFinding[] = [];
  let end = -1;
  for (const f of all) {
    if (f.index >= end) {
      kept.push(f);
      end = f.index + f.match.length;
    }
  }
  return kept;
}

// ---------------------------------------------------------------------------------------
// Redactor
// ---------------------------------------------------------------------------------------

function label(n: number): string {
  // A..Z, then AA, AB...
  let s = '';
  let i = n;
  do {
    s = String.fromCharCode(65 + (i % 26)) + s;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return s;
}

const RESTORE_RE =
  /(?<![\p{L}\p{M}\p{N}])((?:[dDlL]|[qQ]u)['’])?([ÉEée]l[èe]ve|[Aa]dulte)\s+([A-Z]{1,3})(?![\p{L}\p{M}\p{N}])/gu;

/** "élève", "A" -> "Élève A": the marker a matched text stands for. */
function markerName(word: string, letters: string): string {
  return `${fold(word) === 'adulte' ? 'Adulte' : 'Élève'} ${letters}`;
}

/** An elided article before a word of a text: "d'Aïcha", "qu'Anne". */
const ELISION = /^(?:[dljmnstc]|qu|jusqu|lorsqu|puisqu)['’]/iu;

/**
 * Replaces known people consistently across every text of one request, and puts them back
 * in the answer. Create one per request.
 */
export class Redactor {
  /** Entries by first word, or by first two words for longer names ("marie\u0000eve"). */
  private readonly byStart = new Map<string, NameEntry[]>();
  /** Every name written as one run of letters ("marieeve"), for the last check. */
  private readonly squashed = new Map<string, SquashedName>();
  private readonly people: { canonical: string; kind: PersonKind }[] = [];
  /** A person ("person:3") or an ambiguous text ("text:staff:mme roy") -> its marker. */
  private readonly assigned = new Map<string, string>();
  private readonly byPlaceholder = new Map<string, Replacement>();
  /** Markers the teacher's own text uses (« l'élève A »): never given to anyone. */
  private readonly reserved = new Set<string>();
  /** The teacher's marker-like text, relabelled because a person already had its marker. */
  private readonly aliasFor = new Map<string, string>();
  /** Relabelled marker -> the teacher's letters, put back in the answer. */
  private readonly aliases = new Map<string, string>();
  private readonly counters = { student: 0, staff: 0 };

  constructor(
    people: readonly KnownPerson[],
    private readonly now = new Date(),
  ) {
    const seen = new Set<string>();
    for (const p of people) {
      const name = normalizeText(p.name).replace(/\s+/g, ' ').trim();
      if (!significant(name)) continue;
      // Same spelling, same restored name. "Léa" and "Lea" stay two people: text that could
      // be either comes back as the teacher wrote it.
      const key = `${p.kind}:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const index = this.people.push({ canonical: name, kind: p.kind }) - 1;
      this.addVariants(name, index, p.kind);
    }
  }

  private add(entry: NameEntry) {
    if (!entry.words.length) return;
    const start = entry.words.slice(0, 2).join('\u0000');
    const list = this.byStart.get(start);
    if (list) list.push(entry);
    else this.byStart.set(start, [entry]);
    // Short names ("Al", "Jo") would also match abbreviations such as "J.O." there.
    const key = entry.words.join('');
    if (key.replace(/\P{L}/gu, '').length >= 3) {
      const known = this.squashed.get(key) ?? {
        standalone: false,
        capitalizedOnly: true,
        titled: false,
      };
      this.squashed.set(key, {
        standalone: known.standalone || !entry.titledOnly,
        // In any case as soon as one entry that stands alone allows it.
        capitalizedOnly: known.capitalizedOnly && (entry.titledOnly || entry.capital >= 0),
        titled: known.titled || entry.titled,
      });
    }
  }

  /**
   * One name: a whole name, or (with `piece`) one part of a staff name. `afterParticle`: the
   * part follows a particle (« Salle » in « La Salle »), so it may be an everyday word.
   */
  private addName(
    person: number,
    words: string[],
    kind: PersonKind,
    piece?: { afterParticle: boolean },
  ) {
    const titled = kind === 'staff';
    const partial = piece !== undefined;
    const single = words.length === 1 ? words[0]! : null;
    const letters = words.join('').replace(/\P{L}/gu, '');
    const titledOnly =
      partial &&
      single !== null &&
      (NAME_PARTICLES.has(single) || (letters.length < 3 && !IDEOGRAPHIC.test(letters)));
    let capital = single !== null && EVERYDAY_WORDS.has(single) ? 0 : -1;
    if (piece) {
      // « De Grandpré », « La Salle »: the word after the particles is capitalized.
      const lead = words.findIndex((w) => !NAME_PARTICLES.has(w));
      if (lead > 0) capital = lead;
      else if (piece.afterParticle) capital = 0;
    }
    this.add({ person, words, capital, titledOnly, partial, titled });
    // Also written as one word: "MarieÈve", or "Marie Ève" once an invisible separator is gone
    // ("LaSalle": capitalized, like "La Salle").
    if (words.length > 1) {
      this.add({
        person,
        words: [words.join('')],
        capital: capital >= 0 ? 0 : -1,
        titledOnly: false,
        partial,
        titled,
      });
    }
  }

  private addVariants(name: string, person: number, kind: PersonKind) {
    const full = nameWords(name);
    this.addName(person, full, kind);
    if (kind !== 'staff') return;
    // Staff are often named by one part, with or without an honorific (see scan): "Mme
    // Tremblay", "Tremblay", "Isabelle", "Madame Isabelle". Each half of a compound part
    // counts too: "Mme Gagnon" or "Roy" for Anne Gagnon-Roy, "Jean" for Jean-François.
    // A particle stays with what follows it (« De Grandpré », « La Salle », « D'Amour »), and
    // what follows it is matched alone only when capitalized: « la salle », « d'amour » and
    // « Saint-Laurent » are everyday words.
    const pieces = new Map<string, { words: string[]; afterParticle: boolean }>();
    const put = (words: string[], afterParticle: boolean) => {
      const key = words.join(' ');
      const known = pieces.get(key);
      pieces.set(key, { words, afterParticle: afterParticle && (known?.afterParticle ?? true) });
    };
    let particles: string[] = [];
    for (const part of name.split(' ')) {
      const words = nameWords(part);
      if (!words.length || (words.length === 1 && HONORIFICS.has(words[0]!))) continue;
      if (words.every((w) => NAME_PARTICLES.has(w))) {
        particles.push(...words);
        // Maybe the surname itself (« Minh Lê »): only « Mme Lê ».
        if (words.length === 1) put(words, false);
        continue;
      }
      for (let k = 0; k < particles.length; k++) put([...particles.slice(k), ...words], false);
      put(words, particles.length > 0);
      if (words.length > 1) {
        words.forEach((w, j) => {
          if (NAME_PARTICLES.has(w)) return;
          const afterParticle =
            particles.length > 0 || words.slice(0, j).some((p) => NAME_PARTICLES.has(p));
          put([w], afterParticle);
        });
      }
      particles = [];
    }
    pieces.delete(full.join(' '));
    for (const { words, afterParticle } of pieces.values()) {
      if (significant(words.join(''))) this.addName(person, words, kind, { afterParticle });
    }
  }

  /** The longest entries matching at word `i` (after an honorific: staff entries only). */
  private longestAt(
    text: string,
    words: Word[],
    i: number,
    titled: boolean,
  ): { last: number; found: NameEntry[] } {
    let last = -1;
    let found: NameEntry[] = [];
    const first = words[i]?.folded;
    if (first === undefined) return { last, found };
    const second = words[i + 1]?.folded;
    const candidates = [
      ...(this.byStart.get(first) ?? []),
      ...(second === undefined ? [] : (this.byStart.get(`${first}\u0000${second}`) ?? [])),
    ];
    for (const entry of candidates) {
      if (titled && !entry.titled) continue;
      const end = this.matchAt(text, words, i, entry, titled);
      if (end < 0 || end < last) continue;
      if (end > last) {
        last = end;
        found = [];
      }
      found.push(entry);
    }
    return { last, found };
  }

  /** Every known name in `text`, longest match first, left to right. */
  private scan(text: string): NameHit[] {
    const words: Word[] = [...text.matchAll(WORD)].map((m) => ({
      start: m.index,
      end: m.index + m[0].length,
      raw: m[0],
      folded: fold(m[0]),
    }));
    const hits: NameHit[] = [];
    for (let i = 0; i < words.length;) {
      let { last, found } = this.longestAt(text, words, i, false);
      // "Mme Tremblay", "M. Roy": the honorific is part of the name.
      let titled = false;
      const next = words[i + 1];
      if (
        next &&
        HONORIFICS.has(words[i]!.folded) &&
        HONORIFIC_GAP.test(text.slice(words[i]!.end, next.start))
      ) {
        const after = this.longestAt(text, words, i + 1, true);
        if (after.last >= 0 && after.last >= last) {
          found = after.last === last ? [...found, ...after.found] : after.found;
          last = after.last;
          titled = true;
        }
      }
      if (last < 0) {
        i++;
        continue;
      }
      hits.push({
        start: words[i]!.start,
        end: words[last]!.end,
        words: words.slice(i, last + 1).map((w) => w.folded),
        persons: [...new Set(found.map((e) => e.person))],
        loose:
          !titled &&
          /^\p{Ll}/u.test(words[i]!.raw) &&
          found.every((e) => e.partial && e.words.length === 1),
      });
      i = last + 1;
    }
    return hits;
  }

  /** Index of the last word of `entry` matched at word `i`, or -1. */
  private matchAt(
    text: string,
    words: Word[],
    i: number,
    entry: NameEntry,
    afterHonorific = false,
  ): number {
    for (let k = 1; k < entry.words.length; k++) {
      const word = words[i + k];
      if (!word || word.folded !== entry.words[k]) return -1;
      if (!NAME_GAP.test(text.slice(words[i + k - 1]!.end, word.start))) return -1;
    }
    const capitalized = (k: number) => /^\p{Lu}/u.test(words[i + k]!.raw);
    if (entry.titledOnly) {
      if (!afterHonorific || !capitalized(0)) return -1;
    } else if (entry.capital >= 0 && !afterHonorific && !capitalized(entry.capital)) {
      return -1;
    }
    return i + entry.words.length - 1;
  }

  /**
   * A name written as one run of letters around punctuation ("Lé.a", "Marie_Ève"), for the
   * last check only: the first pass leaves these alone, so they must not go out.
   */
  private findSquashedName(text: string): string | null {
    for (const [chunk] of text.matchAll(/\S+/gu)) {
      const trimmed = chunk.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, '');
      const core = trimmed.replace(ELISION, '');
      // A plain word was already looked at by scan().
      if (!core || /^[\p{L}\p{M}\p{N}]+$/u.test(core)) continue;
      const key = squash(core);
      const name = this.squashed.get(key);
      if (name?.standalone && (!name.capitalizedOnly || /^\p{Lu}/u.test(core))) return chunk;
      // "M.Roy", "Mme.Tremblay".
      for (const h of HONORIFICS) {
        if (
          key.length > h.length &&
          key.startsWith(h) &&
          this.squashed.get(key.slice(h.length))?.titled
        ) {
          return chunk;
        }
      }
    }
    return null;
  }

  private nextPlaceholder(kind: PersonKind): string {
    const word = kind === 'student' ? 'Élève' : 'Adulte';
    for (;;) {
      const placeholder = `${word} ${label(this.counters[kind]++)}`;
      if (!this.reserved.has(placeholder)) return placeholder;
    }
  }

  /**
   * The marker for a matched name. Names come back as written the first time: students with
   * the roster spelling ("Léa", even if typed "lea"), staff as the teacher named them ("Mme
   * Tremblay" stays "Mme Tremblay"). Text that could name several people (two staff named
   * Roy, a student and a teacher both named Isabelle) or a lowercase staff surname gets a
   * marker of its own and comes back exactly as the teacher wrote it, never as a guess.
   */
  private placeholderFor(hit: NameHit, surface: string): string {
    const person = hit.persons.length === 1 && !hit.loose ? hit.persons[0]! : null;
    const kind: PersonKind =
      person !== null
        ? this.people[person]!.kind
        : hit.persons.some((p) => this.people[p]?.kind === 'student')
          ? 'student'
          : 'staff';
    const key = person !== null ? `person:${person}` : `text:${kind}:${hit.words.join(' ')}`;
    const existing = this.assigned.get(key);
    if (existing) return existing;
    const placeholder = this.nextPlaceholder(kind);
    const original =
      person !== null && kind === 'student'
        ? this.people[person]!.canonical
        : surface.replace(/\s+/g, ' ');
    this.assigned.set(key, placeholder);
    this.byPlaceholder.set(placeholder, { placeholder, original, kind });
    return placeholder;
  }

  /**
   * Text that already reads like a marker (« l'élève A » in a math problem) must never come
   * back as a real name. Its letters are kept away from new markers; if an earlier text of
   * this request already gave that marker to someone, the letters are swapped for unused ones
   * here and swapped back in the answer.
   */
  private escapeMarkers(text: string): string {
    const found = [...text.matchAll(RESTORE_RE)];
    const issued = (p: string) => this.byPlaceholder.has(p) || this.aliases.has(p);
    for (const m of found) {
      const marker = markerName(m[2]!, m[3]!);
      if (!issued(marker)) this.reserved.add(marker);
    }
    let out = '';
    let last = 0;
    for (const m of found) {
      const letters = m[3]!;
      const marker = markerName(m[2]!, letters);
      if (this.reserved.has(marker)) continue;
      let alias = this.aliasFor.get(marker);
      if (!alias) {
        alias = this.nextPlaceholder(marker.startsWith('Adulte') ? 'staff' : 'student');
        this.aliasFor.set(marker, alias);
        this.aliases.set(alias, letters);
      }
      const end = m.index + m[0].length;
      out += text.slice(last, end - letters.length) + alias.slice(alias.indexOf(' ') + 1);
      last = end;
    }
    return out + text.slice(last);
  }

  /**
   * De-identifies one text. The returned text is normalized (see normalizeText) and is what
   * must be sent. Blocked details are reported, not removed: the caller refuses.
   */
  redact(input: string): RedactedText {
    const text = this.escapeMarkers(normalizeText(input));
    const segments: Segment[] = [];
    let out = '';
    let last = 0;
    for (const hit of this.scan(text)) {
      const placeholder = this.placeholderFor(hit, text.slice(hit.start, hit.end));
      if (hit.start > last) segments.push({ text: text.slice(last, hit.start) });
      segments.push({ text: placeholder, placeholder });
      out += text.slice(last, hit.start) + placeholder;
      last = hit.end;
    }
    if (last < text.length) segments.push({ text: text.slice(last) });
    out += text.slice(last);
    return { text: out, segments, blocked: findBlockedDetails(text, this.now) };
  }

  /** The people replaced so far in this request. */
  replacements(): Replacement[] {
    return [...this.byPlaceholder.values()];
  }

  /** Puts names back into a model answer (strings anywhere inside `value`). */
  restore<T>(value: T): T {
    if (typeof value === 'string') return this.restoreText(value) as T;
    if (Array.isArray(value)) return value.map((v: unknown) => this.restore(v)) as T;
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.restore(v)])) as T;
    }
    return value;
  }

  private restoreText(text: string): string {
    return text.replace(
      RESTORE_RE,
      (whole: string, elision: string | undefined, word: string, letters: string) => {
        const placeholder = markerName(word, letters);
        // The teacher's own « élève A », relabelled on the way out.
        const generic = this.aliases.get(placeholder);
        if (generic !== undefined) return whole.slice(0, whole.length - letters.length) + generic;
        const r = this.byPlaceholder.get(placeholder);
        if (!r) return whole;
        if (!elision) return r.original;
        const article = elision.slice(0, -1);
        // "l'Élève A" -> "Léa": no article before a first name.
        if (/^[lL]$/.test(article)) return r.original;
        // "d'Élève A" -> "de Léa", "d'Élève B" -> "d’Anne".
        const vowel = /^[aeiouyh]/i.test(fold(r.original));
        return vowel ? `${article}’${r.original}` : `${article}e ${r.original}`;
      },
    );
  }

  /**
   * Last check before sending: no blocked detail and no known name may remain anywhere in
   * the outbound text. It normalizes its own copy (so it does not depend on what the caller
   * did) and also looks for names hidden by punctuation. Throws PrivacyViolation.
   */
  assertSafeOutbound(payload: string): void {
    const text = normalizeForCheck(payload);
    const findings: { kind: string; match: string }[] = [];
    const seen = new Set<string>();
    for (const f of [
      ...findBlockedDetails(payload, this.now),
      ...findBlockedDetails(text, this.now),
    ]) {
      const key = `${f.kind}:${f.match}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({ kind: f.kind, match: f.match });
    }
    const hit = this.scan(text)[0];
    const name = hit ? text.slice(hit.start, hit.end) : this.findSquashedName(text);
    if (name !== null) findings.push({ kind: 'name', match: name });
    if (findings.length) throw new PrivacyViolation(findings);
  }
}
