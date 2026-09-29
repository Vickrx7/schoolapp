/**
 * Changes to the teacher's overlay on a plan (sub_plans.edits, D-048), as pure functions so the
 * editor's rules can be unit-tested. Every edit of a block records the lesson it was written
 * for: it applies only while the block keeps that lesson, and is never lost when the plan is
 * rebuilt.
 */
import type {
  ComposedBlock,
  DetachedEdit,
  SubPlanBlockEdit,
  SubPlanEdits,
  SubPlanStepEdit,
} from '@lynx/domain';

export const MAX_STEPS = 12;
export const MAX_CHECKLIST = 12;

type Block = Pick<ComposedBlock, 'key' | 'lesson' | 'steps' | 'teacherNote'>;

function withBlock(edits: SubPlanEdits, key: string, edit: SubPlanBlockEdit | null): SubPlanEdits {
  const blocks = { ...edits.blocks };
  if (edit) blocks[key] = edit;
  else delete blocks[key];
  const next: SubPlanEdits = { ...edits, blocks };
  if (Object.keys(blocks).length === 0) delete next.blocks;
  return next;
}

/** The block's current edit if it still applies, else a fresh one for its current lesson. */
function currentEdit(edits: SubPlanEdits, block: Block): SubPlanBlockEdit {
  const lessonId = block.lesson?.lessonId ?? null;
  const existing = edits.blocks?.[block.key];
  if (existing && existing.forLessonId === lessonId) return existing;
  return { forLessonId: lessonId };
}

/** The steps the editor starts from: the teacher's own, else what the plan shows now. */
export function stepsForEditing(block: Block): SubPlanStepEdit[] {
  // An AI step's « Dites : » line stays with its step (plan content is always French).
  return block.steps.map((s) => ({
    minutes: s.minutes,
    text: (s.say ? `${s.text} Dites : ${s.say}` : s.text).slice(0, 1000),
  }));
}

export function setBlockSteps(
  edits: SubPlanEdits,
  block: Block,
  steps: SubPlanStepEdit[],
): SubPlanEdits {
  return withBlock(edits, block.key, {
    ...currentEdit(edits, block),
    steps: steps.slice(0, MAX_STEPS),
  });
}

export function setBlockNote(edits: SubPlanEdits, block: Block, note: string): SubPlanEdits {
  const edit = { ...currentEdit(edits, block), teacherNote: note };
  return withBlock(edits, block.key, edit);
}

/** « Revenir au plan préparé »: the block shows the generated steps again. */
export function resetBlock(edits: SubPlanEdits, blockKey: string): SubPlanEdits {
  return withBlock(edits, blockKey, null);
}

/** Applies a detached edit to the block's current lesson (the teacher checked it still fits). */
export function reattachEdit(
  edits: SubPlanEdits,
  detached: Pick<DetachedEdit, 'blockKey' | 'currentLessonId'>,
): SubPlanEdits {
  const edit = edits.blocks?.[detached.blockKey];
  if (!edit) return edits;
  return withBlock(edits, detached.blockKey, { ...edit, forLessonId: detached.currentLessonId });
}

export function setOverview(edits: SubPlanEdits, overview: string): SubPlanEdits {
  const next: SubPlanEdits = { ...edits, overview };
  if (overview === '') delete next.overview;
  return next;
}

export function setChecklist(edits: SubPlanEdits, items: string[]): SubPlanEdits {
  return { ...edits, endOfDayChecklist: items.slice(0, MAX_CHECKLIST) };
}

export function resetChecklist(edits: SubPlanEdits): SubPlanEdits {
  const next = { ...edits };
  delete next.endOfDayChecklist;
  return next;
}

/** Null removes the faith moment, text replaces it, undefined goes back to the generated one. */
export function setFaith(edits: SubPlanEdits, faith: { text: string } | null | undefined) {
  const next: SubPlanEdits = { ...edits };
  if (faith === undefined) delete next.faith;
  else next.faith = faith;
  return next;
}

/**
 * What is sent to the server: blank steps, checklist items and notes are dropped (the editor
 * keeps them while the teacher types), and an empty overlay is null.
 */
export function toPayload(edits: SubPlanEdits): SubPlanEdits | null {
  const out: SubPlanEdits = {};
  const overview = edits.overview?.trim();
  if (overview) out.overview = overview;
  if (edits.endOfDayChecklist) {
    out.endOfDayChecklist = edits.endOfDayChecklist.map((i) => i.trim()).filter(Boolean);
  }
  if (edits.faith === null) out.faith = null;
  else if (edits.faith?.text.trim()) out.faith = { text: edits.faith.text.trim() };
  const blocks: Record<string, SubPlanBlockEdit> = {};
  for (const [key, edit] of Object.entries(edits.blocks ?? {})) {
    const next: SubPlanBlockEdit = { forLessonId: edit.forLessonId };
    if (edit.steps) {
      next.steps = edit.steps
        .map((s) => ({ minutes: s.minutes, text: s.text.trim() }))
        .filter((s) => s.text.length > 0);
    }
    const note = edit.teacherNote?.trim();
    if (note) next.teacherNote = note;
    if (next.steps || next.teacherNote) blocks[key] = next;
  }
  if (Object.keys(blocks).length > 0) out.blocks = blocks;
  return Object.keys(out).length > 0 ? out : null;
}

/** Whether two overlays save the same thing. */
export function samePayload(a: SubPlanEdits | null, b: SubPlanEdits | null): boolean {
  return JSON.stringify(a ? toPayload(a) : null) === JSON.stringify(b ? toPayload(b) : null);
}

/** Parses a minutes field: blank is "no duration", otherwise 1 to 240. */
export function parseMinutes(value: string): number | null {
  const n = Number.parseInt(value.replace(/\D/g, ''), 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(240, n);
}
