import { describe, expect, it } from 'vitest';
import {
  defaultClass,
  defaultLesson,
  defaultMode,
  defaultUnit,
  nextLesson,
  orderUnits,
  positionChoices,
  positionKey,
  positionNumber,
  type PlanningClass,
  type PlanningLesson,
  type PlanningUnit,
} from './planning-targets';

const lesson = (n: number, over: Partial<PlanningLesson> = {}): PlanningLesson => ({
  id: `l${n}`,
  sequenceNumber: n,
  title: `Leçon ${n}`,
  done: false,
  expectationIds: [],
  resource: null,
  hasHiddenResource: false,
  ...over,
});

const unit = (id: string, over: Partial<PlanningUnit> = {}): PlanningUnit => ({
  id,
  title: id,
  subjectId: 'fra',
  subjectLabel: 'Français',
  status: 'active',
  lessons: [],
  ...over,
});

describe('adding a resource to the planning', () => {
  it('attaches materials, and makes lesson plans and projects a new lesson', () => {
    expect(defaultMode('worksheet')).toBe('attach');
    expect(defaultMode('reading_passage')).toBe('attach');
    expect(defaultMode('lesson_plan')).toBe('new');
    expect(defaultMode('project')).toBe('new');
  });

  it('picks the next lesson not yet done that shares an attente, else the next one', () => {
    // 3e Français: lessons 1 to 3 done, lesson 4 « Trouver l’idée principale » linked to C1.2.
    const lessons = [
      lesson(1, { done: true, expectationIds: ['c12'] }),
      lesson(2, { done: true }),
      lesson(3, { done: true }),
      lesson(5, { expectationIds: ['c13'] }),
      lesson(4, { expectationIds: ['c12'] }),
    ];
    expect(defaultLesson(lessons, ['c12'])?.id).toBe('l4');
    expect(defaultLesson(lessons, ['c13'])?.id).toBe('l5');
    expect(defaultLesson(lessons, ['d11'])?.id).toBe('l4');
    expect(nextLesson(lessons)?.id).toBe('l4');
    // A finished unit: the last lesson, so the dialog still has a choice.
    expect(defaultLesson([lesson(1, { done: true }), lesson(2, { done: true })], [])?.id).toBe(
      'l2',
    );
    expect(nextLesson([lesson(1, { done: true })])).toBeNull();
    expect(defaultLesson([], ['c12'])).toBeNull();
  });

  it('lists the resource’s subject first, active units before the others', () => {
    const units = [
      unit('Zèbres', { subjectId: 'mat', status: 'active' }),
      unit('Castors', { status: 'completed' }),
      unit('Animaux', { status: 'planned' }),
      unit('Huards', { status: 'active' }),
    ];
    expect(orderUnits(units, 'fra').map((u) => u.id)).toEqual([
      'Huards',
      'Animaux',
      'Castors',
      'Zèbres',
    ]);
  });

  it('starts from the class and unit that fit the resource', () => {
    const classes: PlanningClass[] = [
      { id: 'c5', name: '5e année', gradeCodes: ['5'], units: [unit('u5', { subjectId: 'mat' })] },
      {
        id: 'c3',
        name: '3e année',
        gradeCodes: ['3'],
        units: [unit('u3m', { subjectId: 'mat' }), unit('u3f', { subjectId: 'fra' })],
      },
    ];
    expect(defaultClass(classes, 'fra', ['3'])?.id).toBe('c3');
    expect(defaultClass(classes, 'mat', ['3'])?.id).toBe('c3');
    expect(defaultClass(classes, 'mat', ['5'])?.id).toBe('c5');
    expect(defaultClass(classes, 'sci', ['8'])?.id).toBe('c5');
    expect(defaultUnit(classes[1]!, 'fra')?.id).toBe('u3f');
    expect(defaultClass([], 'fra', ['3'])).toBeNull();
    expect(defaultUnit(null, 'fra')).toBeNull();
  });

  it('offers the end of the unit, the next lesson and after each lesson', () => {
    const lessons = [lesson(1, { done: true }), lesson(2), lesson(3)];
    const choices = positionChoices(lessons);
    expect(choices.map(positionKey)).toEqual(['end', 'next:l2', 'after:l1', 'after:l2']);
    expect(choices.map(positionNumber)).toEqual([null, 2, 2, 3]);
    expect(positionChoices([]).map(positionKey)).toEqual(['end']);
  });
});
