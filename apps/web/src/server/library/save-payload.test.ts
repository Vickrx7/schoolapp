import {
  LIBRARY_ITEM_TYPES,
  TYPE_INFO,
  fromAuthoring,
  newAuthoringQuestion,
  sampleCanonical,
  sampleSafetyNotes,
  toAuthoring,
  validateAnswerKey,
  type AuthoringQuestion,
  type LibraryItemType,
} from '@lynx/content';
import { describe, expect, it } from 'vitest';
import {
  copyOfBase,
  editorFormFromItem,
  editorFormSchema,
  editorSafetyNotes,
  emptyEditorForm,
  type LibraryEditorForm,
} from './editor-form';
import { buildSavePayload, readinessErrors } from './save-payload';
import type { LibraryItemView } from './view-model';

const BOARD = '00000000-0000-4000-8000-000000000001';
const LEVEL = '00000000-0000-4000-8000-0000000000a1';
const EXP = '00000000-0000-4000-8000-0000000000e1';
const SUBJECT = '00000000-0000-4000-8000-0000000000f1';

/** A form built from a type's sample content (what the editor shows for a finished item). */
function sampleForm(type: LibraryItemType): LibraryEditorForm {
  const { content, answerKey } = sampleCanonical(type);
  const authoring = toAuthoring(type, content, answerKey);
  return {
    ...emptyEditorForm(type, { boardId: BOARD, schoolId: null }),
    title: 'Une ressource',
    subjectId: SUBJECT,
    gradeCodes: ['3'],
    expectationIds: [EXP],
    keywords: 'nombres',
    materials: 'Crayons',
    safetyNotes: TYPE_INFO[type].needsSafety ? sampleSafetyNotes() : null,
    versions: [{ languageLevelId: null, content: authoring.content, solution: authoring.solution }],
  };
}

function quizForm(questions: AuthoringQuestion[]): LibraryEditorForm {
  const form = sampleForm('quiz');
  form.versions[0]!.content = { ...form.versions[0]!.content, questions };
  return form;
}

const mc = (): Extract<AuthoringQuestion, { kind: 'multiple_choice' }> => ({
  ...(newAuthoringQuestion('multiple_choice', []) as Extract<
    AuthoringQuestion,
    { kind: 'multiple_choice' }
  >),
  prompt: 'Quel nombre vient après 399?',
  choices: [
    { id: 'c1', text: '398', correct: false },
    { id: 'c2', text: '400', correct: true },
  ],
});

describe('the editor form', () => {
  it('starts every type empty but valid as a draft once it has a title', () => {
    for (const type of LIBRARY_ITEM_TYPES) {
      const form = { ...emptyEditorForm(type, { boardId: BOARD, schoolId: null }), title: 'X' };
      expect(editorFormSchema.safeParse(form).success, type).toBe(true);
      const result = buildSavePayload(form);
      expect(result.ok, `${type}: ${JSON.stringify(!result.ok && result.fieldErrors)}`).toBe(true);
      // Experiments start with empty safety notes, which are no notes at all.
      if (result.ok) expect(result.payload.safetyNotes).toBeNull();
    }
    expect(buildSavePayload(emptyEditorForm('quiz', { boardId: BOARD, schoolId: null }))).toEqual({
      ok: false,
      fieldErrors: { title: 'required' },
    });
  });

  it('saves the sample of every type as it was, content and key', () => {
    for (const type of LIBRARY_ITEM_TYPES) {
      const result = buildSavePayload(sampleForm(type));
      if (!result.ok) throw new Error(`${type}: ${JSON.stringify(result.fieldErrors)}`);
      // The sample's own order of ordering items and right columns becomes the editor's
      // scramble (seeded by question id); nothing else changes.
      const { content, answerKey } = sampleCanonical(type);
      const expected = fromAuthoring(type, toAuthoring(type, content, answerKey));
      expect(result.payload.versions[0]!.content, type).toEqual(expected.content);
      expect(result.payload.versions[0]!.answerKey, type).toEqual(expected.key);
      expect(validateAnswerKey(type, expected.content, expected.key), type).toEqual([]);
      expect(readinessErrors(result.payload, []), type).toEqual({});
    }
  });

  it('reads an item back into the form, answers included', () => {
    const { content, answerKey } = sampleCanonical('quiz');
    const item = {
      id: 'item',
      boardId: BOARD,
      schoolId: null,
      type: 'quiz',
      title: 'Quiz',
      summary: null,
      licence: null,
      subject: { id: SUBJECT, code: 'mat', label: 'Mathématiques', labelFr: 'Mathématiques' },
      grades: [{ code: '3', label: '3e année', labelFr: '3e année' }],
      expectations: [{ id: EXP }],
      tags: [],
      keywords: 'nombres',
      durationMinutes: 20,
      materials: 'Crayons',
      formats: { printable: true, projectable: true, interactive: false },
      subFriendly: true,
      safetyNotes: null,
      faith: { content: false, connection: null, referenceId: null, onStudentSheet: false },
      versions: [{ id: 'v1', languageLevelId: null, content }],
    } as unknown as LibraryItemView;
    const form = editorFormFromItem(item, new Map([['v1', answerKey]]));
    expect(form).toMatchObject({ title: 'Quiz', gradeCodes: ['3'], expectationIds: [EXP] });
    const result = buildSavePayload(form);
    if (!result.ok) throw new Error(JSON.stringify(result.fieldErrors));
    const expected = fromAuthoring('quiz', toAuthoring('quiz', content, answerKey));
    expect(result.payload.versions[0]!.content).toEqual(expected.content);
    expect(result.payload.versions[0]!.answerKey).toEqual(expected.key);
    // A new level version starts as a copy of the base version, not linked to it.
    const copy = copyOfBase(form, LEVEL);
    expect(copy.languageLevelId).toBe(LEVEL);
    expect(copy.content).toEqual(form.versions[0]!.content);
    expect(copy.content).not.toBe(form.versions[0]!.content);
  });

  it('points each error at the field that shows it', () => {
    const long = 'x'.repeat(1001);
    const matching = newAuthoringQuestion('matching', []) as Extract<
      AuthoringQuestion,
      { kind: 'matching' }
    >;
    matching.id = 'q2';
    matching.pairs[1]!.left = 'y'.repeat(301);
    const short = newAuthoringQuestion('short_answer', []) as Extract<
      AuthoringQuestion,
      { kind: 'short_answer' }
    >;
    short.id = 'q3';
    short.acceptableAnswers = ['z'.repeat(101)];
    const choice = mc();
    choice.prompt = long;
    choice.choices[1]!.text = 'w'.repeat(301);
    const form = quizForm([choice, matching, short]);
    form.versions[0]!.solution = 's'.repeat(8001);
    form.title = 't'.repeat(201);
    const result = buildSavePayload(form);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.fieldErrors).toMatchObject({
      title: 'tooLong',
      'versions.0.content.questions.0.prompt': 'tooLong',
      'versions.0.content.questions.0.choices.1.text': 'tooLong',
      'versions.0.content.questions.1.pairs.1.left': 'tooLong',
      'versions.0.content.questions.2.acceptableAnswers.0': 'tooLong',
      'versions.0.solution': 'tooLong',
    });
  });

  it('refuses answers that contradict the question, but keeps an unfinished one', () => {
    const two = mc();
    two.choices = two.choices.map((c) => ({ ...c, correct: true }));
    const refused = buildSavePayload(quizForm([two]));
    expect(!refused.ok && refused.fieldErrors).toEqual({
      'versions.0.content.questions.0.choices': 'tooManyCorrect',
    });
    // No correct choice yet: a draft keeps it; marking it reviewed will not.
    const none = mc();
    none.choices = none.choices.map((c) => ({ ...c, correct: false }));
    const kept = buildSavePayload(quizForm([none]));
    if (!kept.ok) throw new Error(JSON.stringify(kept.fieldErrors));
    expect(readinessErrors(kept.payload, [])).toMatchObject({
      'readiness.key': 'readiness.key',
      'versions.0.content.questions.0.choices': 'noCorrectChoice',
    });
  });

  it('refuses a malformed question or content instead of failing', () => {
    const broken = { ...mc(), choices: 'not a list' } as unknown as AuthoringQuestion;
    expect(buildSavePayload(quizForm([broken]))).toEqual({
      ok: false,
      fieldErrors: { 'versions.0.content.questions.0': 'invalid' },
    });
    const form = sampleForm('quiz');
    form.versions[0]!.content = { ...form.versions[0]!.content, answer: 'B' };
    const extra = buildSavePayload(form);
    expect(!extra.ok && extra.fieldErrors).toEqual({ 'versions.0.content': 'invalid' });
  });

  it('checks versions, sub-friendliness and safety notes', () => {
    const twoBases = sampleForm('quiz');
    twoBases.versions.push({ ...twoBases.versions[0]! });
    expect(!buildSavePayload(twoBases).ok && buildSavePayload(twoBases)).toMatchObject({
      fieldErrors: { versions: 'baseVersion' },
    });

    const test = { ...sampleForm('unit_test'), subFriendly: true };
    expect(buildSavePayload(test)).toMatchObject({
      ok: false,
      fieldErrors: { subFriendly: 'subFriendlyNotAllowed' },
    });

    const experiment = sampleForm('experiment');
    experiment.safetyNotes = { ...sampleSafetyNotes(), supervision: 'close' };
    expect(buildSavePayload({ ...experiment, subFriendly: true })).toMatchObject({
      ok: false,
      fieldErrors: { subFriendly: 'subFriendlyNotAllowed' },
    });
    // Incomplete notes are kept in a draft, and block readiness.
    experiment.safetyNotes = {
      ageSuitability: 'De 9 à 11 ans',
      allergyAwareMaterials: '',
      supervision: '',
      hazards: ['  ', 'Lunettes'],
      notes: '',
    };
    const saved = buildSavePayload(experiment);
    if (!saved.ok) throw new Error(JSON.stringify(saved.fieldErrors));
    expect(saved.payload.safetyNotes).toMatchObject({ hazards: ['Lunettes'] });
    expect(readinessErrors(saved.payload, [])).toHaveProperty('readiness.safety');
    // Other types never carry safety notes.
    expect(
      buildSavePayload({ ...sampleForm('quiz'), safetyNotes: sampleSafetyNotes() }),
    ).toMatchObject({ ok: true, payload: { safetyNotes: null } });
    expect(editorSafetyNotes('quiz', sampleSafetyNotes())).toBeNull();
    expect(
      editorSafetyNotes('experiment', { supervision: 'nope', ageSuitability: 'Tous' }),
    ).toEqual({
      ageSuitability: 'Tous',
      allergyAwareMaterials: '',
      supervision: '',
      hazards: [],
      notes: '',
    });
  });

  it('lists what a reviewed item still needs', () => {
    const form = { ...sampleForm('quiz'), expectationIds: [], materials: '', keywords: '' };
    const result = buildSavePayload(form);
    if (!result.ok) throw new Error(JSON.stringify(result.fieldErrors));
    expect(Object.keys(readinessErrors(result.payload, [])).sort()).toEqual([
      'readiness.expectations',
      'readiness.materials',
      'readiness.tags',
    ]);
    const emptyPrompt = sampleForm('quiz');
    const questions = emptyPrompt.versions[0]!.content.questions as AuthoringQuestion[];
    questions[0] = { ...questions[0]!, prompt: '' };
    const saved = buildSavePayload(emptyPrompt);
    if (!saved.ok) throw new Error(JSON.stringify(saved.fieldErrors));
    expect(readinessErrors(saved.payload, [])).toMatchObject({
      'readiness.content': 'readiness.content',
      'versions.0.content.questions.0.prompt': 'required',
    });
  });
});
