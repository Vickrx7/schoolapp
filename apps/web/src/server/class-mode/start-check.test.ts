import { findPersonalInfo } from '@lynx/ai/privacy';
import { sampleCanonical } from '@lynx/content';
import { describe, expect, it } from 'vitest';
import { deviceQuestions, isScorable, quizPreview } from './start-check';

const quiz = sampleCanonical('quiz');

describe('the check before « Lancer » (D-084, D-086, D-087)', () => {
  it('counts the questions devices get and those that count for points', () => {
    const preview = quizPreview({
      type: 'quiz',
      title: 'Quiz : les nombres jusqu’à 1 000',
      content: quiz.content,
      answerKey: quiz.answerKey,
      scoreShortAnswers: false,
    });
    // mc1, tf1, ma1, or1 and the short answer sa1 (not scored by default, and it has no
    // accepted answers anyway).
    expect(preview.questions).toBe(5);
    expect(preview.scorable).toBe(4);
  });

  it('shows devices only the whitelist: never the teacher note or the key', () => {
    const { deviceStrings } = quizPreview({
      type: 'quiz',
      title: 'Quiz',
      content: {
        ...quiz.content,
        teacherNote: 'SENTINELLE-NOTE',
        questions: quiz.content.questions.map((q) => ({
          ...q,
          explanation: 'SENTINELLE-EXPLICATION',
          correctChoiceIds: ['c1'],
        })),
      },
      answerKey: quiz.answerKey,
      scoreShortAnswers: true,
    });
    const text = deviceStrings.join('\n');
    expect(text).toContain('Quel nombre est le plus grand?');
    expect(text).toContain('Regarde d’abord le chiffre des centaines.');
    expect(text).toContain('300 + 40 + 5');
    expect(text).not.toMatch(/SENTINELLE|Prévoir du temps|893 a 8 centaines/);
  });

  it('follows the snapshot rules of the database', () => {
    const content = {
      questions: [
        {
          id: 'q1',
          kind: 'multiple_choice',
          prompt: 'Une seule option',
          choices: [{ id: 'a', text: 'x' }],
        },
        { id: 'q2', kind: 'true_false', prompt: '  ' },
        { id: 'Q3', kind: 'true_false', prompt: 'Identifiant invalide' },
        { id: 'q4', kind: 'essay', prompt: 'Type inconnu' },
        { id: 'q5', kind: 'true_false', prompt: 'Retenue' },
        { id: 'q5', kind: 'true_false', prompt: 'Doublon' },
        { id: 'q6', kind: 'ordering', prompt: 'Un seul élément', items: [{ id: 'a', text: 'x' }] },
      ],
    };
    expect(deviceQuestions('quiz', content).map((q) => q.prompt)).toEqual(['Retenue']);
    // Exit tickets, tests and diagnostics are presented, never played on devices (D-082).
    for (const type of ['exit_ticket', 'unit_test', 'diagnostic', 'worksheet'] as const) {
      expect(deviceQuestions(type, quiz.content)).toEqual([]);
    }
    expect(deviceQuestions('game', sampleCanonical('game').content)).toHaveLength(1);
  });

  it('scores a question only when its key entry fits it', () => {
    const [mc] = deviceQuestions('quiz', quiz.content);
    const key = (entry: Record<string, unknown>) => ({
      answers: [{ questionId: 'mc1', kind: 'multiple_choice', ...entry }],
    });
    expect(isScorable(mc!, key({ correctChoiceIds: ['c1'] }), false)).toBe(true);
    // Two right answers to a single-answer question, an unknown choice, no entry.
    expect(isScorable(mc!, key({ correctChoiceIds: ['c1', 'c2'] }), false)).toBe(false);
    expect(isScorable(mc!, key({ correctChoiceIds: ['zz'] }), false)).toBe(false);
    expect(isScorable(mc!, { answers: [] }, false)).toBe(false);
    expect(isScorable(mc!, null, false)).toBe(false);

    const short = {
      questions: [{ id: 's1', kind: 'short_answer', prompt: 'Écris mille en chiffres.' }],
    };
    const [sa] = deviceQuestions('quiz', short);
    const shortKey = {
      answers: [{ questionId: 's1', kind: 'short_answer', acceptableAnswers: ['1 000', '1000'] }],
    };
    expect(isScorable(sa!, shortKey, false)).toBe(false);
    expect(isScorable(sa!, shortKey, true)).toBe(true);
  });

  it('finds a student’s first name in what devices will show', () => {
    const { deviceStrings } = quizPreview({
      type: 'quiz',
      title: 'Quiz de Samuel',
      content: {
        questions: [
          { id: 'q1', kind: 'true_false', prompt: 'Maëlle a trois billes de plus que Hugo.' },
        ],
      },
      answerKey: null,
      scoreShortAnswers: false,
    });
    const people = ['Samuel', 'Maëlle', 'Hugo', 'Inès'].map((name) => ({
      name,
      kind: 'student' as const,
    }));
    expect(findPersonalInfo(deviceStrings, people).studentNames).toEqual([
      'Samuel',
      'Maëlle',
      'Hugo',
    ]);
    const clean = quizPreview({
      type: 'quiz',
      title: 'Quiz',
      content: quiz.content,
      answerKey: quiz.answerKey,
      scoreShortAnswers: false,
    });
    expect(findPersonalInfo(clean.deviceStrings, people).studentNames).toEqual([]);
  });
});
