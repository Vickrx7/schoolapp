import { describe, expect, it } from 'vitest';
import { buildSubPlanAiInput, plannedMinutes, subPlanAiBlocks } from './ai-input';
import { buildAbsencePlans } from './build';
import { composeSubPlan, type ComposedSubPlan } from './compose';
import { subPlanEditsSchema, type SubPlanV1 } from './schema';
import {
  C3,
  C5,
  DEBUTANTS_3E,
  LEVEL,
  NOW,
  WEEK,
  block,
  event,
  isabelleSources,
  lesson,
  parse,
  student,
  twoClassSources,
  type RawEvent,
} from './test-fixtures';

const sources = isabelleSources();
const LEVELS = sources.levels!.map((l) => ({
  id: l.id,
  labelFr: l.labelFr,
  descriptionFr: l.descriptionFr ?? null,
}));

function planOn(date: string, events: RawEvent[] = [], raw = sources): SubPlanV1 {
  return buildAbsencePlans(
    parse({ ...raw, events }),
    { startsOn: date, endsOn: date, part: 'full_day', catholicConnection: true },
    { now: NOW },
  ).plans[0]!.plan;
}

const owner = (plan: SubPlanV1, edits?: unknown): ComposedSubPlan =>
  composeSubPlan(plan, {
    audience: 'owner',
    edits: edits ? subPlanEditsSchema.parse(edits) : null,
  });

describe('buildSubPlanAiInput', () => {
  const monday = planOn(WEEK.mon);
  const input = buildSubPlanAiInput(owner(monday), LEVELS);

  it('sends the teaching periods only, each with the ids that stay in Canada', () => {
    expect(input.blocks.map((b) => `${b.start} ${b.subjectLabel}`)).toEqual([
      '08:55 Français',
      '09:45 Mathématiques',
      '11:15 Français',
      '12:05 Enseignement religieux',
      '13:35 Sciences et technologie',
      '14:25 Éducation artistique',
    ]);
    expect(input.blocks.map((b) => b.key)).toEqual(['B1', 'B2', 'B3', 'B4', 'B5', 'B6']);
    expect(input.blocks[0]!.ref).toEqual({
      blockKey: block(C3, 1, '08:55'),
      lessonId: lesson('fra3', 4),
    });
    expect(input.blocks[2]!.ref).toEqual({
      blockKey: block(C3, 1, '11:15'),
      lessonId: lesson('fra3', 5),
    });
    expect(input.blocks[0]).toMatchObject({
      minutes: 50,
      status: 'normal',
      room: 'Local 101',
      unitTitle: 'Lire pour s’informer : les animaux de l’Ontario',
      needsActivity: false,
      fallback: null,
      lesson: { title: 'Trouver l’idée principale' },
    });
    expect(input.blocks[0]!.lesson!.subNotes).toContain('version illustrée du texte (bac vert)');
    expect(input).toMatchObject({ weekday: 'lundi', gradeLabels: ['3e année'] });
  });

  it('asks for an activity where there is no lesson, with the class’s fallback activities', () => {
    const religion = input.blocks[3]!;
    expect(religion).toMatchObject({
      lesson: null,
      needsActivity: true,
      ref: { blockKey: block(C3, 1, '12:05'), lessonId: null },
    });
    expect(religion.fallback).toContain('Lecture libre (bac jaune)');
  });

  it('sends groups as level names, descriptions and sizes, never students', () => {
    expect(input.groups).toEqual([
      {
        key: 'G1',
        levelLabel: 'Débutant',
        levelDescription:
          'Phrases courtes, vocabulaire très fréquent, appuis visuels suggérés et glossaire.',
        size: 3,
      },
      expect.objectContaining({ key: 'G2', levelLabel: 'Intermédiaire', size: 4 }),
      expect.objectContaining({ key: 'G3', levelLabel: 'Avancé', size: 10 }),
      expect.objectContaining({ key: 'G4', levelLabel: 'Enrichi', size: 3 }),
    ]);
    expect(input.blocks.every((b) => b.groups.join() === 'G1,G2,G3,G4')).toBe(true);

    const json = JSON.stringify(input);
    for (const id of [...DEBUTANTS_3E, student(C3, 1), C3, LEVEL.debutant]) {
      expect(json).not.toContain(id);
    }
  });

  it('leaves out names, class management, arrival and dismissal notes', () => {
    const json = JSON.stringify(input);
    expect(monday.classNotes[0]!.classManagement).toContain('Signal de silence');
    for (const text of [
      'Signal de silence', // « Gestion de classe »
      'porte 3', // arrival
      'autobus 12', // dismissal
      '3e année – Mme Tremblay', // class name
      'Tremblay',
      'Gagnon',
      'Leblanc',
      'Local 104, juste à côté', // the neighbour's note
    ]) {
      expect(json).not.toContain(text);
    }
  });

  it('sends the faith moment chosen for the day, and none once the teacher rewrote it', () => {
    expect(input.faith).toEqual({
      ref: monday.faith!.referenceId,
      title: monday.faith!.title,
      text: monday.faith!.text,
    });
    const rewritten = owner(monday, { faith: { text: 'Notre prière à nous.' } });
    expect(buildSubPlanAiInput(rewritten, LEVELS).faith).toBeNull();
    const removed = owner(monday, { faith: null });
    expect(buildSubPlanAiInput(removed, LEVELS).faith).toBeNull();
  });

  it('plans only the minutes an assembly leaves, and skips periods a mass replaces', () => {
    const friday = planOn(WEEK.fri, [
      event({
        startsOn: WEEK.fri,
        title: 'Messe de l’école',
        startTime: '09:45',
        endTime: '10:35',
      }),
      event({
        startsOn: WEEK.fri,
        eventType: 'assembly',
        title: 'Rassemblement',
        startTime: '08:55',
        endTime: '09:15',
      }),
    ]);
    const blocks = buildSubPlanAiInput(owner(friday), LEVELS).blocks;
    expect(blocks.some((b) => b.start === '09:45')).toBe(false);
    expect(blocks[0]).toMatchObject({
      start: '08:55',
      end: '09:45',
      minutes: 30,
      status: 'interrupted',
      eventTitle: 'Rassemblement',
    });
    const french = friday.blocks.find((b) => b.start === '08:55')!;
    expect(plannedMinutes(french)).toBe(30);
  });

  it('keeps each class’s groups to its own periods, and sends at most ten periods', () => {
    const both = planOn(WEEK.mon, [], twoClassSources());
    const composed = owner(both);
    const two = buildSubPlanAiInput(composed, LEVELS);
    const groupsOf = (classId: string) =>
      composed.groups.filter((g) => g.classId === classId).map((g) => g.key);
    for (const b of two.blocks) {
      const cls = composed.blocks.find((x) => x.key === b.ref.blockKey)!.classId;
      expect(b.groups).toEqual(groupsOf(cls));
    }
    expect(new Set(two.blocks.map((b) => b.groups.join())).size).toBe(2);
    expect(two.gradeLabels).toEqual(['3e année', '5e année']);
    expect(two.blocks).toHaveLength(10);
    expect(subPlanAiBlocks(composed).length).toBeLessThanOrEqual(10);
    expect(composed.blocks.filter((b) => b.kind === 'subject').length).toBeGreaterThan(10);
    expect(JSON.stringify(two)).not.toContain(C5);
  });

  it('skips a lesson already taught that day and has nothing to send on a day of routines only', () => {
    const taught = {
      ...monday,
      blocks: monday.blocks.map((b) =>
        b.lesson ? { ...b, lesson: { ...b.lesson, assignment: 'taught' as const } } : b,
      ),
    };
    const blocks = buildSubPlanAiInput(owner(taught), LEVELS).blocks;
    expect(blocks.every((b) => b.lesson === null)).toBe(true);
    const routines = { ...monday, blocks: monday.blocks.filter((b) => b.kind !== 'subject') };
    expect(buildSubPlanAiInput(owner(routines), LEVELS).blocks).toEqual([]);
  });
});
