import { describe, expect, it } from 'vitest';
import {
  emptyAuthoring,
  freshId,
  fromAuthoring,
  newAuthoringQuestion,
  toAuthoring,
  type Authoring,
  type AuthoringQuestion,
} from './authoring';
import { validateAnswerKey } from './answer-key';
import { contentSchema, answerKeySchema } from './schemas';
import { sampleCanonical } from './samples';
import { matchingPermutation, permutationFor, scrambleBySeed, unscramble } from './scramble';
import { KEY_SENTINEL, QUESTION_TYPES } from './test-fixtures';

const base = { hint: '', points: null, category: null, explanation: KEY_SENTINEL };

const QUESTIONS: AuthoringQuestion[] = [
  {
    ...base,
    id: 'q1',
    kind: 'multiple_choice',
    prompt: 'Quel nombre vient après 399?',
    choices: [
      { id: 'c1', text: '398', correct: false },
      { id: 'c2', text: '400', correct: true },
      { id: 'c3', text: '410', correct: false },
    ],
    multipleAnswers: false,
  },
  { ...base, id: 'q2', kind: 'true_false', prompt: '1 000 = 10 centaines.', correct: true },
  {
    ...base,
    id: 'q3',
    kind: 'matching',
    prompt: 'Associe.',
    pairs: [
      { leftId: 'l1', left: '2 centaines', rightId: 'r1', right: '200' },
      { leftId: 'l2', left: '5 dizaines', rightId: 'r2', right: '50' },
      { leftId: 'l3', left: '7 unités', rightId: 'r3', right: '7' },
    ],
    extraRight: [
      { id: 'r4', text: '70' },
      { id: 'r5', text: '500' },
    ],
  },
  {
    ...base,
    id: 'q4',
    kind: 'ordering',
    prompt: 'Place en ordre croissant.',
    items: [
      { id: 'i1', text: '105' },
      { id: 'i2', text: '150' },
      { id: 'i3', text: '501' },
      { id: 'i4', text: '510' },
    ],
  },
  {
    ...base,
    id: 'q5',
    kind: 'short_answer',
    prompt: 'Écris 300 + 20 + 4 en chiffres.',
    lines: 1,
    sampleAnswer: KEY_SENTINEL,
    acceptableAnswers: ['324', KEY_SENTINEL],
  },
];

const quizAuthoring = (): Authoring<'quiz'> => ({
  type: 'quiz',
  content: { ...emptyAuthoring('quiz').content, instructions: 'Réponds.', questions: QUESTIONS },
  solution: KEY_SENTINEL,
});

describe('authoring', () => {
  it('23. the round trip gives the input back', () => {
    const authoring = quizAuthoring();
    const { content, key } = fromAuthoring('quiz', authoring);
    expect(contentSchema('quiz', 'final').safeParse(content).success).toBe(true);
    expect(answerKeySchema('final').safeParse(key).success).toBe(true);
    expect(validateAnswerKey('quiz', content, key)).toEqual([]);
    expect(toAuthoring('quiz', content, key)).toEqual(authoring);

    // Stored samples: content → authoring → content is stable too.
    for (const type of QUESTION_TYPES) {
      const sample = sampleCanonical(type);
      const again = fromAuthoring(type, toAuthoring(type, sample.content, sample.answerKey));
      expect(toAuthoring(type, again.content, again.key), type).toEqual(
        toAuthoring(type, sample.content, sample.answerKey),
      );
      expect(validateAnswerKey(type, again.content, again.key), type).toEqual([]);
    }
  });

  it('24. scrambles deterministically and never keeps the identity when n ≥ 2', () => {
    for (let n = 2; n <= 8; n++) {
      for (let s = 0; s < 200; s++) {
        const seed = `q${s}`;
        const perm = permutationFor(seed, n);
        expect(perm).toEqual(permutationFor(seed, n));
        expect([...perm].sort((a, b) => a - b)).toEqual([...Array(n).keys()]);
        expect(perm.every((v, i) => v === i)).toBe(false);
        for (let pairs = 2; pairs <= n; pairs++) {
          const m = matchingPermutation(seed, n, pairs);
          const paired = m.filter((from) => from < pairs);
          expect(paired.every((v, i) => v === i)).toBe(false);
        }
      }
    }
    expect(permutationFor('q1', 1)).toEqual([0]);
    const items = ['a', 'b', 'c', 'd', 'e'];
    const display = scrambleBySeed(items, 'q7');
    expect(unscramble(display, permutationFor('q7', 5))).toEqual(items);
  });

  it('25. content never holds answers', () => {
    const { content, key } = fromAuthoring('quiz', quizAuthoring());
    const json = JSON.stringify(content);
    expect(json).not.toContain(KEY_SENTINEL);
    for (const k of [
      '"correct"',
      'correctChoiceIds',
      'pairs',
      'orderedIds',
      'sampleAnswer',
      'solution',
    ]) {
      expect(json).not.toContain(k);
    }
    expect(JSON.stringify(key)).toContain(KEY_SENTINEL);
    // The ordering items are not stored in the answer order.
    const ordering = content.questions.find((q) => q.kind === 'ordering')!;
    expect(ordering.kind === 'ordering' && ordering.items.map((i) => i.id)).not.toEqual([
      'i1',
      'i2',
      'i3',
      'i4',
    ]);
  });

  it('gives a key only where one belongs', () => {
    expect(fromAuthoring('quiz', emptyAuthoring('quiz')).key).toEqual({
      answers: [],
      solution: '',
    });
    expect(fromAuthoring('worksheet', emptyAuthoring('worksheet')).key).toBeNull();
    expect(fromAuthoring('song', { ...emptyAuthoring('song'), solution: 'x' }).key).toBeNull();
    expect(
      fromAuthoring('weekly_challenge', { ...emptyAuthoring('weekly_challenge'), solution: '42' })
        .key,
    ).toEqual({ answers: [], solution: '42' });
  });

  it('makes new questions with fresh ids', () => {
    expect(freshId('q', ['q1', 'q2', 'q4'])).toBe('q3');
    for (const kind of [
      'multiple_choice',
      'true_false',
      'matching',
      'ordering',
      'short_answer',
    ] as const) {
      const question = newAuthoringQuestion(kind, ['q1']);
      expect(question.id).toBe('q2');
      expect(question.kind).toBe(kind);
      const authoring = {
        ...emptyAuthoring('quiz'),
        content: { ...emptyAuthoring('quiz').content, questions: [question] },
      };
      const { content } = fromAuthoring('quiz', authoring);
      expect(contentSchema('quiz', 'draft').safeParse(content).success, kind).toBe(true);
    }
  });
});
