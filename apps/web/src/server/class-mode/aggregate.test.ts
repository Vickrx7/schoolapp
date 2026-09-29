import { describe, expect, it } from 'vitest';
import {
  classPercentCorrect,
  parseSessionAggregate,
  percentCorrect,
  sessionAggregateSchema,
} from './aggregate';

// As `app.class_session_aggregate` writes it for the demo session (4 teams, 10 questions: two
// shown here).
const aggregate = {
  schemaVersion: 1,
  itemId: '5a8d2c1e-3f4b-4a6c-8d9e-0f1a2b3c4d5e',
  itemTitle: 'Quiz : les nombres jusqu’à 1 000',
  mode: 'teams',
  revealAnswers: true,
  startedAt: '2026-10-27T14:05:00.123456+00:00',
  endedAt: '2026-10-27T14:31:12.5+00:00',
  deviceCount: 12,
  questionsPlayed: 2,
  teams: [
    { team: 'castors', members: 3, score: 175 },
    { team: 'huards', members: 3, score: 150 },
    { team: 'ours', members: 3, score: 150 },
    { team: 'orignaux', members: 0, score: null },
  ],
  questions: [
    {
      index: 0,
      id: 'q1',
      kind: 'multiple_choice',
      prompt: 'Quel nombre vient après 399?',
      scorable: true,
      answered: 12,
      correct: 9,
      averageScore: 75,
      choices: [
        { id: 'c1', text: '400', count: 9, correct: true },
        { id: 'c2', text: '310', count: 3, correct: false },
      ],
      trueFalse: null,
    },
    {
      index: 1,
      id: 'q2',
      kind: 'true_false',
      prompt: '1 000 est plus grand que 999.',
      scorable: true,
      answered: 11,
      correct: 10,
      averageScore: 90.9,
      trueFalse: { trueCount: 10, falseCount: 1, correct: true },
    },
  ],
};

describe('sessionAggregateSchema (W5)', () => {
  it('reads a kept aggregate', () => {
    const parsed = sessionAggregateSchema.parse(aggregate);
    expect(parsed.teams).toHaveLength(4);
    expect(parsed.teams?.[3]).toEqual({ team: 'orignaux', members: 0, score: null });
    expect(parsed.questions[0]?.choices?.[0]).toEqual({
      id: 'c1',
      text: '400',
      count: 9,
      correct: true,
    });
    // Left out by the database: null, like the fields it wrote as null.
    expect(parsed.questions[1]?.choices).toBeNull();
    expect(parsed.questions[0]?.trueFalse).toBeNull();
  });

  it('shows nothing that could identify a device, even if a row held it', () => {
    const leaky = {
      ...aggregate,
      participants: [{ id: 'p1', device: 7 }],
      questions: aggregate.questions.map((q) => ({
        ...q,
        responses: [{ participantId: 'p1', device: 7, text: 'SENTINEL-TYPED' }],
        choices: q.choices?.map((c) => ({ ...c, devices: [7, 8] })),
      })),
      teams: aggregate.teams.map((t) => ({ ...t, devices: [1, 2, 3] })),
    };
    const parsed = sessionAggregateSchema.parse(leaky);
    const json = JSON.stringify(parsed);
    expect(json).not.toMatch(/participant|device"|devices|responses|SENTINEL/);
    expect(parsed).toEqual(sessionAggregateSchema.parse(aggregate));
  });

  it('reads a solo session and unscored questions', () => {
    const solo = {
      ...aggregate,
      mode: 'solo',
      teams: undefined,
      questions: [
        {
          index: 0,
          id: 'q7',
          kind: 'short_answer',
          prompt: 'Écris 1 000 en lettres.',
          scorable: false,
          answered: 8,
        },
      ],
    };
    const parsed = sessionAggregateSchema.parse(solo);
    expect(parsed.teams).toBeNull();
    expect(parsed.questions[0]).toMatchObject({ correct: null, averageScore: null });
  });

  it('refuses another schema version or a damaged row', () => {
    expect(parseSessionAggregate({ ...aggregate, schemaVersion: 2 })).toBeNull();
    expect(parseSessionAggregate({ ...aggregate, mode: 'relay' })).toBeNull();
    expect(parseSessionAggregate({ ...aggregate, questions: 'none' })).toBeNull();
    expect(parseSessionAggregate({ ...aggregate, deviceCount: -1 })).toBeNull();
    expect(
      parseSessionAggregate({ ...aggregate, teams: [{ team: 'aigles', members: 1, score: 1 }] }),
    ).toBeNull();
    expect(parseSessionAggregate(null)).toBeNull();
    expect(parseSessionAggregate(aggregate)).not.toBeNull();
  });
});

describe('percentages', () => {
  it('gives each scored question its share of correct answers', () => {
    const parsed = sessionAggregateSchema.parse(aggregate);
    expect(percentCorrect(parsed.questions[0]!)).toBe(75);
    expect(percentCorrect(parsed.questions[1]!)).toBe(91);
    expect(classPercentCorrect(parsed)).toBe(83); // 19 of 23
  });

  it('has none for unscored or unanswered questions', () => {
    const parsed = sessionAggregateSchema.parse({
      ...aggregate,
      questions: [
        { ...aggregate.questions[0], scorable: false, correct: null, averageScore: null },
        { ...aggregate.questions[1], answered: 0, correct: 0, averageScore: null },
      ],
    });
    expect(percentCorrect(parsed.questions[0]!)).toBeNull();
    expect(percentCorrect(parsed.questions[1]!)).toBeNull();
    expect(classPercentCorrect(parsed)).toBeNull();
  });
});
