import { describe, expect, it } from 'vitest';
import type { LibraryItemType } from './catalog';
import { reviewReadiness, type ReadinessInput, type ReadinessVersion } from './readiness';
import { sampleCanonical, sampleSafetyNotes } from './samples';

const LEVELS = ['level-debutant', 'level-intermediaire', 'level-avance', 'level-enrichi'];

function input(
  type: LibraryItemType,
  overrides: Partial<ReadinessInput['item']> = {},
  versions?: ReadinessVersion[],
  forApproval = false,
): ReadinessInput {
  const { content, answerKey } = sampleCanonical(type);
  return {
    item: {
      type,
      gradeCodes: ['3'],
      subjectId: 'subject',
      durationMinutes: 30,
      materials: 'Crayons',
      keywords: 'nombres',
      tagIds: [],
      expectationIds: ['exp'],
      safetyNotes: null,
      subFriendly: false,
      ...overrides,
    },
    versions: versions ?? [{ languageLevelId: null, content, answerKey }],
    boardLevelIds: LEVELS,
    forApproval,
  };
}

const codes = (i: ReadinessInput) => reviewReadiness(i).blocking.map((b) => b.code);
const warnings = (i: ReadinessInput) => reviewReadiness(i).warnings.map((w) => w.code);

describe('readiness', () => {
  it('39. reports each blocking code; some types need no attente', () => {
    expect(reviewReadiness(input('quiz')).ready).toBe(true);
    expect(codes(input('quiz', { gradeCodes: [] }))).toEqual(['grades']);
    expect(codes(input('quiz', { subjectId: null }))).toEqual(['subject']);
    expect(codes(input('quiz', { durationMinutes: null }))).toEqual(['duration']);
    expect(codes(input('quiz', { materials: '  ' }))).toEqual(['materials']);
    expect(codes(input('quiz', { keywords: null }))).toEqual(['tags']);
    expect(codes(input('quiz', { keywords: null, tagIds: ['tag'] }))).toEqual([]);
    expect(codes(input('quiz', { expectationIds: [] }))).toEqual(['expectations']);
    const { content, answerKey } = sampleCanonical('quiz');
    expect(codes(input('quiz', {}, [{ languageLevelId: 'l1', content, answerKey }]))).toEqual([
      'base',
    ]);
    for (const type of ['brain_break', 'song', 'culture_hook', 'catholic_reflection'] as const) {
      expect(reviewReadiness(input(type, { expectationIds: [] })).ready, type).toBe(true);
    }
  });

  it('40. a keyed type without a key blocks; an empty sample answer only warns', () => {
    const { content, answerKey } = sampleCanonical('quiz');
    const noKey = input('quiz', {}, [{ languageLevelId: null, content, answerKey: null }]);
    expect(reviewReadiness(noKey).blocking).toContainEqual({
      code: 'key',
      versionIndex: 0,
      keyIssue: 'missingKey',
    });
    const incomplete = {
      ...answerKey!,
      answers: answerKey!.answers.filter((a) => a.questionId !== 'tf1'),
    };
    expect(
      reviewReadiness(
        input('quiz', {}, [{ languageLevelId: null, content, answerKey: incomplete }]),
      ).blocking,
    ).toContainEqual(
      expect.objectContaining({ code: 'key', keyIssue: 'missingAnswer', questionId: 'tf1' }),
    );
    const noSample = {
      ...answerKey!,
      answers: answerKey!.answers.map((a) =>
        a.kind === 'short_answer' ? { ...a, sampleAnswer: '' } : a,
      ),
    };
    const result = reviewReadiness(
      input('quiz', {}, [{ languageLevelId: null, content, answerKey: noSample }]),
    );
    expect(result.ready).toBe(true);
    expect(result.warnings).toContainEqual({
      code: 'sampleAnswer',
      versionIndex: 0,
      questionId: 'sa1',
    });
  });

  it('41. incomplete safety notes block', () => {
    expect(codes(input('experiment'))).toEqual(['safety']);
    expect(
      codes(
        input('experiment', { safetyNotes: { ...sampleSafetyNotes(), allergyAwareMaterials: '' } }),
      ),
    ).toEqual(['safety']);
    expect(codes(input('experiment', { safetyNotes: sampleSafetyNotes() }))).toEqual([]);
    expect(codes(input('stem_challenge', { safetyNotes: { supervision: 'close' } }))).toEqual([
      'safety',
    ]);
  });

  it('42. a version failing final blocks, with its index', () => {
    const { content, answerKey } = sampleCanonical('reading_passage');
    const blocking = reviewReadiness(
      input('reading_passage', {}, [
        { languageLevelId: null, content, answerKey },
        { languageLevelId: 'l1', content: { ...content, text: '' }, answerKey },
      ]),
    ).blocking;
    expect(blocking).toEqual([{ code: 'content', versionIndex: 1, path: ['text'] }]);
  });

  it('43. approval needs every board level for some types; others only warn', () => {
    const { content, answerKey } = sampleCanonical('reading_passage');
    const three = [null, ...LEVELS.slice(0, 3)].map((languageLevelId) => ({
      languageLevelId,
      content,
      answerKey,
    }));
    expect(reviewReadiness(input('reading_passage', {}, three, true)).blocking).toEqual([
      { code: 'levels', levelId: 'level-enrichi' },
    ]);
    // Marking reviewed doesn't need levels.
    expect(codes(input('reading_passage', {}, three, false))).toEqual([]);
    const all = [null, ...LEVELS].map((languageLevelId) => ({
      languageLevelId,
      content,
      answerKey,
    }));
    expect(reviewReadiness(input('reading_passage', {}, all, true)).ready).toBe(true);

    const game = reviewReadiness(input('game', {}, undefined, true));
    expect(game.ready).toBe(true);
    expect(game.warnings.map((w) => w.code)).toEqual(['baseOnly']);
    expect(warnings(input('song', {}, undefined, true))).toEqual([]);
  });

  it('warns about a sub-friendly lesson plan without sub notes', () => {
    const { content } = sampleCanonical('lesson_plan');
    const versions = [
      { languageLevelId: null, content: { ...content, subNotes: '' }, answerKey: null },
    ];
    expect(warnings(input('lesson_plan', { subFriendly: true }, versions))).toEqual(['subNotes']);
    expect(warnings(input('lesson_plan', { subFriendly: true }))).toEqual([]);
  });
});
