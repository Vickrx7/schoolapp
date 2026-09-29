import { describe, expect, it } from 'vitest';
import {
  easterSunday,
  liturgicalSeasonOn,
  pickCatholicReference,
  rankCatholicReferences,
  type CatholicReference,
} from './catholic';
import { BOARD, isabelleSources, parse } from './test-fixtures';

const seedRefs = parse(isabelleSources()).catholicReferences;
const pick = (
  refs: readonly CatholicReference[],
  context: Partial<Parameters<typeof pickCatholicReference>[1]> = {},
) =>
  pickCatholicReference(refs, {
    gradeOrdinals: [3],
    date: '2026-10-19',
    keywords: [],
    boardId: BOARD,
    ...context,
  });

const ref = (id: string, overrides: Partial<CatholicReference> = {}): CatholicReference => ({
  id,
  boardId: BOARD,
  type: 'virtue',
  title: id,
  textFr: 'Texte',
  gradeMin: -1,
  gradeMax: 8,
  liturgicalSeason: null,
  tags: [],
  ...overrides,
});

describe('easterSunday', () => {
  it('follows the Gregorian computus', () => {
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2027)).toBe('2027-03-28');
    expect(easterSunday(2030)).toBe('2030-04-21');
  });
});

describe('liturgicalSeasonOn', () => {
  it.each([
    ['2026-10-05', 'temps_ordinaire'],
    ['2026-11-28', 'temps_ordinaire'],
    ['2026-11-29', 'avent'],
    ['2026-12-24', 'avent'],
    ['2026-12-25', 'noel'],
    ['2027-01-10', 'noel'],
    ['2027-01-11', 'temps_ordinaire'],
    ['2027-02-09', 'temps_ordinaire'],
    ['2027-02-10', 'careme'],
    ['2027-03-27', 'careme'],
    ['2027-03-28', 'paques'],
    ['2027-05-16', 'paques'],
    ['2027-05-17', 'temps_ordinaire'],
  ])('%s is %s', (date, season) => {
    expect(liturgicalSeasonOn(date)).toBe(season);
  });
});

describe('pickCatholicReference', () => {
  it('keeps references whose grade range includes every covered grade', () => {
    const titles = (gradeOrdinals: number[]) =>
      new Set(
        ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-26'].map(
          (date) => pick(seedRefs, { gradeOrdinals, date })?.title,
        ),
      );
    expect(titles([7])).not.toContain('Prière avant le travail'); // grades -1..6
    expect(titles([-1])).not.toContain('La persévérance'); // grades 1..8
    expect(titles([3, 7])).not.toContain('Prière avant le travail');
    expect(pick([ref('only', { gradeMin: 4, gradeMax: 8 })], { gradeOrdinals: [3, 5] })).toBeNull();
  });

  it('keeps references of the date’s season or of no season', () => {
    const advent = ref('avent', { liturgicalSeason: 'avent' });
    const ordinary = ref('ordinaire', { liturgicalSeason: 'temps_ordinaire' });
    expect(pick([advent, ordinary], { date: '2026-12-01' })?.id).toBe('avent');
    expect(pick([advent, ordinary], { date: '2026-10-19' })?.id).toBe('ordinaire');
    expect(pick([advent], { date: '2026-10-19' })).toBeNull();
  });

  it('prefers the board’s own references', () => {
    const shared = ref('shared', { boardId: null });
    const own = ref('own');
    for (const date of ['2026-10-19', '2026-10-20', '2026-10-21']) {
      expect(pick([shared, own], { date })?.id).toBe('own');
    }
  });

  it('prefers references whose tags match the day’s lessons and subjects, accents ignored', () => {
    const keywords = ['Sciences et technologie', 'Compression et tension'];
    for (const date of ['2026-10-19', '2026-10-20', '2026-10-21']) {
      expect(pick(seedRefs, { date, keywords })?.title).toBe('Prendre soin de la création');
    }
    expect(pick(seedRefs, { keywords: ['Creation du monde'] })?.title).toBe(
      'Prendre soin de la création',
    );
    // A tag's words must all appear: « action de grâce » needs both « action » and « grâce ».
    const partial = [ref('a', { tags: ['action de grâce'] }), ref('b')];
    const dates = ['2026-10-19', '2026-10-20'];
    const picks = (keywords: string[]) =>
      dates.map((date) => pick(partial, { date, keywords })?.id);
    expect(picks(['La grâce en action'])).toEqual(['a', 'a']);
    expect(new Set(picks(['Action']))).toEqual(new Set(['a', 'b']));
  });

  it('rotates ties by date and returns null without candidates', () => {
    const refs = [ref('a'), ref('b'), ref('c')];
    const week = ['2026-10-19', '2026-10-20', '2026-10-21'].map((date) => pick(refs, { date })?.id);
    expect(new Set(week).size).toBe(3);
    expect(pick(refs, { date: '2026-10-22' })?.id).toBe(week[0]);
    expect(pick([...refs].reverse(), { date: '2026-10-19' })?.id).toBe(week[0]);
    expect(pick([])).toBeNull();
  });
});

describe('rankCatholicReferences', () => {
  const rank = (
    refs: readonly CatholicReference[],
    context: Partial<Parameters<typeof rankCatholicReferences>[1]> = {},
  ) =>
    rankCatholicReferences(refs, {
      gradeOrdinals: [3],
      date: '2026-10-19',
      keywords: [],
      boardId: BOARD,
      ...context,
    }).map((r) => r.id);

  it('domain 1. follows grade range, then season, then keyword overlap, then the board’s own, rotating ties by date', () => {
    const refs = [
      ref('older', { gradeMin: 4, gradeMax: 8, tags: ['nombres'] }),
      ref('advent', { liturgicalSeason: 'avent', tags: ['nombres'] }),
      ref('numbers', { boardId: null, tags: ['nombres', 'calcul'] }),
      ref('numbers-own', { tags: ['nombres'] }),
      ref('numbers-shared', { boardId: null, tags: ['nombres'] }),
      ref('plain-a'),
      ref('plain-b'),
      ref('plain-shared', { boardId: null }),
    ];
    const keywords = ['Mathématiques', 'Comparer des nombres et faire du calcul mental'];
    const day1 = rank(refs, { keywords });
    // Grade range and season decide what fits; then the most tags; then the board's own.
    expect(day1).not.toContain('older');
    expect(day1).not.toContain('advent');
    expect(day1.slice(0, 3)).toEqual(['numbers', 'numbers-own', 'numbers-shared']);
    expect(new Set(day1.slice(3, 5))).toEqual(new Set(['plain-a', 'plain-b']));
    expect(day1[5]).toBe('plain-shared');
    // The season comes in when the date is in it; ties rotate from one day to the next.
    expect(rank(refs, { keywords, date: '2026-12-01' })).toContain('advent');
    const day2 = rank(refs, { keywords, date: '2026-10-20' });
    expect(day2.slice(3, 5)).toEqual([...day1.slice(3, 5)].reverse());
    // The first of the ranking is what a substitute plan picks.
    for (const date of ['2026-10-19', '2026-10-20', '2026-12-01']) {
      expect(pick(refs, { keywords, date })?.id).toBe(rank(refs, { keywords, date })[0]);
    }
    expect(rank([ref('only', { gradeMin: 4 })])).toEqual([]);
  });

  it('domain 2. puts « Prendre soin de la création » first for a science attente about forces and structures', () => {
    const keywords = [
      'Sciences et technologie',
      'Décrire les effets des forces de compression, de tension et de torsion sur des structures.',
      'Une activité avec des éponges et des élastiques.',
    ];
    for (const date of ['2026-10-19', '2026-10-20', '2026-10-21', '2026-12-01']) {
      const ranked = rankCatholicReferences(seedRefs, {
        gradeOrdinals: [5],
        date,
        keywords,
        boardId: BOARD,
      });
      expect(ranked[0]?.title).toBe('Prendre soin de la création');
      // Every other reference that fits 5e année and the date still follows, for the picker.
      expect(ranked.map((r) => r.title)).toContain('Prière avant le travail');
      expect(ranked.map((r) => r.title).includes('Prière de l’Avent')).toBe(date === '2026-12-01');
    }
  });
});
