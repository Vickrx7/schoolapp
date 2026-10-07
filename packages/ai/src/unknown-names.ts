/**
 * Names the app does not know, in the text a teacher typed for the AI (DECISIONS D-139, D-132, as
 * amended in the post-MVP review). The redactor (privacy.ts) replaces the people the app knows
 * (« Élève A », « Adulte B »); a parent, a volunteer or a guest is unknown to it and would go out
 * as typed. Two rules, one implementation, used by the web server's preview and by the worker
 * (its `redactInput` and its last check before sending):
 *
 * - `findTitledUnknownNames` (fail closed): a title that is not followed by a name the app knows
 *   (a marker by then) is a finding. A paragraph of « Info-parents » or the note of « Créer une
 *   banque avec l'IA » with one is never sent. No allow-list applies after a title: « Mme Noël »,
 *   « M. Toussaint », « Mme St-Pierre » and « le père Noël » are all findings.
 * - `capitalizedWords`: the other capitalized words, listed for the teacher to check before she
 *   confirms (a first name alone, « Merci à Sophie », is not recognized by any rule).
 *
 * Pure (no dependency): run them on de-identified text.
 */
import type { BlockedFinding } from './privacy';

/** Folded: no accents, lowercase, « œ » as « oe ». */
function fold(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae');
}

interface TextWord {
  start: number;
  end: number;
  raw: string;
  folded: string;
}

function wordsOf(text: string, pattern: RegExp): TextWord[] {
  return [...text.matchAll(pattern)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
    raw: m[0],
    folded: fold(m[0]),
  }));
}

const capitalized = (word: string) => /^\p{Lu}/u.test(word);

// ---------------------------------------------------------------------------------------
// Titles
// ---------------------------------------------------------------------------------------

/** How a title is written, and what may follow it. */
export interface TitleRule {
  /**
   * An abbreviation (« M. », « Mme », « Dr »): a title only when capitalized (never the « m » of
   * « 100 m »), with or without a period. A whole word (« madame », « curé ») is one in any case.
   */
  abbreviation: boolean;
  /**
   * The word right after it is a name whatever its case (« madame dupuis »): the honorifics.
   * After a title that is also an everyday word (« sa mère viendra », « Me voici »), only a
   * capitalized word is taken for a name.
   */
  lowercaseName: boolean;
}

const titles = (list: string, abbreviation: boolean, lowercaseName: boolean) =>
  list.split(' ').map((w) => [w, { abbreviation, lowercaseName }] as const);

/** Every title, folded. */
export const TITLES: ReadonlyMap<string, TitleRule> = new Map([
  // Honorifics, abbreviated: M., MM., Mme, Mmes, Mlle(s), Mx, Dr, Dre, Pr, Pre, Mgr; Mr, Mrs, Ms.
  ...titles('m mm mme mmes mlle mlles mx dr dre pr pre mgr mr mrs ms', true, true),
  // Abbreviations that are also words or initials: Me (maître), Sr (sœur), P. (père), Fr, Rev.
  ...titles('me sr p fr rev', true, false),
  // Honorifics written out.
  ...titles(
    'monsieur madame mademoiselle messieurs mesdames mesdemoiselles mister docteur docteure monseigneur',
    false,
    true,
  ),
  // Religious, school, sports and family titles, which are everyday nouns too.
  ...titles(
    'abbe cure diacre pere mere frere soeur pasteur chanoine reverend maitre professeur ' +
      'professeure coach miss father sister brother maman papa tante oncle',
    false,
    false,
  ),
]);

/**
 * Words that may come right after an honorific without being a name (« Mme la directrice »,
 * « Monsieur est arrivé », « M. et Mme Roy »): articles, pronouns, little words, frequent verbs and
 * a few roles. Any other word right after an honorific is a name, whatever its case. Folded.
 */
const NOT_A_NAME = new Set(
  [
    'le la les l un une des du de d au aux ce cet cette ces mon ma mes ton ta tes son sa ses',
    'notre nos votre vos leur leurs je j tu il elle on nous vous ils elles se s y en lui me m te',
    't moi toi qui que qu quoi dont ou et ni mais donc or car si a pour par avec sans chez dans',
    'sur sous vers entre apres avant pendant depuis comme ne n pas plus tres aussi bien encore',
    'deja toujours jamais souvent ici',
    'est sont etait etaient sera seront ete ont avait avaient aura auront va vont allait ira',
    'iront vient viennent venait viendra viendront fait font faisait fera feront dit disent',
    'peut peuvent pourra pourront doit doivent devra veut voudrait aime aiment',
    'maire mairesse directeur directrice adjoint adjointe president presidente',
    'the an of and or to from with for at in on by is are was will has have had',
  ]
    .join(' ')
    .split(' '),
);

/** At most this many words between a title and a name (« Mme la directrice adjointe Dupuis »). */
const TITLE_LOOKAHEAD = 3;
/** After an abbreviation: a period, any space (a line break, a thin space...) or nothing. */
const ABBREVIATION_GAP = /^\.?\s*$/u;
/** After a whole word: any space, a line break included. */
const SPACE_GAP = /^\s+$/u;
/** Between the words after a title: spaces, an elision (« l'abbé »), a hyphen. */
const WORD_GAP = /^(?:\s+|\s*['’]\s*|\s*\p{Pd}\s*)$/u;
/** What joins the parts of a name: « St-Pierre », « Grace Dupuis », « O'Brien ». */
const NAME_JOIN = /^(?: |\s*\p{Pd}\s*|['’])$/u;
const WORD = /[\p{L}\p{M}\p{N}]+/gu;

/** The rule of the title at word `i`, given what follows it; null when it is not one. */
function titleAt(text: string, words: readonly TextWord[], i: number): TitleRule | null {
  const word = words[i];
  const next = words[i + 1];
  const rule = word && TITLES.get(word.folded);
  if (!word || !next || !rule) return null;
  const gap = text.slice(word.end, next.start);
  if (!rule.abbreviation) return SPACE_GAP.test(gap) ? rule : null;
  // « M. », « MME »; « Sr », « Fr » or « Me » only as written (« FR » is French, « ME » a word).
  const cased =
    capitalized(word.raw) &&
    (rule.lowercaseName || word.raw.length === 1 || /^\p{Lu}\p{Ll}+$/u.test(word.raw));
  return cased && ABBREVIATION_GAP.test(gap) ? rule : null;
}

/** Whether word `k` starts a marker (« Élève A », « Adulte B »): a person the app knows. */
function markerAt(text: string, words: readonly TextWord[], k: number): boolean {
  const word = words[k];
  const next = words[k + 1];
  return (
    word !== undefined &&
    next !== undefined &&
    (word.folded === 'eleve' || word.folded === 'adulte') &&
    /^[A-Z]{1,3}$/.test(next.raw) &&
    /^\s+$/u.test(text.slice(word.end, next.start))
  );
}

/** The last word of the name that starts at word `k`: « St-Pierre », « Grace Dupuis ». */
function nameEnd(text: string, words: readonly TextWord[], k: number): number {
  let end = k;
  while (
    words[end + 1] &&
    capitalized(words[end + 1]!.raw) &&
    NAME_JOIN.test(text.slice(words[end]!.end, words[end + 1]!.start)) &&
    !markerAt(text, words, end + 1)
  ) {
    end++;
  }
  return end;
}

/**
 * Every title that is not followed by a name the app knows: run it on de-identified text, where
 * the people the app knows are markers (« Mme Tremblay » became « Adulte A »). Fail closed: no
 * allow-list after a title (« Mme Noël », « le père Noël », « M. Toussaint »), any space between
 * the title and the name (a line break, a thin space), up to three words in between (« M. le
 * maire Watson »), the name in any case after an honorific (« madame dupuis »), and a surname
 * after a marker (« Mme Élève A Dupuis »). Not a finding: a title followed by little words only
 * (« Mme la directrice a dit »), or by a marker alone.
 */
export function findTitledUnknownNames(text: string): BlockedFinding[] {
  const words = wordsOf(text, WORD);
  const findings: BlockedFinding[] = [];
  let i = 0;
  while (i < words.length) {
    const rule = titleAt(text, words, i);
    if (!rule) {
      i++;
      continue;
    }
    let found = -1;
    for (let k = i + 1; k <= i + 1 + TITLE_LOOKAHEAD && k < words.length; k++) {
      const word = words[k]!;
      if (k > i + 1 && !WORD_GAP.test(text.slice(words[k - 1]!.end, word.start))) break;
      // « M. et Mme Dupuis »: the next title starts its own search. A capitalized title word
      // right after a title is a name (« Mme Pasteur »).
      const direct = k === i + 1 && capitalized(word.raw) && !TITLES.get(word.folded)?.abbreviation;
      if (!direct && titleAt(text, words, k)) break;
      if (markerAt(text, words, k)) {
        // « Mme Élève A Dupuis », « Adulte A Dupuis »: the rest of the name is not known.
        const after = words[k + 2];
        if (
          after &&
          capitalized(after.raw) &&
          NAME_JOIN.test(text.slice(words[k + 1]!.end, after.start))
        ) {
          found = k + 2;
        }
        break;
      }
      if (capitalized(word.raw)) {
        found = k;
        break;
      }
      if (k === i + 1 && rule.lowercaseName && /^\p{L}/u.test(word.raw)) {
        if (!NOT_A_NAME.has(word.folded)) {
          found = k;
          break;
        }
      }
    }
    if (found >= 0) {
      const end = nameEnd(text, words, found);
      findings.push({
        kind: 'titledName',
        match: text.slice(words[i]!.start, words[end]!.end),
        index: words[i]!.start,
      });
      i = end + 1;
    } else {
      i++;
    }
  }
  // A marker followed by a surname, with no title (« Adulte A Dupuis » for « Mme Isabelle Dupuis »:
  // the redactor took the title with the first name it knows).
  for (let k = 0; k + 2 < words.length; k++) {
    if (!markerAt(text, words, k)) continue;
    const after = words[k + 2]!;
    const start = words[k]!.start;
    if (
      capitalized(after.raw) &&
      NAME_JOIN.test(text.slice(words[k + 1]!.end, after.start)) &&
      !markerAt(text, words, k + 2) &&
      !findings.some((f) => f.index <= start && start < f.index + f.match.length)
    ) {
      const end = nameEnd(text, words, k + 2);
      findings.push({
        kind: 'titledName',
        match: text.slice(start, words[end]!.end),
        index: start,
      });
    }
  }
  return findings.sort((a, b) => a.index - b.index);
}

// ---------------------------------------------------------------------------------------
// Capitalized words to check
// ---------------------------------------------------------------------------------------

/**
 * Capitalized words that never name a person in a message to families (folded): the faith, the
 * feasts and seasons, places, school subjects and days off, and English days and months (the
 * plan's allowlist, **Assumption**). « Marie » and « Grace », « June » or « April » are not in it:
 * they are first names too. It applies to this list only, never after a title.
 */
export const NEVER_A_PERSON: ReadonlySet<string> = new Set(
  [
    // Faith, feasts and seasons
    'dieu jesus christ seigneur vierge esprit saint sainte st ste tout puissant eglise',
    'noel paques avent careme pentecote toussaint epiphanie ascension assomption cendres',
    'action souvenir famille fetes fete terre halloween carnaval',
    // Places
    'canada ontario quebec ottawa toronto',
    // Subjects and school words
    'francais anglais mathematiques sciences technologie etudes sociales education physique',
    'sante arts musique danse histoire geographie religieux enseignement info parents',
    'ecole conseil paroisse classe',
    'english french math',
    // Events of a school's calendar
    'messe liturgie celebration assemblee journee conge',
    // English days and months, which may stand in a French text (not those that are first names)
    'monday tuesday wednesday thursday friday saturday sunday',
    'january february march july september october november december',
  ]
    .join(' ')
    .split(' '),
);

/**
 * Words that often start a sentence or a quotation and are never a name there (folded): little
 * words, greetings and frequent openings of a message to families. Inside a sentence they count
 * like any capitalized word (« Merci à Son et à Bon »).
 */
const SENTENCE_STARTERS = new Set(
  [
    'le la les l un une des du de d au aux ce cet cette ces ca mon ma mes ton ta tes son sa ses',
    'notre nos votre vos leur leurs je j tu il elle on nous vous ils elles c qui que qu quoi',
    'et ou mais donc or ni car si s en a dans par pour sur sous avec sans chez vers entre apres',
    'avant depuis pendant durant lors des jusqu tous toutes tout toute chaque plusieurs quelques',
    'aucun aucune certains certaines comme quand lorsque lorsqu puisque parce afin selon malgre',
    'voici voila oui non ici aujourd hui demain hier ensuite enfin puis alors ainsi aussi',
    'egalement encore deja bientot maintenant cependant toutefois pourtant finalement surtout',
    'bref comment pourquoi combien quel quelle quels quelles est y',
    // French days and months, capitalized only at the start of a sentence
    'lundi mardi mercredi jeudi vendredi samedi dimanche',
    'janvier fevrier mars avril mai juin juillet aout septembre octobre novembre decembre',
    'merci bonjour bonsoir bravo felicitations bienvenue joyeux joyeuse bonne bon bonnes bons',
    'belle beau cher chere cheres chers rappel rappels attention important importante note nb ps',
    'svp priere veuillez pensez apportez prenez lisez ecrivez consultez venez profitez rappelez',
    'demandez envoyez signez retournez remplissez inscrivez visitez continuez encouragez notez',
    'verifiez assurez prevoyez preparez discutez parlez faites dites allez soyez ayez',
    // Verbs that often start the title of a unit or a lesson, in quotation marks
    'faire lire ecrire compter decouvrir explorer comparer comprendre utiliser creer resoudre',
    'mesurer reperer observer classer construire raconter presenter',
    'the a an we our you your this these that please thank thanks dear hello',
  ]
    .join(' ')
    .split(' '),
);

/** « Élève A », « Adulte B »: the markers the redactor puts in place of people. */
const MARKER =
  /(?<![\p{L}\p{M}\p{N}])([ÉEée]l[èe]ve|[Aa]dulte)\s+([A-Z]{1,3})(?![\p{L}\p{M}\p{N}])/gu;
/** Words without their elision: « Hélène » in « d’Hélène ». */
const LETTERS = /[\p{L}\p{M}]+/gu;
/**
 * What comes right before a word that starts a sentence, a quotation, a parenthesis, an item
 * after a colon or a dash: there, a little word (« Les », « Demain ») is not listed.
 */
const STARTS = /(?:^|[.!?…:;«“"([\n—–]|^\s*-|\s-)\s*$/u;

/**
 * The capitalized words of the texts that the teacher should check before sending (D-139): a
 * name the app does not know (a parent's, a volunteer's) is sent as it is, so the preview asks her
 * to look at every word that may be one. Every capitalized word is listed, wherever it stands (in
 * a sentence, at its start, after « : », « ( », « « » or a dash), except markers, short acronyms
 * (« PA »), titles (« Mme »: `findTitledUnknownNames` takes care of them), `NEVER_A_PERSON`, and
 * the little words that start a sentence or a quotation (« Les », « Demain »). In order of
 * appearance, each once.
 */
export function capitalizedWords(texts: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const text of texts) {
    const markers = new Set<number>();
    for (const m of text.matchAll(MARKER)) {
      markers.add(m.index);
      markers.add(m.index + m[0].length - m[2]!.length);
    }
    for (const w of [...text.matchAll(LETTERS)]) {
      const word = w[0];
      if (markers.has(w.index) || !capitalized(word) || word.length < 2) continue;
      if (word.length <= 3 && word === word.toUpperCase()) continue;
      const folded = fold(word);
      if (NEVER_A_PERSON.has(folded) || TITLES.get(folded)?.abbreviation) continue;
      // A sentence's or a quotation's first word, when it is a little word.
      if (SENTENCE_STARTERS.has(folded) && STARTS.test(text.slice(0, w.index))) continue;
      if (!seen.has(folded)) {
        seen.add(folded);
        out.push(word);
      }
    }
  }
  return out;
}
