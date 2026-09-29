/**
 * Saved « Texte différencié » results as ordinary library content (DECISIONS P-13): the
 * teacher's original text is the base version, each level a version with the same objective,
 * and questions become short answers whose keys wait for a sample answer. Limits follow
 * Phase 2: texts up to 40,000 characters, empty glossary definitions allowed.
 */
import type { AnswerKey } from './questions';
import { emptyContent, type ContentOf } from './schemas';

export type DifferentiationItemType = 'reading_passage' | 'worksheet';

/** The job input (`differentiateInputSchema`), as far as it matters here. */
export interface DifferentiationInput {
  title: string;
  text: string;
  itemType: DifferentiationItemType;
}

/** The result as the teacher saves it (`DifferentiationResult` in the web app). */
export interface DifferentiationResult {
  title: string;
  objective: string;
  versions: readonly {
    languageLevelId: string;
    title: string;
    text: string;
    glossary: readonly { term: string; definition: string }[];
    visualSupports: readonly string[];
    questions: readonly string[];
    teacherNote: string;
  }[];
}

export interface DifferentiationVersion {
  languageLevelId: string | null;
  content: ContentOf<DifferentiationItemType>;
  answerKey: AnswerKey | null;
}

export function fromDifferentiation(
  input: DifferentiationInput,
  result: DifferentiationResult,
): { versions: DifferentiationVersion[] } {
  const type = input.itemType;
  const base: DifferentiationVersion = {
    languageLevelId: null,
    content: {
      ...emptyContent(type),
      title: input.title,
      objective: result.objective,
      text: input.text,
    },
    answerKey: null,
  };
  const levels = result.versions.map((v): DifferentiationVersion => {
    const questions = v.questions.map((prompt, i) => ({
      id: `q${i + 1}`,
      kind: 'short_answer' as const,
      prompt,
      hint: '',
      points: null,
      category: null,
      lines: 3,
    }));
    return {
      languageLevelId: v.languageLevelId,
      content: {
        ...emptyContent(type),
        title: v.title,
        objective: result.objective,
        teacherNote: v.teacherNote,
        text: v.text,
        glossary: v.glossary.map((g) => ({ term: g.term, definition: g.definition })),
        visualSupports: [...v.visualSupports],
        questions,
      },
      answerKey: questions.length
        ? {
            answers: questions.map((q) => ({
              questionId: q.id,
              kind: 'short_answer' as const,
              sampleAnswer: '',
              acceptableAnswers: [],
              explanation: '',
            })),
            solution: '',
          }
        : null,
    };
  });
  return { versions: [base, ...levels] };
}
