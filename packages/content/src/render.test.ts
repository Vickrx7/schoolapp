import { describe, expect, it } from 'vitest';
import { LIBRARY_ITEM_TYPES } from './catalog';
import { renderedDocSchema, type DocBlock, type QuestionBlock } from './render/doc';
import { lessonPhaseLabels } from './render/labels-fr';
import { docToPlainText } from './render/plain';
import { renderStudentDoc } from './render/student';
import { renderAnswerKeyDoc, renderTeacherDoc } from './render/teacher';
import { sampleCanonical, sampleSafetyNotes } from './samples';
import { NBSP } from './style';
import {
  KEY_SENTINEL,
  STUDENT_TYPES,
  TEACHER_SENTINEL,
  withTeacherSentinels,
} from './test-fixtures';

const questionBlocks = (blocks: DocBlock[]): QuestionBlock[] =>
  blocks.flatMap((b) =>
    b.type === 'question' ? [b] : b.type === 'section' ? questionBlocks(b.blocks) : [],
  );

describe('render', () => {
  it('32. every student document parses and holds no key or teacher-only text', () => {
    for (const type of STUDENT_TYPES) {
      const content = withTeacherSentinels(type);
      const doc = renderStudentDoc(type, content, { itemTitle: 'Titre', number: 2 });
      expect(doc, type).not.toBeNull();
      const parsed = renderedDocSchema.safeParse(doc);
      expect(parsed.error?.issues ?? [], type).toEqual([]);
      const json = JSON.stringify(doc);
      expect(json, type).not.toContain(TEACHER_SENTINEL);
      expect(json, type).not.toContain(KEY_SENTINEL);
      // Answers from the sample key never appear.
      const { answerKey } = sampleCanonical(type);
      for (const entry of answerKey?.answers ?? []) {
        if (entry.explanation) expect(json, type).not.toContain(entry.explanation);
        if (entry.kind === 'short_answer' && entry.sampleAnswer) {
          expect(json, type).not.toContain(entry.sampleAnswer);
        }
      }
      if (answerKey?.solution) expect(json, type).not.toContain(answerKey.solution);
    }
    for (const type of ['lesson_plan', 'teacher_guide'] as const) {
      expect(
        renderStudentDoc(type, sampleCanonical(type).content, { itemTitle: 'T', number: 1 }),
      ).toBeNull();
    }
  });

  it('32b. every teacher and answer-key document parses', () => {
    for (const type of LIBRARY_ITEM_TYPES) {
      const { content, answerKey } = sampleCanonical(type);
      const teacher = renderTeacherDoc({ itemTitle: 'Titre' }, type, content);
      expect(renderedDocSchema.safeParse(teacher).error?.issues ?? [], type).toEqual([]);
      const key = renderAnswerKeyDoc(type, content, answerKey, { number: 1 });
      expect(renderedDocSchema.safeParse(key).error?.issues ?? [], type).toEqual([]);
    }
  });

  it('33. the answer key numbers answers like the student sheet', () => {
    for (const type of ['quiz', 'unit_test', 'worked_example', 'riddle', 'experiment'] as const) {
      const { content, answerKey } = sampleCanonical(type);
      const student = renderStudentDoc(type, content, { itemTitle: 'T', number: 3 })!;
      const key = renderAnswerKeyDoc(type, content, answerKey, { number: 3 });
      const numbers = questionBlocks(student.blocks).map((q) => q.number);
      const answers = key.blocks.flatMap((b) => (b.type === 'answer' ? [b.number] : []));
      expect(numbers.length, type).toBeGreaterThan(0);
      expect(answers, type).toEqual(numbers);
      expect(numbers).toEqual(numbers.map((_, i) => i + 1));
      expect(key.title).toBe('Corrigé — version 3');
    }
    // The unit test continues numbering across sections.
    const test = sampleCanonical('unit_test');
    const doc = renderStudentDoc('unit_test', test.content, { itemTitle: 'T', number: 1 })!;
    expect(questionBlocks(doc.blocks).map((q) => q.number)).toEqual([1, 2, 3]);
    const key = renderAnswerKeyDoc(
      'quiz',
      sampleCanonical('quiz').content,
      sampleCanonical('quiz').answerKey,
      {
        number: 1,
      },
    );
    const texts = key.blocks.flatMap((b) => (b.type === 'answer' ? [b.text] : []));
    expect(texts[0]).toBe('B) 893');
    expect(texts[1]).toBe('Vrai');
    expect(texts[3]).toBe(`Ordre attendu${NBSP}: 3, 1, 2`);
  });

  it('34. the teacher document flags unverified attentes, safety and faith', () => {
    const { content } = sampleCanonical('experiment');
    const doc = renderTeacherDoc(
      {
        itemTitle: 'Éponges',
        gradeLabels: ['5e année'],
        subjectLabel: 'Sciences et technologie',
        durationMinutes: 45,
        materials: 'Éponges, élastiques sans latex',
        expectations: [
          { code: 'D2.1', text: 'Distinguer les forces internes.', verified: false },
          { code: 'D2', text: 'Comprendre les forces.', verified: true },
        ],
        safetyNotes: sampleSafetyNotes(),
        faith: {
          connection: 'Prendre soin de la création.',
          referenceTitle: 'Prendre soin de la création',
        },
      },
      'experiment',
      content,
    );
    const text = docToPlainText(doc);
    expect(text).toContain('D2.1 — Distinguer les forces internes. (à vérifier)');
    expect(text).not.toContain('Comprendre les forces. (à vérifier)');
    const callouts = doc.blocks.flatMap((b) => (b.type === 'callout' ? [b.tone] : []));
    expect(callouts).toContain('safety');
    expect(callouts).toContain('faith');
    expect(text).toContain(`Supervision${NBSP}: Supervision habituelle`);

    const faith = { connection: 'Un lien avec la foi.', onStudentSheet: false };
    const hidden = renderStudentDoc('reading_passage', sampleCanonical('reading_passage').content, {
      itemTitle: 'T',
      number: 1,
      faith,
    })!;
    expect(hidden.blocks.some((b) => b.type === 'callout' && b.tone === 'faith')).toBe(false);
    const shown = renderStudentDoc('reading_passage', sampleCanonical('reading_passage').content, {
      itemTitle: 'T',
      number: 1,
      faith: { ...faith, onStudentSheet: true },
    })!;
    expect(shown.blocks.some((b) => b.type === 'callout' && b.tone === 'faith')).toBe(true);
    const reflection = renderStudentDoc(
      'catholic_reflection',
      sampleCanonical('catholic_reflection').content,
      {
        itemTitle: 'T',
        number: 1,
        faith,
      },
    )!;
    expect(reflection.blocks.some((b) => b.type === 'callout' && b.tone === 'faith')).toBe(true);
  });

  it('34b. category labels are on the teacher copy only', () => {
    const { content } = sampleCanonical('unit_test');
    const student = renderStudentDoc('unit_test', content, { itemTitle: 'T', number: 1 })!;
    const teacher = renderTeacherDoc({ itemTitle: 'T' }, 'unit_test', content);
    expect(questionBlocks(student.blocks).every((q) => q.category === null)).toBe(true);
    expect(questionBlocks(teacher.blocks)[0]!.category).toBe('Connaissance et compréhension');
  });

  it('35. ordering items and matching right columns render in display order', () => {
    const { content } = sampleCanonical('quiz');
    const doc = renderStudentDoc('quiz', content, { itemTitle: 'T', number: 1 })!;
    const blocks = questionBlocks(doc.blocks);
    const ordering = content.questions.find((q) => q.kind === 'ordering')!;
    const matching = content.questions.find((q) => q.kind === 'matching')!;
    expect(blocks.find((b) => b.kind === 'ordering')!.choices.map((c) => c.text)).toEqual(
      ordering.kind === 'ordering' ? ordering.items.map((i) => i.text) : [],
    );
    const right = blocks.find((b) => b.kind === 'matching')!.right;
    expect(right).toEqual(
      matching.kind === 'matching'
        ? matching.right.map((r, i) => ({ label: 'ABC'[i], text: r.text }))
        : [],
    );
    expect(blocks.find((b) => b.kind === 'multiple_choice')!.choices.map((c) => c.label)).toEqual([
      'A',
      'B',
      'C',
    ]);
  });

  it('36. the English half of a family guide is an en-CA section', () => {
    const doc = renderStudentDoc('parent_guide', sampleCanonical('parent_guide').content, {
      itemTitle: 'Guide',
      number: null,
    })!;
    expect(doc.lang).toBe('fr-CA');
    const sections = doc.blocks.flatMap((b) => (b.type === 'section' ? [b] : []));
    expect(sections.map((s) => s.lang)).toEqual(['fr-CA', 'en-CA']);
    expect(JSON.stringify(sections[1])).toContain('What we are learning');
    expect(JSON.stringify(sections[1])).not.toContain('Ce que nous apprenons');
  });

  it('37. docToPlainText is readable', () => {
    const { content } = sampleCanonical('quiz');
    const doc = renderStudentDoc('quiz', content, { itemTitle: 'Quiz des nombres', number: 1 })!;
    const text = docToPlainText(doc);
    expect(text.startsWith('Quiz des nombres')).toBe(true);
    expect(text).toContain('1. Quel nombre est le plus grand? (1 point)');
    expect(text).toContain('   A) 389');
    expect(text).toContain('   [ ] Vrai');
    expect(text).toContain('\n\n');
    expect(text).not.toMatch(/undefined|null|\[object Object\]/);
    for (const type of LIBRARY_ITEM_TYPES) {
      const teacher = docToPlainText(
        renderTeacherDoc({ itemTitle: 'T' }, type, sampleCanonical(type).content),
      );
      expect(teacher, type).not.toMatch(/undefined|\[object Object\]/);
    }
  });

  it('37b. a sheet students fill in starts with « Nom » and « Date », never a level', () => {
    const writes = (blocks: DocBlock[]): boolean =>
      blocks.some((b) =>
        b.type === 'section' ? writes(b.blocks) : b.type === 'question' || b.type === 'lines',
      );
    let filled = 0;
    for (const type of STUDENT_TYPES) {
      const doc = renderStudentDoc(type, sampleCanonical(type).content, {
        itemTitle: 'T',
        number: 2,
      })!;
      const nameLines = doc.blocks.filter((b) => b.type === 'nameLine');
      if (writes(doc.blocks)) {
        filled += 1;
        expect(doc.blocks[0], type).toEqual({ type: 'nameLine', labels: ['Nom', 'Date'] });
        expect(nameLines, type).toHaveLength(1);
      } else {
        expect(nameLines, type).toEqual([]);
      }
    }
    expect(filled).toBeGreaterThan(5);
    const quiz = renderStudentDoc('quiz', sampleCanonical('quiz').content, {
      itemTitle: 'Quiz',
      number: 1,
    })!;
    const text = docToPlainText(quiz);
    expect(text).toContain(`Nom${NBSP}: ________________   Date${NBSP}: ________________`);
    expect(text).not.toMatch(/Débutant|Intermédiaire|Avancé|Enrichi|niveau/i);
    // Teacher copies and answer keys have none.
    const teacher = renderTeacherDoc({ itemTitle: 'T' }, 'quiz', sampleCanonical('quiz').content);
    expect(teacher.blocks.some((b) => b.type === 'nameLine')).toBe(false);
  });

  it('38. lesson phases follow the subject', () => {
    expect(lessonPhaseLabels('mat')).toEqual({
      opening: 'Mise en train',
      development: 'Exploration',
      closing: 'Objectivation',
    });
    expect(lessonPhaseLabels('fra')).toEqual({
      opening: 'Avant',
      development: 'Pendant',
      closing: 'Après',
    });
    expect(lessonPhaseLabels(null)).toEqual(lessonPhaseLabels('sci'));
    const plan = renderTeacherDoc(
      { itemTitle: 'T', subjectCode: 'mat' },
      'lesson_plan',
      sampleCanonical('lesson_plan').content,
    );
    const headings = plan.blocks.flatMap((b) => (b.type === 'heading' ? [b.text] : []));
    expect(headings).toEqual(
      expect.arrayContaining(['Mise en train', 'Exploration', 'Objectivation']),
    );
  });

  it('renders content that fails the schema without throwing', () => {
    const broken = { questions: [{ kind: 'essay', prompt: 'x' }, 'texte', null], instructions: 3 };
    const doc = renderStudentDoc('quiz', broken, { itemTitle: 'T', number: 1 })!;
    expect(renderedDocSchema.safeParse(doc).success).toBe(true);
    expect(questionBlocks(doc.blocks)).toEqual([]);
  });
});
