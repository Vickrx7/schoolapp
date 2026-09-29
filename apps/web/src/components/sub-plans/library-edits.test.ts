/**
 * « Ne pas utiliser cette ressource » in the teacher's overlay (DECISIONS D-077, D-048): the
 * switch is an edit of the block for its current lesson, saved like her other edits.
 */
import { subPlanEditsSchema, type SubPlanEdits } from '@lynx/domain';
import { describe, expect, it } from 'vitest';
import { resetBlock, setBlockNote, setHideLibrary, toPayload } from './edits';

const BLOCK = '20000000-0000-4000-8000-000000000001';
const L4 = '30000000-0000-4000-8000-000000000004';
const L5 = '30000000-0000-4000-8000-000000000005';

const block = (lessonId: string) => ({
  key: BLOCK,
  lesson: {
    lessonId,
    unitTitle: 'Les animaux',
    sequenceNumber: 4,
    title: 'Trouver l’idée principale',
    objectives: null,
    materials: null,
    content: null,
    subNotes: null,
    assignment: 'assigned' as const,
    gapBefore: null,
  },
  steps: [],
  teacherNote: null,
});

describe('setHideLibrary', () => {
  it('hides the resource for the block’s lesson, and saves it', () => {
    const edits = setHideLibrary({}, block(L4), true);
    expect(edits.blocks?.[BLOCK]).toEqual({ forLessonId: L4, hideLibrary: true });
    const payload = toPayload(edits);
    expect(payload).toEqual({ blocks: { [BLOCK]: { forLessonId: L4, hideLibrary: true } } });
    // What the server accepts.
    expect(subPlanEditsSchema.parse(payload)).toEqual(payload);
  });

  it('brings it back, and leaves no empty edit behind', () => {
    const hidden = setHideLibrary({}, block(L4), true);
    const shown = setHideLibrary(hidden, block(L4), false);
    expect(shown.blocks).toBeUndefined();
    expect(toPayload(shown)).toBeNull();
  });

  it('keeps her note and steps when it changes, and her note when it is brought back', () => {
    let edits: SubPlanEdits = setBlockNote({}, block(L4), 'Les textes sont sur le bureau.');
    edits = setHideLibrary(edits, block(L4), true);
    expect(edits.blocks?.[BLOCK]).toEqual({
      forLessonId: L4,
      teacherNote: 'Les textes sont sur le bureau.',
      hideLibrary: true,
    });
    edits = setHideLibrary(edits, block(L4), false);
    expect(edits.blocks?.[BLOCK]).toEqual({
      forLessonId: L4,
      teacherNote: 'Les textes sont sur le bureau.',
    });
  });

  it('starts over for a block whose lesson changed', () => {
    const old = setHideLibrary({}, block(L4), true);
    expect(setHideLibrary(old, block(L5), true).blocks?.[BLOCK]).toEqual({
      forLessonId: L5,
      hideLibrary: true,
    });
  });

  it('is undone with « Revenir au plan préparé » like her other edits', () => {
    expect(resetBlock(setHideLibrary({}, block(L4), true), BLOCK).blocks).toBeUndefined();
  });
});
