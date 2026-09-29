/**
 * The rules of the « Créer avec l’IA » form (DECISIONS D-072, D-074), apart from React so they
 * are unit-tested: which subjects a grade has, what a restored draft may still hold, the faith
 * suggestion and what the form sends.
 */
import { TYPE_INFO } from '@lynx/content';
import { rankCatholicReferences } from '@lynx/domain';
import type { GenerateForm } from '@/server/actions/library-ai';
import type {
  GenerateFormContext,
  GenerateFormValues,
  GenerateReference,
} from '@/server/queries/library-ai';

/**
 * The device drafts of the form: per user, and per attente or request it started from. Here, not
 * in the client form, because the server pages compute it too.
 */
export const generateDraftPrefix = (userId: string) => `library-generate:${userId}`;

/** One or two grades (a split class). */
export const MAX_GRADES = 2;
export const MAX_EXPECTATIONS = 5;
/** Minutes offered (the database accepts 5 to 240). */
export const DURATION_CHOICES = [5, 10, 15, 20, 25, 30, 40, 45, 50, 60, 75, 90, 120, 180, 240];

/**
 * The subjects taught in every chosen grade: by their grade range, and Anglais only from the
 * board's start grade (D-069).
 */
export function subjectsForGrades(
  context: Pick<GenerateFormContext, 'grades' | 'subjects' | 'anglaisStartGrade'>,
  gradeCodes: readonly string[],
): GenerateFormContext['subjects'] {
  const ordinals = context.grades.filter((g) => gradeCodes.includes(g.code)).map((g) => g.ordinal);
  if (!ordinals.length) return [];
  const min = Math.min(...ordinals);
  const max = Math.max(...ordinals);
  return context.subjects.filter(
    (s) =>
      s.gradeMin <= min &&
      s.gradeMax >= max &&
      (s.code !== 'ang' || min >= context.anglaisStartGrade),
  );
}

/** The levels the form offers for a school: its board's, then the teacher's own. */
export function levelsForSchool(context: GenerateFormContext, schoolId: string) {
  const school = context.schools.find((s) => s.id === schoolId);
  return context.levels.filter((l) => !school || l.boardId === school.boardId);
}

/**
 * The values the form really holds: a restored draft (or an old request) can name a school,
 * grade, subject, level or reference that no longer applies, or a choice the type does not have.
 */
export function effectiveGenerateValues(
  values: GenerateFormValues,
  context: GenerateFormContext,
): GenerateFormValues {
  const school = context.schools.find((s) => s.id === values.schoolId) ?? context.schools[0];
  const schoolId = school?.id ?? '';
  const info = TYPE_INFO[values.itemType] ?? TYPE_INFO.worksheet;
  const gradeCodes = values.gradeCodes
    .filter((g) => context.grades.some((x) => x.code === g))
    .slice(0, MAX_GRADES);
  const subjectId = subjectsForGrades(context, gradeCodes).some((s) => s.id === values.subjectId)
    ? values.subjectId
    : '';
  const levels = new Set(levelsForSchool(context, schoolId).map((l) => l.id));
  const faith = values.itemType === 'catholic_reflection' || values.faith;
  const reference = context.references.some(
    (r) =>
      r.id === values.catholicReferenceId &&
      (!school || r.boardId === null || r.boardId === school.boardId),
  );
  return {
    ...values,
    itemType: TYPE_INFO[values.itemType] ? values.itemType : 'worksheet',
    schoolId,
    gradeCodes,
    subjectId,
    expectationIds: subjectId ? values.expectationIds.slice(0, MAX_EXPECTATIONS) : [],
    withLevels: info.levelable && values.withLevels,
    levelIds: values.levelIds.filter((id) => levels.has(id)),
    faith,
    catholicReferenceId: reference ? values.catholicReferenceId : '',
    referenceChosen: reference && values.referenceChosen,
    durationMinutes: DURATION_CHOICES.includes(values.durationMinutes)
      ? values.durationMinutes
      : 30,
    subFriendly: info.subFriendlyAllowed && values.subFriendly,
  };
}

/**
 * The references that fit the request, best first (D-074: the same ranking as substitute plans,
 * on the grades, the date, and the words of the subject, the attentes and the note), then the
 * others in title order, for the picker. `suggested` is how many fit.
 */
export function referenceChoices(
  context: GenerateFormContext,
  values: GenerateFormValues,
  words: { subject: string | null; expectations: readonly string[] },
): { references: GenerateReference[]; suggested: number } {
  const school = context.schools.find((s) => s.id === values.schoolId);
  if (!school) return { references: [], suggested: 0 };
  const own = context.references.filter((r) => r.boardId === null || r.boardId === school.boardId);
  const ranked = rankCatholicReferences(own, {
    gradeOrdinals: context.grades
      .filter((g) => values.gradeCodes.includes(g.code))
      .map((g) => g.ordinal),
    date: school.today,
    keywords: [words.subject ?? '', ...words.expectations, values.teacherNote],
    boardId: school.boardId,
  });
  const rest = own
    .filter((r) => !ranked.includes(r))
    .sort((a, b) => a.title.localeCompare(b.title, 'fr-CA'));
  return { references: [...ranked, ...rest], suggested: ranked.length };
}

/** The reference the request uses: the teacher's choice, else the first suggestion. */
export function chosenReferenceId(
  values: GenerateFormValues,
  choices: { references: readonly GenerateReference[]; suggested: number },
): string {
  if (
    values.referenceChosen &&
    choices.references.some((r) => r.id === values.catholicReferenceId)
  ) {
    return values.catholicReferenceId;
  }
  return choices.suggested > 0 ? choices.references[0]!.id : '';
}

/** What the form sends (ids and choices only): levels and the faith link only when asked for. */
export function toGenerateForm(values: GenerateFormValues, referenceId: string): GenerateForm {
  const info = TYPE_INFO[values.itemType];
  const faith = values.itemType === 'catholic_reflection' || values.faith;
  return {
    schoolId: values.schoolId,
    itemType: values.itemType,
    gradeCodes: values.gradeCodes,
    subjectId: values.subjectId,
    expectationIds: values.expectationIds,
    levelIds: info.levelable && values.withLevels ? values.levelIds : [],
    catholicReferenceId: faith && referenceId ? referenceId : null,
    durationMinutes: values.durationMinutes,
    subFriendly: info.subFriendlyAllowed && values.subFriendly,
    teacherNote: values.teacherNote,
  };
}
