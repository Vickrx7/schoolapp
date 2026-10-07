import { subReportContentSchema, subReportNotesSchema } from '@lynx/domain';
import { describe, expect, it } from 'vitest';
import { emptyReportState, reportFromState, reportStateFrom } from './report-state';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// Two lessons of the plan: Français (block 1) then Math (block 2).
const lessons = [
  { blockKey: id(1), lessonId: id(11) },
  { blockKey: id(2), lessonId: id(12) },
];
const roster = new Set([id(21), id(22)]);

describe('the report form', () => {
  it('sends answered lessons in plan order, with the notes, as the schemas expect', () => {
    const { content, notes } = reportFromState(
      {
        outcomes: { [id(12)]: 'partial', [id(11)]: 'done' },
        lessonNotes: { [id(1)]: ' Page 12 lue. ', [id(2)]: '   ' },
        absent: [id(22), id(22)],
        behaviour: ' Calme. ',
        forTeacher: '',
      },
      lessons,
      roster,
    );
    expect(content).toEqual({
      schemaVersion: 1,
      lessons: [
        { blockKey: id(1), lessonId: id(11), outcome: 'done' },
        { blockKey: id(2), lessonId: id(12), outcome: 'partial' },
      ],
      absentStudentIds: [id(22)],
    });
    expect(notes).toEqual({
      lessonNotes: { [id(1)]: 'Page 12 lue.' },
      behaviour: 'Calme.',
      forTeacher: '',
    });
    expect(subReportContentSchema.safeParse(content).success).toBe(true);
    expect(subReportNotesSchema.safeParse(notes).success).toBe(true);
  });

  it('leaves out lessons without an answer and anything not in today’s plan or roster', () => {
    const { content, notes } = reportFromState(
      {
        ...emptyReportState(),
        outcomes: { [id(12)]: 'not_done', [id(99)]: 'done' },
        lessonNotes: { [id(98)]: 'Ailleurs' },
        absent: [id(21), id(97)],
      },
      lessons,
      roster,
    );
    expect(content.lessons).toEqual([{ blockKey: id(2), lessonId: id(12), outcome: 'not_done' }]);
    expect(content.absentStudentIds).toEqual([id(21)]);
    expect(notes.lessonNotes).toEqual({});
  });

  it('starts from the saved report, dropping what the plan or roster no longer has', () => {
    const state = reportStateFrom(
      {
        lessons: [
          { blockKey: id(1), lessonId: id(11), outcome: 'done' },
          { blockKey: id(9), lessonId: id(99), outcome: 'done' },
        ],
        absentStudentIds: [id(21), id(97)],
      },
      { lessonNotes: { [id(1)]: 'Bien', [id(9)]: 'x' }, behaviour: 'Calme', forTeacher: 'Merci' },
      lessons,
      roster,
    );
    expect(state).toEqual({
      outcomes: { [id(11)]: 'done' },
      lessonNotes: { [id(1)]: 'Bien' },
      absent: [id(21)],
      behaviour: 'Calme',
      forTeacher: 'Merci',
    });
    expect(reportStateFrom(null, null, lessons, roster)).toEqual(emptyReportState());
  });
});
