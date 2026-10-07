import { BUCKET_LABELS_FR, LIBRARY_BUCKETS, LIBRARY_ITEM_TYPES, TYPE_INFO } from '@lynx/content';
import { describe, expect, it } from 'vitest';
import en from '../../../messages/en-CA.json';
import fr from '../../../messages/fr-CA.json';
import {
  itemBadges,
  libraryAccess,
  parsePrintParams,
  printHref,
  selectVersions,
  versionOrder,
  type BadgeInput,
} from './view-model';

const BOARD = 'b0000000-0000-4000-8000-000000000001';
const OTHER_BOARD = 'b0000000-0000-4000-8000-000000000002';
const ME = 'd0000000-0000-4000-8000-000000000001';
const SOMEONE = 'd0000000-0000-4000-8000-000000000002';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('the order and numbers of versions', () => {
  it('puts the base version first, then board levels, personal levels and unknown levels', () => {
    const ordered = versionOrder([
      { id: id(5), languageLevelId: 'unknown', level: null },
      { id: id(4), languageLevelId: 'enrichi', level: { sortOrder: 40, personal: false } },
      { id: id(3), languageLevelId: 'mine', level: { sortOrder: 5, personal: true } },
      { id: id(2), languageLevelId: 'debutant', level: { sortOrder: 10, personal: false } },
      { id: id(1), languageLevelId: null, level: null },
    ]);
    expect(ordered.map((v) => [v.languageLevelId, v.number])).toEqual([
      [null, 1],
      ['debutant', 2],
      ['enrichi', 3],
      ['mine', 4],
      ['unknown', 5],
    ]);
  });

  it('never depends on the order rows arrive in', () => {
    const versions = [
      { id: id(9), languageLevelId: 'a', level: { sortOrder: 10, personal: false } },
      { id: id(8), languageLevelId: 'b', level: { sortOrder: 10, personal: false } },
      { id: id(7), languageLevelId: null, level: null },
    ];
    const once = versionOrder(versions).map((v) => v.id);
    expect(versionOrder([...versions].reverse()).map((v) => v.id)).toEqual(once);
    expect(once).toEqual([id(7), id(8), id(9)]);
  });
});

describe('what the screens offer', () => {
  const item = (over: Partial<Parameters<typeof libraryAccess>[0]> = {}) => ({
    boardId: BOARD,
    authorId: ME,
    boardOwned: false,
    status: 'draft' as const,
    ...over,
  });
  const contentReviewer = [{ boardId: BOARD, approvesContent: true, reviewsFaith: false }];

  it('lets the author edit until the board approves', () => {
    for (const status of ['draft', 'teacher_reviewed', 'rejected'] as const) {
      expect(libraryAccess(item({ status }), ME, []).canEdit, status).toBe(true);
    }
    for (const status of ['board_approved', 'archived'] as const) {
      const access = libraryAccess(item({ status }), ME, []);
      expect(access.canEdit, status).toBe(false);
      // Still the item's keeper (archive, restore).
      expect(access.keeper).toBe(true);
    }
  });

  it('never lets a colleague edit, whatever they review', () => {
    const access = libraryAccess(item({ authorId: SOMEONE }), ME, contentReviewer);
    expect(access).toEqual({
      mine: false,
      keeper: false,
      canEdit: false,
      reviewerKinds: ['content'],
    });
  });

  it('lets content reviewers keep the board’s own items, not faith reviewers', () => {
    const board = item({ authorId: null, boardOwned: true });
    expect(libraryAccess(board, ME, contentReviewer).canEdit).toBe(true);
    const faithOnly = [{ boardId: BOARD, approvesContent: false, reviewsFaith: true }];
    expect(libraryAccess(board, ME, faithOnly)).toEqual({
      mine: false,
      keeper: false,
      canEdit: false,
      reviewerKinds: ['faith'],
    });
    // A reviewer of another board is nobody here.
    const elsewhere = [{ boardId: OTHER_BOARD, approvesContent: true, reviewsFaith: true }];
    expect(libraryAccess(board, ME, elsewhere).reviewerKinds).toEqual([]);
    expect(libraryAccess(board, ME, elsewhere).canEdit).toBe(false);
  });

  it('never gives a reviewer an item whose author was deleted (not the board’s, D-091)', () => {
    const orphan = item({ authorId: null, boardOwned: false });
    expect(libraryAccess(orphan, ME, contentReviewer)).toMatchObject({
      keeper: false,
      canEdit: false,
    });
  });
});

describe('badges', () => {
  const input = (over: Partial<BadgeInput> = {}): BadgeInput => ({
    type: 'reading_passage',
    status: 'board_approved',
    requested: false,
    source: 'board_created',
    subFriendly: false,
    requiresFaithReview: false,
    levelCount: 0,
    ...over,
  });
  const keys = (i: BadgeInput, withStatus = true) =>
    itemBadges(i, { withStatus }).map((b) => b.key);

  it('shows approval first, then the substitute, levels, AI and faith badges', () => {
    const badges = itemBadges(
      input({
        subFriendly: true,
        levelCount: 4,
        source: 'ai_generated',
        requiresFaithReview: true,
      }),
      { withStatus: true },
    );
    expect(badges.map((b) => b.key)).toEqual(['approved', 'subFriendly', 'levels', 'ai', 'faith']);
    expect(badges.find((b) => b.key === 'levels')?.count).toBe(4);
  });

  it('says « Version de base seulement » only for types that have levels', () => {
    expect(keys(input({ type: 'reading_passage' }))).toContain('baseOnly');
    expect(keys(input({ type: 'rubric' }))).not.toContain('baseOnly');
    expect(keys(input({ type: 'brain_break' }))).not.toContain('baseOnly');
  });

  it('shows the workflow status when asked', () => {
    expect(keys(input({ status: 'draft' }))).toEqual(['draft', 'baseOnly']);
    expect(keys(input({ status: 'teacher_reviewed', requested: true }))).toEqual([
      'teacher_reviewed',
      'requested',
      'baseOnly',
    ]);
    expect(keys(input({ status: 'rejected' }), false)).toEqual(['baseOnly']);
    // « Approuvée par le conseil » is shown either way, once.
    expect(keys(input(), false)).toEqual(['approved', 'baseOnly']);
    expect(keys(input(), true)).toEqual(['approved', 'baseOnly']);
  });

  it('has a message for every badge and status', () => {
    const all = itemBadges(
      input({
        status: 'teacher_reviewed',
        requested: true,
        subFriendly: true,
        levelCount: 2,
        source: 'ai_generated',
        requiresFaithReview: true,
      }),
      { withStatus: true },
    );
    for (const badge of all) {
      const inStatus = badge.key in fr.libraryCommon.status;
      const inBadges = badge.key in fr.libraryCommon.badges;
      expect(inStatus || inBadges || badge.key === 'requested', badge.key).toBe(true);
    }
    for (const status of ['draft', 'teacher_reviewed', 'board_approved', 'rejected', 'archived']) {
      expect(fr.libraryCommon.status).toHaveProperty(status);
    }
  });
});

describe('the print page’s address', () => {
  it('round-trips the document and the versions', () => {
    const href = printHref('item-1', 'teacher', [id(1), id(2)]);
    expect(href).toBe(`/library/items/item-1/print?doc=teacher&v=${id(1)},${id(2)}`);
    const params = Object.fromEntries(new URL(href, 'http://x').searchParams);
    expect(parsePrintParams(params)).toEqual({ doc: 'teacher', versionIds: [id(1), id(2)] });
    expect(printHref('item-1', 'student')).toBe('/library/items/item-1/print?doc=student');
  });

  it('drops what is not an id, and reads repeated values', () => {
    expect(parsePrintParams({ doc: 'answers', v: `${id(1)},nope,${id(1)}` })).toEqual({
      doc: 'student',
      versionIds: [id(1)],
    });
    expect(parsePrintParams({ v: [id(2), id(3).toUpperCase()] }).versionIds).toEqual([
      id(2),
      id(3),
    ]);
    expect(parsePrintParams({})).toEqual({ doc: 'student', versionIds: [] });
  });

  it('prints the chosen versions of the item, else all of them', () => {
    const versions = [{ id: id(1) }, { id: id(2) }, { id: id(3) }];
    expect(selectVersions(versions, [id(3), id(1)]).map((v) => v.id)).toEqual([id(1), id(3)]);
    expect(selectVersions(versions, [id(9)])).toEqual(versions);
    expect(selectVersions(versions, [])).toEqual(versions);
  });
});

describe('library labels', () => {
  it('names every type as the catalogue does, in both languages', () => {
    for (const type of LIBRARY_ITEM_TYPES) {
      expect(fr.libraryCommon.types[type], type).toBe(TYPE_INFO[type].labelFr);
      expect(en.libraryCommon.types[type], type).toBeTruthy();
      expect(fr.libraryCommon.typeHints[type], type).toBeTruthy();
    }
    for (const bucket of LIBRARY_BUCKETS) {
      expect(fr.libraryCommon.buckets[bucket], bucket).toBe(BUCKET_LABELS_FR[bucket]);
    }
  });
});
