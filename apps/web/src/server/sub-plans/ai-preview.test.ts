import type { SubPlanAiInput } from '@lynx/ai/features/sub-plan';
import { describe, expect, it } from 'vitest';
import { describeDropped, segmentsOf } from './ai-preview';

const input = {
  gradeLabels: ['3e année'],
  weekday: 'lundi',
  groups: [{ key: 'G1', levelLabel: 'Débutant', levelDescription: null, size: 3 }],
  faith: null,
  blocks: [
    {
      key: 'B2',
      ref: { blockKey: '60000000-0000-4000-8000-000000000001', lessonId: null },
      start: '09:45',
      end: '10:35',
      minutes: 50,
      status: 'normal',
      eventTitle: null,
      subjectLabel: 'Mathématiques',
      unitTitle: null,
      room: null,
      groups: ['G1'],
      lesson: null,
      fallback: 'Lecture libre.',
      needsActivity: true,
    },
  ],
} satisfies SubPlanAiInput;

describe('segmentsOf', () => {
  it('marks every replaced name, and never part of a longer marker', () => {
    expect(
      segmentsOf('Élève A aide Élève AB et Adulte A.', ['Élève A', 'Élève AB', 'Adulte A']),
    ).toEqual([
      { text: 'Élève A', placeholder: 'Élève A' },
      { text: ' aide ' },
      { text: 'Élève AB', placeholder: 'Élève AB' },
      { text: ' et ' },
      { text: 'Adulte A', placeholder: 'Adulte A' },
      { text: '.' },
    ]);
  });

  it('keeps the whole text when nothing was replaced', () => {
    expect(segmentsOf('Lecture du texte.', [])).toEqual([{ text: 'Lecture du texte.' }]);
    expect(segmentsOf('', [])).toEqual([]);
  });
});

describe('describeDropped', () => {
  it('names the period, group or part of the day a left-out field comes from', () => {
    expect(describeDropped({ path: 'blocks.B2.lesson.subNotes', kinds: ['phone'] }, input)).toEqual(
      {
        block: { start: '09:45', end: '10:35', subject: 'Mathématiques' },
        group: null,
        field: 'subNotes',
        kinds: ['phone'],
      },
    );
    expect(describeDropped({ path: 'blocks.B2.fallback', kinds: ['email'] }, input)).toMatchObject({
      field: 'fallback',
    });
    expect(
      describeDropped({ path: 'groups.G1.levelDescription', kinds: ['address'] }, input),
    ).toMatchObject({ block: null, group: 'G1', field: 'levelDescription' });
    expect(describeDropped({ path: 'faith.text', kinds: ['phone'] }, input)).toMatchObject({
      field: 'faithText',
    });
    expect(describeDropped({ path: 'gradeLabels.0', kinds: ['identifier'] }, input)).toMatchObject({
      field: 'gradeLabel',
    });
  });
});
