/**
 * Consistency between a content's questions and its answer key (DECISIONS D-062): one entry per
 * question, of the same kind, pointing at choices that exist. Structural sizes are checked by
 * the schemas; this checks what the schemas cannot see. Only errors are reported here: a short
 * answer without a sample answer is a readiness warning (`readiness.ts`).
 */
import type { LibraryItemType } from './catalog';
import { questionsOf, type ContentPath } from './questions-of';
import type { AnswerEntry, AnswerKey, Question } from './questions';

export type KeyIssueCode =
  | 'duplicateQuestionId'
  | 'duplicateOptionId'
  | 'missingAnswer'
  | 'unknownQuestion'
  | 'duplicateAnswer'
  | 'wrongKind'
  | 'noCorrectChoice'
  | 'unknownChoice'
  | 'duplicateChoice'
  | 'tooManyCorrect'
  | 'unknownLeft'
  | 'unknownRight'
  | 'duplicateLeft'
  | 'duplicateRight'
  | 'unpairedLeft'
  | 'notPermutation'
  | 'orderGivesAnswer';

export interface KeyIssue {
  code: KeyIssueCode;
  /** Whether `path` points into the content or into the answer key. */
  where: 'content' | 'key';
  path: ContentPath;
  questionId?: string;
}

function optionIds(question: Question): { path: string; ids: string[] }[] {
  switch (question.kind) {
    case 'multiple_choice':
      return [{ path: 'choices', ids: question.choices.map((c) => c.id) }];
    case 'matching':
      return [
        { path: 'left', ids: question.left.map((c) => c.id) },
        { path: 'right', ids: question.right.map((c) => c.id) },
      ];
    case 'ordering':
      return [{ path: 'items', ids: question.items.map((c) => c.id) }];
    default:
      return [];
  }
}

function checkEntry(
  question: Question,
  entry: AnswerEntry,
  keyPath: ContentPath,
  contentPath: ContentPath,
): KeyIssue[] {
  const issues: KeyIssue[] = [];
  const questionId = question.id;
  const onKey = (code: KeyIssueCode, path: ContentPath = []) =>
    issues.push({ code, where: 'key', path: [...keyPath, ...path], questionId });

  if (entry.kind !== question.kind) {
    onKey('wrongKind', ['kind']);
    return issues;
  }
  switch (question.kind) {
    case 'multiple_choice': {
      const { correctChoiceIds } = entry as Extract<AnswerEntry, { kind: 'multiple_choice' }>;
      const choices = new Set(question.choices.map((c) => c.id));
      if (!correctChoiceIds.length) onKey('noCorrectChoice', ['correctChoiceIds']);
      correctChoiceIds.forEach((id, i) => {
        if (!choices.has(id)) onKey('unknownChoice', ['correctChoiceIds', i]);
        else if (correctChoiceIds.indexOf(id) !== i)
          onKey('duplicateChoice', ['correctChoiceIds', i]);
      });
      if (!question.multipleAnswers && new Set(correctChoiceIds).size > 1) {
        onKey('tooManyCorrect', ['correctChoiceIds']);
      }
      break;
    }
    case 'matching': {
      const { pairs } = entry as Extract<AnswerEntry, { kind: 'matching' }>;
      const left = new Set(question.left.map((c) => c.id));
      const right = new Set(question.right.map((c) => c.id));
      const usedLeft = new Set<string>();
      const usedRight = new Set<string>();
      pairs.forEach((pair, i) => {
        if (!left.has(pair.leftId)) onKey('unknownLeft', ['pairs', i, 'leftId']);
        else if (usedLeft.has(pair.leftId)) onKey('duplicateLeft', ['pairs', i, 'leftId']);
        if (!right.has(pair.rightId)) onKey('unknownRight', ['pairs', i, 'rightId']);
        else if (usedRight.has(pair.rightId)) onKey('duplicateRight', ['pairs', i, 'rightId']);
        usedLeft.add(pair.leftId);
        usedRight.add(pair.rightId);
      });
      // Every left item exactly once; extra right items are allowed.
      question.left.forEach((item, i) => {
        if (!usedLeft.has(item.id)) {
          issues.push({
            code: 'unpairedLeft',
            where: 'content',
            path: [...contentPath, 'left', i],
            questionId,
          });
        }
      });
      break;
    }
    case 'ordering': {
      const { orderedIds } = entry as Extract<AnswerEntry, { kind: 'ordering' }>;
      const display = question.items.map((c) => c.id);
      const permutation =
        orderedIds.length === display.length &&
        new Set(orderedIds).size === orderedIds.length &&
        orderedIds.every((id) => display.includes(id));
      if (!permutation) onKey('notPermutation', ['orderedIds']);
      else if (display.length >= 2 && orderedIds.every((id, i) => id === display[i])) {
        onKey('orderGivesAnswer', ['orderedIds']);
      }
      break;
    }
    default:
      break;
  }
  return issues;
}

export function validateAnswerKey(
  type: LibraryItemType,
  content: unknown,
  key: AnswerKey | null,
): KeyIssue[] {
  const issues: KeyIssue[] = [];
  const questions = questionsOf(type, content);

  const seen = new Set<string>();
  for (const { path, question } of questions) {
    if (seen.has(question.id)) {
      issues.push({
        code: 'duplicateQuestionId',
        where: 'content',
        path: [...path, 'id'],
        questionId: question.id,
      });
    }
    seen.add(question.id);
    for (const group of optionIds(question)) {
      group.ids.forEach((id, i) => {
        if (group.ids.indexOf(id) !== i) {
          issues.push({
            code: 'duplicateOptionId',
            where: 'content',
            path: [...path, group.path, i, 'id'],
            questionId: question.id,
          });
        }
      });
    }
  }

  const answers = key?.answers ?? [];
  const entries = new Map<string, number>();
  answers.forEach((entry, index) => {
    if (!seen.has(entry.questionId)) {
      issues.push({
        code: 'unknownQuestion',
        where: 'key',
        path: ['answers', index, 'questionId'],
        questionId: entry.questionId,
      });
    } else if (entries.has(entry.questionId)) {
      issues.push({
        code: 'duplicateAnswer',
        where: 'key',
        path: ['answers', index, 'questionId'],
        questionId: entry.questionId,
      });
    } else {
      entries.set(entry.questionId, index);
    }
  });

  const checked = new Set<string>();
  for (const { path, question } of questions) {
    if (checked.has(question.id)) continue;
    checked.add(question.id);
    const index = entries.get(question.id);
    if (index === undefined) {
      issues.push({
        code: 'missingAnswer',
        where: 'key',
        path: ['answers'],
        questionId: question.id,
      });
      continue;
    }
    issues.push(...checkEntry(question, answers[index]!, ['answers', index], path));
  }
  return issues;
}

/** The entry of a question, if any. */
export function answerFor(key: AnswerKey | null, questionId: string): AnswerEntry | undefined {
  return key?.answers.find((a) => a.questionId === questionId);
}
