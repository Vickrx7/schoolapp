/**
 * The « Moment de foi » of a substitute plan (DECISIONS D-058, SPEC 9.5): one reference from
 * the board-editable `catholic_references`, picked deterministically so the same sources give
 * the same plan. The teacher can edit or remove it; she is the authority on faith content.
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

/**
 * Picks the reference for a plan day:
 * - its grade range must include every grade of the covered classes;
 * - its season must match the date's, or be empty;
 * - the most tags found in the day's lesson titles and subject labels wins (accents ignored),
 *   then the board's own references over shared ones;
 * - remaining ties rotate by date, so a week of absence doesn't repeat the same prayer.
 * Returns null when nothing fits. Callers pass active references only.
 */
export function pickCatholicReference<R extends CatholicReference>(
  refs: readonly R[],
  context: {
    gradeOrdinals: readonly number[];
    date: LocalDate;
    /** Lesson titles and subject labels of the day. */
    keywords: readonly string[];
    boardId: string;
  },
): R | null {
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
  if (candidates.length === 0) return null;

  const best = candidates.reduce(
    (top, c) =>
      c.overlap > top.overlap || (c.overlap === top.overlap && c.own > top.own) ? c : top,
    candidates[0]!,
  );
  const tied = candidates
    .filter((c) => c.overlap === best.overlap && c.own === best.own)
    .map((c) => c.ref)
    .sort((a, b) => compareFr(a.title, b.title) || (a.id < b.id ? -1 : 1));
  const turn = Math.abs(daysBetween('2000-01-01', context.date)) % tied.length;
  return tied[turn]!;
}
