import { describe, expect, it } from 'vitest';
import {
  aiFaithContent,
  normalizeAiContent,
  normalizeAiKey,
  normalizeAiVersion,
  normalizeSafetyNotes,
} from './ai';
import { validateAnswerKey } from './answer-key';
import { safetyNotesSchema } from './safety';
import { sampleKey, sampleVersion } from './samples';
import { contentSchema } from './schemas';
import { NBSP } from './style';

const flat = (fields: Record<string, unknown>) => ({
  id: 'q1',
  kind: 'short_answer',
  prompt: 'Question?',
  hint: '',
  points: null,
  category: null,
  choices: null,
  multipleAnswers: null,
  left: null,
  right: null,
  items: null,
  lines: null,
  ...fields,
});

describe('ai', () => {
  it('14. turns flat questions of each kind into canonical ones; an unknown kind fails final', () => {
    const ai = sampleVersion('quiz');
    const content = normalizeAiContent('quiz', ai, normalizeAiKey(sampleKey('quiz', ai)));
    const byKind = Object.fromEntries(content.questions.map((q) => [q.kind, Object.keys(q)]));
    const base = ['id', 'kind', 'prompt', 'hint', 'points', 'category'];
    expect(byKind).toEqual({
      multiple_choice: [...base, 'choices', 'multipleAnswers'],
      true_false: base,
      matching: [...base, 'left', 'right'],
      ordering: [...base, 'items'],
      short_answer: [...base, 'lines'],
    });

    const loose = normalizeAiContent('quiz', {
      ...ai,
      questions: [
        flat({ id: 'Q-1', kind: 'Short answer', category: 'Habiletés de la pensée', points: 2.4 }),
        flat({ id: 'q2', kind: 'essay' }),
      ],
    });
    expect(loose.questions[0]).toEqual({
      id: 'q1',
      kind: 'short_answer',
      prompt: 'Question?',
      hint: '',
      points: 2,
      category: 'habiletes',
      lines: 3,
    });
    expect(loose.questions[1]!.kind).toBe('essay');
    const final = contentSchema('quiz', 'final').safeParse(loose);
    expect(final.error!.issues.map((i) => i.path.join('.'))).toEqual(['questions.1.kind']);
  });

  it('14b. keeps a missing true/false answer missing instead of making it « Faux »', () => {
    const key = normalizeAiKey({
      answers: [
        {
          questionId: 'q1',
          kind: 'true_false',
          correctChoiceIds: null,
          correct: null,
          pairs: null,
          orderedIds: null,
          sampleAnswer: null,
          acceptableAnswers: null,
          explanation: '',
        },
      ],
      solution: '',
    });
    expect(key!.answers[0]).toMatchObject({ kind: 'true_false', correct: null });
  });

  it('15. fixes French typography, but not in the English half of a family guide', () => {
    const ai = sampleVersion('reading_passage');
    const content = normalizeAiContent('reading_passage', {
      ...ai,
      text: "  L'idée principale, en 3ème année et en 1ère année: « le castor » et «la hutte».  ",
    });
    expect(content.text).toBe(
      `L’idée principale, en 3e année et en 1re année${NBSP}: «${NBSP}le castor${NBSP}» et «${NBSP}la hutte${NBSP}».`,
    );
    // Times and addresses keep their colon.
    expect(
      normalizeAiContent('reading_passage', { ...ai, text: 'À 8:45, voir https://exemple.ca' })
        .text,
    ).toBe('À 8:45, voir https://exemple.ca');

    const guide = sampleVersion('parent_guide') as {
      fr: Record<string, unknown>;
      en: Record<string, unknown>;
    };
    const english = "Note: it's the 3ème time: « ok »";
    const normalized = normalizeAiContent('parent_guide', {
      ...guide,
      fr: { ...guide.fr, intro: "Note: c'est l'automne" },
      en: { ...guide.en, intro: english },
    });
    expect(normalized.fr.intro).toBe(`Note${NBSP}: c’est l’automne`);
    expect(normalized.en.intro).toBe(english);
  });

  it('16. scrambles, deterministically, an ordering question left in answer order', () => {
    const ai = sampleVersion('quiz');
    const questions = (ai.questions as Record<string, unknown>[]).map((q) =>
      q.kind === 'ordering'
        ? {
            ...q,
            items: [
              { id: 'i1', text: '170' },
              { id: 'i2', text: '701' },
              { id: 'i3', text: '710' },
            ],
          }
        : q,
    );
    const raw = { content: { ...ai, questions }, answerKey: sampleKey('quiz', ai) };
    const first = normalizeAiVersion('quiz', raw);
    const second = normalizeAiVersion('quiz', raw);
    const ordering = first.content.questions.find((q) => q.kind === 'ordering')!;
    const order = ordering.kind === 'ordering' ? ordering.items.map((i) => i.id) : [];
    expect(order).not.toEqual(['i1', 'i2', 'i3']);
    expect(order.sort()).toEqual(['i1', 'i2', 'i3']);
    expect(second).toEqual(first);
    expect(validateAnswerKey('quiz', first.content, first.answerKey)).toEqual([]);
  });

  it('16b. scrambles a matching right column left in the order of the left column', () => {
    const ai = sampleVersion('quiz');
    const questions = (ai.questions as Record<string, unknown>[]).map((q) =>
      q.kind === 'matching'
        ? {
            ...q,
            right: [
              { id: 'r1', text: '345' },
              { id: 'r2', text: '504' },
              { id: 'r3', text: '540' },
            ],
          }
        : q,
    );
    const { content } = normalizeAiVersion('quiz', {
      content: { ...ai, questions },
      answerKey: sampleKey('quiz', ai),
    });
    const matching = content.questions.find((q) => q.kind === 'matching')!;
    const right = matching.kind === 'matching' ? matching.right.map((r) => r.id) : [];
    expect(right.indexOf('r1')).toBeGreaterThan(right.indexOf('r2'));
  });

  it('17. faith words set faithContent', () => {
    const passage = normalizeAiContent('reading_passage', sampleVersion('reading_passage'));
    expect(aiFaithContent('reading_passage', [passage], false)).toBe(false);
    expect(aiFaithContent('reading_passage', [passage], true)).toBe(true);
    const prayer = { ...passage, text: `${passage.text}\n\nTerminons par une courte prière.` };
    expect(aiFaithContent('reading_passage', [passage, prayer], false)).toBe(true);
    const river = { ...passage, text: 'Le fleuve Saint-Laurent coule vers l’est.' };
    expect(aiFaithContent('reading_passage', [river], false)).toBe(false);
  });

  it('normalizes safety notes to the canonical shape', () => {
    const notes = normalizeSafetyNotes({
      ageSuitability: ' 8 à 11 ans ',
      allergyAwareMaterials: 'Élastiques sans latex',
      supervision: 'Adult only',
      hazards: null,
    });
    expect(notes).toEqual({
      ageSuitability: '8 à 11 ans',
      allergyAwareMaterials: 'Élastiques sans latex',
      supervision: 'adult_only',
      hazards: [],
      notes: '',
    });
    expect(safetyNotesSchema('final').safeParse(notes).success).toBe(true);
    expect(normalizeSafetyNotes({ supervision: 'étroite' })!.supervision).toBe('close');
    expect(normalizeSafetyNotes(null)).toBeNull();
  });

  it('never throws on garbage', () => {
    for (const raw of [null, 3, 'texte', [], { questions: 'non' }]) {
      expect(() => normalizeAiContent('quiz', raw)).not.toThrow();
      expect(() => normalizeAiKey(raw)).not.toThrow();
      expect(() => normalizeSafetyNotes(raw)).not.toThrow();
    }
    expect(normalizeAiContent('quiz', null)).toEqual({
      title: '',
      objective: '',
      teacherNote: '',
      instructions: '',
      questions: [],
    });
  });
});
