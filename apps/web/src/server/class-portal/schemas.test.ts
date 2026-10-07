import { QUESTION_KINDS } from '@lynx/content';
import { describe, expect, it } from 'vitest';
import {
  CLASS_TEAM_KEYS,
  answerRequestSchema,
  answerResultSchema,
  answerSchema,
  deviceStateSchema,
  joinRowSchema,
  liveStateSchema,
  teamResultSchema,
} from './schemas';

// Key-shaped values planted where a careless function could leak them.
const LEAKS = {
  answer: 'SENTINEL-ANSWER',
  accepted: ['sentinel-accepted'],
  explanation: 'SENTINEL-EXPLANATION',
  correctChoiceIds: ['c2'],
  display: { sampleAnswer: 'SENTINEL-SAMPLE' },
};

const question = {
  id: 'q1',
  kind: 'multiple_choice',
  prompt: 'Combien font 7 × 8?',
  multipleAnswers: false,
  choices: [
    { id: 'c1', text: '54' },
    { id: 'c2', text: '56' },
  ],
  scorable: true,
};

const deviceState = {
  status: 'ok',
  version: 7,
  serverNow: '2026-11-03T14:05:00.123456+00:00',
  session: {
    title: 'Quiz : les nombres jusqu’à 1 000',
    lang: 'fr-CA',
    mode: 'teams',
    phase: 'question',
    index: 0,
    total: 10,
    joiningOpen: false,
    teamChoice: 'random',
    teams: ['huards', 'castors', 'orignaux', 'ours'],
  },
  me: { device: 7, team: 'castors' },
  question,
  myAnswer: { answered: true },
};

const participantId = '7f3c2a8e-1b4d-4c6e-9a2f-5d8e1c3b7a90';

const liveState = {
  version: 12,
  phase: 'reveal',
  index: 0,
  total: 10,
  mode: 'teams',
  lang: 'fr-CA',
  joinCode: 'K7M4R9',
  joiningOpen: false,
  joiningClosesAt: '2026-11-03T14:20:00+00:00',
  expiresAt: '2026-11-03T16:00:00+00:00',
  closesAt: null,
  serverNow: '2026-11-03T14:06:00+00:00',
  keep: false,
  revealAnswers: true,
  question,
  answered: 18,
  devices: {
    count: 2,
    connected: 2,
    byTeam: [
      { team: 'huards', members: 1 },
      { team: 'castors', members: 1 },
    ],
    list: [{ id: participantId, device: 7, team: 'castors', left: false }],
  },
  reveal: {
    distribution: { c1: 5, c2: 13 },
    correctCount: 13,
    answer: {
      kind: 'multiple_choice',
      choiceIds: ['c2'],
      accepted: ['56'],
      display: { sampleAnswer: '', acceptable: [], explanation: '7 × 8 = 56' },
    },
  },
  leaderboard: null,
  classStats: { percentCorrect: 72 },
};

describe('device state (W3)', () => {
  it('parses what a device receives', () => {
    const parsed = deviceStateSchema.parse(deviceState);
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;
    expect(parsed.me).toEqual({ device: 7, team: 'castors' });
    expect(parsed.session.closesAt).toBeNull(); // left out by jsonb_strip_nulls
    expect(parsed.question?.choices).toHaveLength(2);
    expect(parsed.question?.hint).toBeNull();
    expect(parsed.myAnswer).toEqual({ answered: true, result: null });
    expect(parsed.leaderboard).toBeNull();
  });

  it('drops answer, accepted and explanation wherever they appear', () => {
    const leaky = {
      ...deviceState,
      ...LEAKS,
      session: { ...deviceState.session, ...LEAKS },
      me: { ...deviceState.me, ...LEAKS },
      question: {
        ...question,
        ...LEAKS,
        choices: question.choices.map((c) => ({ ...c, ...LEAKS, correct: true })),
      },
      myAnswer: { answered: true, ...LEAKS, result: { correct: true, points: 100, ...LEAKS } },
    };
    const parsed = deviceStateSchema.parse(leaky);
    const json = JSON.stringify(parsed);
    expect(json).not.toMatch(/SENTINEL|sentinel/);
    expect(json).not.toMatch(/"(answer|accepted|explanation|correctChoiceIds|display)"/);
    expect(parsed).toEqual(
      deviceStateSchema.parse({
        ...deviceState,
        myAnswer: { answered: true, result: { correct: true, points: 100 } },
      }),
    );
  });

  it('parses the short states', () => {
    expect(deviceStateSchema.parse({ status: 'unchanged', serverNow: 'x', ...LEAKS })).toEqual({
      status: 'unchanged',
      serverNow: 'x',
    });
    expect(deviceStateSchema.parse({ status: 'ended' })).toEqual({ status: 'ended' });
    expect(deviceStateSchema.parse({ status: 'gone', ...LEAKS })).toEqual({ status: 'gone' });
    expect(deviceStateSchema.safeParse({ status: 'nope' }).success).toBe(false);
  });

  it('refuses unknown teams, phases and oversized snapshots', () => {
    const bad = (patch: Record<string, unknown>) =>
      deviceStateSchema.safeParse({ ...deviceState, ...patch }).success;
    expect(bad({ me: { device: 7, team: 'aigles' } })).toBe(false);
    expect(bad({ session: { ...deviceState.session, phase: 'paused' } })).toBe(false);
    const nine = Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, text: String(i) }));
    expect(bad({ question: { ...question, choices: nine } })).toBe(false);
    expect(bad({ question: { ...question, prompt: 'x'.repeat(1001) } })).toBe(false);
  });

  it('parses the results of answer and set_team', () => {
    const recorded = answerResultSchema.parse({
      status: 'ok',
      outcome: 'recorded',
      state: deviceState,
      ...LEAKS,
    });
    expect(recorded).toMatchObject({ status: 'ok', outcome: 'recorded' });
    expect(JSON.stringify(recorded)).not.toMatch(/SENTINEL|sentinel/);
    expect(answerResultSchema.parse({ status: 'ok', outcome: 'invalid' })).toEqual({
      status: 'ok',
      outcome: 'invalid',
    });
    expect(answerResultSchema.parse({ status: 'gone' })).toEqual({ status: 'gone' });
    expect(answerResultSchema.safeParse({ status: 'ok', outcome: 'recorded' }).success).toBe(false);
    expect(teamResultSchema.parse({ outcome: 'invalid' })).toEqual({ outcome: 'invalid' });
    expect(teamResultSchema.parse(deviceState)).toMatchObject({ status: 'ok' });
  });

  it('parses a join row', () => {
    const token = 'aB3_-'.repeat(8) + 'xyz';
    expect(
      joinRowSchema.parse({
        outcome: 'ok',
        token,
        expires_at: new Date('2026-11-03T16:00:00Z'),
        retry_after: null,
      }),
    ).toEqual({
      outcome: 'ok',
      token,
      expires_at: new Date('2026-11-03T16:00:00Z'),
      retry_after: null,
    });
    expect(
      joinRowSchema.parse({ outcome: 'wait', token: null, expires_at: null, retry_after: 30 }),
    ).toMatchObject({ outcome: 'wait', retry_after: 30, expires_at: null });
    expect(joinRowSchema.safeParse({ outcome: 'ok', token: 'short' }).success).toBe(false);
  });
});

describe('projector state', () => {
  it('keeps the answer in the reveal, without the graded forms', () => {
    const parsed = liveStateSchema.parse(liveState);
    expect(parsed.reveal?.answer).toEqual({
      kind: 'multiple_choice',
      choiceIds: ['c2'],
      value: null,
      pairs: null,
      orderedIds: null,
      display: { sampleAnswer: '', acceptable: [], explanation: '7 × 8 = 56' },
    });
    expect(parsed.devices.list[0]).toEqual({
      id: participantId,
      device: 7,
      team: 'castors',
      left: false,
    });
  });

  it('never carries a reveal before the answer is shown', () => {
    for (const phase of ['lobby', 'question'] as const) {
      const parsed = liveStateSchema.parse({ ...liveState, phase });
      expect(parsed.reveal).toBeNull();
      expect(JSON.stringify(parsed)).not.toMatch(/choiceIds|explanation|distribution/);
    }
    for (const phase of ['reveal', 'leaderboard', 'finished'] as const) {
      expect(liveStateSchema.parse({ ...liveState, phase }).reveal).not.toBeNull();
    }
  });

  it('drops keys it does not know, even on the projector', () => {
    const parsed = liveStateSchema.parse({
      ...liveState,
      ...LEAKS,
      question: { ...question, ...LEAKS },
    });
    expect(parsed.question).not.toHaveProperty('answer');
    expect(parsed.question).not.toHaveProperty('explanation');
    expect(parsed).not.toHaveProperty('accepted');
  });
});

describe('answers from devices (W3)', () => {
  it('has a shape for every question kind', () => {
    for (const kind of QUESTION_KINDS) expect(answerSchema(kind)).toBeDefined();
  });

  it('keeps only the answer itself', () => {
    const extra = { ...LEAKS, deviceNumber: 3 };
    expect(answerSchema('multiple_choice').parse({ choiceIds: ['c1'], ...extra })).toEqual({
      choiceIds: ['c1'],
    });
    expect(answerSchema('true_false').parse({ value: false, ...extra })).toEqual({ value: false });
    expect(answerSchema('matching').parse({ pairs: { l1: 'r2', l2: 'r1' }, ...extra })).toEqual({
      pairs: { l1: 'r2', l2: 'r1' },
    });
    expect(answerSchema('ordering').parse({ orderedIds: ['i2', 'i1'], ...extra })).toEqual({
      orderedIds: ['i2', 'i1'],
    });
    expect(answerSchema('short_answer').parse({ text: ' mille ', ...extra })).toEqual({
      text: 'mille',
    });
  });

  it('refuses 7 choices and 101 characters', () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${i + 1}`);
    expect(answerSchema('multiple_choice').safeParse({ choiceIds: ids(6) }).success).toBe(true);
    expect(answerSchema('multiple_choice').safeParse({ choiceIds: ids(7) }).success).toBe(false);
    expect(answerSchema('short_answer').safeParse({ text: 'é'.repeat(100) }).success).toBe(true);
    expect(answerSchema('short_answer').safeParse({ text: 'é'.repeat(101) }).success).toBe(false);
  });

  it('refuses other shapes and sizes', () => {
    const ok = (kind: (typeof QUESTION_KINDS)[number], value: unknown) =>
      answerSchema(kind).safeParse(value).success;
    expect(ok('multiple_choice', { choiceIds: [] })).toBe(false);
    expect(ok('multiple_choice', { choiceIds: ['C1'] })).toBe(false);
    expect(ok('multiple_choice', { choiceIds: 'c1' })).toBe(false);
    expect(ok('true_false', { value: 'true' })).toBe(false);
    expect(ok('true_false', {})).toBe(false);
    const pairs = (n: number) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`l${i}`, `r${i}`]));
    expect(ok('matching', { pairs: pairs(8) })).toBe(true);
    expect(ok('matching', { pairs: pairs(9) })).toBe(false);
    expect(ok('matching', { pairs: {} })).toBe(false);
    expect(ok('matching', { pairs: { l1: 'R1' } })).toBe(false);
    expect(ok('ordering', { orderedIds: Array.from({ length: 8 }, (_, i) => `i${i}`) })).toBe(true);
    expect(ok('ordering', { orderedIds: Array.from({ length: 9 }, (_, i) => `i${i}`) })).toBe(
      false,
    );
    expect(ok('short_answer', { text: '   ' })).toBe(false);
    expect(ok('short_answer', { text: 12 })).toBe(false);
  });

  it('reads the request body of an answer', () => {
    expect(
      answerRequestSchema.parse({
        index: 3,
        kind: 'true_false',
        response: { value: true, explanation: 'x' },
        answer: 'x',
      }),
    ).toEqual({ index: 3, kind: 'true_false', response: { value: true } });
    expect(
      answerRequestSchema.safeParse({ index: 80, kind: 'true_false', response: { value: true } })
        .success,
    ).toBe(false);
    expect(
      answerRequestSchema.safeParse({ index: 0, kind: 'essay', response: { text: 'x' } }).success,
    ).toBe(false);
    expect(
      answerRequestSchema.safeParse({ index: 0, kind: 'true_false', response: { text: 'x' } })
        .success,
    ).toBe(false);
  });
});

describe('team keys', () => {
  it('are the six fixed teams of the database, in list order', () => {
    expect(CLASS_TEAM_KEYS).toEqual(['huards', 'castors', 'orignaux', 'ours', 'loups', 'renards']);
  });
});
