import { describe, expect, it } from 'vitest';
import {
  MAX_STATS_ITEMS,
  adaptOffer,
  allowedScopes,
  canGiveOpinion,
  newUuid,
  opinionSummary,
  starFill,
  statsById,
  statsIds,
  usableItem,
  type GrowthItem,
} from './growth';

const ID = '3daed963-c2a5-568d-b23e-b38865b2b551';
const OTHER = '61a7a7bc-a2e2-5abd-a700-3db3b79bd26e';

const item = (over: Partial<GrowthItem> = {}): GrowthItem => ({
  status: 'board_approved',
  shareScope: 'board',
  mine: false,
  canEdit: false,
  noDerivatives: false,
  ...over,
});

describe('statsById', () => {
  it('maps the rows of library_item_stats by item, numbers as the database sends them', () => {
    const stats = statsById([
      { item_id: ID, rating_average: 4.5, rating_count: 7, my_rating: 4, usage_count: 12 },
      { item_id: OTHER, rating_average: null, rating_count: null, my_rating: null, usage_count: 0 },
    ]);
    expect(stats.get(ID)).toEqual({
      ratingAverage: 4.5,
      ratingCount: 7,
      myRating: 4,
      usageCount: 12,
    });
    expect(stats.get(OTHER)).toEqual({
      ratingAverage: null,
      ratingCount: null,
      myRating: null,
      usageCount: 0,
    });
    // numeric can come back as a string.
    expect(
      statsById([
        { item_id: ID, rating_average: '4.0', rating_count: 5, my_rating: null, usage_count: 1 },
      ]).get(ID)?.ratingAverage,
    ).toBe(4);
  });

  it('leaves out rows that do not parse, never guessing a number', () => {
    const stats = statsById([
      { item_id: 'x', rating_average: 4, rating_count: 5, my_rating: null, usage_count: 0 },
      { item_id: ID, rating_average: 9, rating_count: 5, my_rating: null, usage_count: 0 },
      { item_id: OTHER, rating_average: null, rating_count: -1, my_rating: null, usage_count: 0 },
      null,
    ]);
    expect(stats.size).toBe(0);
    expect(statsById(null).size).toBe(0);
  });
});

describe('opinionSummary (D-093)', () => {
  it('shows an average from 5 opinions', () => {
    expect(opinionSummary({ ratingAverage: 4.5, ratingCount: 7 })).toEqual({
      kind: 'average',
      average: 4.5,
      count: 7,
    });
    expect(opinionSummary({ ratingAverage: 3, ratingCount: 5 })?.kind).toBe('average');
  });

  it('shows only the number below 5 opinions, whatever average is sent', () => {
    expect(opinionSummary({ ratingAverage: null, ratingCount: 3 })).toEqual({
      kind: 'notEnough',
      count: 3,
    });
    expect(opinionSummary({ ratingAverage: 5, ratingCount: 4 })).toEqual({
      kind: 'notEnough',
      count: 4,
    });
    expect(opinionSummary({ ratingAverage: null, ratingCount: 0 })).toEqual({ kind: 'none' });
  });

  it('shows nothing for an item that takes no opinion', () => {
    expect(opinionSummary({ ratingAverage: null, ratingCount: null })).toBeNull();
    expect(opinionSummary(null)).toBeNull();
    expect(opinionSummary(undefined)).toBeNull();
  });
});

describe('starFill', () => {
  it('fills stars by halves', () => {
    expect(starFill(4.5)).toEqual(['full', 'full', 'full', 'full', 'half']);
    expect(starFill(3)).toEqual(['full', 'full', 'full', 'empty', 'empty']);
    expect(starFill(1)).toEqual(['full', 'empty', 'empty', 'empty', 'empty']);
    expect(starFill(9)).toEqual(['full', 'full', 'full', 'full', 'full']);
  });
});

describe('adaptOffer and canGiveOpinion (D-092, D-093)', () => {
  it('offers « Adapter » on resources the user can use, not archived', () => {
    expect(adaptOffer(item())).toBe('offer');
    expect(adaptOffer(item({ status: 'teacher_reviewed', shareScope: 'school' }))).toBe('offer');
    expect(adaptOffer(item({ status: 'archived', shareScope: 'private', mine: true }))).toBeNull();
    // Waiting for review, or private: the user cannot use it.
    expect(adaptOffer(item({ status: 'teacher_reviewed', shareScope: 'private' }))).toBeNull();
    expect(adaptOffer(item({ status: 'draft', shareScope: 'private' }))).toBeNull();
  });

  it('on her own resources only once approved (she edits the others)', () => {
    expect(adaptOffer(item({ mine: true, canEdit: false }))).toBe('offer');
    expect(
      adaptOffer(item({ status: 'draft', shareScope: 'private', mine: true, canEdit: true })),
    ).toBeNull();
  });

  it('says so when the licence forbids it', () => {
    expect(adaptOffer(item({ noDerivatives: true }))).toBe('licence');
    expect(adaptOffer(item({ noDerivatives: true, status: 'archived' }))).toBeNull();
  });

  it('asks for opinions on board-approved resources the user did not write', () => {
    expect(canGiveOpinion(item())).toBe(true);
    expect(canGiveOpinion(item({ mine: true }))).toBe(false);
    expect(canGiveOpinion(item({ status: 'teacher_reviewed', shareScope: 'school' }))).toBe(false);
  });

  it('knows which resources the user can use', () => {
    expect(usableItem(item({ status: 'draft', shareScope: 'private', mine: true }))).toBe(true);
    expect(usableItem(item({ status: 'rejected', shareScope: 'private' }))).toBe(false);
  });
});

describe('allowedScopes (D-092)', () => {
  it('keeps a capped adaptation within its school', () => {
    expect(allowedScopes(ID)).toEqual({ scopes: ['private', 'school'], schoolIds: [ID] });
    expect(allowedScopes(null)).toEqual({
      scopes: ['private', 'school', 'board'],
      schoolIds: null,
    });
  });
});

describe('newUuid', () => {
  it('makes version 4 UUIDs, with or without crypto.randomUUID', () => {
    const v4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(newUuid()).toMatch(v4);
    const randomUUID = crypto.randomUUID;
    try {
      Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
      const ids = new Set(Array.from({ length: 20 }, () => newUuid()));
      expect(ids.size).toBe(20);
      for (const id of ids) expect(id).toMatch(v4);
    } finally {
      Object.defineProperty(crypto, 'randomUUID', { value: randomUUID, configurable: true });
    }
  });
});

describe('statsIds', () => {
  it('asks once per item, for well-formed ids, 50 at most', () => {
    expect(statsIds([ID, ID, 'nope', OTHER])).toEqual([ID, OTHER]);
    const many = Array.from(
      { length: 60 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    expect(statsIds(many)).toHaveLength(MAX_STATS_ITEMS);
  });
});
