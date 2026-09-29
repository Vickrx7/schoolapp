/**
 * What each audience sees of a plan (DECISIONS D-048, D-056): per block, the teacher's edits,
 * then the AI layer (3b), then the generated template, each applied only while the block
 * still has the lesson it was written for. Edits that no longer match are shown to the owner
 * as detached and hidden from everyone else. « Gestion de classe » never reaches the office
 * or a PDF.
 */
import type { CatholicReferenceType } from './catholic';
import {
  subPlanAiLayerSchema,
  type SubPlanBlock,
  type SubPlanBlockEdit,
  type SubPlanClassNotes,
  type SubPlanEdits,
  type SubPlanStepEdit,
  type SubPlanV1,
} from './schema';

/**
 * « Mme Tremblay » from ('Isabelle Tremblay', 'Mme'); the display name when there is no
 * honorific. Must match app.formal_staff_name in SQL: the honorific, a space and the last
 * space-separated word of the trimmed display name.
 */
export function formalStaffName(displayName: string, honorific: string | null): string {
  const title = honorific?.trim();
  if (!title) return displayName;
  const last = displayName.trim().split(' ').at(-1) ?? '';
  return `${title} ${last}`;
}

export type SubPlanAudience = 'owner' | 'staff' | 'office' | 'substitute' | 'pdf';

export interface ComposedStep {
  minutes: number | null;
  text: string;
  /** A « Dites : » line (AI layer only). */
  say: string | null;
}

export interface ComposedBlockAi {
  overview: string;
  differentiation: { group: string; instruction: string }[];
  ifTimeRemains: string | null;
  materialsChecklist: string[];
  activity: {
    title: string;
    studentInstructions: string;
    perGroup: { group: string; studentInstructions: string }[];
  } | null;
}

export interface ComposedBlock extends Omit<SubPlanBlock, 'steps'> {
  steps: ComposedStep[];
  /** Where the steps come from. */
  stepsSource: 'teacher' | 'ai' | 'template';
  /** The teacher's note for this block (edits only). */
  teacherNote: string | null;
  /** Whether a teacher edit applies to this block. */
  edited: boolean;
  ai: ComposedBlockAi | null;
}

export interface ComposedFaith {
  /** Null when the teacher wrote a faith moment on a plan that had none. */
  referenceId: string | null;
  type: CatholicReferenceType | null;
  title: string | null;
  text: string;
  /** One sentence linking the reference to the day (AI layer, 3b). */
  linkSentence: string | null;
  edited: boolean;
}

/** A teacher edit that no longer applies (owner only). */
export interface DetachedEdit {
  blockKey: string;
  /** 'lesson_changed': the block now has another lesson; 'block_removed': it left the plan. */
  reason: 'lesson_changed' | 'block_removed';
  blockTitle: string | null;
  forLessonId: string | null;
  currentLessonId: string | null;
  steps: SubPlanStepEdit[] | null;
  teacherNote: string | null;
}

export interface ComposedSubPlan extends Omit<SubPlanV1, 'blocks' | 'faith' | 'classNotes'> {
  audience: SubPlanAudience;
  /** The teacher's overview of the day (or the AI's, 3b). */
  overview: string | null;
  blocks: ComposedBlock[];
  classNotes: SubPlanClassNotes[];
  faith: ComposedFaith | null;
  /** Owner only; empty for everyone else. */
  detachedEdits: DetachedEdit[];
}

function nonBlank(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

/** The AI layer per timetable block, for the lessons it was written for. Invalid: ignored. */
function aiByBlock(ai: unknown) {
  const parsed = ai == null ? null : subPlanAiLayerSchema.safeParse(ai);
  if (!parsed?.success) {
    return { overview: null, faithSentence: null, faithRef: undefined, blocks: new Map() };
  }
  const refs = new Map(parsed.data.refs.map((r) => [r.key, r.ref]));
  const blocks = new Map<
    string,
    { lessonId: string | null; steps: ComposedStep[]; ai: ComposedBlockAi }
  >();
  for (const b of parsed.data.result.blocks) {
    const ref = refs.get(b.key);
    if (!ref || blocks.has(ref.blockKey)) continue;
    blocks.set(ref.blockKey, {
      lessonId: ref.lessonId,
      steps: b.steps.map((s) => ({
        minutes:
          Number.isFinite(s.minutes) && s.minutes >= 1
            ? Math.min(240, Math.round(s.minutes))
            : null,
        text: s.instruction,
        say: nonBlank(s.say),
      })),
      ai: {
        overview: b.overview,
        differentiation: b.differentiation,
        ifTimeRemains: nonBlank(b.ifTimeRemains),
        materialsChecklist: b.materialsChecklist,
        activity: b.activity,
      },
    });
  }
  return {
    overview: nonBlank(parsed.data.result.dayOverview),
    faithSentence: nonBlank(parsed.data.result.faithSentence),
    faithRef: parsed.data.faithRef,
    blocks,
  };
}

export function composeSubPlan(
  plan: SubPlanV1,
  options: {
    edits?: SubPlanEdits | null;
    /** sub_plans.ai (3b); read leniently. */
    ai?: unknown;
    audience: SubPlanAudience;
  },
): ComposedSubPlan {
  const { audience } = options;
  const edits = options.edits ?? {};
  const ai = aiByBlock(options.ai);
  const blockEdits: Record<string, SubPlanBlockEdit> = edits.blocks ?? {};

  const blocks: ComposedBlock[] = plan.blocks.map((block) => {
    const lessonId = block.lesson?.lessonId ?? null;
    const edit = blockEdits[block.key];
    const editApplies = !!edit && edit.forLessonId === lessonId;
    const aiBlock = ai.blocks.get(block.key);
    const aiApplies = !!aiBlock && aiBlock.lessonId === lessonId;

    let steps: ComposedStep[] = block.steps.map((s) => ({ ...s, say: null }));
    let stepsSource: ComposedBlock['stepsSource'] = 'template';
    if (editApplies && edit.steps) {
      steps = edit.steps.map((s) => ({ minutes: s.minutes, text: s.text, say: null }));
      stepsSource = 'teacher';
    } else if (aiApplies && aiBlock.steps.length > 0) {
      steps = aiBlock.steps;
      stepsSource = 'ai';
    }
    return {
      ...block,
      steps,
      stepsSource,
      teacherNote: editApplies ? nonBlank(edit.teacherNote) : null,
      edited: editApplies,
      ai: aiApplies ? aiBlock.ai : null,
    };
  });

  const detachedEdits: DetachedEdit[] = [];
  if (audience === 'owner') {
    const byKey = new Map(plan.blocks.map((b) => [b.key, b]));
    for (const [blockKey, edit] of Object.entries(blockEdits)) {
      const block = byKey.get(blockKey);
      const currentLessonId = block ? (block.lesson?.lessonId ?? null) : null;
      if (block && edit.forLessonId === currentLessonId) continue;
      detachedEdits.push({
        blockKey,
        reason: block ? 'lesson_changed' : 'block_removed',
        blockTitle: block?.title ?? null,
        forLessonId: edit.forLessonId,
        currentLessonId,
        steps: edit.steps ?? null,
        teacherNote: nonBlank(edit.teacherNote),
      });
    }
    detachedEdits.sort((a, b) => (a.blockKey < b.blockKey ? -1 : 1));
  }

  let faith: ComposedFaith | null = plan.faith
    ? {
        referenceId: plan.faith.referenceId,
        type: plan.faith.type,
        title: plan.faith.title,
        text: plan.faith.text,
        // Only for the reference it was written for: a rebuild may pick another one.
        linkSentence:
          ai.faithRef === undefined || ai.faithRef === plan.faith.referenceId
            ? ai.faithSentence
            : null,
        edited: false,
      }
    : null;
  if (edits.faith === null) {
    faith = null;
  } else if (edits.faith) {
    faith = {
      referenceId: faith?.referenceId ?? null,
      type: faith?.type ?? null,
      title: faith?.title ?? null,
      text: edits.faith.text,
      linkSentence: null, // the teacher's text replaces the AI's sentence
      edited: true,
    };
  }

  const dropsClassManagement = audience === 'office' || audience === 'pdf';
  return {
    ...plan,
    audience,
    overview: nonBlank(edits.overview) ?? ai.overview,
    blocks,
    classNotes: plan.classNotes.map((n) =>
      dropsClassManagement ? { ...n, classManagement: null } : n,
    ),
    endOfDay: {
      time: plan.endOfDay.time,
      checklist: edits.endOfDayChecklist ?? plan.endOfDay.checklist,
    },
    faith,
    detachedEdits,
  };
}
