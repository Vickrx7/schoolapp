import { describe, expect, it } from 'vitest';
import { validateAnswerKey } from './answer-key';
import type { AnswerEntry, AnswerKey } from './questions';
import { sampleCanonical } from './samples';

const quiz = sampleCanonical('quiz');
const content = quiz.content;
const key = quiz.answerKey!;

const withEntry = (questionId: string, entry: Partial<AnswerEntry> | null): AnswerKey => ({
  ...key,
  answers: key.answers.flatMap((a) =>
    a.questionId !== questionId ? [a] : entry ? [{ ...a, ...entry } as AnswerEntry] : [],
  ),
});
const codes = (k: AnswerKey | null, c: unknown = content) =>
  validateAnswerKey('quiz', c, k).map((i) => `${i.code}@${i.path.join('.')}`);

describe('answer-key', () => {
  it('accepts the sample key', () => {
    expect(validateAnswerKey('quiz', content, key)).toEqual([]);
  });

  it('18. reports a missing entry, a wrong kind and an unknown question', () => {
    expect(codes(withEntry('tf1', null))).toEqual(['missingAnswer@answers']);
    expect(codes(withEntry('tf1', { kind: 'short_answer' }))).toEqual(['wrongKind@answers.1.kind']);
    const extra: AnswerKey = {
      ...key,
      answers: [
        ...key.answers,
        { questionId: 'zz', kind: 'true_false', correct: true, explanation: '' },
      ],
    };
    expect(codes(extra)).toEqual(['unknownQuestion@answers.5.questionId']);
    const twice: AnswerKey = { ...key, answers: [...key.answers, key.answers[1]!] };
    expect(codes(twice)).toEqual(['duplicateAnswer@answers.5.questionId']);
    // No key at all: every question is missing its answer.
    expect(codes(null)).toHaveLength(content.questions.length);
  });

  it('19. reports unknown choices, and several correct choices without multipleAnswers', () => {
    expect(codes(withEntry('mc1', { correctChoiceIds: ['c9'] }))).toEqual([
      'unknownChoice@answers.0.correctChoiceIds.0',
    ]);
    expect(codes(withEntry('mc1', { correctChoiceIds: ['c1', 'c2'] }))).toEqual([
      'tooManyCorrect@answers.0.correctChoiceIds',
    ]);
    expect(codes(withEntry('mc1', { correctChoiceIds: [] }))).toEqual([
      'noCorrectChoice@answers.0.correctChoiceIds',
    ]);
    const several = {
      ...content,
      questions: content.questions.map((q) =>
        q.kind === 'multiple_choice' ? { ...q, multipleAnswers: true } : q,
      ),
    };
    expect(codes(withEntry('mc1', { correctChoiceIds: ['c1', 'c2'] }), several)).toEqual([]);
  });

  it('20. pairs every left item exactly once in matching; extra right items are fine', () => {
    // The sample has 2 left items and 3 right items (one extra).
    expect(codes(withEntry('ma1', { pairs: [{ leftId: 'l1', rightId: 'r1' }] }))).toEqual([
      'unpairedLeft@questions.2.left.1',
    ]);
    expect(
      codes(
        withEntry('ma1', {
          pairs: [
            { leftId: 'l1', rightId: 'r1' },
            { leftId: 'l1', rightId: 'r2' },
            { leftId: 'l2', rightId: 'r2' },
          ],
        }),
      ),
    ).toEqual([
      'duplicateLeft@answers.2.pairs.1.leftId',
      'duplicateRight@answers.2.pairs.2.rightId',
    ]);
    expect(
      codes(
        withEntry('ma1', {
          pairs: [
            { leftId: 'l1', rightId: 'r9' },
            { leftId: 'l2', rightId: 'r2' },
          ],
        }),
      ),
    ).toEqual(['unknownRight@answers.2.pairs.0.rightId']);
  });

  it('21. needs a permutation for ordering, different from the display order', () => {
    expect(codes(withEntry('or1', { orderedIds: ['i1', 'i2'] }))).toEqual([
      'notPermutation@answers.3.orderedIds',
    ]);
    expect(codes(withEntry('or1', { orderedIds: ['i1', 'i1', 'i2'] }))).toEqual([
      'notPermutation@answers.3.orderedIds',
    ]);
    const ordering = content.questions.find((q) => q.kind === 'ordering')!;
    const display = ordering.kind === 'ordering' ? ordering.items.map((i) => i.id) : [];
    expect(codes(withEntry('or1', { orderedIds: display }))).toEqual([
      'orderGivesAnswer@answers.3.orderedIds',
    ]);
  });

  it('22. reports duplicate ids across unit test sections', () => {
    const test = sampleCanonical('unit_test');
    expect(validateAnswerKey('unit_test', test.content, test.answerKey)).toEqual([]);
    const [a, b] = test.content.sections;
    const duplicated = {
      ...test.content,
      sections: [a!, { ...b!, questions: [...b!.questions, { ...a!.questions[0]! }] }],
    };
    const issues = validateAnswerKey('unit_test', duplicated, test.answerKey);
    expect(issues).toContainEqual({
      code: 'duplicateQuestionId',
      where: 'content',
      path: ['sections', 1, 'questions', 1, 'id'],
      questionId: 'mc1',
    });
  });

  it('reports duplicate option ids within a question', () => {
    const duplicated = {
      ...content,
      questions: content.questions.map((q) =>
        q.kind === 'multiple_choice'
          ? { ...q, choices: [...q.choices, { id: q.choices[0]!.id, text: 'autre' }] }
          : q,
      ),
    };
    expect(codes(key, duplicated)).toEqual(['duplicateOptionId@questions.0.choices.3.id']);
  });
});
