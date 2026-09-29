/**
 * Pratiquer: worksheets, learning centres, reading passages, vocabulary banks, exit tickets.
 */
import { common, glossaryEntry, type SchemaContext } from './shared';

/** Saved « Texte différencié » results are worksheets or reading passages (D-073). */
export function worksheet({ k, q }: SchemaContext) {
  const schema = k.obj({
    ...common(k),
    instructions: k.optText(4000),
    text: k.optText(40_000),
    glossary: k.list(glossaryEntry(k), 0, 30),
    questions: k.list(q.question, 0, 30),
    /** Teacher-only suggestions of visual supports. */
    visualSupports: k.list(k.text(300), 0, 10),
  });
  if (k.mode !== 'final') return schema;
  // A worksheet needs something to do: questions, instructions or a text.
  return schema.superRefine((value, ctx) => {
    if (!value.questions.length && !value.instructions.trim() && !value.text.trim()) {
      ctx.addIssue({ code: 'custom', path: ['instructions'], message: 'worksheetEmpty' });
    }
  });
}

export function learningCentre({ k }: SchemaContext) {
  return k.obj({
    ...common(k),
    /** Teacher-only: how to set the centre up. */
    setup: k.text(2000),
    groupSize: k.optText(60),
    studentSteps: k.list(k.text(500), 1, 10),
    extension: k.optText(1000),
    cleanup: k.optText(500),
  });
}

export function readingPassage({ k, q }: SchemaContext) {
  return k.obj({
    ...common(k),
    text: k.text(40_000),
    glossary: k.list(glossaryEntry(k), 0, 30),
    questions: k.list(q.question, 0, 20),
    visualSupports: k.list(k.text(300), 0, 10),
  });
}

export const WORD_CLASSES = ['nom', 'verbe', 'adjectif', 'adverbe', 'expression', 'autre'] as const;
export const GRAMMATICAL_GENDERS = ['m', 'f'] as const;

export function vocabularyBank({ k }: SchemaContext) {
  return k.obj({
    ...common(k),
    theme: k.text(120),
    words: k.list(
      k.obj({
        term: k.text(80),
        definition: k.text(300),
        example: k.optText(300),
        wordClass: k.enumOf(WORD_CLASSES).nullable(),
        gender: k.enumOf(GRAMMATICAL_GENDERS).nullable(),
      }),
      1,
      40,
    ),
    /** Teacher-only. */
    activityIdeas: k.list(k.text(300), 0, 6),
  });
}

export function exitTicket({ k, q }: SchemaContext) {
  return k.obj({
    ...common(k),
    prompt: k.optText(300),
    questions: k.list(q.question, 1, 3),
  });
}
