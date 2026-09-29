import {
  QUESTION_KINDS,
  contentSchema,
  emptyAuthoring,
  fromAuthoring,
  newAuthoringQuestion,
  toAuthoring,
  validateAnswerKey,
  type AuthoringQuestion,
} from '@lynx/content';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  QUESTION_LIMITS,
  addAcceptable,
  addChoice,
  addExtraRight,
  addItem,
  addPair,
  addQuestion,
  canAddPair,
  changeKind,
  clampInt,
  kindsFor,
  move,
  moveItem,
  questionIdsOf,
  removeChoice,
  removeItem,
  removePair,
  setAcceptable,
  setChoiceText,
  setExtraRight,
  setItem,
  setMultipleAnswers,
  setPair,
  toggleCorrect,
} from './question-ops';

type Of<K extends AuthoringQuestion['kind']> = Extract<AuthoringQuestion, { kind: K }>;
const q = <K extends AuthoringQuestion['kind']>(kind: K) => newAuthoringQuestion(kind, []) as Of<K>;

/** A quiz with one question of each kind, filled in through the editor's operations. */
function filledQuiz() {
  let mc = q('multiple_choice');
  mc = setChoiceText(setChoiceText(addChoice(mc), 0, '398'), 1, '400');
  mc = setChoiceText(mc, 2, '410');
  mc = toggleCorrect(mc, 1);
  const tf = { ...q('true_false'), correct: false };
  let matching = q('matching');
  matching = setPair(setPair(matching, 0, { left: '2 centaines', right: '200' }), 1, {
    left: '5 dizaines',
    right: '50',
  });
  matching = setExtraRight(addExtraRight(matching), 0, '500');
  let ordering = q('ordering');
  ordering = setItem(setItem(addItem(ordering), 0, '105'), 1, '150');
  ordering = setItem(ordering, 2, '501');
  let short = q('short_answer');
  short = setAcceptable(addAcceptable({ ...short, sampleAnswer: 'Mille' }), 0, '1 000');

  let questions: AuthoringQuestion[] = [];
  for (const question of [mc, tf, matching, ordering, short]) {
    questions = addQuestion(questions, question.kind, []);
    questions[questions.length - 1] = { ...question, id: questions[questions.length - 1]!.id };
  }
  return questions.map((x, i) => ({ ...x, prompt: `Question ${i + 1}` }));
}

describe('the question editor', () => {
  it('builds a quiz with every kind whose content and key pass the schemas and the key check', () => {
    const authoring = emptyAuthoring('quiz');
    authoring.content.questions = filledQuiz();
    const { content, key } = fromAuthoring('quiz', authoring);
    expect(contentSchema('quiz', 'draft').safeParse(content).success).toBe(true);
    expect(contentSchema('quiz', 'final').safeParse(content).success).toBe(true);
    expect(validateAnswerKey('quiz', content, key)).toEqual([]);
    // Unique ids, answers split out, and the editor's model comes back exactly.
    expect(new Set(questionIdsOf('quiz', content)).size).toBe(5);
    expect(JSON.stringify(content)).not.toContain('correct');
    expect(toAuthoring('quiz', content, key).content.questions).toEqual(
      authoring.content.questions,
    );
  });

  it('keeps one correct choice unless several are allowed', () => {
    let mc = addChoice(q('multiple_choice'));
    expect(mc.choices.filter((c) => c.correct).map((c) => c.id)).toEqual(['c1']);
    mc = toggleCorrect(mc, 2);
    expect(mc.choices.map((c) => c.correct)).toEqual([false, false, true]);
    mc = setMultipleAnswers(mc, true);
    mc = toggleCorrect(toggleCorrect(mc, 0), 2);
    expect(mc.choices.map((c) => c.correct)).toEqual([true, false, false]);
    mc = toggleCorrect(mc, 1);
    expect(mc.choices.map((c) => c.correct)).toEqual([true, true, false]);
    // Back to one answer: the first correct one stays.
    mc = setMultipleAnswers(mc, false);
    expect(mc.choices.map((c) => c.correct)).toEqual([true, false, false]);
  });

  it('never goes past the sizes of a question', () => {
    let mc = q('multiple_choice');
    for (let i = 0; i < 10; i++) mc = addChoice(mc);
    expect(mc.choices).toHaveLength(QUESTION_LIMITS.choices.max);
    expect(new Set(mc.choices.map((c) => c.id)).size).toBe(QUESTION_LIMITS.choices.max);
    for (let i = 0; i < 10; i++) mc = removeChoice(mc, 0);
    expect(mc.choices).toHaveLength(QUESTION_LIMITS.choices.min);

    let ordering = q('ordering');
    for (let i = 0; i < 10; i++) ordering = addItem(ordering);
    expect(ordering.items).toHaveLength(QUESTION_LIMITS.items.max);
    for (let i = 0; i < 10; i++) ordering = removeItem(ordering, 0);
    expect(ordering.items).toHaveLength(QUESTION_LIMITS.items.min);

    // The right column holds the pairs and the extra items: 8 at most in all.
    let matching = q('matching');
    for (let i = 0; i < 3; i++) matching = addExtraRight(matching);
    for (let i = 0; i < 10; i++) matching = addPair(matching);
    expect(matching.pairs.length + matching.extraRight.length).toBe(QUESTION_LIMITS.right.max);
    expect(canAddPair(matching)).toBe(false);
    const rightIds = [
      ...matching.pairs.map((p) => p.rightId),
      ...matching.extraRight.map((r) => r.id),
    ];
    expect(new Set(rightIds).size).toBe(rightIds.length);
    for (let i = 0; i < 10; i++) matching = removePair(matching, 0);
    expect(matching.pairs).toHaveLength(QUESTION_LIMITS.pairs.min);

    let short = q('short_answer');
    for (let i = 0; i < 12; i++) short = addAcceptable(short);
    expect(short.acceptableAnswers).toHaveLength(QUESTION_LIMITS.acceptableAnswers.max);
  });

  it('uses the limits of the schemas', () => {
    const json = z.toJSONSchema(contentSchema('quiz', 'final'), {
      io: 'input',
      unrepresentable: 'any',
    }) as unknown as { properties: { questions: { items: { oneOf: Record<string, unknown>[] } } } };
    const byKind = Object.fromEntries(
      json.properties.questions.items.oneOf.map((s) => {
        const props = (s as { properties: Record<string, Record<string, unknown>> }).properties;
        return [String(props.kind!.const), props];
      }),
    );
    const bounds = (p: Record<string, unknown> | undefined) => ({
      min: p?.minItems,
      max: p?.maxItems,
    });
    expect(bounds(byKind.multiple_choice!.choices)).toEqual(QUESTION_LIMITS.choices);
    expect(bounds(byKind.matching!.left)).toEqual(QUESTION_LIMITS.pairs);
    expect(bounds(byKind.matching!.right)).toEqual(QUESTION_LIMITS.right);
    expect(bounds(byKind.ordering!.items)).toEqual(QUESTION_LIMITS.items);
    const lines = byKind.short_answer!.lines as { minimum: number; maximum: number };
    expect({ min: lines.minimum, max: lines.maximum }).toEqual(QUESTION_LIMITS.lines);
  });

  it('keeps the author’s order for ordering items (the sheet scrambles them)', () => {
    let ordering = q('ordering');
    ordering = setItem(setItem(ordering, 0, 'premier'), 1, 'deuxième');
    ordering = moveItem(ordering, 1, 'up');
    expect(ordering.items.map((i) => i.text)).toEqual(['deuxième', 'premier']);
    const authoring = emptyAuthoring('quiz');
    authoring.content.questions = [{ ...ordering, prompt: 'Place en ordre.' }];
    const { content, key } = fromAuthoring('quiz', authoring);
    expect(key?.answers[0]).toMatchObject({ orderedIds: ordering.items.map((i) => i.id) });
    expect(
      (content.questions[0] as { items: { id: string }[] }).items.map((i) => i.id),
    ).not.toEqual(ordering.items.map((i) => i.id));
  });

  it('changes a question’s kind, keeping what the kinds share', () => {
    let mc: Of<'multiple_choice'> = {
      ...q('multiple_choice'),
      id: 'q7',
      prompt: 'Range',
      hint: 'Indice',
      points: 2,
    };
    mc = setChoiceText(setChoiceText(mc, 0, 'un'), 1, 'deux');
    const ordering = changeKind(mc, 'ordering');
    expect(ordering).toMatchObject({ id: 'q7', kind: 'ordering', prompt: 'Range', points: 2 });
    expect((ordering as Of<'ordering'>).items.map((i) => i.text)).toEqual(['un', 'deux']);
    const back = changeKind(ordering, 'multiple_choice') as Of<'multiple_choice'>;
    expect(back.choices.map((c) => [c.text, c.correct])).toEqual([
      ['un', true],
      ['deux', false],
    ]);
    const short = changeKind(back, 'short_answer') as Of<'short_answer'>;
    expect(short).toMatchObject({ id: 'q7', lines: 3, sampleAnswer: '', acceptableAnswers: [] });
    for (const kind of QUESTION_KINDS) expect(changeKind(short, kind).kind).toBe(kind);
  });

  it('numbers questions across a unit test’s sections', () => {
    const content = {
      ...emptyAuthoring('unit_test').content,
      sections: [
        { title: 'A', questions: [q('true_false')] },
        { title: 'B', questions: [] },
      ],
    };
    const taken = questionIdsOf('unit_test', content);
    expect(taken).toEqual(['q1']);
    const added = addQuestion([], 'short_answer', taken);
    expect(added[0]!.id).toBe('q2');
  });

  it('offers riddles short answers only', () => {
    expect(kindsFor(true)).toEqual(['short_answer']);
    expect(kindsFor(false)).toEqual(QUESTION_KINDS);
  });

  it('moves, clamps and leaves lists alone at their ends', () => {
    expect(move(['a', 'b', 'c'], 0, 'up')).toEqual(['a', 'b', 'c']);
    expect(move(['a', 'b', 'c'], 2, 'down')).toEqual(['a', 'b', 'c']);
    expect(move(['a', 'b', 'c'], 1, 'down')).toEqual(['a', 'c', 'b']);
    expect(clampInt('', QUESTION_LIMITS.points)).toBeNull();
    expect(clampInt('99', QUESTION_LIMITS.points)).toBe(20);
    expect(clampInt('0', QUESTION_LIMITS.lines)).toBe(1);
    expect(clampInt('2.6', QUESTION_LIMITS.lines)).toBe(3);
    expect(clampInt('abc', QUESTION_LIMITS.lines)).toBeNull();
  });
});
