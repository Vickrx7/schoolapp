/**
 * Values of the new-request form. A draft restored from the device, or a request reused after
 * a failure, can hold a school, grade, subject or level that no longer applies: the form shows
 * and sends only what does.
 */
import type { DifferentiateInput } from '@lynx/ai/features/differentiate';
import type { DifferentiateFormContext } from '../../server/queries/differentiate';

export type ItemType = 'reading_passage' | 'worksheet';

export interface FormValues {
  schoolId: string;
  title: string;
  text: string;
  objective: string;
  itemType: ItemType;
  gradeCode: string;
  subjectId: string;
  levelIds: string[];
}

type Context = Pick<
  DifferentiateFormContext,
  'schools' | 'levels' | 'grades' | 'subjects' | 'defaultGrade'
>;

const defaultSchoolId = (context: Context) =>
  context.schools.find((s) => s.aiEnabled)?.id ?? context.schools[0]?.id ?? '';

const defaultGradeCode = (context: Context) =>
  context.defaultGrade ?? context.grades.find((g) => g.code === '3')?.code ?? '';

export function defaultFormValues(context: Context): FormValues {
  const schoolId = defaultSchoolId(context);
  const boardId = context.schools.find((s) => s.id === schoolId)?.boardId;
  return {
    schoolId,
    title: '',
    text: '',
    objective: '',
    itemType: 'reading_passage',
    gradeCode: defaultGradeCode(context),
    subjectId: '',
    levelIds: context.levels
      .filter((l) => !l.personal && (!boardId || l.boardId === boardId))
      .map((l) => l.id)
      .slice(0, 6),
  };
}

/** The form filled from an earlier request, to send it again. */
export function resumeFormValues(
  context: Context,
  job: { schoolId: string; input: DifferentiateInput },
): FormValues {
  return effectiveFormValues(
    {
      schoolId: job.schoolId,
      title: job.input.title,
      text: job.input.text,
      objective: job.input.objective,
      itemType: job.input.itemType,
      gradeCode: job.input.gradeCode,
      subjectId: job.input.subjectId ?? '',
      levelIds: job.input.levels.map((l) => l.languageLevelId),
    },
    context,
  );
}

/** Subjects taught in a grade (all of them when no grade is chosen). */
export function subjectsForGrade(
  subjects: Context['subjects'],
  grade: Context['grades'][number] | undefined,
): Context['subjects'] {
  return subjects.filter(
    (s) => !grade || (s.gradeMin <= grade.ordinal && grade.ordinal <= s.gradeMax),
  );
}

/** Whether a subject still applies to a grade (used when the grade changes). */
export function subjectFitsGrade(context: Context, subjectId: string, gradeCode: string): boolean {
  const grade = context.grades.find((g) => g.code === gradeCode);
  return subjectsForGrade(context.subjects, grade).some((s) => s.id === subjectId);
}

/** What the form shows and sends: anything that no longer applies is replaced or left out. */
export function effectiveFormValues(values: FormValues, context: Context): FormValues {
  const schoolId = context.schools.some((s) => s.id === values.schoolId)
    ? values.schoolId
    : defaultSchoolId(context);
  const boardId = context.schools.find((s) => s.id === schoolId)?.boardId;
  const gradeCode = context.grades.some((g) => g.code === values.gradeCode)
    ? values.gradeCode
    : defaultGradeCode(context);
  return {
    ...values,
    itemType: values.itemType === 'worksheet' ? 'worksheet' : 'reading_passage',
    schoolId,
    gradeCode,
    subjectId: subjectFitsGrade(context, values.subjectId, gradeCode) ? values.subjectId : '',
    levelIds: values.levelIds.filter((id) =>
      context.levels.some((l) => l.id === id && (!boardId || l.boardId === boardId)),
    ),
  };
}
