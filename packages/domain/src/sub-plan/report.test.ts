import { describe, expect, it } from 'vitest';
import { buildAbsencePlans } from './build';
import { composeSubPlan } from './compose';
import { defaultConfirmDecisions, reportableLessons } from './report';
import { subReportContentSchema, subReportNotesSchema } from './schema';
import { C3, NOW, WEEK, block, completed, isabelleSources, lesson, parse } from './test-fixtures';

// A Wednesday where the teacher already checked off Français Leçon 4 for that date: the plan
// holds one 'taught' lesson (08:55) and 'assigned' ones (Math at 09:45, Français Leçon 5 at 13:35).
const raw = isabelleSources();
raw.progress = [
  ...completed('fra3', 3),
  ...completed('mat3', 4),
  { lessonId: lesson('fra3', 4), status: 'completed', taughtOn: WEEK.wed },
];
const plan = composeSubPlan(
  buildAbsencePlans(
    parse(raw),
    { startsOn: WEEK.wed, endsOn: WEEK.wed, part: 'full_day', catholicConnection: false },
    { now: NOW },
  ).plans[0]!.plan,
  { audience: 'substitute' },
);

describe('reportableLessons', () => {
  it('returns only lessons the substitute was asked to teach, in plan order', () => {
    expect(plan.blocks.find((b) => b.start === '08:55')!.lesson?.assignment).toBe('taught');
    expect(reportableLessons(plan)).toEqual([
      {
        blockKey: block(C3, 3, '09:45'),
        lessonId: lesson('mat3', 5),
        title: 'Ordonner des nombres',
        unitTitle: 'Les nombres jusqu’à 1 000',
        sequenceNumber: 5,
        className: '3e année – Mme Tremblay',
        start: '09:45',
        end: '10:35',
      },
      expect.objectContaining({ blockKey: block(C3, 3, '13:35'), lessonId: lesson('fra3', 5) }),
    ]);
  });
});

describe('defaultConfirmDecisions', () => {
  it('preselects completed for done lessons and not completed for the others', () => {
    const content = subReportContentSchema.parse({
      schemaVersion: 1,
      lessons: [
        { blockKey: block(C3, 3, '13:35'), lessonId: lesson('fra3', 5), outcome: 'partial' },
        { blockKey: block(C3, 3, '09:45'), lessonId: lesson('mat3', 5), outcome: 'done' },
      ],
    });
    expect(defaultConfirmDecisions(plan, content)).toEqual([
      { lessonId: lesson('mat3', 5), decision: 'completed' },
      { lessonId: lesson('fra3', 5), decision: 'not_completed' },
    ]);
    const notDone = { lessons: [{ ...content.lessons[1]!, outcome: 'not_done' as const }] };
    expect(defaultConfirmDecisions(plan, notDone)).toEqual([
      { lessonId: lesson('mat3', 5), decision: 'not_completed' },
    ]);
    expect(defaultConfirmDecisions(plan, { lessons: [] })).toEqual([]);
  });
});

describe('report schemas', () => {
  const lessonEntry = {
    blockKey: block(C3, 3, '09:45'),
    lessonId: lesson('mat3', 5),
    outcome: 'done',
  };

  it('accepts a report and defaults the purged absent-student list', () => {
    expect(subReportContentSchema.parse({ schemaVersion: 1, lessons: [lessonEntry] })).toEqual({
      schemaVersion: 1,
      lessons: [lessonEntry],
      absentStudentIds: [],
    });
  });

  it('refuses another version, unknown keys, duplicates and unknown outcomes', () => {
    const ok = { schemaVersion: 1, lessons: [lessonEntry], absentStudentIds: [] };
    expect(subReportContentSchema.safeParse(ok).success).toBe(true);
    expect(subReportContentSchema.safeParse({ ...ok, schemaVersion: 2 }).success).toBe(false);
    expect(subReportContentSchema.safeParse({ ...ok, notes: 'texte' }).success).toBe(false);
    expect(
      subReportContentSchema.safeParse({ ...ok, lessons: [lessonEntry, lessonEntry] }).success,
    ).toBe(false);
    expect(
      subReportContentSchema.safeParse({ ...ok, lessons: [{ ...lessonEntry, outcome: 'maybe' }] })
        .success,
    ).toBe(false);
  });

  it('bounds the free text that gets encrypted', () => {
    expect(subReportNotesSchema.parse({})).toEqual({
      lessonNotes: {},
      behaviour: '',
      forTeacher: '',
    });
    expect(
      subReportNotesSchema.safeParse({ behaviour: 'x'.repeat(3001) }).error?.issues[0]?.message,
    ).toBe('tooLong');
    expect(subReportNotesSchema.safeParse({ lessonNotes: { 'not-a-uuid': 'Note' } }).success).toBe(
      false,
    );
  });
});
