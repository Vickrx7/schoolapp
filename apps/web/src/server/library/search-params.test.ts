import { describe, expect, it } from 'vitest';
import {
  EMPTY_SEARCH,
  MAX_PAGES,
  clearFilters,
  facetFilterCount,
  hasFilters,
  itemHref,
  libraryHref,
  parseLibrarySearch,
  showsResults,
  subjectsForGrade,
  toRpcFilters,
  toSearchParams,
  withChanges,
  type LibrarySearch,
} from './search-params';

const SUBJECT = '00000000-0000-4000-8000-0000000000aa';
const STRAND = '00000000-0000-4000-8000-0000000000bb';
const EXP = '20000000-0000-4000-8000-000000030c12';
const LEVEL = '00000000-0000-4000-8000-0000000000cc';
const LESSON = '00000000-0000-4000-8000-0000000000dd';

const FULL: LibrarySearch = {
  q: 'idée principale',
  grade: '3',
  subject: SUBJECT,
  strand: STRAND,
  exp: EXP,
  types: ['worksheet', 'quiz'],
  buckets: ['pratiquer', 'evaluer'],
  dur: 'le30',
  fmt: ['printable', 'projectable'],
  sub: true,
  approved: true,
  level: LEVEL,
  mine: true,
  attachTo: LESSON,
  page: 3,
};

describe('the search in the address', () => {
  it('reads back every filter it wrote (round trip)', () => {
    expect(parseLibrarySearch(toSearchParams(FULL))).toEqual(FULL);
    expect(parseLibrarySearch(new URLSearchParams(libraryHref(FULL).split('?')[1]))).toEqual(FULL);
  });

  it('reads the page props of Next (a string, or an array for a repeated key)', () => {
    expect(
      parseLibrarySearch({
        q: '  huard  ',
        type: ['quiz', 'worksheet'],
        bucket: 'jouer',
        fmt: ['interactive'],
        sub: '1',
        approved: 'true',
        mine: '0',
        page: '2',
      }),
    ).toEqual({
      ...EMPTY_SEARCH,
      q: 'huard',
      types: ['worksheet', 'quiz'],
      buckets: ['jouer'],
      fmt: ['interactive'],
      sub: true,
      approved: true,
      page: 2,
    });
  });

  it('accepts comma-separated lists and keeps the catalogue order, once each', () => {
    const s = parseLibrarySearch(
      new URLSearchParams('type=quiz,worksheet&type=quiz&bucket=relier,enseigner'),
    );
    expect(s.types).toEqual(['worksheet', 'quiz']);
    expect(s.buckets).toEqual(['enseigner', 'relier']);
  });

  it('drops values that are not valid instead of refusing the page', () => {
    expect(
      parseLibrarySearch({
        grade: '9',
        subject: 'not-an-id',
        strand: `${STRAND}x`,
        exp: "1' or 1=1",
        type: ['poster', 'quiz'],
        bucket: ['partout'],
        dur: 'le45',
        fmt: ['paper', 'printable'],
        sub: 'yes',
        level: '',
        attachTo: '42',
        page: '0',
      }),
    ).toEqual({ ...EMPTY_SEARCH, types: ['quiz'], fmt: ['printable'] });
    expect(parseLibrarySearch({ page: '2.5' }).page).toBe(1);
    expect(parseLibrarySearch({ page: '-3' }).page).toBe(1);
    expect(parseLibrarySearch({ page: '9999' }).page).toBe(MAX_PAGES);
  });

  it('normalizes what can be: grade codes in capitals, ids in lower case, spaces', () => {
    const s = parseLibrarySearch({
      grade: 'k2',
      subject: SUBJECT.toUpperCase(),
      q: ' fractions \n  équivalentes ',
    });
    expect(s.grade).toBe('K2');
    expect(s.subject).toBe(SUBJECT);
    expect(s.q).toBe('fractions équivalentes');
  });

  it('keeps at most 200 characters of the words typed', () => {
    expect(parseLibrarySearch({ q: 'a'.repeat(500) }).q).toHaveLength(200);
  });

  it('writes the same link for the same search, defaults left out', () => {
    expect(libraryHref(EMPTY_SEARCH)).toBe('/library');
    expect(libraryHref({ grade: '3', q: 'huard' })).toBe('/library?q=huard&grade=3');
    expect(libraryHref({ ...EMPTY_SEARCH, types: ['quiz', 'worksheet'], page: 1 })).toBe(
      '/library?type=worksheet&type=quiz',
    );
    expect(libraryHref({ sub: true, page: 2 })).toBe('/library?sub=1&page=2');
    // Words with spaces and accents are encoded, then read back as typed.
    const href = libraryHref({ q: 'idée principale & co' });
    expect(parseLibrarySearch(new URLSearchParams(href.split('?')[1])).q).toBe(
      'idée principale & co',
    );
  });
});

describe('changing the search', () => {
  it('goes back to the first page when a filter changes', () => {
    expect(withChanges(FULL, { sub: false }).page).toBe(1);
    expect(withChanges(FULL, { page: 4 }).page).toBe(4);
  });

  it('« Effacer les filtres » keeps the words typed and the lesson being chosen for', () => {
    expect(clearFilters(FULL)).toEqual({ ...EMPTY_SEARCH, q: FULL.q, attachTo: LESSON });
  });

  it('counts the choices of the filter panel', () => {
    expect(facetFilterCount(EMPTY_SEARCH)).toBe(0);
    // 2 types, 2 categories, a duration, 2 formats, substitutes, approved, a level, grade, subject.
    expect(facetFilterCount(FULL)).toBe(12);
  });

  it('shows results as soon as something is typed, filtered or a lesson is being chosen for', () => {
    expect(showsResults(EMPTY_SEARCH)).toBe(false);
    expect(showsResults({ ...EMPTY_SEARCH, page: 3 })).toBe(false);
    expect(showsResults({ ...EMPTY_SEARCH, q: 'huard' })).toBe(true);
    expect(showsResults({ ...EMPTY_SEARCH, attachTo: LESSON })).toBe(true);
    expect(showsResults({ ...EMPTY_SEARCH, exp: EXP })).toBe(true);
    expect(showsResults({ ...EMPTY_SEARCH, mine: true })).toBe(true);
    expect(hasFilters({ ...EMPTY_SEARCH, q: 'huard', attachTo: LESSON })).toBe(false);
  });

  it('carries the search to a result’s page, and back to the results from there', () => {
    const ITEM = '00000000-0000-4000-8000-0000000000ee';
    expect(itemHref(ITEM, null)).toBe(`/library/items/${ITEM}`);
    expect(itemHref(ITEM, EMPTY_SEARCH)).toBe(`/library/items/${ITEM}`);
    const search = { ...EMPTY_SEARCH, q: 'huard', grade: '3', attachTo: LESSON };
    const href = itemHref(ITEM, search);
    expect(href).toBe(`/library/items/${ITEM}?q=huard&grade=3&attachTo=${LESSON}`);
    // The item page reads the same search back, for « Retour aux résultats ».
    const back = parseLibrarySearch(new URL(href, 'http://x').searchParams);
    expect(libraryHref(back)).toBe(libraryHref(search));
  });
});

describe('the filters sent to search_library', () => {
  it('names each filter as the database function does and leaves defaults out', () => {
    expect(toRpcFilters(EMPTY_SEARCH)).toEqual({});
    expect(toRpcFilters(FULL)).toEqual({
      q: 'idée principale',
      gradeCode: '3',
      subjectId: SUBJECT,
      strandId: STRAND,
      expectationId: EXP,
      types: ['worksheet', 'quiz'],
      buckets: ['pratiquer', 'evaluer'],
      duration: 'le30',
      formats: ['printable', 'projectable'],
      subFriendly: true,
      approvedOnly: true,
      languageLevelId: LEVEL,
      mine: true,
    });
  });

  it('never sends the page or the lesson being chosen for', () => {
    const filters = toRpcFilters(FULL) as Record<string, unknown>;
    expect(filters.page).toBeUndefined();
    expect(filters.attachTo).toBeUndefined();
  });
});

describe('the subjects of a grade', () => {
  const subjects = [
    { code: 'pmje', gradeMin: -1, gradeMax: 0 },
    { code: 'fra', gradeMin: 1, gradeMax: 8 },
    { code: 'etu', gradeMin: 1, gradeMax: 6 },
    { code: 'hig', gradeMin: 7, gradeMax: 8 },
    { code: 'ang', gradeMin: 1, gradeMax: 8 },
  ];
  const codes = (ordinal: number, anglaisStartGrade = 4) =>
    subjectsForGrade({ subjects, anglaisStartGrade }, ordinal).map((s) => s.code);

  it("follows each subject's grade range", () => {
    expect(codes(0)).toEqual(['pmje']);
    expect(codes(6)).toEqual(['fra', 'etu', 'ang']);
    expect(codes(7)).toEqual(['fra', 'hig', 'ang']);
  });

  it("offers Anglais from the board's start grade only", () => {
    expect(codes(3)).toEqual(['fra', 'etu']);
    expect(codes(4)).toEqual(['fra', 'etu', 'ang']);
    expect(codes(1, 1)).toEqual(['fra', 'etu', 'ang']);
  });
});
