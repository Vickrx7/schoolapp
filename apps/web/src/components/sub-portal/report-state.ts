import type {
  ReportableLesson,
  SubReportContent,
  SubReportNotes,
  SubReportOutcome,
} from '@lynx/domain';

/**
 * The « Suivi de la journée » form (DECISIONS D-054) and what it sends. Plain functions, no
 * React, so the rules can be tested: only lessons of the plan and students of today's roster are
 * sent, in plan order, and a lesson without an answer is simply left out.
 */
export interface ReportFormState {
  /** By lesson id. */
  outcomes: Record<string, SubReportOutcome>;
  /** By block key. */
  lessonNotes: Record<string, string>;
  /** Student ids, for information only. */
  absent: string[];
  behaviour: string;
  forTeacher: string;
}

export const emptyReportState = (): ReportFormState => ({
  outcomes: {},
  lessonNotes: {},
  absent: [],
  behaviour: '',
  forTeacher: '',
});

type Lessons = readonly Pick<ReportableLesson, 'blockKey' | 'lessonId'>[];

/** The form from the report the server holds (or the defaults when there is none). */
export function reportStateFrom(
  content: Pick<SubReportContent, 'lessons' | 'absentStudentIds'> | null,
  notes: SubReportNotes | null,
  lessons: Lessons,
  rosterIds: ReadonlySet<string>,
): ReportFormState {
  const lessonIds = new Set(lessons.map((l) => l.lessonId));
  const blockKeys = new Set(lessons.map((l) => l.blockKey));
  return {
    outcomes: Object.fromEntries(
      (content?.lessons ?? [])
        .filter((l) => lessonIds.has(l.lessonId))
        .map((l) => [l.lessonId, l.outcome]),
    ),
    lessonNotes: Object.fromEntries(
      Object.entries(notes?.lessonNotes ?? {}).filter(([key]) => blockKeys.has(key)),
    ),
    absent: (content?.absentStudentIds ?? []).filter((id) => rosterIds.has(id)),
    behaviour: notes?.behaviour ?? '',
    forTeacher: notes?.forTeacher ?? '',
  };
}

/** What « Envoyer le suivi » (and the autosave) sends: outcomes in plan order, and the notes. */
export function reportFromState(
  state: ReportFormState,
  lessons: Lessons,
  rosterIds: ReadonlySet<string>,
): { content: SubReportContent; notes: SubReportNotes } {
  const blockKeys = new Set(lessons.map((l) => l.blockKey));
  return {
    content: {
      schemaVersion: 1,
      lessons: lessons.flatMap((l) => {
        const outcome = state.outcomes[l.lessonId];
        return outcome ? [{ blockKey: l.blockKey, lessonId: l.lessonId, outcome }] : [];
      }),
      absentStudentIds: [...new Set(state.absent)].filter((id) => rosterIds.has(id)),
    },
    notes: {
      lessonNotes: Object.fromEntries(
        Object.entries(state.lessonNotes)
          .filter(([key, text]) => blockKeys.has(key) && text.trim() !== '')
          .map(([key, text]) => [key, text.trim()]),
      ),
      behaviour: state.behaviour.trim(),
      forTeacher: state.forTeacher.trim(),
    },
  };
}
