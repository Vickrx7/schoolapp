import { describe, expect, it } from 'vitest';
import { buildAbsencePlans } from './build';
import { composeSubPlan, formalStaffName, type SubPlanAudience } from './compose';
import type { SubPlanAiLayer, SubPlanEdits } from './schema';
import { subPlanEditsSchema } from './schema';
import { C3, NOW, WEEK, block, isabelleSources, lesson, parse } from './test-fixtures';

const plan = buildAbsencePlans(
  parse(isabelleSources()),
  { startsOn: WEEK.mon, endsOn: WEEK.mon, part: 'full_day', catholicConnection: true },
  { now: NOW },
).plans[0]!.plan;

const FRENCH = block(C3, 1, '08:55');
const MATH = block(C3, 1, '09:45');
const french = (c: ReturnType<typeof composeSubPlan>) => c.blocks.find((b) => b.key === FRENCH)!;

const edits = (value: unknown): SubPlanEdits => subPlanEditsSchema.parse(value);

describe('composeSubPlan', () => {
  it('shows the teacher’s edits before the template', () => {
    const composed = composeSubPlan(plan, {
      audience: 'substitute',
      edits: edits({
        overview: 'Journée calme, les élèves connaissent la routine.',
        endOfDayChecklist: ['Fermez les fenêtres.'],
        blocks: {
          [FRENCH]: {
            forLessonId: lesson('fra3', 4),
            steps: [{ minutes: 10, text: 'Lisez le texte « Le huard » à voix haute.' }],
            teacherNote: 'Les responsables de la semaine distribuent les textes.',
          },
        },
      }),
    });
    expect(french(composed)).toMatchObject({
      steps: [{ minutes: 10, text: 'Lisez le texte « Le huard » à voix haute.', say: null }],
      stepsSource: 'teacher',
      teacherNote: 'Les responsables de la semaine distribuent les textes.',
      edited: true,
    });
    const math = composed.blocks.find((b) => b.key === MATH)!;
    expect(math.stepsSource).toBe('template');
    expect(math.steps.map((s) => s.text)).toEqual(
      plan.blocks.find((b) => b.key === MATH)!.steps.map((s) => s.text),
    );
    expect(composed.overview).toBe('Journée calme, les élèves connaissent la routine.');
    expect(composed.endOfDay).toEqual({ time: '15:20', checklist: ['Fermez les fenêtres.'] });
    expect(composed.detachedEdits).toEqual([]);
  });

  it('hides an edit written for another lesson, and shows it to the owner as detached', () => {
    const stale = edits({
      blocks: {
        [FRENCH]: {
          forLessonId: lesson('fra3', 3),
          steps: [{ minutes: null, text: 'Relisez « L’ours noir ».' }],
          teacherNote: 'Note pour la leçon 3',
        },
      },
    });
    const substitute = composeSubPlan(plan, { audience: 'substitute', edits: stale });
    expect(french(substitute)).toMatchObject({
      stepsSource: 'template',
      teacherNote: null,
      edited: false,
    });
    expect(JSON.stringify(substitute)).not.toContain('L’ours noir');
    expect(substitute.detachedEdits).toEqual([]);

    const owner = composeSubPlan(plan, { audience: 'owner', edits: stale });
    expect(french(owner).stepsSource).toBe('template');
    expect(owner.detachedEdits).toEqual([
      {
        blockKey: FRENCH,
        reason: 'lesson_changed',
        blockTitle: 'Français',
        forLessonId: lesson('fra3', 3),
        currentLessonId: lesson('fra3', 4),
        steps: [{ minutes: null, text: 'Relisez « L’ours noir ».' }],
        teacherNote: 'Note pour la leçon 3',
      },
    ]);
  });

  it('drops « Gestion de classe » for the office and in PDFs', () => {
    const management = (audience: SubPlanAudience) =>
      composeSubPlan(plan, { audience }).classNotes[0]!.classManagement;
    expect(management('office')).toBeNull();
    expect(management('pdf')).toBeNull();
    for (const audience of ['owner', 'staff', 'substitute'] as const) {
      expect(management(audience)).toContain('Signal de silence');
    }
    expect(JSON.stringify(composeSubPlan(plan, { audience: 'pdf' }))).not.toContain(
      'Signal de silence',
    );
  });

  it('removes the faith moment when the teacher sets it to null, or uses her text', () => {
    expect(plan.faith).not.toBeNull();
    expect(
      composeSubPlan(plan, { audience: 'substitute', edits: edits({ faith: null }) }).faith,
    ).toBeNull();
    const rewritten = composeSubPlan(plan, {
      audience: 'substitute',
      edits: edits({ faith: { text: 'Prions pour nos amis malades.' } }),
    }).faith;
    expect(rewritten).toMatchObject({
      referenceId: plan.faith!.referenceId,
      text: 'Prions pour nos amis malades.',
      edited: true,
    });
    expect(composeSubPlan(plan, { audience: 'substitute' }).faith).toMatchObject({
      text: plan.faith!.text,
      edited: false,
    });
  });

  it('ignores edits for blocks the plan doesn’t have', () => {
    const unknown = 'aaaaaaaa-0000-4000-8000-000000000000';
    const withUnknown = edits({
      blocks: { [unknown]: { forLessonId: null, steps: [{ minutes: 5, text: 'Ailleurs.' }] } },
    });
    const composed = composeSubPlan(plan, { audience: 'substitute', edits: withUnknown });
    expect(composed.blocks).toEqual(composeSubPlan(plan, { audience: 'substitute' }).blocks);
    expect(composed.blocks.some((b) => b.key === unknown)).toBe(false);
    // The owner is told the edit no longer has a block.
    expect(
      composeSubPlan(plan, { audience: 'owner', edits: withUnknown }).detachedEdits,
    ).toMatchObject([{ blockKey: unknown, reason: 'block_removed', blockTitle: null }]);
  });

  it('uses the AI layer (3b) under the teacher’s edits, for the lesson it was written for', () => {
    const ai: SubPlanAiLayer = {
      jobId: 'job',
      appliedAt: NOW.toISOString(),
      refs: [
        { key: 'B1', ref: { blockKey: FRENCH, lessonId: lesson('fra3', 4) } },
        { key: 'B2', ref: { blockKey: MATH, lessonId: lesson('mat3', 4) } }, // stale lesson
      ],
      result: {
        dayOverview: 'Une journée de lecture.',
        blocks: ['B1', 'B2'].map((key) => ({
          key,
          overview: `Aperçu ${key}`,
          steps: [{ minutes: 10, instruction: `Étape ${key}`, say: '« Bonjour! »' }],
          differentiation: [{ group: 'G1', instruction: 'Version illustrée.' }],
          ifTimeRemains: '',
          materialsChecklist: ['Texte'],
          activity: null,
        })),
        faithSentence: 'Aujourd’hui, pensons aux animaux.',
      },
    };
    const composed = composeSubPlan(plan, { audience: 'substitute', ai });
    expect(french(composed)).toMatchObject({
      stepsSource: 'ai',
      steps: [{ minutes: 10, text: 'Étape B1', say: '« Bonjour! »' }],
      ai: { overview: 'Aperçu B1', ifTimeRemains: null },
    });
    expect(composed.blocks.find((b) => b.key === MATH)).toMatchObject({
      stepsSource: 'template',
      ai: null,
    });
    expect(composed.overview).toBe('Une journée de lecture.');
    expect(composed.faith?.linkSentence).toBe('Aujourd’hui, pensons aux animaux.');

    const edited = composeSubPlan(plan, {
      audience: 'substitute',
      ai,
      edits: edits({
        blocks: {
          [FRENCH]: { forLessonId: lesson('fra3', 4), steps: [{ minutes: 5, text: 'Mien.' }] },
        },
      }),
    });
    expect(french(edited)).toMatchObject({ stepsSource: 'teacher', steps: [{ text: 'Mien.' }] });

    const broken = composeSubPlan(plan, { audience: 'substitute', ai: { result: 'oops' } });
    expect(broken.blocks).toEqual(composeSubPlan(plan, { audience: 'substitute' }).blocks);

    // The faith sentence goes with the reference it was written for, not one a rebuild picked.
    const sameRef = composeSubPlan(plan, {
      audience: 'substitute',
      ai: { ...ai, faithRef: plan.faith!.referenceId },
    });
    expect(sameRef.faith?.linkSentence).toBe('Aujourd’hui, pensons aux animaux.');
    const otherRef = composeSubPlan(plan, {
      audience: 'substitute',
      ai: { ...ai, faithRef: 'bbbbbbbb-0000-4000-8000-000000000000' },
    });
    expect(otherRef.faith).toMatchObject({ text: plan.faith!.text, linkSentence: null });
  });
});

describe('formalStaffName', () => {
  it('uses the honorific and last name, or the display name without an honorific', () => {
    expect(formalStaffName('Isabelle Tremblay', 'Mme')).toBe('Mme Tremblay');
    expect(formalStaffName('  Marc  Gagnon ', 'M.')).toBe('M. Gagnon');
    expect(formalStaffName('Isabelle Tremblay', null)).toBe('Isabelle Tremblay');
    expect(formalStaffName('Isabelle Tremblay', '  ')).toBe('Isabelle Tremblay');
  });
});
