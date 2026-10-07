import { describe, expect, it } from 'vitest';
import { buildAbsencePlans } from './build';
import { groupStudentsByLevel } from './groupings';
import {
  C3,
  C5,
  DEBUTANTS_3E,
  LEVEL,
  NOW,
  WEEK,
  isabelleSources,
  parse,
  paulSources,
  student,
} from './test-fixtures';

const { students, levels } = parse(paulSources());

describe('groupStudentsByLevel', () => {
  it('groups each class in level order', () => {
    const shuffledLevels = [levels[2]!, levels[0]!, levels[3]!, levels[1]!];
    const { groups, withoutLevel } = groupStudentsByLevel(students, shuffledLevels, [C3, C5]);
    expect(groups.map((g) => [g.key, g.classId, g.levelId, g.studentIds.length])).toEqual([
      ['G1', C3, LEVEL.debutant, 3],
      ['G2', C3, LEVEL.intermediaire, 4],
      ['G3', C3, LEVEL.avance, 10],
      ['G4', C3, LEVEL.enrichi, 3],
      ['G5', C5, LEVEL.debutant, 3],
      ['G6', C5, LEVEL.intermediaire, 4],
      ['G7', C5, LEVEL.avance, 10],
      ['G8', C5, LEVEL.enrichi, 3],
    ]);
    expect(groups[0]!.studentIds).toEqual(DEBUTANTS_3E);
    expect(withoutLevel).toBe(false);
  });

  it('puts students without a level last, and the plan warns about them', () => {
    const unleveled = students.map((s) => (s.id === student(C3, 1) ? { ...s, levelId: null } : s));
    const unknownLevel = [
      ...unleveled,
      {
        id: student(C3, 99),
        classId: C3,
        levelId: 'dddddddd-0000-4000-8000-000000000000',
        active: true,
      },
    ];
    const { groups, withoutLevel } = groupStudentsByLevel(unknownLevel, levels, [C3]);
    expect(withoutLevel).toBe(true);
    expect(groups.at(-1)).toEqual({
      key: 'G5',
      classId: C3,
      levelId: null,
      studentIds: [student(C3, 1), student(C3, 99)],
    });

    const raw = isabelleSources();
    raw.students = raw.students!.map((s) =>
      s.id === student(C3, 1) ? { ...s, levelId: null } : s,
    );
    const plan = buildAbsencePlans(
      parse(raw),
      { startsOn: WEEK.mon, endsOn: WEEK.mon, part: 'full_day', catholicConnection: false },
      { now: NOW },
    ).plans[0]!.plan;
    expect(plan.warnings).toContainEqual({ code: 'students_without_level', blockKey: null });
    expect(plan.groups.at(-1)).toMatchObject({ levelId: null, studentIds: [student(C3, 1)] });
  });

  it('leaves inactive students out', () => {
    const withInactive = students.map((s) =>
      DEBUTANTS_3E.includes(s.id) ? { ...s, active: false } : s,
    );
    const { groups } = groupStudentsByLevel(withInactive, levels, [C3]);
    expect(groups.map((g) => g.levelId)).toEqual([
      LEVEL.intermediaire,
      LEVEL.avance,
      LEVEL.enrichi,
    ]);
    expect(groups.flatMap((g) => g.studentIds)).not.toContain(DEBUTANTS_3E[0]);
  });

  it('gives the same keys for the same input, whatever the order', () => {
    const a = groupStudentsByLevel(students, levels, [C3, C5]);
    const b = groupStudentsByLevel([...students].reverse(), [...levels].reverse(), [C3, C5]);
    expect(b).toEqual(a);
    // Without explicit classes, classes are ordered by id.
    expect(groupStudentsByLevel([...students].reverse(), levels).groups).toEqual(a.groups);
  });
});
