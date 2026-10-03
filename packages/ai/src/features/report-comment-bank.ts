/**
 * « Créer une banque avec l’IA » (DECISIONS D-131, D-132): a « Banque de commentaires de
 * bulletin » written from curriculum labels only: points forts and prochaines étapes for one
 * grade, a subject (or the learning skills and work habits, or Enseignement religieux), a report
 * (« Bulletin de progrès » or « Bulletin scolaire ») and up to 12 attentes, each text with the
 * placeholder `{prénom}`. The answer becomes a private draft of the teacher who asked (the
 * database's trigger on `ai_jobs`, through `app.library_item_from_ai_result`).
 *
 * No student data is ever part of a request. The input is built by the database from ids
 * (`app.report_comment_bank_ai_input`): the grade, the subject, the attentes' codes and texts are
 * read from its tables; the request carries no id into the message (the keys `E1`… instead), no
 * school, class or student. The teacher's note (« Précisions ») is the only text she typed: it is
 * de-identified with the rest (D-038), and the answer may contain no marker (« Élève A »), so no
 * name can come back into a bank.
 *
 * Pure (Zod and @lynx/content only): the web server imports it for its preview.
 */
import {
  ACHIEVEMENT_CATEGORIES,
  CATEGORY_LABELS_FR,
  contentSchema,
  entryQualifierProblems,
  FIRST_NAME_TOKEN,
  GRADE_CODE_PATTERN,
  issueKey,
  LEARNING_SKILL_LABELS_FR,
  LEARNING_SKILL_RATING_LABELS_FR,
  LEARNING_SKILL_RATINGS,
  LEARNING_SKILLS,
  normalizeCommentTemplate,
  normalizeFrenchTypography,
  PROGRESS_MARKS,
  REPORT_BANK_SCOPES,
  REPORT_CARD_QUALIFIERS,
  REPORT_ENTRY_KINDS,
  type AchievementCategory,
  type LearningSkill,
  type LearningSkillRating,
  type ProgressMark,
  type ReportBankScope,
  type ReportEntryKind,
} from '@lynx/content';
import { z } from 'zod';
import type { BlockedFinding, Redactor } from '../privacy';
import { selectPromptSections } from '../prompt-sections';
import type { FeatureDefinition } from '../types';
import { findTitledUnknownNames } from '../unknown-names';
import { wordingProblems } from './library-shared';
import { tagged } from './shared';

export const REPORT_COMMENT_BANK = 'report_comment_bank';

/** The reports a bank is generated for: one at a time (a bank for both is written by hand). */
export const REPORT_BANK_AI_PERIODS = ['progress', 'term'] as const;
export type ReportBankAiPeriod = (typeof REPORT_BANK_AI_PERIODS)[number];

/** « Courtes (250 caractères) » or « Moyennes (400 caractères) »: the longest text of an entry. */
export const REPORT_BANK_LENGTHS = { short: 250, medium: 400 } as const;
export type ReportBankLength = keyof typeof REPORT_BANK_LENGTHS;
export const REPORT_BANK_LENGTH_KEYS = ['short', 'medium'] as const;

/** At most this many attentes per bank, and this many characters of « Précisions ». */
export const REPORT_BANK_MAX_EXPECTATIONS = 12;
export const REPORT_BANK_NOTE_MAX = 500;
/** At most this many entries in an answer (the bank's own limit). */
export const REPORT_BANK_MAX_ENTRIES = 160;

export const reportBankExpectationSchema = z.object({
  /** E1…E12, in the order the teacher chose; the attente's id stays in Canada. */
  key: z.string().regex(/^E(?:[1-9]|1[0-2])$/),
  expectationId: z.uuid(),
  code: z.string().max(20),
  text: z.string().max(2000),
  kind: z.enum(['overall', 'specific']),
  /** The attente's domaine, from the database. */
  strandLabel: z.string().max(200).nullable(),
});
export type ReportBankExpectation = z.infer<typeof reportBankExpectationSchema>;

/** Maternelle to 8e année: the grade codes of `public.grades` (the database allows 1re to 8e). */
const gradeCode = z.string().regex(GRADE_CODE_PATTERN);

export const reportCommentBankInputSchema = z
  .object({
    /** What the draft becomes (`app.library_item_from_ai_result`). */
    itemType: z.literal('report_comments'),
    scope: z.enum(REPORT_BANK_SCOPES),
    period: z.enum(REPORT_BANK_AI_PERIODS),
    length: z.enum(REPORT_BANK_LENGTH_KEYS),
    /** One grade (D-132, **Assumption**). */
    gradeCodes: z.array(gradeCode).length(1),
    /** « 3e année »: French labels, from the database. */
    gradeLabels: z.array(z.string().max(40)).length(1),
    /** Null for the learning skills and work habits; Enseignement religieux for religion. */
    subjectId: z.uuid().nullable(),
    subjectLabel: z.string().max(80).nullable(),
    expectations: z.array(reportBankExpectationSchema).max(REPORT_BANK_MAX_EXPECTATIONS),
    teacherNote: z.string().trim().max(REPORT_BANK_NOTE_MAX),
  })
  .superRefine((input, ctx) => {
    const skills = input.scope === 'learning_skills';
    if (skills ? input.subjectId !== null : input.subjectId === null) {
      ctx.addIssue({ code: 'custom', path: ['subjectId'], message: 'invalid' });
    }
    if (!skills && !input.subjectLabel?.trim()) {
      ctx.addIssue({ code: 'custom', path: ['subjectLabel'], message: 'required' });
    }
    if (skills && input.expectations.length) {
      ctx.addIssue({ code: 'custom', path: ['expectations'], message: 'invalid' });
    }
    input.expectations.forEach((e, i) => {
      if (e.key !== `E${i + 1}`) {
        ctx.addIssue({ code: 'custom', path: ['expectations', i, 'key'], message: 'invalid' });
      }
    });
  });
export type ReportCommentBankInput = z.infer<typeof reportCommentBankInputSchema>;

/**
 * One entry as answered. Enumerations are plain strings until normalized (structured outputs
 * ignore enums): `validate` checks them all. `expectationKey` is a key of the request (`E1`…),
 * or null for an entry about the subject as a whole (always null without attentes).
 */
export interface ReportBankAiEntry {
  kind: string;
  expectationKey: string | null;
  skill: string | null;
  level: number | null;
  progress: string | null;
  rating: string | null;
  category: string | null;
  neutral: string;
  feminine: string;
  masculine: string;
  /** Set by `normalize` from `expectationKey`: the codes the bank stores. Never asked for. */
  expectationCodes?: string[];
}

export interface ReportCommentBankAiOutput {
  title: string;
  summary: string;
  /** Free words for the search, separated by commas. */
  keywords: string;
  entries: ReportBankAiEntry[];
}

const aiEntrySchema = z.object({
  kind: z.string(),
  expectationKey: z.string().nullable(),
  skill: z.string().nullable(),
  level: z.number().nullable(),
  progress: z.string().nullable(),
  rating: z.string().nullable(),
  category: z.string().nullable(),
  neutral: z.string(),
  feminine: z.string(),
  masculine: z.string(),
});

/** The answer's schema (D-080), with no enum, pattern or size constraint: `validate` checks them. */
export const reportCommentBankOutputSchema = z.object({
  title: z.string(),
  summary: z.string(),
  keywords: z.string(),
  entries: z.array(aiEntrySchema),
}) as unknown as z.ZodType<ReportCommentBankAiOutput>;

/** Longest parts of an answer (characters), as the library stores them. */
export const REPORT_BANK_OUTPUT_LIMITS = { title: 200, summary: 1000, keywords: 300 } as const;

// ---------------------------------------------------------------------------------------
// De-identification
// ---------------------------------------------------------------------------------------

/**
 * De-identifies every text of the request with one redactor: the teacher's note is the only text
 * she typed and the one most likely to name someone; the labels and the attentes come from the
 * database, and are checked all the same. A note where a title is not followed by a name the app
 * knows (« Merci à Mme Dupuis », `findTitledUnknownNames`) refuses the request, as « Traduire en
 * anglais (IA) » leaves out such a paragraph (D-132, D-139): the teacher takes the name out.
 */
export function redactReportCommentBankInput(
  input: ReportCommentBankInput,
  redactor: Redactor,
): { input: ReportCommentBankInput; blocked: BlockedFinding[] } {
  const blocked: BlockedFinding[] = [];
  const clean = (value: string) => {
    const r = redactor.redact(value);
    blocked.push(...r.blocked);
    return r.text;
  };
  const cleanOrNull = (value: string | null) => (value === null ? null : clean(value));
  const teacherNote = clean(input.teacherNote);
  blocked.push(...findTitledUnknownNames(teacherNote));
  return {
    input: {
      ...input,
      gradeLabels: input.gradeLabels.map(clean),
      subjectLabel: cleanOrNull(input.subjectLabel),
      expectations: input.expectations.map((e) => ({
        ...e,
        code: clean(e.code),
        text: clean(e.text),
        strandLabel: cleanOrNull(e.strandLabel),
      })),
      teacherNote,
    },
    blocked,
  };
}

/** The tag of the teacher's note in the message (`tagged`, which the note cannot close). */
const NOTE_TAG = 'precisions';
const NOTE_BLOCK = new RegExp(`<${NOTE_TAG}>\\n([\\s\\S]*)\\n</${NOTE_TAG}>`, 'u');

/** The teacher's note as the message carries it, or '' when it has none. */
export function reportBankNoteOf(message: string): string {
  return NOTE_BLOCK.exec(message)?.[1] ?? '';
}

// ---------------------------------------------------------------------------------------
// The message
// ---------------------------------------------------------------------------------------

const SCOPE_FR: Record<ReportBankScope, string> = {
  subject: 'une matière',
  learning_skills: 'les habiletés d’apprentissage et les habitudes de travail',
  religion: 'l’enseignement religieux',
};

const PERIOD_FR: Record<ReportBankAiPeriod, string> = {
  term: 'Bulletin scolaire (1re et 2e étapes)',
  progress: 'Bulletin de progrès',
};

/** The marks an entry may be for, as the message names them. */
const MARKS_FR: Record<ReportBankAiPeriod | 'skills', string> = {
  term: 'Niveaux de rendement (`level`) : 1, 2, 3, 4',
  progress:
    'Cotes (`progress`) : with_difficulty (Progresse avec difficulté), well (Progresse bien), very_well (Progresse très bien)',
  skills: `Cotes (\`rating\`) : ${LEARNING_SKILL_RATINGS.map(
    (r) => `${r} (${LEARNING_SKILL_RATING_LABELS_FR[r]})`,
  ).join(', ')}`,
};

const LENGTH_FR: Record<ReportBankLength, string> = {
  short: 'courtes',
  medium: 'moyennes',
};

/** The request in French, as the model reads it (and as the preview shows it). */
export function reportCommentBankUserMessage(input: ReportCommentBankInput): string {
  const skills = input.scope === 'learning_skills';
  const lines = [
    `Banque de commentaires de bulletin pour ${SCOPE_FR[input.scope]}`,
    `Année d'études : ${input.gradeLabels.join(', ')}`,
  ];
  if (!skills) lines.push(`Matière : ${input.subjectLabel ?? ''}`);
  lines.push(
    `Bulletin : ${PERIOD_FR[input.period]}`,
    MARKS_FR[skills ? 'skills' : input.period],
    `Longueur des entrées : ${LENGTH_FR[input.length]}, au plus ${REPORT_BANK_LENGTHS[input.length]} caractères par texte`,
  );
  if (skills) {
    lines.push(
      'Habiletés (`skill`) :',
      ...LEARNING_SKILLS.map((s) => `- ${s} : ${LEARNING_SKILL_LABELS_FR[s]}`),
    );
  } else if (input.expectations.length) {
    lines.push(
      'Attentes visées (`expectationKey`) :',
      ...input.expectations.map(
        (e) =>
          `- ${e.key} — ${e.code} (${e.kind === 'overall' ? 'attente' : 'contenu d’apprentissage'}${
            e.strandLabel?.trim() ? ` · ${e.strandLabel}` : ''
          }) : ${e.text}`,
      ),
    );
  } else {
    lines.push(
      'Attentes visées : aucune (commentaires généraux pour la matière : `expectationKey` est toujours null)',
    );
  }
  lines.push(
    '',
    input.teacherNote.trim()
      ? tagged(NOTE_TAG, input.teacherNote)
      : "Précisions de l'enseignant·e : aucune.",
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------
// Normalizing and checking an answer
// ---------------------------------------------------------------------------------------

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[’'`´_\s-]+/g, ' ')
    .trim();

/** A value of `options`, read loosely: its key in any case, or one of its French names. */
function looseValue<V extends string>(
  value: string | null,
  options: readonly V[],
  french: Record<string, V> = {},
): string | null {
  if (value === null) return null;
  const folded = fold(value);
  if (!folded) return null;
  return (
    options.find((o) => fold(o) === folded) ??
    Object.entries(french).find(([name]) => fold(name) === folded)?.[1] ??
    value.trim()
  );
}

const KIND_NAMES: Record<string, ReportEntryKind> = {
  'point fort': 'strength',
  'points forts': 'strength',
  'prochaine étape': 'next_step',
  'prochaines étapes': 'next_step',
  'commentaire général': 'general',
  'commentaires généraux': 'general',
  général: 'general',
};
const SKILL_NAMES: Record<string, LearningSkill> = Object.fromEntries([
  ...LEARNING_SKILLS.map((s) => [LEARNING_SKILL_LABELS_FR[s], s] as const),
  ['organisation', 'organization'],
  ['collaboration', 'collaboration'],
  ['initiative', 'initiative'],
  ['independent work', 'independent_work'],
  ['self regulation', 'self_regulation'],
]);
const RATING_NAMES: Record<string, LearningSkillRating> = {
  e: 'excellent',
  t: 'good',
  'très bien': 'good',
  s: 'satisfactory',
  satisfaisant: 'satisfactory',
  n: 'needs_improvement',
  'amélioration nécessaire': 'needs_improvement',
};
const PROGRESS_NAMES: Record<string, ProgressMark> = {
  'progresse avec difficulté': 'with_difficulty',
  'avec difficulté': 'with_difficulty',
  'progresse bien': 'well',
  bien: 'well',
  'progresse très bien': 'very_well',
  'très bien': 'very_well',
};
const CATEGORY_NAMES: Record<string, AchievementCategory> = Object.fromEntries([
  ...ACHIEVEMENT_CATEGORIES.map((c) => [CATEGORY_LABELS_FR[c], c] as const),
  ['habiletés', 'habiletes'],
  ['mise en application', 'application'],
]);

const tidy = (text: string) => normalizeCommentTemplate(normalizeFrenchTypography(text.trim()));

/**
 * The answer in its canonical form, for free (D-080): typography, the placeholder spelled
 * `{prénom}` with the article before it in full (« de {prénom} »), French names of kinds, skills,
 * ratings, marks and categories as their keys, a feminine or masculine text that only repeats the
 * neutral one left empty, and each entry's attente key turned into the code the bank stores.
 * Never throws; what it cannot fix is left for `validate`.
 */
export function normalizeReportCommentBank(
  output: ReportCommentBankAiOutput,
  input: ReportCommentBankInput,
): ReportCommentBankAiOutput {
  const codes = new Map(input.expectations.map((e) => [e.key, e.code.trim()]));
  return {
    title: normalizeFrenchTypography(output.title.trim()),
    summary: normalizeFrenchTypography(output.summary.trim()),
    keywords: normalizeFrenchTypography(output.keywords.trim()),
    entries: output.entries.map((e) => {
      const neutral = tidy(e.neutral);
      const feminine = tidy(e.feminine);
      const masculine = tidy(e.masculine);
      const key = e.expectationKey?.trim().toUpperCase() || null;
      const code = key ? codes.get(key) : undefined;
      return {
        kind: looseValue(e.kind, REPORT_ENTRY_KINDS, KIND_NAMES) ?? e.kind,
        expectationKey: key,
        skill: looseValue(e.skill, LEARNING_SKILLS, SKILL_NAMES),
        level:
          typeof e.level === 'number' && Number.isFinite(e.level) ? Math.round(e.level) : e.level,
        progress: looseValue(e.progress, PROGRESS_MARKS, PROGRESS_NAMES),
        rating: looseValue(e.rating, LEARNING_SKILL_RATINGS, RATING_NAMES),
        category: looseValue(e.category, ACHIEVEMENT_CATEGORIES, CATEGORY_NAMES),
        neutral,
        feminine: feminine === neutral ? '' : feminine,
        masculine: masculine === neutral ? '' : masculine,
        expectationCodes: code ? [code] : [],
      };
    }),
  };
}

/** The bank's content as the library stores it (the database builds the same from the answer). */
export function reportBankContent(
  output: ReportCommentBankAiOutput,
  input: ReportCommentBankInput,
) {
  return {
    title: '',
    objective: '',
    teacherNote: '',
    scope: input.scope,
    period: input.period,
    entries: output.entries.map((e) => ({
      kind: e.kind,
      skill: e.skill,
      level: e.level,
      progress: e.progress,
      rating: e.rating,
      category: e.category,
      expectationCodes: e.expectationCodes ?? [],
      neutral: e.neutral,
      feminine: e.feminine,
      masculine: e.masculine,
    })),
  };
}

const pathOf = (path: readonly PropertyKey[]) => path.map(String).join('.');

/** What an entry is for: its attente key (null: the subject as a whole) and its mark. */
type Mark = number | string | null;
const markOf = (e: ReportBankAiEntry, input: ReportCommentBankInput): Mark =>
  input.scope === 'learning_skills' ? e.rating : input.period === 'term' ? e.level : e.progress;

/**
 * Each attente (or the subject as a whole, without attentes) has at least one point fort and one
 * prochaine étape for each level (« Bulletin scolaire ») or progress mark (« Bulletin de
 * progrès »); each learning skill has at least one of each. An entry without a mark is for every
 * mark.
 */
export function reportBankCoverageProblems(
  entries: readonly ReportBankAiEntry[],
  input: ReportCommentBankInput,
): string[] {
  const problems: string[] = [];
  const kinds: ReportEntryKind[] = ['strength', 'next_step'];
  if (input.scope === 'learning_skills') {
    for (const skill of LEARNING_SKILLS) {
      for (const kind of kinds) {
        if (!entries.some((e) => e.kind === kind && e.skill === skill)) {
          problems.push(`entries: no ${kind} for ${skill}`);
        }
      }
    }
    return problems;
  }
  const targets: (string | null)[] = input.expectations.length
    ? input.expectations.map((e) => e.key)
    : [null];
  const marks: Mark[] = input.period === 'term' ? [1, 2, 3, 4] : [...PROGRESS_MARKS];
  for (const target of targets) {
    for (const mark of marks) {
      for (const kind of kinds) {
        const found = entries.some(
          (e) =>
            e.kind === kind &&
            e.expectationKey === target &&
            [mark, null].includes(markOf(e, input)),
        );
        if (!found) problems.push(`entries: no ${kind} for ${target ?? 'the subject'} at ${mark}`);
      }
    }
  }
  return problems;
}

/** Every text of an entry, for the wording and length checks. */
const entryTexts = (e: ReportBankAiEntry) => [e.neutral, e.feminine, e.masculine];

/** Every rule a stored draft needs, with paths and codes (never content). */
export function validateReportCommentBank(
  output: ReportCommentBankAiOutput,
  input: ReportCommentBankInput,
): string[] {
  const L = REPORT_BANK_OUTPUT_LIMITS;
  const problems: string[] = [];
  const max = REPORT_BANK_LENGTHS[input.length];
  const keys = new Set(input.expectations.map((e) => e.key));
  const skills = input.scope === 'learning_skills';

  // What the store needs: the bank's content passes `final` ({prénom} only, no code in a text,
  // the marks that fit the scope and the report).
  const content = contentSchema('report_comments', 'final').safeParse(
    reportBankContent(output, input),
  );
  if (!content.success) {
    for (const issue of content.error.issues) {
      problems.push(`${pathOf(issue.path)}: ${issueKey(issue)}`);
    }
  }
  if (output.entries.length > REPORT_BANK_MAX_ENTRIES) problems.push('entries: tooMany');

  output.entries.forEach((e, i) => {
    const at = `entries.${i}`;
    if (e.expectationKey !== null && !keys.has(e.expectationKey)) {
      problems.push(`${at}.expectationKey: not in the request`);
    }
    if (skills && (e.level !== null || e.progress !== null)) {
      problems.push(`${at}: a level or progress mark for a learning skill`);
    }
    if (!skills && input.period === 'term' && e.progress !== null) {
      problems.push(`${at}.progress: not for this report`);
    }
    for (const [field, text] of [
      ['neutral', e.neutral],
      ['feminine', e.feminine],
      ['masculine', e.masculine],
    ] as const) {
      if ([...text].length > max) problems.push(`${at}.${field}: longer than ${max}`);
    }
    if (
      e.level !== null &&
      (ACHIEVEMENT_CATEGORIES as readonly string[]).includes(e.category ?? '')
    ) {
      for (const p of entryQualifierProblems({
        level: e.level,
        category: e.category as AchievementCategory,
        neutral: e.neutral,
        feminine: e.feminine,
        masculine: e.masculine,
      })) {
        problems.push(`${at}.${p.field}: qualifier of level ${p.foundLevel}`);
      }
    }
  });
  problems.push(...reportBankCoverageProblems(output.entries, input));

  // Sizes of the item's texts.
  if (!output.title.trim()) problems.push('title: required');
  if (output.title.length > L.title) problems.push('title: tooLong');
  if (output.summary.length > L.summary) problems.push('summary: tooLong');
  if (output.keywords.length > L.keywords) problems.push('keywords: tooLong');

  // Words: Canadian French, no marker (no name can come back), no code in an entry's text.
  const item = [output.title, output.summary, output.keywords];
  problems.push(
    ...wordingProblems(
      'item',
      { french: item, all: item },
      { markers: new Set(), codes: new Set(input.expectations.map((e) => e.code.trim())) },
    ),
  );
  const texts = output.entries.flatMap(entryTexts);
  problems.push(
    ...wordingProblems(
      'entries',
      { french: texts, all: texts },
      { markers: new Set(), codes: new Set() },
    ),
  );
  return problems;
}

// ---------------------------------------------------------------------------------------
// The fake provider's answer
// ---------------------------------------------------------------------------------------

const clip = (text: string, max: number) => {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
};

/** « Comparer et ordonner des nombres… » → « comparer et ordonner des nombres… ». */
const topicOf = (text: string) => {
  const t = clip(text.replace(/[.;:!?\s]+$/u, ''), 120);
  return t.charAt(0).toLowerCase() + t.slice(1);
};

const EFFECTIVENESS = REPORT_CARD_QUALIFIERS.application;

const SKILL_DOES: Record<LearningSkill, string> = {
  responsibility: 'remplit ses responsabilités et remet ses travaux',
  organization: 'planifie son travail et organise son matériel',
  independent_work: 'travaille de façon autonome et suit les consignes',
  collaboration: 'collabore avec les autres et partage ses idées',
  initiative: 'fait preuve de curiosité et propose des idées nouvelles',
  self_regulation: 'se fixe des buts et persévère devant les défis',
};
const SKILL_NEXT: Record<LearningSkill, string> = {
  responsibility: 'noter ses travaux à remettre dans son agenda',
  organization: 'découper une tâche en petites étapes avant de commencer',
  independent_work: 'relire les consignes avant de demander de l’aide',
  collaboration: 'inviter chaque membre de l’équipe à donner son avis',
  initiative: 'proposer une idée pendant les travaux en équipe',
  self_regulation: 'choisir une stratégie quand une tâche devient difficile',
};
const RATING_ADVERB: Record<LearningSkillRating, string> = {
  excellent: 'de façon constante',
  good: 'régulièrement',
  satisfactory: 'parfois',
  needs_improvement: 'avec de l’aide',
};

function fakeSubjectEntries(input: ReportCommentBankInput): ReportBankAiEntry[] {
  const subject = (input.subjectLabel ?? '').toLowerCase();
  const targets = input.expectations.length
    ? input.expectations.map((e) => ({ key: e.key as string | null, topic: topicOf(e.text) }))
    : [{ key: null, topic: `réaliser les tâches proposées en ${subject}` }];
  const entry = (
    key: string | null,
    kind: ReportEntryKind,
    mark: { level?: number; progress?: ProgressMark },
    category: AchievementCategory | null,
    neutral: string,
  ): ReportBankAiEntry => ({
    kind,
    expectationKey: key,
    skill: null,
    level: mark.level ?? null,
    progress: mark.progress ?? null,
    rating: null,
    category,
    neutral,
    feminine: '',
    masculine: '',
  });
  const entries = targets.flatMap(({ key, topic }) =>
    input.period === 'term'
      ? [1, 2, 3, 4].flatMap((level) => [
          entry(
            key,
            'strength',
            { level },
            'application',
            `${FIRST_NAME_TOKEN} réussit à ${topic} ${EFFECTIVENESS[level - 1]}.`,
          ),
          entry(
            key,
            'next_step',
            { level },
            null,
            level <= 2
              ? `Avec du soutien, ${FIRST_NAME_TOKEN} pourrait s’exercer à ${topic} à l’aide d’exemples.`
              : `${FIRST_NAME_TOKEN} pourrait maintenant expliquer sa démarche pour ${topic}.`,
          ),
        ])
      : PROGRESS_MARKS.flatMap((progress) => [
          entry(
            key,
            'strength',
            { progress },
            null,
            progress === 'with_difficulty'
              ? `Avec du soutien, ${FIRST_NAME_TOKEN} commence à ${topic}.`
              : progress === 'well'
                ? `${FIRST_NAME_TOKEN} progresse bien et apprend à ${topic}.`
                : `${FIRST_NAME_TOKEN} progresse très bien et parvient à ${topic} de façon autonome.`,
          ),
          entry(
            key,
            'next_step',
            { progress },
            null,
            progress === 'very_well'
              ? `${FIRST_NAME_TOKEN} pourrait relever des défis plus grands pour ${topic}.`
              : `Pour poursuivre ses progrès, ${FIRST_NAME_TOKEN} pourrait s’exercer à ${topic} chaque semaine.`,
          ),
        ]),
  );
  entries.push(
    entry(
      null,
      'general',
      {},
      null,
      `Les efforts de ${FIRST_NAME_TOKEN} en ${subject} sont réguliers. Bravo!`,
    ),
  );
  return entries;
}

function fakeSkillEntries(): ReportBankAiEntry[] {
  return LEARNING_SKILLS.flatMap((skill) =>
    LEARNING_SKILL_RATINGS.flatMap((rating) => [
      {
        kind: 'strength',
        expectationKey: null,
        skill,
        level: null,
        progress: null,
        rating,
        category: null,
        neutral: `${FIRST_NAME_TOKEN} ${SKILL_DOES[skill]} ${RATING_ADVERB[rating]}.`,
        feminine: '',
        masculine: '',
      },
      {
        kind: 'next_step',
        expectationKey: null,
        skill,
        level: null,
        progress: null,
        rating,
        category: null,
        neutral: `${FIRST_NAME_TOKEN} gagnerait à ${SKILL_NEXT[skill]}.`,
        feminine: '',
        masculine: '',
      },
    ]),
  );
}

/**
 * A complete answer without a model: for each attente (or the subject) and each mark, a point fort
 * with the mark's qualifier and a prochaine étape; for the learning skills, both for each skill
 * and rating. Every text uses `{prénom}`. Deterministic, and it passes `normalize` and `validate`
 * for every scope, report and length.
 */
export function fakeReportCommentBank(input: ReportCommentBankInput): ReportCommentBankAiOutput {
  const skills = input.scope === 'learning_skills';
  const about = skills
    ? 'les habiletés d’apprentissage et les habitudes de travail'
    : (input.subjectLabel ?? '');
  const report = input.period === 'term' ? 'le bulletin scolaire' : 'le bulletin de progrès';
  return {
    title: clip(`Commentaires de bulletin : ${about}, ${input.gradeLabels.join(', ')}`, 200),
    summary: clip(
      `Banque de démonstration pour ${report} : des points forts et des prochaines étapes pour ${about}, ${input.gradeLabels.join(', ')}. À relire avant de l’utiliser.`,
      1000,
    ),
    keywords: clip(
      ['bulletin', 'commentaires', 'points forts', 'prochaines étapes', about].join(', '),
      300,
    ),
    entries: skills ? fakeSkillEntries() : fakeSubjectEntries(input),
  };
}

export const reportCommentBankFeature: FeatureDefinition<
  ReportCommentBankInput,
  ReportCommentBankAiOutput
> = {
  name: REPORT_COMMENT_BANK,
  promptVersion: 'v1',
  inputSchema: reportCommentBankInputSchema,
  outputSchema: reportCommentBankOutputSchema,
  // Room for adaptive thinking plus the largest answer: 12 attentes × 4 levels × 2 kinds and some
  // general entries, about 110 entries of up to 400 characters with their keys, about 20k tokens
  // before any thinking (thinking counts toward this limit; a cut-off answer is not retried).
  // Needs a streamed call (see providers.ts), and keeps within the job's 13 minutes.
  maxTokens: 64_000,

  // The common part, the scope's section and the report's; the learning skills have the same
  // ratings on both reports, so their section says it all.
  systemPrompt: (prompt, input) =>
    selectPromptSections(
      prompt,
      input.scope === 'learning_skills'
        ? ['scope:learning_skills']
        : [`scope:${input.scope}`, `period:${input.period}`],
    ),
  redactInput: redactReportCommentBankInput,
  /**
   * The last check before sending runs the title rule on the note again (D-132): only on the note,
   * since an attente of Enseignement religieux may well say « Marie, mère de Jésus ».
   */
  outboundFindings: (message) => findTitledUnknownNames(reportBankNoteOf(message)),
  buildUserMessage: reportCommentBankUserMessage,
  normalize: normalizeReportCommentBank,
  validate: validateReportCommentBank,
  fake: fakeReportCommentBank,
};
