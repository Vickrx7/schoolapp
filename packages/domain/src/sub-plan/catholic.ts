/**
 * The « Moment de foi » of a substitute plan (DECISIONS D-058, SPEC 9.5): one reference from
 * the board-editable `catholic_references`, picked deterministically so the same sources give
 * the same plan. The teacher can edit or remove it; she is the authority on faith content.
 * The library's « Ajouter un lien avec la foi » suggests references with the same ranking
 * (D-074).
 */
import { addDays, daysBetween, isoWeekday, type LocalDate } from '../dates';
import { compareFr, matchWords } from './text';

export const liturgicalSeasons = ['avent', 'noel', 'careme', 'paques', 'temps_ordinaire'] as const;
export type LiturgicalSeason = (typeof liturgicalSeasons)[number];

export const catholicReferenceTypes = [
  'virtue',
  'graduate_expectation',
  'reflection',
  'prayer',
  'scripture',
] as const;
export type CatholicReferenceType = (typeof catholicReferenceTypes)[number];

export interface CatholicReference {
  id: string;
  /** Null for references shared by every board. */
  boardId: string | null;
  type: CatholicReferenceType;
  title: string;
  textFr: string;
  /** Grade ordinals (K1 = -1, K2 = 0, 1..8), inclusive. */
  gradeMin: number;
  gradeMax: number;
  /** Null: any time of the year. */
  liturgicalSeason: LiturgicalSeason | null;
  tags: readonly string[];
}

function isoDate(year: number, month: number, day: number): LocalDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Easter Sunday in the Gregorian calendar (anonymous computus, Meeus/Jones/Butcher). */
export function easterSunday(year: number): LocalDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoDate(year, month, day);
}

/** First Sunday of Advent: the fourth Sunday before Christmas. */
function adventStart(year: number): LocalDate {
  const christmas = isoDate(year, 12, 25);
  const weekday = isoWeekday(christmas) % 7; // Sunday = 0
  return addDays(christmas, -(weekday === 0 ? 7 : weekday) - 21);
}

/** End of the Christmas season: the first Sunday after January 6 (Baptism of the Lord). */
function christmasSeasonEnd(year: number): LocalDate {
  const epiphany = isoDate(year, 1, 6);
  return addDays(epiphany, 7 - (isoWeekday(epiphany) % 7));
}

/**
 * The liturgical season of a date: avent (first Sunday of Advent to Dec 24), noel (Dec 25 to
 * the first Sunday after Jan 6), careme (Ash Wednesday to Holy Saturday), paques (Easter to
 * Pentecost), otherwise temps_ordinaire.
 */
export function liturgicalSeasonOn(date: LocalDate): LiturgicalSeason {
  const year = Number(date.slice(0, 4));
  if (date >= isoDate(year, 12, 25) || date <= christmasSeasonEnd(year)) return 'noel';
  if (date >= adventStart(year)) return 'avent';
  const easter = easterSunday(year);
  if (date >= addDays(easter, -46) && date < easter) return 'careme';
  if (date >= easter && date <= addDays(easter, 49)) return 'paques';
  return 'temps_ordinaire';
}

/** How many of a reference's tags appear among the day's words (a tag's words must all appear). */
function tagOverlap(tags: readonly string[], words: ReadonlySet<string>): number {
  return tags.filter((tag) => {
    const tagWords = matchWords(tag);
    return tagWords.length > 0 && tagWords.every((w) => words.has(w));
  }).length;
}

export interface CatholicRankContext {
  /** The grades the reference is for (a plan's classes, a resource's grades). */
  gradeOrdinals: readonly number[];
  date: LocalDate;
  /**
   * Words to match against the references' tags: a plan day's lesson titles and subject labels,
   * or a resource's subject, attentes and the teacher's note (D-074).
   */
  keywords: readonly string[];
  boardId: string;
}

/**
 * The references that fit, best first (D-058, D-074), shared by substitute plans and the
 * library's « Ajouter un lien avec la foi »:
 * - a reference fits when its grade range includes every grade given and its season is the
 *   date's, or empty;
 * - the most tags found in the keywords comes first (accents ignored), then the board's own
 *   references before shared ones;
 * - references that tie are in French title order, rotated by date, so a week of absence (or of
 *   new resources) doesn't repeat the same prayer.
 * References that do not fit are left out. Callers pass active references only.
 */
export function rankCatholicReferences<R extends CatholicReference>(
  refs: readonly R[],
  context: CatholicRankContext,
): R[] {
  const season = liturgicalSeasonOn(context.date);
  const minGrade = context.gradeOrdinals.length > 0 ? Math.min(...context.gradeOrdinals) : null;
  const maxGrade = context.gradeOrdinals.length > 0 ? Math.max(...context.gradeOrdinals) : null;
  const words = new Set(context.keywords.flatMap(matchWords));

  const candidates = refs
    .filter(
      (r) =>
        (minGrade === null || r.gradeMin <= minGrade) &&
        (maxGrade === null || r.gradeMax >= maxGrade) &&
        (r.liturgicalSeason === null || r.liturgicalSeason === season),
    )
    .map((r) => ({
      ref: r,
      overlap: tagOverlap(r.tags, words),
      own: r.boardId === context.boardId ? 1 : 0,
    }));

  // Groups of references that tie, best first; each group rotates by date.
  const groups = new Map<string, R[]>();
  for (const c of [...candidates].sort((a, b) => b.overlap - a.overlap || b.own - a.own)) {
    const key = `${c.overlap}:${c.own}`;
    groups.set(key, [...(groups.get(key) ?? []), c.ref]);
  }
  const days = Math.abs(daysBetween('2000-01-01', context.date));
  return [...groups.values()].flatMap((group) => {
    const tied = group.sort((a, b) => compareFr(a.title, b.title) || (a.id < b.id ? -1 : 1));
    const turn = days % tied.length;
    return [...tied.slice(turn), ...tied.slice(0, turn)];
  });
}

/**
 * Picks the reference for a plan day: the first of `rankCatholicReferences` (the grade range
 * includes every grade of the covered classes, the season fits, the most tags found in the day's
 * lesson titles and subject labels, the board's own first, ties rotating by date). Returns null
 * when nothing fits.
 */
export function pickCatholicReference<R extends CatholicReference>(
  refs: readonly R[],
  context: CatholicRankContext,
): R | null {
  return rankCatholicReferences(refs, context)[0] ?? null;
}
