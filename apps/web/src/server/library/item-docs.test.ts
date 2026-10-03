import { sampleCanonical, type LibraryItemType } from '@lynx/content';
import { describe, expect, it } from 'vitest';
import { studentVersionDocs, teacherVersionDocs } from './item-docs';
import type { LibraryItemView } from './view-model';

const KEY_SENTINEL = 'SENTINELLE-CORRIGE';
const TEACHER_SENTINEL = 'SENTINELLE-ENSEIGNANT';

function view(type: LibraryItemType, over: Partial<LibraryItemView> = {}): LibraryItemView {
  return {
    id: 'item',
    boardId: 'board',
    schoolId: null,
    schoolName: null,
    type,
    bucket: 'pratiquer',
    title: 'Les nombres jusqu’à 1 000',
    summary: null,
    status: 'board_approved',
    shareScope: 'board',
    source: 'board_created',
    requested: false,
    mine: false,
    boardOwn: true,
    authorName: null,
    subject: { id: 'mat', code: 'mat', label: 'Mathématiques', labelFr: 'Mathématiques' },
    grades: [{ code: '3', label: '3e année', labelFr: '3e année' }],
    expectations: [
      {
        id: 'e1',
        code: 'B1.2',
        text: 'Comparer et ordonner des nombres naturels jusqu’à 1 000.',
        textFr: 'Comparer et ordonner des nombres naturels jusqu’à 1 000.',
        verified: false,
        kind: 'specific',
      },
    ],
    tags: [],
    keywords: null,
    durationMinutes: 30,
    materials: 'Crayons',
    licence: null,
    formats: { printable: true, projectable: false, interactive: false },
    subFriendly: false,
    safetyNotes: null,
    faith: {
      content: false,
      connection: null,
      referenceId: null,
      referenceTitle: null,
      onStudentSheet: false,
      requiresReview: false,
      reviewed: false,
    },
    provenance: {
      aiFeature: null,
      promptVersion: null,
      model: null,
      packTitle: null,
      packVersion: null,
      createdAt: '2026-09-01T12:00:00Z',
      updatedAt: '2026-09-01T12:00:00Z',
      approvedAt: null,
      usageCount: 0,
    },
    contentRevision: 1,
    canEdit: false,
    reviewerKinds: [],
    review: null,
    versions: [],
    hasKeys: true,
    adaptation: { isAdaptation: false, shareCapSchoolId: null, noDerivatives: false },
    ...over,
  };
}

/** A quiz whose key and teacher note carry sentinels. */
function quiz() {
  const { content, answerKey } = sampleCanonical('quiz');
  const key = structuredClone(answerKey)!;
  for (const answer of key.answers) answer.explanation = KEY_SENTINEL;
  key.solution = KEY_SENTINEL;
  return { content: { ...content, teacherNote: TEACHER_SENTINEL }, key };
}

describe('the documents of a version', () => {
  it('keeps the key and teacher notes off the student sheet, and on the teacher copy', () => {
    const { content, key } = quiz();
    const source = {
      type: 'quiz' as const,
      title: 'Quiz',
      faith: { connection: null, onStudentSheet: false },
    };
    const student = studentVersionDocs(source, { number: 2, content });
    expect(student.partial).toBe(false);
    expect(student.student?.number).toBe(2);
    const studentJson = JSON.stringify(student.student);
    expect(studentJson).not.toContain(KEY_SENTINEL);
    expect(studentJson).not.toContain(TEACHER_SENTINEL);

    const teacher = teacherVersionDocs(view('quiz'), { number: 2, content }, key);
    expect(JSON.stringify(teacher.teacher)).toContain(TEACHER_SENTINEL);
    expect(JSON.stringify(teacher.teacher)).not.toContain(KEY_SENTINEL);
    expect(teacher.answerKey?.title).toBe('Corrigé — version 2');
    expect(JSON.stringify(teacher.answerKey)).toContain(KEY_SENTINEL);
    expect(teacher.partial).toBe(false);
  });

  it('numbers the answers like the questions of the student sheet', () => {
    const { content, key } = quiz();
    const source = {
      type: 'quiz' as const,
      title: 'Quiz',
      faith: { connection: null, onStudentSheet: false },
    };
    const questions = studentVersionDocs(source, { number: 1, content }).student!.blocks.filter(
      (b) => b.type === 'question',
    );
    const answers = teacherVersionDocs(
      view('quiz'),
      { number: 1, content },
      key,
    ).answerKey!.blocks.filter((b) => b.type === 'answer');
    expect(answers.map((a) => a.number)).toEqual(questions.map((q) => q.number));
  });

  it('shows the attentes as « à vérifier » on the teacher copy', () => {
    const { content, key } = quiz();
    const teacher = teacherVersionDocs(view('quiz'), { number: 1, content }, key).teacher!;
    expect(JSON.stringify(teacher)).toContain(
      'B1.2 — Comparer et ordonner des nombres naturels jusqu’à 1 000. (à vérifier)',
    );
  });

  it('has no student sheet for teacher-only types', () => {
    const { content } = sampleCanonical('lesson_plan');
    const source = {
      type: 'lesson_plan' as const,
      title: 'Plan',
      faith: { connection: null, onStudentSheet: false },
    };
    expect(studentVersionDocs(source, { number: 1, content })).toEqual({
      student: null,
      partial: false,
    });
    const teacher = teacherVersionDocs(view('lesson_plan'), { number: 1, content }, null);
    expect(teacher.teacher).not.toBeNull();
    expect(teacher.answerKey).toBeNull();
  });

  it('prints the faith link for students only when the author chose so', () => {
    const { content } = sampleCanonical('worksheet');
    const faith = (onStudentSheet: boolean) => ({
      type: 'worksheet' as const,
      title: 'Fiche',
      faith: { connection: 'Prendre soin les uns des autres.', onStudentSheet },
    });
    const has = (onStudentSheet: boolean) =>
      studentVersionDocs(faith(onStudentSheet), { number: 1, content }).student!.blocks.some(
        (b) => b.type === 'callout' && b.tone === 'faith',
      );
    expect(has(false)).toBe(false);
    expect(has(true)).toBe(true);
  });

  it('puts the English half of a family guide in its own section', () => {
    const { content } = sampleCanonical('parent_guide');
    const source = {
      type: 'parent_guide' as const,
      title: 'Guide',
      faith: { connection: null, onStudentSheet: false },
    };
    const doc = studentVersionDocs(source, { number: 1, content }).student!;
    expect(doc.lang).toBe('fr-CA');
    expect(
      doc.blocks.filter((b) => b.type === 'section').map((b) => b.type === 'section' && b.lang),
    ).toEqual(['fr-CA', 'en-CA']);
  });

  it('renders what it can of content that fails the schema, and says so', () => {
    const { content } = sampleCanonical('quiz');
    const source = {
      type: 'quiz' as const,
      title: 'Quiz',
      faith: { connection: null, onStudentSheet: false },
    };
    // An unknown field (an older shape, or an answer slipped into the content).
    const odd = studentVersionDocs(source, { number: 1, content: { ...content, correct: 'B' } });
    expect(odd.partial).toBe(true);
    expect(odd.student?.blocks.some((b) => b.type === 'question')).toBe(true);
    expect(JSON.stringify(odd.student)).not.toContain('"correct"');
    // Not this type's content at all, or another schema version: nothing to show.
    expect(studentVersionDocs(source, { number: 1, content: { heading: 'x' } })).toEqual({
      student: null,
      partial: true,
    });
    expect(studentVersionDocs(source, { number: 1, content, schemaVersion: 2 })).toEqual({
      student: null,
      partial: true,
    });
    // An unfinished draft (fails `final` only) is not partial.
    const draft = studentVersionDocs(source, { number: 1, content: { ...content, questions: [] } });
    expect(draft.partial).toBe(false);
  });

  it('says so when a key cannot be read, and still lists the questions to answer', () => {
    const { content } = sampleCanonical('quiz');
    const teacher = teacherVersionDocs(view('quiz'), { number: 1, content }, { answers: 'oops' });
    expect(teacher.partial).toBe(true);
    expect(teacher.answerKey?.blocks.some((b) => b.type === 'answer')).toBe(true);
    // A keyed type without its key yet: « Réponse à ajouter ».
    const missing = teacherVersionDocs(view('quiz'), { number: 1, content }, null);
    expect(JSON.stringify(missing.answerKey)).toContain('Réponse à ajouter');
    expect(missing.partial).toBe(false);
  });
});
