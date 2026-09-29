/**
 * Automatic quality checks for AI answers (« Texte différencié », « Consignes détaillées »). They
 * catch regressions; a teacher still reads the report for what code cannot judge (natural
 * Canadian French, tone).
 */
import type { DifferentiateOutput } from '../features/differentiate';
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
