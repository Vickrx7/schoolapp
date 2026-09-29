import { describe, expect, it } from 'vitest';
import {
  easterSunday,
  liturgicalSeasonOn,
  pickCatholicReference,
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
