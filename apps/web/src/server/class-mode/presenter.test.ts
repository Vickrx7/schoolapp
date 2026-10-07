/**
 * « Présenter à la classe » (DECISIONS D-082, D-086): who may present what, which version and
 * slide the projector opens on, and what « Afficher la réponse » may return. The key must never
 * reach the projector page, and a reveal returns one question's answer and nothing else.
 */
import {
  LIBRARY_ITEM_TYPES,
  PRESENT_KIND,
  TYPE_INFO,
  mapQuestions,
  sampleCanonical,
  type LibraryItemType,
} from '@lynx/content';
import { describe, expect, it } from 'vitest';
import {
  buildPresentation,
  isPresentable,
  presentedQuestionIds,
  presenterAnswer,
  presenterHref,
  slideIndex,
  type PresentableInput,
  type PresenterSource,
} from './presenter';

const KEY_SENTINEL = 'SENTINELLE-CORRIGE';
const TEACHER_SENTINEL = 'SENTINELLE-ENSEIGNANT';

const ITEM = '0b88457b-f048-5e6e-9563-de1f91788e16';
const BASE = '11111111-1111-4111-8111-111111111111';
const LEVEL = '22222222-2222-4222-8222-222222222222';

function source(type: LibraryItemType, overrides: Partial<PresenterSource> = {}): PresenterSource {
  const { content } = sampleCanonical(type);
  return {
    id: ITEM,
    type,
    title: 'Titre de la ressource',
    projectable: false,
    status: 'board_approved',
    shareScope: 'board',
    mine: false,
    materials: 'Une éponge par équipe.',
    durationMinutes: 20,
    subjectCode: 'mat',
    versions: [
      { id: BASE, schemaVersion: 1, content, hasKey: true },
      {
        id: LEVEL,
        schemaVersion: 1,
        content: { ...(content as Record<string, unknown>), title: 'Version adaptée' },
        hasKey: false,
      },
    ],
    ...overrides,
  };
}

/**
 * Content with key-shaped fields planted where they don't belong: in every question, and at the
 * top with the teacher's note and safety-note fields.
 */
function withSentinels(type: LibraryItemType): Record<string, unknown> {
  const content = mapQuestions(type, sampleCanonical(type).content, (q) => ({
    ...q,
    category: TEACHER_SENTINEL,
    correctChoiceIds: [KEY_SENTINEL],
    correct: KEY_SENTINEL,
    pairs: [{ leftId: KEY_SENTINEL, rightId: KEY_SENTINEL }],
    orderedIds: [KEY_SENTINEL],
    sampleAnswer: KEY_SENTINEL,
    acceptableAnswers: [KEY_SENTINEL],
    explanation: KEY_SENTINEL,
  })) as Record<string, unknown>;
  return {
    ...content,
    teacherNote: TEACHER_SENTINEL,
    answerKey: { answers: [], solution: KEY_SENTINEL },
    solution: KEY_SENTINEL,
    safetyNotes: { hazards: [KEY_SENTINEL], notes: KEY_SENTINEL },
    safety_notes: KEY_SENTINEL,
  };
}

describe('who may present what', () => {
  const base: PresentableInput = {
    type: 'quiz',
    projectable: false,
    status: 'board_approved',
    shareScope: 'board',
    mine: false,
  };

  it('offers the special players, and projectable items of other types', () => {
    expect(isPresentable(base)).toBe(true);
    for (const type of Object.keys(PRESENT_KIND) as LibraryItemType[]) {
      expect(isPresentable({ ...base, type }), type).toBe(true);
    }
    expect(isPresentable({ ...base, type: 'song' })).toBe(false);
    expect(isPresentable({ ...base, type: 'song', projectable: true })).toBe(true);
    // Teacher-only types have nothing to project, even marked projectable.
    expect(isPresentable({ ...base, type: 'lesson_plan', projectable: true })).toBe(false);
    expect(isPresentable({ ...base, type: 'teacher_guide', projectable: true })).toBe(false);
  });

  it('needs an item the teacher can use in class (as « Ajouter à ma planification »)', () => {
    // Her own, at any status but archived.
    for (const status of ['draft', 'teacher_reviewed', 'rejected', 'board_approved'] as const) {
      expect(isPresentable({ ...base, mine: true, status, shareScope: 'private' }), status).toBe(
        true,
      );
    }
    expect(isPresentable({ ...base, mine: true, status: 'archived' })).toBe(false);
    // A colleague's: reviewed or approved, and shared.
    expect(isPresentable({ ...base, status: 'teacher_reviewed', shareScope: 'school' })).toBe(true);
    expect(isPresentable({ ...base, status: 'teacher_reviewed', shareScope: 'private' })).toBe(
      false,
    );
    // A reviewer reading a colleague's draft or a board draft does not present it.
    expect(isPresentable({ ...base, status: 'draft', shareScope: 'private' })).toBe(false);
    expect(isPresentable({ ...base, status: 'rejected', shareScope: 'school' })).toBe(false);
    expect(isPresentable({ ...base, status: 'archived' })).toBe(false);
  });
});

describe('the projector address', () => {
  it('carries the version and the slide (from 1)', () => {
    expect(presenterHref(ITEM)).toBe(`/projector/items/${ITEM}`);
    expect(presenterHref(ITEM, BASE)).toBe(`/projector/items/${ITEM}?v=${BASE}`);
    expect(presenterHref(ITEM, BASE, 3)).toBe(`/projector/items/${ITEM}?v=${BASE}&s=3`);
    expect(presenterHref(ITEM, 'pas-un-id', 1)).toBe(`/projector/items/${ITEM}`);
  });

  it('reads the slide within the presentation', () => {
    expect(slideIndex(undefined, 5)).toBe(0);
    expect(slideIndex('1', 5)).toBe(0);
    expect(slideIndex('3', 5)).toBe(2);
    expect(slideIndex('99', 5)).toBe(4);
    expect(slideIndex('0', 5)).toBe(0);
    expect(slideIndex('-2', 5)).toBe(0);
    expect(slideIndex('deux', 5)).toBe(0);
    expect(slideIndex('3', 0)).toBe(0);
  });
});

describe('the presentation', () => {
  it('opens the base version by default, the version asked for otherwise', () => {
    const quiz = source('quiz');
    const base = buildPresentation(quiz, {})!;
    expect(base.versionId).toBe(BASE);
    expect(base.title).toBe('Titre de la ressource');
    expect(base.hasKey).toBe(true);
    expect(base.slides[0]?.kind).toBe('title');
    expect(base.slides.at(-1)?.kind).toBe('end');

    const level = buildPresentation(quiz, { versionId: LEVEL.toUpperCase() })!;
    expect(level.versionId).toBe(LEVEL);
    expect(level.title).toBe('Version adaptée');
    expect(level.hasKey).toBe(false);

    // A version of another item (or none that can be read) falls back to the base version.
    expect(buildPresentation(quiz, { versionId: ITEM })!.versionId).toBe(BASE);
    expect(buildPresentation({ ...quiz, versions: [] }, {})).toBeNull();
    // A teacher-only type has no slides.
    expect(buildPresentation(source('lesson_plan', { projectable: true }), {})).toBeNull();
  });

  it('opens on the slide asked for, within the presentation', () => {
    const quiz = source('quiz');
    const total = buildPresentation(quiz, {})!.slides.length;
    expect(buildPresentation(quiz, { slide: '3' })!.index).toBe(2);
    expect(buildPresentation(quiz, { slide: String(total + 10) })!.index).toBe(total - 1);
  });

  it('projects Anglais in English and everything else in French', () => {
    expect(buildPresentation(source('quiz', { subjectCode: 'ang' }), {})!.lang).toBe('en-CA');
    expect(buildPresentation(source('quiz', { subjectCode: 'fra' }), {})!.lang).toBe('fr-CA');
    expect(buildPresentation(source('quiz', { subjectCode: null }), {})!.lang).toBe('fr-CA');
  });

  it('says when stored content cannot be read', () => {
    const quiz = source('quiz');
    const older = { ...quiz, versions: [{ ...quiz.versions[0]!, schemaVersion: 2 }] };
    const presentation = buildPresentation(older, {})!;
    expect(presentation.partial).toBe(true);
    expect(presentation.slides.map((s) => s.kind)).toEqual(['title', 'end']);
    expect(buildPresentation(quiz, {})!.partial).toBe(false);
  });

  it('never carries a key, a teacher-only field or a safety note, for any type', () => {
    for (const type of LIBRARY_ITEM_TYPES) {
      if (TYPE_INFO[type].audience === 'teacher') continue;
      const presentation = buildPresentation(
        source(type, {
          projectable: true,
          versions: [{ id: BASE, schemaVersion: 1, content: withSentinels(type), hasKey: true }],
        }),
        {},
      )!;
      const json = JSON.stringify(presentation);
      expect(json, type).not.toContain(KEY_SENTINEL);
      expect(json, type).not.toContain(TEACHER_SENTINEL);
    }
  });
});

describe('« Afficher la réponse »', () => {
  const quiz = sampleCanonical('quiz');
  const version = { schemaVersion: 1, content: quiz.content };

  it('returns one question’s answer and explanation, nothing else of the key', () => {
    const answer = presenterAnswer('quiz', version, quiz.answerKey, 'mc1');
    expect(answer).toEqual({
      kind: 'multiple_choice',
      correctChoiceIds: ['c1'],
      explanation: '893 a 8 centaines; 389 et 398 en ont seulement 3.',
    });
    expect(presenterAnswer('quiz', version, quiz.answerKey, 'tf1')).toEqual({
      kind: 'true_false',
      correct: true,
      explanation: '',
    });
    expect(presenterAnswer('quiz', version, quiz.answerKey, 'ma1')).toEqual({
      kind: 'matching',
      pairs: [
        { leftId: 'l1', rightId: 'r1' },
        { leftId: 'l2', rightId: 'r2' },
      ],
      explanation: '',
    });
    expect(presenterAnswer('quiz', version, quiz.answerKey, 'or1')).toEqual({
      kind: 'ordering',
      orderedIds: ['i1', 'i2', 'i3'],
      explanation: '',
    });
    expect(presenterAnswer('quiz', version, quiz.answerKey, 'sa1')).toMatchObject({
      kind: 'short_answer',
      acceptableAnswers: [],
    });
  });

  it('leaves out the other questions, the solution and anything unknown in the key', () => {
    const key = quiz.answerKey!;
    const planted = {
      solution: KEY_SENTINEL,
      extra: KEY_SENTINEL,
      answers: key.answers.map((entry) =>
        entry.questionId === 'mc1'
          ? { ...entry, secret: KEY_SENTINEL, sampleAnswer: KEY_SENTINEL }
          : { ...entry, explanation: KEY_SENTINEL },
      ),
    };
    const answer = presenterAnswer('quiz', version, planted, 'mc1');
    expect(answer).toMatchObject({ kind: 'multiple_choice', correctChoiceIds: ['c1'] });
    expect(JSON.stringify(answer)).not.toContain(KEY_SENTINEL);
    expect(Object.keys(answer!).sort()).toEqual(['correctChoiceIds', 'explanation', 'kind']);
  });

  it('answers only questions on a question slide', () => {
    expect(presenterAnswer('quiz', version, quiz.answerKey, 'inconnue')).toBeNull();
    // A projectable worksheet is shown as its document: no « Afficher la réponse ».
    const worksheet = sampleCanonical('worksheet');
    const sheet = { schemaVersion: 1, content: worksheet.content };
    expect(presentedQuestionIds('worksheet', sheet)).toEqual([]);
    expect(presenterAnswer('worksheet', sheet, worksheet.answerKey, 'mc1')).toBeNull();
    // An experiment's conclusion questions and a game's questions are on question slides.
    const experiment = sampleCanonical('experiment');
    const lab = { schemaVersion: 1, content: experiment.content };
    expect(presentedQuestionIds('experiment', lab)).toEqual(['sa3']);
    expect(presenterAnswer('experiment', lab, experiment.answerKey, 'sa3')).toMatchObject({
      kind: 'short_answer',
    });
    const game = sampleCanonical('game');
    expect(
      presenterAnswer('game', { schemaVersion: 1, content: game.content }, game.answerKey, 'tf1'),
    ).toMatchObject({ kind: 'true_false' });
  });

  it('has nothing to show without a key entry of the question’s kind', () => {
    expect(presenterAnswer('quiz', version, null, 'mc1')).toBeNull();
    expect(presenterAnswer('quiz', version, 'pas une clé', 'mc1')).toBeNull();
    expect(presenterAnswer('quiz', version, { answers: [], solution: '' }, 'mc1')).toBeNull();
    const wrongKind = {
      answers: [{ questionId: 'mc1', kind: 'true_false', correct: true, explanation: '' }],
      solution: '',
    };
    expect(presenterAnswer('quiz', version, wrongKind, 'mc1')).toBeNull();
    // A version the renderers cannot read has no question slide.
    expect(
      presenterAnswer('quiz', { schemaVersion: 2, content: quiz.content }, quiz.answerKey, 'mc1'),
    ).toBeNull();
  });
});
