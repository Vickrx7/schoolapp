import { describe, expect, it } from 'vitest';
import { answerFor } from './answer-key';
import { gradeAll, gradeQuestion, normalizeAnswer } from './grading';
import type { Question } from './questions';
import { sampleCanonical } from './samples';

const { content, answerKey } = sampleCanonical('quiz');
const question = (kind: Question['kind']) => content.questions.find((q) => q.kind === kind)!;
const grade = (kind: Question['kind'], response: Parameters<typeof gradeQuestion>[2]) => {
  const q = question(kind);
  return gradeQuestion(q, answerFor(answerKey, q.id), response);
};

describe('grading', () => {
  it('26. grades every kind; matching gives partial credit', () => {
    expect(grade('multiple_choice', { kind: 'multiple_choice', choiceIds: ['c1'] })).toEqual({
      score: 1,
      max: 1,
      correct: true,
    });
    expect(
      grade('multiple_choice', { kind: 'multiple_choice', choiceIds: ['c1', 'c2'] }).correct,
    ).toBe(false);
    expect(grade('true_false', { kind: 'true_false', value: true }).correct).toBe(true);
    expect(grade('true_false', { kind: 'true_false', value: false }).score).toBe(0);
    expect(grade('ordering', { kind: 'ordering', orderedIds: ['i1', 'i2', 'i3'] }).correct).toBe(
      true,
    );
    expect(grade('ordering', { kind: 'ordering', orderedIds: ['i2', 'i1', 'i3'] })).toEqual({
      score: 0,
      max: 1,
      correct: false,
    });
    // Matching: one point per pair (2 pairs, points not set).
    expect(grade('matching', { kind: 'matching', pairs: { l1: 'r1', l2: 'r2' } })).toEqual({
      score: 2,
      max: 2,
      correct: true,
    });
    expect(grade('matching', { kind: 'matching', pairs: { l1: 'r1', l2: 'r3' } })).toEqual({
      score: 1,
      max: 2,
      correct: false,
    });
    // No response, or a response of another kind, is wrong.
    expect(grade('true_false', null).correct).toBe(false);
    expect(grade('true_false', { kind: 'ordering', orderedIds: [] }).correct).toBe(false);
    // No key entry: nothing can be said.
    expect(
      gradeQuestion(question('true_false'), undefined, { kind: 'true_false', value: true }),
    ).toEqual({
      score: 0,
      max: 1,
      correct: null,
    });
  });

  it('27. normalizes answers', () => {
    expect(normalizeAnswer('Mille')).toBe(normalizeAnswer('mille'));
    for (const space of [' ', '\u00a0', '\u202f']) {
      expect(normalizeAnswer(`1${space}000`)).toBe('1000');
    }
    expect(normalizeAnswer('1 000 000')).toBe('1000000');
    expect(normalizeAnswer('0,5')).toBe(normalizeAnswer('0.5'));
    expect(normalizeAnswer('¾')).toBe('3/4');
    expect(normalizeAnswer('2¾')).toBe('2 3/4');
    expect(normalizeAnswer('Élève')).toBe('eleve');
    expect(normalizeAnswer('Le castor.')).toBe('le castor');
    expect(normalizeAnswer('  « L’huard »  ')).toBe("l'huard");
    // Two numbers stay two numbers.
    expect(normalizeAnswer('3 et 4')).toBe('3 et 4');
  });

  it('28. short answers match accepted answers, or go to the teacher', () => {
    const riddle = sampleCanonical('riddle');
    const [first] = riddle.content.riddles;
    const entry = answerFor(riddle.answerKey, first!.id);
    expect(gradeQuestion(first!, entry, { kind: 'short_answer', text: 'Le Castor!' }).correct).toBe(
      true,
    );
    expect(gradeQuestion(first!, entry, { kind: 'short_answer', text: 'un ours' })).toEqual({
      score: 0,
      max: 1,
      correct: null,
    });
    expect(gradeQuestion(first!, entry, { kind: 'short_answer', text: '  ' }).correct).toBe(false);
    // No accepted answers at all: always the teacher's call.
    expect(grade('short_answer', { kind: 'short_answer', text: 'Parce que 8 > 3' })).toEqual({
      score: 0,
      max: 2,
      correct: null,
    });
  });

  it('29. gradeAll sums points', () => {
    const result = gradeAll('quiz', content, answerKey, {
      mc1: { kind: 'multiple_choice', choiceIds: ['c1'] },
      tf1: { kind: 'true_false', value: false },
      ma1: { kind: 'matching', pairs: { l1: 'r1', l2: 'r3' } },
      or1: { kind: 'ordering', orderedIds: ['i1', 'i2', 'i3'] },
      sa1: { kind: 'short_answer', text: 'Le 8 vaut 800.' },
    });
    // mc 1/1, tf 0/1, matching 1/2, ordering 1/1, short answer 0/2 (manual).
    expect(result.score).toBe(3);
    expect(result.max).toBe(7);
    expect(result.manual).toBe(1);
    expect(result.results.map((r) => r.number)).toEqual([1, 2, 3, 4, 5]);
  });
});
