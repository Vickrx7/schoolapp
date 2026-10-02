/**
 * Automatic quality checks for AI answers (« Texte différencié », « Consignes détaillées »,
 * « Créer avec l’IA », « Créer les versions manquantes avec l’IA », « Créer une banque avec
 * l’IA »). They catch regressions; a teacher still reads the report for what code cannot judge
 * (natural Canadian French, tone).
 */
import {
  ACHIEVEMENT_CATEGORIES,
  DESIGN_STAGES,
  FIRST_NAME_TOKEN,
  frenchStrings,
  hasCurriculumCode,
  hasStrayPlaceholder,
  notCanadianWords,
  questionsOf,
  reportQualifierLevels,
  rubricWordingProblems,
  studentContent,
  TYPE_INFO,
  validateAnswerKey,
  type AchievementCategory,
  type AnswerKey,
  type LibraryItemType,
} from '@lynx/content';
import type { DifferentiateOutput } from '../features/differentiate';
import type { LibraryItemAiOutput, LibraryItemInput } from '../features/library-item';
import type { LibraryLevelsAiOutput, LibraryLevelsInput } from '../features/library-levels';
import {
  levelParityProblems,
  markersIn,
  proseStrings,
  type LibraryAiVersion,
} from '../features/library-shared';
import {
  REPORT_BANK_LENGTHS,
  reportBankCoverageProblems,
  validateReportCommentBank,
  type ReportCommentBankAiOutput,
  type ReportCommentBankInput,
} from '../features/report-comment-bank';
import { mentionsLevelLabel, NOT_CANADIAN } from '../features/shared';
import type { SubPlanAiInput, SubPlanAiOutput } from '../features/sub-plan';

export { NOT_CANADIAN };

export interface CheckResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Average words per sentence. */
export function averageSentenceLength(text: string): number {
  const sentences = text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => /\p{L}/u.test(s));
  if (!sentences.length) return 0;
  const words = sentences.reduce((n, s) => n + (s.match(/[\p{L}\p{N}’'-]+/gu)?.length ?? 0), 0);
  return words / sentences.length;
}

export function checkDifferentiation(
  output: DifferentiateOutput,
  options: { levelKeys: string[]; mustKeep: string[]; people: string[] },
): CheckResult[] {
  const results: CheckResult[] = [];
  const byKey = new Map(output.versions.map((v) => [v.level, v]));
  const ordered = options.levelKeys.map((k) => byKey.get(k));
  const first = ordered[0];
  const last = ordered[ordered.length - 1];

  results.push({
    name: 'every level present once',
    passed: ordered.every(Boolean) && output.versions.length === options.levelKeys.length,
  });
  results.push({ name: 'shared objective stated', passed: output.objective.trim().length >= 10 });

  const missing = options.levelKeys.flatMap((k) => {
    const v = byKey.get(k);
    if (!v) return [];
    const text = fold(`${v.title}\n${v.text}`);
    return options.mustKeep.filter((w) => !text.includes(fold(w))).map((w) => `${k}: ${w}`);
  });
  results.push({
    name: 'key content kept in every version',
    passed: missing.length === 0,
    detail: missing.join(', ') || undefined,
  });

  if (first && last) {
    const a = averageSentenceLength(first.text);
    const b = averageSentenceLength(last.text);
    results.push({
      name: 'most accessible level has short sentences (≤ 12 words)',
      passed: a <= 12,
      detail: a.toFixed(1),
    });
    results.push({
      name: 'sentences get longer from first to last level',
      passed: a <= b,
      detail: `${a.toFixed(1)} → ${b.toFixed(1)}`,
    });
    results.push({
      name: 'most accessible level has a glossary',
      passed: first.glossary.length >= 2,
    });
    results.push({ name: 'last level has questions', passed: last.questions.length >= 1 });
  }

  const all = fold(
    output.versions
      .map((v) =>
        [
          v.title,
          v.text,
          ...v.questions,
          ...v.glossary.map((g) => `${g.term} ${g.definition}`),
        ].join('\n'),
      )
      .join('\n'),
  );
  const european = NOT_CANADIAN.filter((w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(all));
  results.push({
    name: 'no European French or anglicisms',
    passed: european.length === 0,
    detail: european.join(', ') || undefined,
  });

  const markers = /(?:[ÉEée]l[èe]ve|[Aa]dulte)\s+[A-Z]{1,3}(?![\p{L}])/u.test(
    output.versions.map((v) => v.text).join('\n'),
  );
  results.push({ name: 'no leftover name markers after restore', passed: !markers });
  if (options.people.length) {
    const kept = options.people.filter((p) => all.includes(fold(p)));
    results.push({
      name: 'names restored in the answer',
      passed: kept.length > 0,
      detail: kept.join(', ') || undefined,
    });
  }
  return results;
}

// ---------------------------------------------------------------------------------------
// « Consignes détaillées » (sub_plan)
// ---------------------------------------------------------------------------------------

/** What one evaluation case expects beyond the checks every answer gets. */
export interface SubPlanExpectations {
  /** Phrases the answer must keep (accents, case and apostrophes ignored), e.g. a safety note. */
  mustKeep?: string[];
  /** For each list, the answer mentions at least one of its words (e.g. a movement break). */
  mustMentionAny?: string[][];
  /** The longest step allowed, in minutes (young classes). */
  maxStepMinutes?: number;
  /** The rooms the input gave: no other numbered room, gym or cafeteria may be named. */
  rooms?: string[];
  /** The faith sentence mentions one of these (the reference it links to). */
  faithMentions?: string[];
  /** Fields the request must leave out, by path (their personal detail is never sent). */
  dropped?: string[];
  /** Text that must never be in what was sent. */
  neverSent?: string[];
  /** People of the case whose names must come back in the answer. */
  namesRestored?: string[];
}

/** Apostrophes and spaces made plain, accents and case ignored. */
const loose = (s: string) =>
  fold(s)
    .replace(/[’‘`´]/g, "'")
    .replace(/\s+/g, ' ');

function subPlanText(output: SubPlanAiOutput): string {
  return [
    output.dayOverview,
    output.faithSentence,
    ...output.blocks.flatMap((b) => [
      b.overview,
      b.ifTimeRemains,
      ...b.materialsChecklist,
      ...b.steps.flatMap((s) => [s.instruction, s.say]),
      ...b.differentiation.map((d) => d.instruction),
      ...(b.activity
        ? [
            b.activity.title,
            b.activity.studentInstructions,
            ...b.activity.perGroup.map((g) => g.studentInstructions),
          ]
        : []),
    ]),
  ].join('\n');
}

function inputText(input: SubPlanAiInput): string {
  return [
    ...input.gradeLabels,
    ...input.groups.flatMap((g) => [g.levelLabel, g.levelDescription ?? '']),
    input.faith?.title ?? '',
    input.faith?.text ?? '',
    ...input.blocks.flatMap((b) => [
      b.subjectLabel,
      b.unitTitle ?? '',
      b.eventTitle ?? '',
      b.room ?? '',
      b.fallback ?? '',
      ...(b.lesson
        ? [b.lesson.title, b.lesson.objectives, b.lesson.materials, b.lesson.content]
        : []
      ).map((t) => t ?? ''),
      b.lesson?.subNotes ?? '',
    ]),
  ].join('\n');
}

const HEALTH_WORDS = /allerg|[ée]pip?en|m[ée]dicament|diab[èe]te|asthme|convulsion/giu;
/** France's grade names: never used in Ontario schools. */
const FRENCH_GRADES = /(^|[^\p{L}\p{N}])(CP|CE ?[12]|CM ?[12])(?![\p{L}\p{N}])/u;
/** Ontario curriculum codes (« A1.2 », « B2.3 »). */
const CURRICULUM_CODE = /(?<![\p{L}\p{N}])[A-F]\d{1,2}\.\d{1,2}(?!\p{N})/gu;
/** Numbered rooms and named spaces a transition could send students to. */
const ROOM_MENTION =
  /(?<![\p{L}\p{N}])(?:(?:local|salle)\s+\d+[a-z]?|gymnase|caf[ée]t[ée]ria|salle polyvalente)(?![\p{L}\p{N}])/giu;
const LEFTOVER_MARKER = /(?:[ÉEée]l[èe]ve|[Aa]dulte)\s+[A-Z]{1,3}(?![\p{L}])/u;

export function checkSubPlan(
  output: SubPlanAiOutput,
  input: SubPlanAiInput,
  expect: SubPlanExpectations = {},
  run: { sentText: string | null; problems: string[] } = { sentText: null, problems: [] },
): CheckResult[] {
  const results: CheckResult[] = [];
  const failing = (keys: string[]) => ({
    passed: keys.length === 0,
    detail: keys.join(', ') || undefined,
  });
  const outByKey = new Map(output.blocks.map((b) => [b.key.trim(), b]));
  const pairs = input.blocks.map((b) => ({ block: b, out: outByKey.get(b.key) }));

  const keys = output.blocks.map((b) => b.key.trim()).sort();
  results.push({
    name: 'every period present once',
    passed: JSON.stringify(keys) === JSON.stringify(input.blocks.map((b) => b.key).sort()),
  });
  results.push({
    name: '3 to 10 steps per period',
    ...failing(
      pairs
        .filter(({ out }) => !out || out.steps.length < 3 || out.steps.length > 10)
        .map((p) => p.block.key),
    ),
  });
  results.push({
    name: 'steps fit each period (60–110 % of its minutes)',
    ...failing(
      pairs
        .filter(({ block, out }) => {
          const total = out?.steps.reduce((n, s) => n + s.minutes, 0) ?? 0;
          return (
            !out ||
            out.steps.some((s) => !(s.minutes > 0)) ||
            total < 0.6 * block.minutes ||
            total > 1.1 * block.minutes
          );
        })
        .map((p) => p.block.key),
    ),
  });
  results.push({
    name: 'instructions for every group',
    ...failing(
      pairs
        .filter(({ block, out }) => {
          if (!out) return true;
          const diff = out.differentiation.map((d) => d.group.trim());
          const per = out.activity?.perGroup.map((g) => g.group.trim()) ?? null;
          return (
            diff.some((g) => !block.groups.includes(g)) ||
            (block.groups.length > 1 && block.groups.some((g) => !diff.includes(g))) ||
            (per !== null &&
              (block.groups.some((g) => !per.includes(g)) ||
                per.some((g) => !block.groups.includes(g))))
          );
        })
        .map((p) => p.block.key),
    ),
  });
  results.push({
    name: 'an activity where the lesson is missing or thin',
    ...failing(
      pairs
        .filter(({ block, out }) => block.needsActivity && !out?.activity)
        .map((p) => p.block.key),
    ),
  });
  const labels = input.groups.map((g) => g.levelLabel).filter((l) => l.trim());
  results.push({
    name: 'no level name in what students receive',
    ...failing(
      pairs
        .filter(({ out }) => {
          const a = out?.activity;
          return (
            !!a &&
            [a.title, a.studentInstructions, ...a.perGroup.map((g) => g.studentInstructions)].some(
              (t) => mentionsLevelLabel(t, labels),
            )
          );
        })
        .map((p) => p.block.key),
    ),
  });
  results.push({
    name: 'a faith sentence only when there is a faith moment',
    passed: !!input.faith === output.faithSentence.trim().length > 0,
  });

  const all = subPlanText(output);
  const given = fold(inputText(input));
  const health = [...all.matchAll(HEALTH_WORDS)].map((m) => fold(m[0]));
  results.push({
    name: 'no health words the teacher did not write',
    ...failing([...new Set(health.filter((w) => !given.includes(w)))]),
  });
  const folded = fold(all);
  results.push({
    name: 'no European French or anglicisms',
    ...failing(NOT_CANADIAN.filter((w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(folded))),
  });
  results.push({ name: 'no France grade names (CP, CE1, CM2)', passed: !FRENCH_GRADES.test(all) });
  const codes = [...all.matchAll(CURRICULUM_CODE)].map((m) => m[0]);
  results.push({
    name: 'no invented curriculum codes',
    ...failing([...new Set(codes.filter((c) => !inputText(input).includes(c)))]),
  });
  const says = output.blocks.flatMap((b) => b.steps.map((s) => s.say.trim()).filter(Boolean));
  results.push({
    name: '« Dites » lines in guillemets',
    passed: says.every((s) => /^«[\s\S]*»[.!?…]?$/u.test(s)),
    detail: `${says.length} lines`,
  });
  results.push({
    name: 'no leftover name markers after restore',
    passed: !LEFTOVER_MARKER.test(all),
  });

  if (expect.mustKeep?.length) {
    const text = loose(all);
    results.push({
      name: 'key content kept',
      ...failing(expect.mustKeep.filter((w) => !text.includes(loose(w)))),
    });
  }
  for (const words of expect.mustMentionAny ?? []) {
    results.push({
      name: `mentions ${words.join(' / ')}`,
      passed: words.some((w) => folded.includes(fold(w))),
    });
  }
  if (expect.maxStepMinutes !== undefined) {
    const max = expect.maxStepMinutes;
    results.push({
      name: `steps of ${max} minutes or less`,
      ...failing(
        pairs.filter(({ out }) => out?.steps.some((s) => s.minutes > max)).map((p) => p.block.key),
      ),
    });
  }
  if (expect.rooms) {
    const allowed = expect.rooms.map(loose);
    const named = [...all.matchAll(ROOM_MENTION)].map((m) => loose(m[0]));
    results.push({
      name: 'only rooms that were given',
      ...failing([...new Set(named.filter((r) => !allowed.some((a) => a.includes(r))))]),
    });
  }
  if (expect.faithMentions?.length) {
    const sentence = fold(output.faithSentence);
    results.push({
      name: 'the faith sentence links the day to the reference given',
      passed: expect.faithMentions.some((w) => sentence.includes(fold(w))),
    });
  }
  if (expect.dropped?.length) {
    results.push({
      name: 'fields with a personal detail left out',
      ...failing(expect.dropped.filter((p) => !run.problems.includes(`dropped ${p}`))),
    });
  }
  if (expect.neverSent?.length) {
    results.push({
      name: 'personal details never sent',
      passed: run.sentText !== null && expect.neverSent.every((t) => !run.sentText!.includes(t)),
    });
  }
  if (expect.namesRestored?.length) {
    results.push({
      name: 'names restored in the answer',
      ...failing(expect.namesRestored.filter((n) => !all.includes(n))),
    });
  }
  return results;
}

// ---------------------------------------------------------------------------------------
// « Créer avec l’IA » (library_item) and « Créer les versions manquantes » (library_levels)
// ---------------------------------------------------------------------------------------

/** What one library evaluation case expects beyond the checks every answer gets. */
export interface LibraryItemExpectations {
  /**
   * The most accessible level averages 12 words or fewer per sentence, and sentences do not get
   * shorter from one level to the next.
   */
  mostAccessibleShort?: boolean;
  /** The most accessible level's glossary has at least this many words. */
  glossaryOnMostAccessible?: number;
  /** No number above this anywhere students read (3e année: up to 1 000). */
  maxNumber?: number;
  /** Names that must never be in the resource (a student named in the teacher's note). */
  absentNames?: string[];
  /** Questions of at least this many kinds. */
  minQuestionKinds?: number;
  /** Every answer can be graded automatically, or has a sample answer. */
  autoGradable?: boolean;
  /** Complete safety notes; the allergy field names one of `allergyWords` (if any). */
  safety?: { allergyWords: string[]; standard: boolean };
  /** Design stages among the seven, and constraints and criteria present. */
  designStages?: boolean;
  /** Four categories, four levels per criterion, the chart's wording. */
  rubric?: boolean;
  maxSteps?: number;
  maxDuration?: number;
  /** A brain break needs no equipment. */
  noEquipment?: boolean;
  /** The faith link mentions one of these. */
  faithMentions?: string[];
  /** No quotation (« … ») longer than this many words. */
  maxQuotationWords?: number;
  /** A cultural hook lists facts to verify. */
  factsToVerify?: boolean;
  /** A family guide has both halves, the English one in English. */
  bilingual?: boolean;
}

/** Student-facing prose of a version, as students would read it. */
function studentText(type: LibraryItemType, content: unknown): string {
  const c = content && typeof content === 'object' ? (content as Record<string, unknown>) : {};
  if (typeof c.text === 'string' && c.text.trim()) return c.text;
  return proseStrings(studentContent(type, content)).join('\n');
}

const EQUIPMENT =
  /(?<![\p{L}])(ballons?|cerceaux?|cordes? à sauter|cônes?|foulards?|balles?|matelas|tapis|bâtons?|quilles?)(?![\p{L}])/iu;
const ENGLISH_WORDS = /(?<![\p{L}])(the|your|child|and|to|at|home|is|with)(?![\p{L}])/giu;

function levelChecks(
  type: LibraryItemType,
  base: LibraryAiVersion | null,
  versions: { level: string; version: LibraryAiVersion }[],
  levels: readonly { key: string; label: string; mostAccessible: boolean }[],
): CheckResult[] {
  const results: CheckResult[] = [];
  const failing = (keys: string[]) => ({
    passed: keys.length === 0,
    detail: keys.join(', ') || undefined,
  });
  const got = versions.map((v) => v.level).sort();
  results.push({
    name: 'every level asked for, once',
    passed: JSON.stringify(got) === JSON.stringify(levels.map((l) => l.key).sort()),
  });
  if (base) {
    results.push({
      name: 'objective and questions kept in every level',
      ...failing(
        versions.flatMap((v) =>
          levelParityProblems(type, base.content, v.version.content, v.level),
        ),
      ),
    });
  }
  const labels = levels.map((l) => l.label);
  const all = [...(base ? [{ level: 'base', version: base }] : []), ...versions];
  results.push({
    name: 'no level name in what students receive',
    ...failing(
      all
        .filter(({ version }) =>
          proseStrings(studentContent(type, version.content)).some((t) =>
            mentionsLevelLabel(t, labels),
          ),
        )
        .map((v) => v.level),
    ),
  });
  results.push({
    name: 'every answer key matches its questions',
    ...failing(
      all
        .filter(
          ({ version }) =>
            validateAnswerKey(
              type,
              version.content,
              version.answerKey as unknown as AnswerKey | null,
            ).length > 0,
        )
        .map((v) => v.level),
    ),
  });
  const accessible = levels.find((l) => l.mostAccessible);
  const first = accessible && versions.find((v) => v.level === accessible.key);
  if (first) {
    const length = averageSentenceLength(studentText(type, first.version.content));
    results.push({
      name: 'most accessible level has short sentences (≤ 12 words)',
      passed: length <= 12,
      detail: length.toFixed(1),
    });
  }
  return results;
}

function wordingChecks(french: string[], all: string[]): CheckResult[] {
  const folded = [...new Set(french.flatMap(notCanadianWords))];
  return [
    {
      name: 'no European French or anglicisms',
      passed: folded.length === 0,
      detail: folded.join(', ') || undefined,
    },
    {
      name: 'no France grade names (CP, CE1, CM2)',
      passed: !french.some((t) => FRENCH_GRADES.test(t)),
    },
    { name: 'no person marker', passed: markersIn(all).size === 0 },
  ];
}

export function checkLibraryItem(
  output: LibraryItemAiOutput,
  input: Omit<LibraryItemInput, 'characterNames'>,
  expect: LibraryItemExpectations = {},
): CheckResult[] {
  const type = input.itemType;
  const results: CheckResult[] = [];
  const versions = output.levels.map((l) => ({ level: l.level, version: l }));
  results.push(...levelChecks(type, output.base, versions, input.levels));

  const contents = [output.base, ...output.levels];
  const french = [
    output.title,
    output.summary,
    output.materials,
    output.catholicConnection,
    ...contents.flatMap((v) => frenchStrings(type, v.content)),
  ];
  const all = [
    ...french,
    ...contents.flatMap((v) => [...proseStrings(v.content), ...proseStrings(v.answerKey)]),
  ];
  results.push(...wordingChecks(french, all));
  results.push({
    name: 'a faith link exactly when one was asked for',
    passed: !!input.catholic === output.catholicConnection.trim().length > 0,
  });

  const base = output.base.content as Record<string, unknown>;
  const questions = questionsOf(type, base);
  const key = output.base.answerKey as unknown as AnswerKey | null;

  if (expect.mostAccessibleShort) {
    const ordered = input.levels
      .map((l) => output.levels.find((v) => v.level === l.key))
      .filter((v) => v !== undefined)
      .map((v) => averageSentenceLength(studentText(type, v.content)));
    results.push({
      name: 'sentences do not get shorter from one level to the next',
      passed: ordered.every((len, i) => i === 0 || len >= ordered[i - 1]! - 0.5),
      detail: ordered.map((l) => l.toFixed(1)).join(' → '),
    });
  }
  if (expect.glossaryOnMostAccessible !== undefined) {
    const accessible = input.levels.find((l) => l.mostAccessible);
    const version = output.levels.find((v) => v.level === accessible?.key);
    const glossary = (version?.content as { glossary?: unknown[] } | undefined)?.glossary ?? [];
    results.push({
      name: `most accessible level has a glossary (≥ ${expect.glossaryOnMostAccessible})`,
      passed: glossary.length >= expect.glossaryOnMostAccessible,
      detail: String(glossary.length),
    });
  }
  if (expect.maxNumber !== undefined) {
    const max = expect.maxNumber;
    const big = [
      ...new Set(
        contents
          .flatMap((v) => proseStrings(studentContent(type, v.content)))
          // \u00ab 1 000 \u00bb is one number: thousands grouped by a space.
          .flatMap((t) => [...t.matchAll(/\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?!\d)|\d+/g)])
          .map((m) => Number(m[0].replace(/[ \u00a0\u202f]/g, '')))
          .filter((x) => x > max),
      ),
    ];
    results.push({
      name: `numbers up to ${max}`,
      passed: big.length === 0,
      detail: big.join(', ') || undefined,
    });
  }
  if (expect.absentNames?.length) {
    const text = fold(all.join('\n'));
    const found = expect.absentNames.filter((n) =>
      new RegExp(`(^|[^\\p{L}])${fold(n)}([^\\p{L}]|$)`, 'u').test(text),
    );
    results.push({
      name: 'the student named in the note is nowhere in the resource',
      passed: found.length === 0,
      detail: found.join(', ') || undefined,
    });
  }
  if (expect.minQuestionKinds !== undefined) {
    const kinds = new Set(questions.map((q) => q.question.kind));
    results.push({
      name: `at least ${expect.minQuestionKinds} kinds of questions`,
      passed: kinds.size >= expect.minQuestionKinds,
      detail: [...kinds].join(', '),
    });
  }
  if (expect.autoGradable) {
    const manual = questions.filter(({ question }) => {
      const entry = key?.answers.find((a) => a.questionId === question.id);
      return (
        !entry ||
        (entry.kind === 'short_answer' &&
          entry.acceptableAnswers.length === 0 &&
          !entry.sampleAnswer.trim())
      );
    });
    results.push({
      name: 'every answer grades automatically or has a sample answer',
      passed: manual.length === 0,
      detail: manual.map((q) => q.question.id).join(', ') || undefined,
    });
  }
  if (expect.safety) {
    const notes = output.safetyNotes;
    const complete =
      !!notes &&
      !!notes.ageSuitability.trim() &&
      !!notes.allergyAwareMaterials.trim() &&
      ['standard', 'close', 'adult_only'].includes(notes.supervision);
    results.push({ name: 'safety notes complete', passed: complete });
    if (expect.safety.allergyWords.length) {
      const allergy = fold(notes?.allergyAwareMaterials ?? '');
      results.push({
        name: 'allergy-aware materials name nut-free or latex-free options',
        passed: expect.safety.allergyWords.some((w) => allergy.includes(fold(w))),
      });
    }
    if (expect.safety.standard) {
      results.push({
        name: 'standard supervision (a substitute can run it)',
        passed: notes?.supervision === 'standard',
      });
    }
  }
  if (expect.designStages) {
    const c = base as {
      constraints?: unknown[];
      criteria?: unknown[];
      designStages?: { stage?: string }[];
    };
    results.push({
      name: 'constraints and criteria present',
      passed: (c.constraints?.length ?? 0) > 0 && (c.criteria?.length ?? 0) > 0,
    });
    const stages = (c.designStages ?? []).map((s) => s.stage ?? '');
    results.push({
      name: 'design stages among the seven',
      passed:
        stages.length > 0 && stages.every((s) => (DESIGN_STAGES as readonly string[]).includes(s)),
      detail: stages.join(', '),
    });
  }
  if (expect.rubric) {
    const criteria = (base.criteria ?? []) as {
      category: string;
      levels: { level1: string; level2: string; level3: string; level4: string };
    }[];
    results.push({
      name: 'the four achievement-chart categories',
      passed: ACHIEVEMENT_CATEGORIES.every((cat) => criteria.some((c) => c.category === cat)),
    });
    results.push({
      name: 'four levels per criterion',
      passed: criteria.every((c) =>
        [c.levels.level1, c.levels.level2, c.levels.level3, c.levels.level4].every((l) =>
          l?.trim(),
        ),
      ),
    });
    const wording = rubricWordingProblems({ criteria });
    results.push({
      name: 'achievement-chart wording per level',
      passed: wording.length === 0,
      detail: wording.length ? `${wording.length} problems` : undefined,
    });
  }
  if (expect.maxSteps !== undefined) {
    const steps = (base.steps as unknown[] | undefined)?.length ?? 0;
    results.push({
      name: `${expect.maxSteps} steps or fewer`,
      passed: steps > 0 && steps <= expect.maxSteps,
      detail: String(steps),
    });
  }
  if (expect.maxDuration !== undefined) {
    results.push({
      name: `${expect.maxDuration} minutes or less`,
      passed: output.durationMinutes <= expect.maxDuration,
      detail: String(output.durationMinutes),
    });
  }
  if (expect.noEquipment) {
    const text = proseStrings(base).join('\n') + '\n' + output.materials;
    const found = text.match(EQUIPMENT);
    results.push({
      name: 'no equipment needed',
      passed: !found,
      detail: found?.[0],
    });
  }
  if (expect.faithMentions?.length) {
    const text = fold(`${output.catholicConnection}\n${proseStrings(base).join('\n')}`);
    results.push({
      name: 'the faith link and the reflection speak of the reference',
      passed:
        !!output.catholicConnection.trim() &&
        expect.faithMentions.some((w) => text.includes(fold(w))),
    });
  }
  if (expect.maxQuotationWords !== undefined) {
    const max = expect.maxQuotationWords;
    const long = all.flatMap((t) =>
      [...t.matchAll(/«([^»]*)»/g)]
        .map((m) => m[1]!.match(/[\p{L}\p{N}’'-]+/gu)?.length ?? 0)
        .filter((words) => words > max),
    );
    results.push({
      name: `no quotation longer than ${max} words`,
      passed: long.length === 0,
      detail: long.join(', ') || undefined,
    });
  }
  if (expect.factsToVerify) {
    const facts = (base.factsToVerify as unknown[] | undefined) ?? [];
    results.push({ name: 'facts to verify listed', passed: facts.length > 0 });
  }
  if (expect.bilingual) {
    const fr = base.fr as { intro?: string } | undefined;
    const en = base.en as { intro?: string } | undefined;
    results.push({
      name: 'French and English parts both written',
      passed: !!fr?.intro?.trim() && !!en?.intro?.trim(),
    });
    const english = en?.intro?.match(ENGLISH_WORDS)?.length ?? 0;
    results.push({
      name: 'the English part is in English',
      passed: english >= 2,
      detail: String(english),
    });
  }
  return results;
}

export function checkLibraryLevels(
  output: LibraryLevelsAiOutput,
  input: Omit<LibraryLevelsInput, 'characterNames'>,
): CheckResult[] {
  const type = input.itemType;
  const base = input.base as LibraryAiVersion;
  const results = levelChecks(
    type,
    base,
    output.levels.map((l) => ({ level: l.level, version: l })),
    input.levels,
  );
  const french = output.levels.flatMap((v) => frenchStrings(type, v.content));
  const all = output.levels.flatMap((v) => [
    ...proseStrings(v.content),
    ...proseStrings(v.answerKey),
  ]);
  results.push(...wordingChecks(french, all));
  results.push({
    name: 'a key for every level when the base has one',
    passed: !base.answerKey || output.levels.every((l) => l.answerKey !== null),
  });
  if (TYPE_INFO[type].mayHaveQuestions) {
    const expected = questionsOf(type, base.content).length;
    results.push({
      name: 'as many questions as the base in every level',
      passed: output.levels.every((l) => questionsOf(type, l.content).length === expected),
    });
  }
  return results;
}

// ---------------------------------------------------------------------------------------
// « Créer une banque avec l’IA » (report_comment_bank)
// ---------------------------------------------------------------------------------------

/** What one bank evaluation case expects beyond the checks every answer gets. */
export interface ReportCommentBankExpectations {
  /** Names that must never be in the bank (a student named in the teacher's note). */
  absentNames?: string[];
  /** At least this many entries tied to each attente of the request. */
  minEntriesPerExpectation?: number;
}

/** `{prénom}` in at least this share of the points forts and prochaines étapes. */
const MIN_PLACEHOLDER_SHARE = 0.8;

/**
 * « il » or « elle » as the subject of a neutral text: a rough sign of wording that is not
 * épicène (« il faut », « il serait profitable » and other impersonal uses are left alone).
 */
const GENDERED_PRONOUN =
  /(?<![\p{L}’'])(?:elles?(?![\p{L}])|ils?(?![\p{L}])(?!\s+(?:faut|faudrait|serait|sera|est\s+(?:important|utile|essentiel|souhaitable|recommandé|conseillé)|s[’']agit|y\s+a|importe|convient|reste|semble|vaut)(?![\p{L}])))/iu;

export function checkReportCommentBank(
  output: ReportCommentBankAiOutput,
  input: ReportCommentBankInput,
  expect: ReportCommentBankExpectations = {},
): CheckResult[] {
  const results: CheckResult[] = [];
  const failing = (items: string[]) => ({
    passed: items.length === 0,
    detail: items.slice(0, 8).join(', ') || undefined,
  });
  const texts = output.entries.flatMap((e) => [e.neutral, e.feminine, e.masculine]);
  const french = [output.title, output.summary, output.keywords, ...texts];

  results.push({
    name: 'the bank passes `final` and every rule of the request',
    ...failing(validateReportCommentBank(output, input)),
  });
  results.push(...wordingChecks(french, french));

  const picked = output.entries.filter((e) => e.kind === 'strength' || e.kind === 'next_step');
  const named = picked.filter((e) => e.neutral.includes(FIRST_NAME_TOKEN)).length;
  results.push({
    name: `{prénom} in at least ${MIN_PLACEHOLDER_SHARE * 100} % of points forts and prochaines étapes`,
    passed: picked.length > 0 && named / picked.length >= MIN_PLACEHOLDER_SHARE,
    detail: `${named}/${picked.length}`,
  });
  results.push({
    name: 'no other placeholder, no curriculum code in a text',
    ...failing(
      output.entries.flatMap((e, i) =>
        [e.neutral, e.feminine, e.masculine].some(
          (t) => hasStrayPlaceholder(t) || hasCurriculumCode(t),
        )
          ? [String(i)]
          : [],
      ),
    ),
  });

  // Qualifiers: an entry with a level and a category uses its own level's and no other's.
  const qualified = output.entries
    .map((e, i) => ({ e, i }))
    .filter(
      ({ e }) =>
        e.level !== null &&
        (ACHIEVEMENT_CATEGORIES as readonly string[]).includes(e.category ?? ''),
    );
  results.push({
    name: 'each qualified entry uses its own level’s qualifier and no other',
    ...failing(
      qualified
        .filter(({ e }) => {
          const found = reportQualifierLevels(e.category as AchievementCategory, e.neutral);
          return found.length !== 1 || found[0] !== e.level;
        })
        .map(({ i }) => String(i)),
    ),
  });
  if (input.period === 'term' && input.scope !== 'learning_skills') {
    const strengths = output.entries.filter((e) => e.kind === 'strength' && e.level !== null);
    const withCategory = strengths.filter((e) => e.category !== null).length;
    results.push({
      name: 'at least half of the points forts carry a category and its qualifier',
      passed: strengths.length > 0 && withCategory * 2 >= strengths.length,
      detail: `${withCategory}/${strengths.length}`,
    });
  }
  if (input.period === 'progress' || input.scope === 'learning_skills') {
    results.push({
      name: 'no achievement level on this report',
      passed: output.entries.every((e) => e.level === null),
    });
  }

  results.push({
    name: 'neutral texts do not use « il » or « elle » for the student (rough)',
    ...failing(
      output.entries.flatMap((e, i) => (GENDERED_PRONOUN.test(e.neutral) ? [String(i)] : [])),
    ),
  });
  const max = REPORT_BANK_LENGTHS[input.length];
  results.push({
    name: `every text within ${max} characters`,
    ...failing(
      output.entries.flatMap((e, i) =>
        [e.neutral, e.feminine, e.masculine].some((t) => [...t].length > max) ? [String(i)] : [],
      ),
    ),
  });
  results.push({
    name: 'a point fort and a prochaine étape for every attente (or skill) and mark',
    ...failing(reportBankCoverageProblems(output.entries, input)),
  });
  if (expect.minEntriesPerExpectation !== undefined) {
    const min = expect.minEntriesPerExpectation;
    results.push({
      name: `at least ${min} entries for each attente`,
      ...failing(
        input.expectations
          .filter((x) => output.entries.filter((e) => e.expectationKey === x.key).length < min)
          .map((x) => x.key),
      ),
    });
  }
  if (expect.absentNames?.length) {
    const text = fold(french.join('\n'));
    const found = expect.absentNames.filter((n) =>
      new RegExp(`(^|[^\\p{L}])${fold(n)}([^\\p{L}]|$)`, 'u').test(text),
    );
    results.push({
      name: 'the student named in the note is nowhere in the bank',
      passed: found.length === 0,
      detail: found.join(', ') || undefined,
    });
  }
  return results;
}
