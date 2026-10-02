/**
 * The rules of the « Créer une banque avec l’IA » form (DECISIONS D-132), apart from React so they
 * are unit-tested: which subjects a scope and grade have, what a restored draft or a link may
 * still hold, and what the form sends (ids and choices only).
 */
import type { ReportBankForm } from '@/server/actions/report-bank-ai';
import type { ReportBankFormContext, ReportBankFormValues } from '@/server/queries/report-bank-ai';

/**
 * The device drafts of the form: per user, and per request it started from. Here, not in the
 * client form, because the server pages compute it too.
 */
export const reportBankDraftPrefix = (userId: string) => `report-bank-generate:${userId}`;

export const BANK_MAX_EXPECTATIONS = 12;
export const BANK_NOTE_MAX = 500;
export const BANK_SCOPES = ['subject', 'learning_skills', 'religion'] as const;
export const BANK_PERIODS = ['term', 'progress'] as const;
export const BANK_LENGTHS = ['short', 'medium'] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The subjects of a scope for a grade: Enseignement religieux for religion, the others for a subject. */
export function bankSubjects(
  context: Pick<ReportBankFormContext, 'grades' | 'subjects' | 'schools'>,
  values: Pick<ReportBankFormValues, 'scope' | 'gradeCode' | 'schoolId'>,
): ReportBankFormContext['subjects'] {
  if (values.scope === 'learning_skills') return [];
  const grade = context.grades.find((g) => g.code === values.gradeCode);
  if (!grade) return [];
  const school = context.schools.find((s) => s.id === values.schoolId);
  return context.subjects.filter(
    (s) =>
      s.gradeMin <= grade.ordinal &&
      s.gradeMax >= grade.ordinal &&
      (s.boardId === null || !school || s.boardId === school.boardId) &&
      (values.scope === 'religion' ? s.code === 'ere' : s.code !== 'ere'),
  );
}

/** A new request: her first school with AI on, her first grade, a subject's report card bank. */
export function defaultBankValues(context: ReportBankFormContext): ReportBankFormValues {
  const school = context.schools.find((s) => s.aiEnabled) ?? context.schools[0];
  return {
    schoolId: school?.id ?? '',
    scope: 'subject',
    period: 'term',
    gradeCode: context.defaultGrade ?? '',
    subjectId: '',
    expectationIds: [],
    length: 'medium',
    teacherNote: '',
  };
}

/**
 * The values the form really holds: a restored draft, an old request or a link can name a
 * school, grade, subject or choice that no longer applies. Religion always takes Enseignement
 * religieux; the learning skills take no subject and no attente.
 */
export function effectiveBankValues(
  values: ReportBankFormValues,
  context: ReportBankFormContext,
): ReportBankFormValues {
  const school = context.schools.find((s) => s.id === values.schoolId) ?? context.schools[0];
  const scope = (BANK_SCOPES as readonly string[]).includes(values.scope)
    ? values.scope
    : 'subject';
  const gradeCode = context.grades.some((g) => g.code === values.gradeCode) ? values.gradeCode : '';
  const next = { ...values, schoolId: school?.id ?? '', scope, gradeCode };
  const subjects = bankSubjects(context, next);
  const subjectId =
    scope === 'religion'
      ? (subjects[0]?.id ?? '')
      : subjects.some((s) => s.id === values.subjectId)
        ? values.subjectId
        : '';
  return {
    ...next,
    period: (BANK_PERIODS as readonly string[]).includes(values.period) ? values.period : 'term',
    length: (BANK_LENGTHS as readonly string[]).includes(values.length) ? values.length : 'medium',
    subjectId,
    expectationIds: subjectId
      ? [...new Set(values.expectationIds.filter((id) => UUID.test(id)))].slice(
          0,
          BANK_MAX_EXPECTATIONS,
        )
      : [],
    teacherNote: values.teacherNote.slice(0, BANK_NOTE_MAX),
  };
}

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value)?.trim() || '';

/**
 * The values of a link (« Bulletins » prefills the form with ids only: `scope`, `grade`,
 * `subject`, `period` and `exp`, a comma-separated list of up to 12 attente ids). Null when the
 * link holds none of them.
 */
export function bankValuesFromParams(
  context: ReportBankFormContext,
  params: Record<string, string | string[] | undefined>,
): ReportBankFormValues | null {
  const keys = ['scope', 'grade', 'subject', 'period', 'exp'];
  if (!keys.some((k) => first(params[k]))) return null;
  const defaults = defaultBankValues(context);
  const scope = first(params.scope);
  const period = first(params.period);
  return effectiveBankValues(
    {
      ...defaults,
      scope: (BANK_SCOPES as readonly string[]).includes(scope)
        ? (scope as ReportBankFormValues['scope'])
        : defaults.scope,
      period: (BANK_PERIODS as readonly string[]).includes(period)
        ? (period as ReportBankFormValues['period'])
        : defaults.period,
      gradeCode: first(params.grade) || defaults.gradeCode,
      subjectId: first(params.subject),
      expectationIds: first(params.exp)
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    },
    context,
  );
}

/** What the form sends (ids and choices only): no subject or attente for the learning skills. */
export function toBankForm(values: ReportBankFormValues): ReportBankForm {
  const skills = values.scope === 'learning_skills';
  return {
    schoolId: values.schoolId,
    scope: values.scope,
    period: values.period,
    gradeCode: values.gradeCode,
    subjectId: skills ? null : values.subjectId || null,
    expectationIds: skills ? [] : values.expectationIds,
    length: values.length,
    teacherNote: values.teacherNote,
  };
}
