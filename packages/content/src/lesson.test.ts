import { describe, expect, it } from 'vitest';
import { lessonFromItem, LESSON_LIMITS } from './lesson';
import { sampleCanonical } from './samples';
import { NBSP } from './style';

const EXPECTATIONS = [
  { code: 'B1.2', text: 'Comparer et ordonner des nombres naturels jusqu’à 1 000.' },
  { code: 'B1.3', text: 'Arrondir des nombres naturels.' },
];

describe('lesson', () => {
  it('45. flattens a lesson plan with minutes and copies its sub notes', () => {
    const { content } = sampleCanonical('lesson_plan', { objective: '' });
    const lesson = lessonFromItem(
      {
        type: 'lesson_plan',
        title: 'Trouver l’idée principale',
        materials: 'Texte, crayons',
        durationMinutes: 30,
        subjectCode: 'fra',
      },
      content,
      EXPECTATIONS,
    );
    expect(lesson.title).toBe('Trouver l’idée principale');
    expect(lesson.content).toContain(
      'Avant\n\n1. (5\u00a0min) Présenter l’intention d’apprentissage',
    );
    expect(lesson.content).toContain(`À dire${NBSP}: «${NBSP}Aujourd’hui`);
    expect(lesson.content).toContain('Pendant\n\n1. (10\u00a0min) Lire le texte');
    expect(lesson.content).toContain('Critères de réussite');
    expect(lesson.content).not.toContain(content.subNotes);
    expect(lesson.subNotes).toBe(content.subNotes);
    expect(lesson.materials).toBe('Texte, crayons');
    expect(lesson.durationMinutes).toBe(30);
    // No objective on the item: the attente texts.
    expect(lesson.objectives).toBe(EXPECTATIONS.map((e) => e.text).join('\n'));
  });

  it('45. hands out a worksheet with its instructions', () => {
    const { content } = sampleCanonical('worksheet', { title: '' });
    const lesson = lessonFromItem(
      { type: 'worksheet', title: 'Ordonner des nombres', materials: null, durationMinutes: null },
      content,
      [],
    );
    expect(lesson.content).toBe(
      `Distribuez la feuille «${NBSP}Ordonner des nombres${NBSP}».\n\n${content.instructions}`,
    );
    expect(lesson.objectives).toBe(content.objective);
    expect(lesson.subNotes).toBe('');
    expect(lesson.materials).toBe('');
  });

  it('45. cuts the title to 160 characters and the content to 20,000', () => {
    const { content } = sampleCanonical('worksheet');
    const lesson = lessonFromItem(
      { type: 'worksheet', title: 'T'.repeat(300), materials: 'M', durationMinutes: 30 },
      { ...content, title: '', instructions: 'x'.repeat(30_000) },
      [],
    );
    expect(lesson.title).toHaveLength(LESSON_LIMITS.title);
    expect(lesson.title.endsWith('…')).toBe(true);
    expect(lesson.content).toHaveLength(LESSON_LIMITS.content);
  });

  it('outlines a project', () => {
    const { content } = sampleCanonical('project');
    const lesson = lessonFromItem(
      { type: 'project', title: 'Projet', materials: null, durationMinutes: 240 },
      content,
      [],
    );
    expect(lesson.content).toContain('Question directrice');
    expect(lesson.content).toContain('1 séance');
  });
});
