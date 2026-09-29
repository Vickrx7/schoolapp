import { composeSubPlan, subPlanEditsSchema, type SubPlanV1 } from '@lynx/domain';
import { describe, expect, it } from 'vitest';
import {
  parseMinutes,
  reattachEdit,
  resetBlock,
  resetChecklist,
  restoreAt,
  samePayload,
  setBlockNote,
  setBlockSteps,
  setChecklist,
  setFaith,
  setOverview,
  stepsForEditing,
  toPayload,
} from './edits';

const CLASS = '10000000-0000-4000-8000-000000000001';
const BLOCK = '20000000-0000-4000-8000-000000000001';
const L4 = '30000000-0000-4000-8000-000000000004';
const L5 = '30000000-0000-4000-8000-000000000005';

function plan(lessonId: string): SubPlanV1 {
  return {
    schemaVersion: 1,
    date: '2026-10-14',
    part: 'full_day',
    window: { start: '08:45', end: '15:20' },
    split: '12:55',
    day: { kind: 'weekly', dayKey: 3 },
    classes: [{ classId: CLASS, name: '3e année', gradeLabels: ['3e année'], roomName: null }],
    groups: [],
    dayEvents: [],
    blocks: [
      {
        key: BLOCK,
        classId: CLASS,
        className: '3e année',
        kind: 'subject',
        start: '08:55',
        end: '09:45',
        status: 'normal',
        title: 'Français',
        subjectLabel: 'Français',
        roomName: null,
        otherAdult: null,
        event: null,
        notes: null,
        lesson: {
          lessonId,
          unitTitle: 'Les animaux',
          sequenceNumber: 4,
          title: 'Trouver l’idée principale',
          objectives: null,
          materials: null,
          content: null,
          subNotes: null,
          assignment: 'assigned',
          gapBefore: null,
        },
        steps: [
          { minutes: 5, text: 'Présentez l’objectif.' },
          { minutes: 40, text: 'Lecture en équipes.' },
        ],
        warnings: [],
      },
    ],
    classNotes: [],
    endOfDay: { time: '15:20', checklist: ['Ramassez les cahiers.'] },
    faith: {
      referenceId: '40000000-0000-4000-8000-000000000001',
      type: 'prayer',
      title: 'Prière',
      text: 'Seigneur, merci.',
    },
    warnings: [],
    generator: { version: 'domain-1', generatedAt: '2026-10-01T10:00:00.000Z' },
  };
}

const blockOf = (p: SubPlanV1, edits = {}) =>
  composeSubPlan(p, { edits, audience: 'owner' }).blocks[0]!;

describe('plan editor overlay', () => {
  it('starts from the steps the plan shows and records the lesson they were written for', () => {
    const block = blockOf(plan(L4));
    const steps = stepsForEditing(block);
    expect(steps).toEqual([
      { minutes: 5, text: 'Présentez l’objectif.' },
      { minutes: 40, text: 'Lecture en équipes.' },
    ]);
    const edits = setBlockSteps({}, block, [...steps, { minutes: null, text: 'Relisez.' }]);
    expect(edits.blocks?.[BLOCK]?.forLessonId).toBe(L4);
    const composed = blockOf(plan(L4), edits);
    expect(composed.stepsSource).toBe('teacher');
    expect(composed.steps.map((s) => s.text)).toContain('Relisez.');
  });

  it('keeps an AI step’s « Dites : » line when the teacher edits the steps', () => {
    const ai = {
      refs: [{ key: 'B1', ref: { blockKey: BLOCK, lessonId: L4 } }],
      result: {
        dayOverview: '',
        blocks: [
          {
            key: 'B1',
            overview: '',
            steps: [
              { minutes: 5, instruction: 'Présentez l’objectif.', say: '« Aujourd’hui, on lit! »' },
              { minutes: 40, instruction: 'Lecture en équipes.', say: '' },
            ],
            differentiation: [],
            ifTimeRemains: '',
            materialsChecklist: [],
            activity: null,
          },
        ],
        faithSentence: '',
      },
    };
    const block = composeSubPlan(plan(L4), { audience: 'owner', ai }).blocks[0]!;
    expect(block.stepsSource).toBe('ai');
    expect(stepsForEditing(block)).toEqual([
      { minutes: 5, text: 'Présentez l’objectif. Dites : « Aujourd’hui, on lit! »' },
      { minutes: 40, text: 'Lecture en équipes.' },
    ]);
  });

  it('keeps the note and the steps of the same block together', () => {
    const block = blockOf(plan(L4));
    let edits = setBlockSteps({}, block, [{ minutes: 10, text: 'Lecture.' }]);
    edits = setBlockNote(edits, blockOf(plan(L4), edits), 'Le bac vert est sous la fenêtre.');
    expect(edits.blocks?.[BLOCK]).toEqual({
      forLessonId: L4,
      steps: [{ minutes: 10, text: 'Lecture.' }],
      teacherNote: 'Le bac vert est sous la fenêtre.',
    });
    expect(resetBlock(edits, BLOCK)).toEqual({});
  });

  it('starts over when the block has another lesson now, and can re-attach a detached edit', () => {
    const edits = setBlockSteps({}, blockOf(plan(L4)), [{ minutes: 10, text: 'Pour L4.' }]);
    // The plan was rebuilt: the block now has lesson 5, the edit is detached.
    const rebuilt = composeSubPlan(plan(L5), { edits, audience: 'owner' });
    expect(rebuilt.blocks[0]!.stepsSource).toBe('template');
    expect(rebuilt.detachedEdits).toHaveLength(1);
    // Editing the block again writes a new edit for lesson 5.
    const fresh = setBlockNote(edits, rebuilt.blocks[0]!, 'Nouvelle note');
    expect(fresh.blocks?.[BLOCK]).toEqual({ forLessonId: L5, teacherNote: 'Nouvelle note' });
    // Or the teacher keeps her steps for the new lesson.
    const kept = reattachEdit(edits, rebuilt.detachedEdits[0]!);
    const composed = composeSubPlan(plan(L5), { edits: kept, audience: 'owner' });
    expect(composed.blocks[0]!.steps.map((s) => s.text)).toEqual(['Pour L4.']);
    expect(composed.detachedEdits).toEqual([]);
  });

  it('edits the overview, the end-of-day list and the faith moment', () => {
    let edits = setOverview({}, 'Bonne journée!');
    edits = setChecklist(edits, ['Fermez les fenêtres.', '']);
    edits = setFaith(edits, null);
    const composed = composeSubPlan(plan(L4), { edits, audience: 'owner' });
    expect(composed.overview).toBe('Bonne journée!');
    expect(composed.endOfDay.checklist).toEqual(['Fermez les fenêtres.', '']);
    expect(composed.faith).toBeNull();
    expect(setOverview(edits, '').overview).toBeUndefined();
    expect(resetChecklist(edits).endOfDayChecklist).toBeUndefined();
    expect(setFaith(edits, undefined)).not.toHaveProperty('faith');
    expect(setFaith(edits, { text: 'Merci pour cette journée.' }).faith).toEqual({
      text: 'Merci pour cette journée.',
    });
  });

  it('sends only what the server accepts: no blank steps, items or notes', () => {
    const block = blockOf(plan(L4));
    let edits = setBlockSteps({}, block, [
      { minutes: 10, text: '  Lecture.  ' },
      { minutes: null, text: '   ' },
    ]);
    edits = setChecklist(edits, ['', '  Rangez.  ']);
    edits = setOverview(edits, '   ');
    const payload = toPayload(edits);
    expect(payload).toEqual({
      endOfDayChecklist: ['Rangez.'],
      blocks: { [BLOCK]: { forLessonId: L4, steps: [{ minutes: 10, text: 'Lecture.' }] } },
    });
    expect(subPlanEditsSchema.safeParse(payload).success).toBe(true);
    // A block with only a blank note saves nothing.
    expect(toPayload(setBlockNote({}, block, '  '))).toBeNull();
    expect(toPayload({})).toBeNull();
    expect(toPayload(setFaith({}, null))).toEqual({ faith: null });
  });

  it('compares overlays by what they save', () => {
    const block = blockOf(plan(L4));
    const a = setBlockSteps({}, block, [{ minutes: 10, text: 'Lecture.' }]);
    const b = setBlockSteps({}, block, [
      { minutes: 10, text: 'Lecture. ' },
      { minutes: null, text: '' },
    ]);
    expect(samePayload(a, b)).toBe(true);
    expect(samePayload(a, {})).toBe(false);
    expect(samePayload({}, null)).toBe(true);
  });

  it('reads the minutes field leniently', () => {
    expect(parseMinutes('')).toBeNull();
    expect(parseMinutes('0')).toBeNull();
    expect(parseMinutes('12 min')).toBe(12);
    expect(parseMinutes('999')).toBe(240);
  });
});

describe('undoing a removal', () => {
  it('puts the item back where it was, keeping later changes', () => {
    expect(restoreAt(['a', 'c'], 1, 'b', 12)).toEqual(['a', 'b', 'c']);
    // Another item was removed meanwhile: at the end rather than out of range.
    expect(restoreAt(['a'], 3, 'd', 12)).toEqual(['a', 'd']);
    expect(restoreAt([], 0, 'a', 12)).toEqual(['a']);
  });

  it('never goes over the limit', () => {
    const full = Array.from({ length: 12 }, (_, i) => String(i));
    expect(restoreAt(full, 0, 'x', 12)).toEqual(full);
  });
});
