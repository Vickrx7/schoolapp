/**
 * De-identification for everything sent to an AI provider.
 *
 * Rule: nothing personal leaves Canada. Before any model call, known people (students and
 * staff) are replaced by neutral markers ("Élève A", "Adulte B"), and text that looks like a
 * personal detail (email, phone, student or health number, postal code, street address,
 * a child's birth date) blocks the request. Names are put back only after the answer is back
 * on our servers. `assertSafeOutbound` re-checks the final payload right before it is sent.
 *
 * Pure functions: the web app uses them for the "what will be sent" preview and the worker
 * uses them again, authoritatively, with the whole school's roster.
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
// Name matching: the text is split into words and names are looked up by their first word,
// so a whole school's roster costs almost nothing per request.
// ---------------------------------------------------------------------------------------

/** First names that are also everyday French words: matched only when capitalized. */
const COMMON_WORD_NAMES = new Set([
  'ange',
  'aurore',
  'blanche',
  'capucine',
  'ciel',
  'claire',
  'clemence',
  'colombe',
  'constance',
  'esperance',
  'felicite',
  'fleur',
  'flore',
  'france',
  'grace',
  'jade',
  'joie',
  'leo',
  'lune',
  'marguerite',
  'marine',
  'max',
  'melodie',
  'noe',
  'oceane',
  'olive',
  'patience',
  'perle',
  'pierre',
  'prudence',
  'prune',
  'remi',
  'rose',
  'sage',
  'soleil',
  'victoire',
  'violette',
]);

const HONORIFICS = ['m', 'mme', 'mlle', 'monsieur', 'madame', 'mademoiselle', 'mr', 'mrs', 'ms'];
const WORD = /[\p{L}\p{M}\p{N}]+/gu;
/** What may separate the words of one name: spaces, hyphens, apostrophes. */
const NAME_GAP = /^[\s\-‐–'’]+$/u;
/** Between an honorific and a name: "M. Roy", "Mme Roy". */
const HONORIFIC_GAP = /^\.?\s+$/u;

function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function nameWords(name: string): string[] {
  return fold(name)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function significant(name: string): boolean {
  return fold(name).replace(/[^a-z]/g, '').length >= 2;
}

interface NameEntry {
  person: number;
  /** Folded words, e.g. ["marie", "eve"] or ["mme", "tremblay"]. */
  words: string[];
  /** The first word must start with a capital letter in the text. */
  capitalizedOnly: boolean;
  /** The first word is an honorific ("Mme"), followed by HONORIFIC_GAP. */
  honorific: boolean;
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
  person: number;
}

// ---------------------------------------------------------------------------------------
// Personal details that block a request
// ---------------------------------------------------------------------------------------

const MONTHS = String.raw`(?:janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[ûu]t|septembre|octobre|novembre|d[ée]cembre|january|february|march|april|may|june|july|august|september|october|november|december)`;

interface Detector {
  kind: BlockedKind;
  pattern: RegExp;
  /** Optional extra check on a match (e.g. only recent birth years). */
  accept?: (match: RegExpExecArray) => boolean;
}

function detectors(now: Date): Detector[] {
  const recentYear = now.getUTCFullYear() - 25;
  const isRecent = (year: string | undefined) => !year || Number(year) >= recentYear;
  const L = String.raw`[\p{L}\p{M}]`;
  return [
    {
      kind: 'email',
      pattern: /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu,
    },
    {
      kind: 'phone',
      pattern: /(?<!\p{N})(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]\d{4}(?!\p{N})/gu,
    },
    // Student numbers (OEN), health cards and other long identifiers.
    { kind: 'identifier', pattern: /(?<!\p{N})\d{9,}(?!\p{N})/gu },
    { kind: 'identifier', pattern: /(?<![\p{N}-])\d{3}-\d{3}-\d{3}(?![\p{N}-])/gu },
    {
      kind: 'identifier',
      pattern: /(?<!\p{N})\d{4}[\s-]\d{3}[\s-]\d{3}(?:[\s-]?[A-Za-z]{2})?(?!\p{N})/gu,
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
      pattern:
        /(?<![\p{L}\p{N}])[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d(?![\p{L}\p{N}])/giu,
    },
    {
      kind: 'address',
      pattern: new RegExp(
        String.raw`(?<!\p{N})\d{1,5}[,\s-]+(?:rue|avenue|av\.|boulevard|boul\.|chemin|ch\.|route|rang|promenade|croissant|crescent|place|mont[ée]e|street|st\.|road|rd\.|drive|dr\.|lane|court|way)(?!${L})`,
        'giu',
      ),
    },
    // Record-style dates (2016-04-12, 12/04/2016) with a recent year.
    {
      kind: 'birthDate',
      pattern: /(?<!\p{N})((?:19|20)\d{2})-\d{2}-\d{2}(?!\p{N})/gu,
      accept: (m) => isRecent(m[1]),
    },
    {
      kind: 'birthDate',
      pattern: /(?<!\p{N})\d{1,2}[/.-]\d{1,2}[/.-]((?:19|20)\d{2})(?!\p{N})/gu,
      accept: (m) => isRecent(m[1]),
    },
    // "née le 3 mai 2017", "anniversaire : 14 février" (no year, or a recent one).
    {
      kind: 'birthDate',
      pattern: new RegExp(
        String.raw`(?<!${L})(?:n[ée]e?s?|naissance|anniversaire|born|birthday)(?!${L})[^.\n]{0,30}?(?<!\p{N})\d{1,2}(?:er)?\s+${MONTHS}(?:\s+(\d{4}))?`,
        'giu',
      ),
      accept: (m) => isRecent(m[1]),
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

/**
 * Replaces known people consistently across every text of one request, and puts them back
 * in the answer. Create one per request.
 */
export class Redactor {
  private readonly byFirstWord = new Map<string, NameEntry[]>();
  private readonly people: { canonical: string; kind: PersonKind }[] = [];
  private readonly assigned = new Map<number, string>();
  private readonly byPlaceholder = new Map<string, Replacement>();
  private readonly counters = { student: 0, staff: 0 };

  constructor(
    people: readonly KnownPerson[],
    private readonly now = new Date(),
  ) {
    const seen = new Set<string>();
    for (const p of people) {
      const name = p.name.replace(/\s+/g, ' ').trim();
      if (!significant(name)) continue;
      const key = `${p.kind}:${fold(name)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const index = this.people.push({ canonical: name, kind: p.kind }) - 1;
      this.addVariants(name, index, p.kind);
    }
  }

  private add(entry: NameEntry) {
    const first = entry.words[0];
    if (!first) return;
    const list = this.byFirstWord.get(first);
    if (list) list.push(entry);
    else this.byFirstWord.set(first, [entry]);
  }

  private addVariants(name: string, person: number, kind: PersonKind) {
    const words = nameWords(name);
    this.add({
      person,
      words,
      capitalizedOnly: words.length === 1 && COMMON_WORD_NAMES.has(words[0] ?? ''),
      honorific: false,
    });
    const parts = name.split(' ').filter(significant);
    if (kind === 'staff' && parts.length > 1) {
      // Staff are often named by one part: "Mme Tremblay", "Tremblay", "Isabelle".
      const last = nameWords(parts[parts.length - 1] ?? '');
      for (const h of HONORIFICS)
        this.add({ person, words: [h, ...last], capitalizedOnly: false, honorific: true });
      for (const part of parts) {
        this.add({ person, words: nameWords(part), capitalizedOnly: true, honorific: false });
      }
    }
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
      let best: { entry: NameEntry; last: number } | null = null;
      for (const entry of this.byFirstWord.get(words[i]!.folded) ?? []) {
        const last = this.matchAt(text, words, i, entry);
        if (last >= 0 && (!best || last > best.last)) best = { entry, last };
      }
      if (best) {
        hits.push({
          start: words[i]!.start,
          end: words[best.last]!.end,
          person: best.entry.person,
        });
        i = best.last + 1;
      } else {
        i++;
      }
    }
    return hits;
  }

  /** Index of the last word of `entry` matched at word `i`, or -1. */
  private matchAt(text: string, words: Word[], i: number, entry: NameEntry): number {
    if (entry.capitalizedOnly && !/^\p{Lu}/u.test(words[i]!.raw)) return -1;
    for (let k = 1; k < entry.words.length; k++) {
      const word = words[i + k];
      if (!word || word.folded !== entry.words[k]) return -1;
      const gap = text.slice(words[i + k - 1]!.end, word.start);
      if (!(entry.honorific && k === 1 ? HONORIFIC_GAP : NAME_GAP).test(gap)) return -1;
    }
    return i + entry.words.length - 1;
  }

  /**
   * The marker for a person. Names come back as written the first time: students with the
   * roster spelling ("Léa", even if typed "lea"), staff as the teacher named them
   * ("Mme Tremblay" stays "Mme Tremblay").
   */
  private placeholderFor(person: number, surface: string): string {
    const existing = this.assigned.get(person);
    if (existing) return existing;
    const p = this.people[person];
    if (!p) throw new Error('unknown person');
    const placeholder =
      p.kind === 'student'
        ? `Élève ${label(this.counters.student++)}`
        : `Adulte ${label(this.counters.staff++)}`;
    const original = p.kind === 'student' ? p.canonical : surface.replace(/\s+/g, ' ');
    this.assigned.set(person, placeholder);
    this.byPlaceholder.set(placeholder, { placeholder, original, kind: p.kind });
    return placeholder;
  }

  /** De-identifies one text. Blocked details are reported, not removed: the caller refuses. */
  redact(text: string): RedactedText {
    const segments: Segment[] = [];
    let out = '';
    let last = 0;
    for (const hit of this.scan(text)) {
      const placeholder = this.placeholderFor(hit.person, text.slice(hit.start, hit.end));
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
        const placeholder = `${fold(word) === 'adulte' ? 'Adulte' : 'Élève'} ${letters}`;
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
   * the outbound text. Throws PrivacyViolation.
   */
  assertSafeOutbound(payload: string): void {
    const findings: { kind: string; match: string }[] = findBlockedDetails(payload, this.now);
    const hit = this.scan(payload)[0];
    if (hit) findings.push({ kind: 'name', match: payload.slice(hit.start, hit.end) });
    if (findings.length) throw new PrivacyViolation(findings);
  }
}
