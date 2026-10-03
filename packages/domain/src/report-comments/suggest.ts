/**
 * The entries « Bulletins » proposes for a student (DECISIONS D-130): a bank's entries for the
 * student's mark (an achievement level, a progress mark, or a rating per learning skill), the
 * attentes taught during the period first, then the entries without an attente, in the bank's
 * order; the entries for attentes not taught are folded away. No AI: with « Mes notes », entries
 * that share a word with the teacher's notes come first. All in the browser.
 */
import {
  LEARNING_SKILLS,
  entryText,
  type CommentForm,
  type ContentOf,
  type LearningSkill,
  type LearningSkillRating,
  type ProgressMark,
} from '@lynx/content';
import type { ComposerReport } from './periods';

export type BankEntry = ContentOf<'report_comments'>['entries'][number];

export interface ResolvedEntry extends BankEntry {
  /** Its place in the bank: picks name entries by it. */
  index: number;
  /** Its attentes in the student's grade; a code the curriculum does not have is left out. */
  expectationIds: string[];
}

/** An attente of the bank's subject, as the curriculum has it. */
export interface CodedExpectation {
  id: string;
  code: string;
  gradeCode: string;
  parentId: string | null;
}

/** A bank's entries with their attentes' ids in `gradeCode` (codes repeat across grades). */
export function resolveBankEntries(
  entries: readonly BankEntry[],
  {
    gradeCode,
    expectations,
  }: { gradeCode: string | null; expectations: readonly CodedExpectation[] },
): ResolvedEntry[] {
  const byCode = new Map(
    expectations.filter((e) => e.gradeCode === gradeCode).map((e) => [e.code, e.id] as const),
  );
  return entries.map((entry, index) => ({
    ...entry,
    index,
    expectationIds: entry.expectationCodes
      .map((code) => byCode.get(code))
      .filter((id): id is string => id !== undefined),
  }));
}

/**
 * Whether an entry counts for the period (D-069's rule, as the library's search): no filter
 * (`taught` null), no attente, or one of its attentes taught, or the overall attente of one, or
 * a specific attente of one.
 */
export function entryInScope(
  entry: Pick<ResolvedEntry, 'expectationIds'>,
  taught: ReadonlySet<string> | null,
  parents: ReadonlyMap<string, string | null>,
): boolean {
  if (taught === null || entry.expectationIds.length === 0) return true;
  return entry.expectationIds.some((id) => {
    if (taught.has(id)) return true;
    const parent = parents.get(id);
    if (parent && taught.has(parent)) return true;
    for (const t of taught) if (parents.get(t) === id) return true;
    return false;
  });
}

/** The student's mark, as the composer keeps it (device only). */
export interface ComposerMark {
  /** An achievement level, for a report card term. */
  level: number | null;
  /** A progress mark, for the progress report. */
  progress: ProgressMark | null;
  /** A rating per learning skill. */
  ratings: Partial<Record<LearningSkill, LearningSkillRating>>;
}

export interface Suggestion {
  entry: ResolvedEntry;
  /** Shares a word with « Mes notes ». */
  fromNotes: boolean;
}

export interface Suggestions {
  strengths: Suggestion[];
  nextSteps: Suggestion[];
  general: Suggestion[];
  /** For the mark, but about attentes not taught during the period (folded away). */
  outOfScope: Suggestion[];
  /** No mark chosen yet: only the entries for every mark are proposed. */
  needsMark: boolean;
}

/** Whether an entry is for this mark (an entry without a mark is for every mark). */
function matchesMark(
  entry: BankEntry,
  scope: 'subject' | 'learning_skills',
  report: ComposerReport,
  mark: ComposerMark,
): boolean {
  if (scope === 'learning_skills') {
    if (entry.skill === null) return false;
    const rating = mark.ratings[entry.skill];
    return rating !== undefined && (entry.rating === null || entry.rating === rating);
  }
  if (entry.skill !== null) return false;
  if (report === 'term') {
    if (entry.progress !== null) return false;
    return entry.level === null || entry.level === mark.level;
  }
  if (entry.level !== null) return false;
  return entry.progress === null || entry.progress === mark.progress;
}

const STOP_WORDS = new Set(
  (
    'avec dans pour elle elles sont mais plus tres bien fait faire cette comme leur leurs nous ' +
    'vous etre avoir aussi encore tout tous toute toutes sans sous entre depuis quand alors donc ' +
    'ainsi peut doit prenom eleve eleves fois chez dont cela celui celle ceux parce selon pendant ' +
    'souvent toujours jamais beaucoup moins assez quelques plusieurs autre autres meme notre votre'
  ).split(' '),
);

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** The words of a text that may match notes: four letters or more, no common words. */
export function noteKeywords(text: string): string[] {
  const words = fold(text.replace(/\{[^{}]*\}/g, ' ')).split(/[^\p{L}]+/u);
  return [...new Set(words.filter((w) => w.length >= 4 && !STOP_WORDS.has(w)))];
}

/** Two words match when equal, or when both have six letters or more and share the first six. */
const sameWord = (a: string, b: string) =>
  a === b || (a.length >= 6 && b.length >= 6 && a.slice(0, 6) === b.slice(0, 6));

function sharesWord(entry: BankEntry, keywords: readonly string[]): boolean {
  if (keywords.length === 0) return false;
  const words = noteKeywords(
    [entry.neutral, entry.feminine, entry.masculine].filter(Boolean).join(' '),
  );
  return words.some((w) => keywords.some((k) => sameWord(w, k)));
}

/**
 * The entries proposed for a student: for the mark, grouped by kind; within each group the
 * entries sharing a word with the notes first, then those tied to an attente taught during the
 * period, then those without an attente, then the bank's order. Learning skills follow the six
 * skills' order. Without a mark, only the entries for every mark (none for the learning skills).
 */
export function suggestEntries({
  entries,
  scope,
  report,
  mark,
  taught,
  parents,
  notes = '',
}: {
  entries: readonly ResolvedEntry[];
  scope: 'subject' | 'learning_skills';
  report: ComposerReport;
  mark: ComposerMark;
  /** The attentes taught during the period; null: no filter (none loaded, or none taught). */
  taught: ReadonlySet<string> | null;
  parents: ReadonlyMap<string, string | null>;
  notes?: string;
}): Suggestions {
  const needsMark =
    scope === 'learning_skills'
      ? Object.keys(mark.ratings).length === 0
      : report === 'term'
        ? mark.level === null
        : mark.progress === null;
  const keywords = noteKeywords(notes);
  const skillOrder = (e: ResolvedEntry) => (e.skill ? LEARNING_SKILLS.indexOf(e.skill) : -1);
  const rank = (s: Suggestion) => [
    s.fromNotes ? 0 : 1,
    taught !== null && s.entry.expectationIds.length > 0 ? 0 : 1,
  ];
  const order = (a: Suggestion, b: Suggestion) => {
    const [an, at] = rank(a);
    const [bn, bt] = rank(b);
    return (
      skillOrder(a.entry) - skillOrder(b.entry) ||
      an! - bn! ||
      at! - bt! ||
      a.entry.index - b.entry.index
    );
  };
  const result: Suggestions = {
    strengths: [],
    nextSteps: [],
    general: [],
    outOfScope: [],
    needsMark,
  };
  for (const entry of entries) {
    if (!matchesMark(entry, scope, report, mark)) continue;
    const suggestion = { entry, fromNotes: sharesWord(entry, keywords) };
    if (!entryInScope(entry, taught, parents)) result.outOfScope.push(suggestion);
    else if (entry.kind === 'strength') result.strengths.push(suggestion);
    else if (entry.kind === 'next_step') result.nextSteps.push(suggestion);
    else result.general.push(suggestion);
  }
  result.strengths.sort(order);
  result.nextSteps.sort(order);
  result.general.sort(order);
  result.outOfScope.sort((a, b) => order(a, b));
  return result;
}

/**
 * What makes entries say the same thing differently (« Autre formulation »): the same kind, mark,
 * and attentes or learning skill. An entry about neither (« Participe avec enthousiasme… ») says
 * something of its own: its key is its own.
 */
export function wordingKey(entry: ResolvedEntry): string {
  if (entry.expectationCodes.length === 0 && entry.skill === null) return `entry:${entry.index}`;
  return [
    entry.kind,
    entry.skill,
    entry.level,
    entry.progress,
    entry.rating,
    entry.expectationCodes.join(' '),
  ].join('|');
}

/** Other entries saying the same thing differently (`wordingKey`), in the bank's order. */
export function alternativesOf(
  entry: ResolvedEntry,
  entries: readonly ResolvedEntry[],
): ResolvedEntry[] {
  const key = wordingKey(entry);
  return entries.filter((e) => e.index !== entry.index && wordingKey(e) === key);
}

const KIND_ORDER = { strength: 0, general: 1, next_step: 2 } as const;

/**
 * The comment built from the chosen entries, in template form (`{prénom}`): points forts, then
 * general comments, then prochaines étapes, each in the order they were chosen, in the student's
 * wording (the neutral text when the entry has none for it).
 */
export function composeFromPicks(
  entries: readonly ResolvedEntry[],
  picks: readonly { index: number }[],
  form: CommentForm,
): string {
  const byIndex = new Map(entries.map((e) => [e.index, e]));
  return picks
    .map((p, order) => ({ entry: byIndex.get(p.index), order }))
    .filter((p): p is { entry: ResolvedEntry; order: number } => p.entry !== undefined)
    .sort((a, b) => KIND_ORDER[a.entry.kind] - KIND_ORDER[b.entry.kind] || a.order - b.order)
    .map((p) => entryText(p.entry, form))
    .filter(Boolean)
    .join(' ');
}
