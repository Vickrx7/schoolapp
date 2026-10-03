/**
 * « Ne pas utiliser cette ressource » in the teacher's overlay (DECISIONS D-077, D-048): the
 * switch is an edit of the block for its current lesson, saved like her other edits.
 */
import { libraryStepText, subPlanEditsSchema, type SubPlanEdits } from '@lynx/domain';
import { describe, expect, it } from 'vitest';
import { resetBlock, setBlockNote, setBlockSteps, setHideLibrary, toPayload } from './edits';

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
  library: null,
  hiddenLibrary: null,
});

/** The block with its resource (only what the step's text needs), shown or hidden. */
const RESOURCE = { title: 'Le huard, oiseau des lacs', studentDocs: [{}] };
const STEP = 'Distribuez « Le huard, oiseau des lacs » : voir « Matériel pour les élèves ».';
const shown = (lessonId: string) =>
  ({ ...block(lessonId), library: RESOURCE }) as unknown as Parameters<typeof setHideLibrary>[1];
const hiddenBlock = (lessonId: string) => ({
  ...block(lessonId),
  hiddenLibrary: { itemId: BLOCK, title: RESOURCE.title, stepText: STEP },
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

describe('setHideLibrary and the teacher’s own steps', () => {
  it('uses the same step text as the plan', () => {
    expect(libraryStepText(RESOURCE as never)).toBe(STEP);
  });

  it('takes the resource’s step out of steps she edited before hiding it', () => {
    let edits = setBlockSteps({}, block(L4), [
      { minutes: 5, text: 'Rappel.' },
      { minutes: null, text: STEP },
      { minutes: 30, text: 'Lecture en équipes.' },
    ]);
    edits = setHideLibrary(edits, shown(L4), true);
    expect(edits.blocks?.[BLOCK]?.steps?.map((s) => s.text)).toEqual([
      'Rappel.',
      'Lecture en équipes.',
    ]);
  });

  it('puts it back before her main step when she brings the resource back', () => {
    let edits = setHideLibrary({}, shown(L4), true);
    edits = setBlockSteps(edits, block(L4), [
      { minutes: 5, text: 'Rappel.' },
      { minutes: 30, text: 'Lecture en équipes.' },
    ]);
    edits = setHideLibrary(edits, hiddenBlock(L4), false);
    expect(edits.blocks?.[BLOCK]?.steps?.map((s) => s.text)).toEqual([
      'Rappel.',
      STEP,
      'Lecture en équipes.',
    ]);
    // Never twice, and never past the limit of steps.
    expect(setHideLibrary(edits, hiddenBlock(L4), false)).toEqual(edits);
    const full = setBlockSteps(
      {},
      block(L4),
      Array.from({ length: 12 }, (_, i) => ({ minutes: 5, text: `Étape ${i + 1}` })),
    );
    expect(setHideLibrary(full, hiddenBlock(L4), false).blocks?.[BLOCK]?.steps).toHaveLength(12);
  });
});
