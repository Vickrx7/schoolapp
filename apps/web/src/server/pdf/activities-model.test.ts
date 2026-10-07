import { mentionsLevelLabel } from '@lynx/ai/features/shared';
import { composeSubPlan, type SubPlanAudience, type SubPlanV1 } from '@lynx/domain';
import { describe, expect, it } from 'vitest';
import {
  activitiesPdfFileName,
  buildActivitiesPdfModel,
  hasActivitySheets,
  type ActivitiesPdfModel,
} from './activities-model';
import {
  activityLayer,
  BLOCK,
  CLASS_3,
  EDITS,
  LEVELS,
  ROSTER,
  SCIENCE_BLOCK,
  withScience,
  type Activity,
} from './test-fixtures';

const LESSON_5 = '40000000-0000-4000-8000-000000000005';
/** A student whose name is also an everyday word (« une réponse claire »). */
const CLAIRE = '50000000-0000-4000-8000-000000000008';

const FRENCH_ACTIVITY: Activity = {
  title: 'Mon idée principale',
  studentInstructions: 'Lis le texte avec ton ou ta camarade.',
  perGroup: [
    { group: 'G1', studentInstructions: 'Dessine l’idée principale.' },
    { group: 'G2', studentInstructions: 'Écris l’idée principale en une phrase.' },
  ],
};
const SCIENCE_ACTIVITY: Activity = {
  title: 'Les forces autour de moi',
  studentInstructions: 'Observe la classe.',
  perGroup: [
    { group: 'G2', studentInstructions: 'Nomme trois forces.' },
    { group: 'G1', studentInstructions: 'Dessine une poussée.' },
  ],
};

function model(
  ai: unknown,
  plan: SubPlanV1 = withScience(),
  roster = ROSTER,
  audience: SubPlanAudience = 'pdf',
): ActivitiesPdfModel {
  return buildActivitiesPdfModel(
    composeSubPlan(plan, { edits: EDITS, ai, audience }),
    roster,
    LEVELS,
  );
}

describe('buildActivitiesPdfModel', () => {
  it('prints one page per group for each activity, in the order of the day', () => {
    const m = model(activityLayer(FRENCH_ACTIVITY, SCIENCE_ACTIVITY));
    expect(m.sheets.map((s) => [s.blockKey, s.subject, s.group])).toEqual([
      [BLOCK.french, 'Français', 'G1'],
      [BLOCK.french, 'Français', 'G2'],
      // G3 is not printed: its only student has left the class (as in the plan's « Groupes »).
      [SCIENCE_BLOCK, 'Sciences et technologie', 'G1'],
      [SCIENCE_BLOCK, 'Sciences et technologie', 'G2'],
    ]);
    expect(m.sheets[0]).toEqual({
      blockKey: BLOCK.french,
      group: 'G1',
      subject: 'Français',
      title: 'Mon idée principale',
      instructions: 'Lis le texte avec ton ou ta camarade.',
      groupInstructions: 'Dessine l’idée principale.',
    });
    // Each group gets its own version, whatever the order of the answer.
    expect(m.sheets.slice(2).map((s) => s.groupInstructions)).toEqual([
      'Dessine une poussée.',
      'Nomme trois forces.',
    ]);
    // The teacher's own steps for Français do not hide the activity.
    expect(model(activityLayer(FRENCH_ACTIVITY, null)).sheets).toHaveLength(2);
  });

  it('never prints a student’s name or a level’s name, even when the answer holds one', () => {
    const roster = [...ROSTER, { id: CLAIRE, classId: CLASS_3, firstName: 'Claire' }];
    const m = model(
      activityLayer(
        {
          title: 'Le défi de Samuel',
          // Names come back as the teacher typed them, in any case or without accents.
          studentInstructions: 'Avec aicha et EMMA, écris une réponse claire. Claire lit.',
          perGroup: [
            // The level names were checked when the answer came back; renamed levels, the
            // English names and « Sans niveau » are taken out here too.
            { group: 'G1', studentInstructions: 'Groupe DÉBUTANT : dessine avec Adam.' },
            { group: 'G2', studentInstructions: 'Les Advanced et les sans niveau lisent.' },
          ],
        },
        null,
      ),
      withScience(),
      roster,
    );
    expect(m.sheets.map((s) => [s.title, s.instructions, s.groupInstructions])).toEqual([
      [
        'Le défi de …',
        'Avec … et …, écris une réponse claire. … lit.',
        'Groupe … : dessine avec ….',
      ],
      ['Le défi de …', 'Avec … et …, écris une réponse claire. … lit.', 'Les … et les … lisent.'],
    ]);

    const json = JSON.stringify(m);
    for (const s of roster) {
      // « claire » (an everyday word) stays; a first name, in any case, never does.
      if (s.firstName === 'Claire') expect(json).not.toContain('Claire');
      else expect(json.toLowerCase()).not.toContain(s.firstName.toLowerCase());
    }
    const labels = [...LEVELS.flatMap((l) => [l.labelFr, l.labelEn ?? '']), 'Sans niveau'];
    expect(mentionsLevelLabel(json, labels)).toBe(false);
    // A group is printed as its key only, never with its level or its students.
    expect(m.sheets.map((s) => s.group)).toEqual(['G1', 'G2']);
    // The builder cannot print the plan's context or interface words: plan, roster, levels.
    expect(buildActivitiesPdfModel.length).toBe(3);
  });

  it('uses the subject as the title when nothing of the answer’s title is left', () => {
    const m = model(activityLayer({ ...FRENCH_ACTIVITY, title: 'Samuel' }, null));
    expect(m.sheets[0]!.title).toBe('Français');
  });

  it('is in French and named by date only, whatever the reader’s language', () => {
    const m = model(activityLayer(FRENCH_ACTIVITY, null));
    expect(m.info).toEqual({ title: 'Activités pour les élèves — 2026-10-21', language: 'fr-CA' });
    expect(m.fileName).toBe('activites-eleves-2026-10-21.pdf');
    expect(activitiesPdfFileName('2026-11-02')).toBe('activites-eleves-2026-11-02.pdf');
    expect(m.taskLabel).toBe('Ta tâche');
  });

  it('prints nothing when no period has an activity for its lesson', () => {
    expect(model(null).sheets).toEqual([]);
    expect(model(activityLayer(null, null)).sheets).toEqual([]);
    // Written for another lesson: the AI part no longer applies to the block.
    const stale = activityLayer(FRENCH_ACTIVITY, null, LESSON_5);
    expect(model(stale).sheets).toEqual([]);
    const owner = composeSubPlan(withScience(), { ai: stale, audience: 'owner' });
    expect(hasActivitySheets(owner)).toBe(false);
    expect(
      hasActivitySheets(
        composeSubPlan(withScience(), {
          ai: activityLayer(null, SCIENCE_ACTIVITY),
          audience: 'owner',
        }),
      ),
    ).toBe(true);
  });

  it('gives a group without its own version the class’s instructions', () => {
    const m = model(
      activityLayer({ ...FRENCH_ACTIVITY, perGroup: [FRENCH_ACTIVITY.perGroup[0]!] }, null),
    );
    expect(m.sheets.map((s) => [s.group, s.groupInstructions])).toEqual([
      ['G1', 'Dessine l’idée principale.'],
      ['G2', null],
    ]);
    expect(m.sheets[1]!.instructions).toBe('Lis le texte avec ton ou ta camarade.');
  });

  it('prints one page for a class with no group, with no number', () => {
    const m = model(activityLayer(FRENCH_ACTIVITY, null), withScience({ groups: [] }), []);
    expect(m.sheets).toEqual([
      {
        blockKey: BLOCK.french,
        group: null,
        subject: 'Français',
        title: 'Mon idée principale',
        instructions: 'Lis le texte avec ton ou ta camarade.',
        groupInstructions: null,
      },
    ]);
  });

  it.each<SubPlanAudience>(['owner', 'staff', 'office', 'substitute'])(
    'refuses a plan composed for the %s audience',
    (audience) => {
      expect(() =>
        model(activityLayer(FRENCH_ACTIVITY, null), withScience(), ROSTER, audience),
      ).toThrow(/pdf audience/);
    },
  );
});
