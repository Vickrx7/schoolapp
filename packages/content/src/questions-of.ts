/**
 * Where each type keeps its questions. Numbering follows this order everywhere (student sheet,
 * teacher copy, answer key), so answers line up with questions.
 */
import type { LibraryItemType } from './catalog';
import { isPlainObject } from './conform';
import type { Question } from './questions';

export type ContentPath = (string | number)[];

/** A list of questions at `list`, or inside each element of `list` at `inner`. */
export interface QuestionListSpec {
  list: string;
  inner?: string;
}

export const QUESTION_LISTS: Partial<Record<LibraryItemType, readonly QuestionListSpec[]>> = {
  worked_example: [{ list: 'practice' }],
  worksheet: [{ list: 'questions' }],
  reading_passage: [{ list: 'questions' }],
  exit_ticket: [{ list: 'questions' }],
  experiment: [{ list: 'conclusionQuestions' }],
  stem_challenge: [{ list: 'reflectionQuestions' }],
  quiz: [{ list: 'questions' }],
  unit_test: [{ list: 'sections', inner: 'questions' }],
  diagnostic: [{ list: 'questions' }],
  game: [{ list: 'questions' }],
  riddle: [{ list: 'riddles' }],
};

export interface LocatedQuestion {
  path: ContentPath;
  question: Question;
}

/** Every question of a content, in display order, with its path. */
export function questionsOf(type: LibraryItemType, content: unknown): LocatedQuestion[] {
  const found: LocatedQuestion[] = [];
  mapQuestions(type, content, (question, path) => {
    found.push({ path, question: question as unknown as Question });
    return question;
  });
  return found;
}

/**
 * Returns a copy of `content` where every question is replaced by `fn(question, path)`.
 * Values that are not objects are left as they are.
 */
export function mapQuestions<T>(
  type: LibraryItemType,
  content: T,
  fn: (question: Record<string, unknown>, path: ContentPath) => unknown,
): T {
  const specs = QUESTION_LISTS[type];
  if (!specs || !isPlainObject(content)) return content;
  const result: Record<string, unknown> = { ...content };
  const mapList = (list: unknown, path: ContentPath): unknown =>
    Array.isArray(list) ? list.map((q, i) => (isPlainObject(q) ? fn(q, [...path, i]) : q)) : list;
  for (const spec of specs) {
    const outer = result[spec.list];
    if (!spec.inner) {
      result[spec.list] = mapList(outer, [spec.list]);
    } else if (Array.isArray(outer)) {
      const inner = spec.inner;
      result[spec.list] = outer.map((section, i) =>
        isPlainObject(section)
          ? { ...section, [inner]: mapList(section[inner], [spec.list, i, inner]) }
          : section,
      );
    }
  }
  return result as T;
}
