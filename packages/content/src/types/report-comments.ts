/**
 * « Banque de commentaires de bulletin » (DECISIONS D-129, D-131): report card comment phrases a
 * teacher picks from, written with the placeholder `{prénom}` and no student data. Each entry is
 * a strength (« Points forts »), a next step (« Prochaines étapes ») or a general comment, for an
 * achievement level (term report), a progress mark (progress report) or a learning skill and its
 * rating, optionally tied to attentes by code. Neutral (épicène) wording comes first; feminine and
 * masculine texts are optional, for when agreement can't be avoided.
 */
import { ACHIEVEMENT_CATEGORIES } from '../questions';
import { common, type SchemaContext } from './shared';

/** What a bank is about: a subject, the learning skills and work habits, or religion (ERE). */
export const REPORT_BANK_SCOPES = ['subject', 'learning_skills', 'religion'] as const;
export type ReportBankScope = (typeof REPORT_BANK_SCOPES)[number];

/** « Bulletin de progrès », « Bulletin scolaire », or both. */
export const REPORT_BANK_PERIODS = ['progress', 'term', 'any'] as const;
export type ReportBankPeriod = (typeof REPORT_BANK_PERIODS)[number];

export const REPORT_ENTRY_KINDS = ['strength', 'next_step', 'general'] as const;
export type ReportEntryKind = (typeof REPORT_ENTRY_KINDS)[number];

/** The six learning skills and work habits of the Ontario report card. */
export const LEARNING_SKILLS = [
  'responsibility',
  'organization',
  'independent_work',
  'collaboration',
  'initiative',
  'self_regulation',
] as const;
export type LearningSkill = (typeof LEARNING_SKILLS)[number];

/** E, T, S, N: « Excellent », « Très bien », « Satisfaisant », « Amélioration nécessaire ». */
export const LEARNING_SKILL_RATINGS = [
  'excellent',
  'good',
  'satisfactory',
  'needs_improvement',
] as const;
export type LearningSkillRating = (typeof LEARNING_SKILL_RATINGS)[number];

/** The progress report's marks: « Progresse avec difficulté / bien / très bien ». */
export const PROGRESS_MARKS = ['with_difficulty', 'well', 'very_well'] as const;
export type ProgressMark = (typeof PROGRESS_MARKS)[number];

/** Where the student's first name goes (D-131). */
export const FIRST_NAME_TOKEN = '{prénom}';

/** At most this many characters per entry text. */
export const REPORT_ENTRY_MAX = 400;

/** A token in braces (`{prénom}`, `{nom}`) and any brace left alone. */
const BRACES = /\{[^{}]*\}|[{}]/gu;
/** A dotted Ontario curriculum code (« B1.2 »): attentes go in `expectationCodes`, not the text. */
const CURRICULUM_CODE = /(?<![\p{L}\p{N}])[A-Z]\d{1,2}\.\d{1,2}(?!\p{N})/u;

/** True when the text holds a brace or token other than `{prénom}`. */
export function hasStrayPlaceholder(text: string): boolean {
  return [...text.matchAll(BRACES)].some((m) => m[0] !== FIRST_NAME_TOKEN);
}

/** True when the text holds a dotted curriculum code. */
export function hasCurriculumCode(text: string): boolean {
  return CURRICULUM_CODE.test(text);
}

export function reportComments({ k }: SchemaContext) {
  const entry = k.obj({
    kind: k.enumOf(REPORT_ENTRY_KINDS),
    /** Set exactly when the bank is about the learning skills. */
    skill: k.enumOf(LEARNING_SKILLS).nullable(),
    /** An achievement level (term report): null for every level. */
    level: k.int(1, 4).nullable(),
    /** A progress mark (progress report): null for every mark. */
    progress: k.enumOf(PROGRESS_MARKS).nullable(),
    /** A learning skill's rating: null for every rating. */
    rating: k.enumOf(LEARNING_SKILL_RATINGS).nullable(),
    /** The achievement-chart category, for the qualifier check. */
    category: k.enumOf(ACHIEVEMENT_CATEGORIES).nullable(),
    /** Codes of the bank's attentes (« B1.2 »): none for a general entry. */
    expectationCodes: k.list(k.text(20), 0, 4),
    neutral: k.text(REPORT_ENTRY_MAX),
    feminine: k.optText(REPORT_ENTRY_MAX),
    masculine: k.optText(REPORT_ENTRY_MAX),
  });
  const schema = k.obj({
    ...common(k),
    scope: k.enumOf(REPORT_BANK_SCOPES),
    period: k.enumOf(REPORT_BANK_PERIODS),
    entries: k.list(entry, 1, 160),
  });
  if (k.mode !== 'final') return schema;
  return schema.superRefine((value, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    const skills = value.scope === 'learning_skills';
    value.entries.forEach((e, i) => {
      if (skills ? e.skill === null : e.skill !== null) issue(['entries', i, 'skill'], 'invalid');
      if (e.level !== null && value.period === 'progress')
        issue(['entries', i, 'level'], 'invalid');
      if (e.progress !== null && value.period === 'term') {
        issue(['entries', i, 'progress'], 'invalid');
      }
      if (e.rating !== null && e.skill === null) issue(['entries', i, 'rating'], 'invalid');
      for (const field of ['neutral', 'feminine', 'masculine'] as const) {
        if (hasStrayPlaceholder(e[field])) issue(['entries', i, field], 'placeholder');
        else if (hasCurriculumCode(e[field])) issue(['entries', i, field], 'codeInText');
      }
    });
  });
}
