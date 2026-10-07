/**
 * « Consignes détaillées » for a substitute plan (SPEC 9.4, DECISIONS D-052): for each teaching
 * period of the day, timed steps with short « Dites : » lines, instructions for each language
 * level group, an activity when the teacher's lesson is missing or thin, and one sentence that
 * links the day's faith moment to the topic (D-058).
 *
 * The input is built from the composed plan by `buildSubPlanAiInput` (packages/domain). It holds
 * no class, school, staff or student names, no alerts, no « Gestion de classe », no arrival or
 * dismissal notes, no absence note and no ids in the message: each block's `ref` (its timetable
 * block and lesson) and the faith reference's id stay in Canada and are never put in the text
 * sent. Groups go as keys and sizes, never as names.
 *
 * Unlike « Texte différencié », a text field that holds a personal detail (a phone number in a
 * note for the substitute...) does not refuse the whole plan: that field is left out, listed in
 * `dropped`, and the preview says « Non envoyé » (D-038 as amended by D-052). The final outbound
 * check still refuses anything that slipped through.
 */
import { z } from 'zod';
import type { BlockedKind, Redactor } from '../privacy';
import type { FeatureDefinition } from '../types';
import { mentionsLevelLabel, tagged } from './shared';

export const SUB_PLAN = 'sub_plan';

/** Periods detailed in one request: a full day, with room for two classes' short periods. */
export const SUB_PLAN_MAX_BLOCKS = 10;
/** Shorter periods are left out: there is nothing to script in a few minutes. */
export const SUB_PLAN_MIN_BLOCK_MINUTES = 10;

export const SUB_PLAN_LIMITS = {
  objectives: 1000,
  materials: 1000,
  content: 3000,
  subNotes: 1000,
  fallback: 1000,
  faithText: 1000,
  levelDescription: 500,
} as const;

const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const;
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const groupKey = z.string().regex(/^G\d{1,2}$/);

export const subPlanAiGroupSchema = z.object({
  /** The plan's group key: students are never named, only counted. */
  key: groupKey,
  levelLabel: z.string().max(60),
  levelDescription: z.string().max(SUB_PLAN_LIMITS.levelDescription).nullable(),
  size: z.number().int().min(0).max(60),
});

export const subPlanAiLessonSchema = z.object({
  title: z.string().max(160),
  objectives: z.string().max(SUB_PLAN_LIMITS.objectives).nullable(),
  materials: z.string().max(SUB_PLAN_LIMITS.materials).nullable(),
  content: z.string().max(SUB_PLAN_LIMITS.content).nullable(),
  /** The teacher's notes for the substitute (safety instructions are copied as written). */
  subNotes: z.string().max(SUB_PLAN_LIMITS.subNotes).nullable(),
});

export const subPlanAiBlockSchema = z.object({
  /** B1, B2...: the only way the model refers to a period. */
  key: z.string().regex(/^B\d{1,2}$/),
  /** Stays in Canada: never in the message. The AI layer is applied only to this block and lesson. */
  ref: z.object({ blockKey: z.uuid(), lessonId: z.uuid().nullable() }),
  start: hhmm,
  end: hhmm,
  /** Minutes to plan: an interrupted period loses the event's minutes. */
  minutes: z.number().int().min(SUB_PLAN_MIN_BLOCK_MINUTES).max(240),
  status: z.enum(['normal', 'shortened', 'interrupted']),
  eventTitle: z.string().max(120).nullable(),
  subjectLabel: z.string().max(80),
  unitTitle: z.string().max(120).nullable(),
  /** Where the period happens (« Gymnase », « Local 104 »). */
  room: z.string().max(60).nullable(),
  /** The groups of this period's class. */
  groups: z.array(groupKey).max(8),
  lesson: subPlanAiLessonSchema.nullable(),
  /** The class's « Activités de rechange », only when there is no lesson. */
  fallback: z.string().max(SUB_PLAN_LIMITS.fallback).nullable(),
  /** No lesson, or a thin one: the answer must include an activity for the students. */
  needsActivity: z.boolean(),
});

export const subPlanAiInputSchema = z
  .object({
    gradeLabels: z.array(z.string().max(40)).max(4),
    weekday: z.enum(WEEKDAYS),
    groups: z.array(subPlanAiGroupSchema).max(20),
    /** The reference the plan already chose (D-058); its id stays in Canada. */
    faith: z
      .object({
        ref: z.uuid(),
        title: z.string().max(160),
        text: z.string().max(SUB_PLAN_LIMITS.faithText),
      })
      .nullable(),
    blocks: z.array(subPlanAiBlockSchema).min(1).max(SUB_PLAN_MAX_BLOCKS),
  })
  .superRefine((input, ctx) => {
    const blockKeys = input.blocks.map((b) => b.key);
    if (new Set(blockKeys).size !== blockKeys.length) {
      ctx.addIssue({ code: 'custom', path: ['blocks'], message: 'duplicate' });
    }
    const groupKeys = new Set(input.groups.map((g) => g.key));
    if (groupKeys.size !== input.groups.length) {
      ctx.addIssue({ code: 'custom', path: ['groups'], message: 'duplicate' });
    }
    input.blocks.forEach((b, i) => {
      if (b.groups.some((g) => !groupKeys.has(g)) || new Set(b.groups).size !== b.groups.length) {
        ctx.addIssue({ code: 'custom', path: ['blocks', i, 'groups'], message: 'invalid' });
      }
    });
  });
export type SubPlanAiInput = z.infer<typeof subPlanAiInputSchema>;
export type SubPlanAiBlockInput = z.infer<typeof subPlanAiBlockSchema>;

// The model's answer. Kept free of length limits (structured outputs support few constraints);
// `validate` checks sizes instead.
export const subPlanAiOutputSchema = z.object({
  dayOverview: z.string(),
  blocks: z.array(
    z.object({
      key: z.string(),
      overview: z.string(),
      /** `say`: a short line to read to the class, in « », or '' for none. */
      steps: z.array(z.object({ minutes: z.number(), instruction: z.string(), say: z.string() })),
      differentiation: z.array(z.object({ group: z.string(), instruction: z.string() })),
      ifTimeRemains: z.string(),
      materialsChecklist: z.array(z.string()),
      activity: z
        .object({
          title: z.string(),
          studentInstructions: z.string(),
          perGroup: z.array(z.object({ group: z.string(), studentInstructions: z.string() })),
        })
        .nullable(),
    }),
  ),
  /** '' when the plan has no faith moment. */
  faithSentence: z.string(),
});
export type SubPlanAiOutput = z.infer<typeof subPlanAiOutputSchema>;
export type SubPlanAiOutputBlock = SubPlanAiOutput['blocks'][number];

/** Longest parts of an answer (characters), checked by `validate`. */
export const SUB_PLAN_OUTPUT_LIMITS = {
  dayOverview: 1200,
  overview: 800,
  steps: { min: 3, max: 10 },
  instruction: 400,
  say: 400,
  differentiation: 500,
  ifTimeRemains: 500,
  materials: { items: 10, length: 200 },
  activityTitle: 120,
  studentInstructions: 1200,
  perGroup: 800,
  faithSentence: 400,
} as const;

// ---------------------------------------------------------------------------------------
// De-identification: every text field, one redactor for the whole request. A field with a
// personal detail is left out (sent empty) instead of refusing the plan.
// ---------------------------------------------------------------------------------------

export interface SubPlanDroppedField {
  /** e.g. 'blocks.B2.lesson.subNotes', 'faith.text', 'groups.G1.levelDescription'. */
  path: string;
  kinds: BlockedKind[];
}

/** De-identifies the input for sending, and lists the fields left out (for the preview too). */
export function redactSubPlanInput(
  input: SubPlanAiInput,
  redactor: Redactor,
): { input: SubPlanAiInput; dropped: SubPlanDroppedField[] } {
  const dropped: SubPlanDroppedField[] = [];
  const clean = (path: string, value: string): string => {
    const r = redactor.redact(value);
    if (r.blocked.length === 0) return r.text;
    dropped.push({ path, kinds: [...new Set(r.blocked.map((b) => b.kind))] });
    return '';
  };
  const cleanOrNull = (path: string, value: string | null) =>
    value === null ? null : clean(path, value);

  return {
    input: {
      ...input,
      gradeLabels: input.gradeLabels.map((g, i) => clean(`gradeLabels.${i}`, g)),
      groups: input.groups.map((g) => ({
        ...g,
        levelLabel: clean(`groups.${g.key}.levelLabel`, g.levelLabel),
        levelDescription: cleanOrNull(`groups.${g.key}.levelDescription`, g.levelDescription),
      })),
      faith: input.faith && {
        ref: input.faith.ref,
        title: clean('faith.title', input.faith.title),
        text: clean('faith.text', input.faith.text),
      },
      blocks: input.blocks.map((b) => {
        const at = (field: string) => `blocks.${b.key}.${field}`;
        return {
          ...b,
          eventTitle: cleanOrNull(at('eventTitle'), b.eventTitle),
          subjectLabel: clean(at('subjectLabel'), b.subjectLabel),
          unitTitle: cleanOrNull(at('unitTitle'), b.unitTitle),
          room: cleanOrNull(at('room'), b.room),
          lesson: b.lesson && {
            title: clean(at('lesson.title'), b.lesson.title),
            objectives: cleanOrNull(at('lesson.objectives'), b.lesson.objectives),
            materials: cleanOrNull(at('lesson.materials'), b.lesson.materials),
            content: cleanOrNull(at('lesson.content'), b.lesson.content),
            subNotes: cleanOrNull(at('lesson.subNotes'), b.lesson.subNotes),
          },
          fallback: cleanOrNull(at('fallback'), b.fallback),
        };
      }),
    },
    dropped,
  };
}

// ---------------------------------------------------------------------------------------
// The message
// ---------------------------------------------------------------------------------------

/** « 8 h 55 », « 13 h » (school-local times, as the plan shows them). */
function frenchTime(time: string): string {
  const [h = '0', m = '00'] = time.split(':');
  return m === '00' ? `${Number(h)} h` : `${Number(h)} h ${m}`;
}

const present = (value: string | null | undefined): value is string => !!value?.trim();

function blockMessage(b: SubPlanAiBlockInput): string {
  const lines = [
    `### ${b.key}`,
    `Heure : ${frenchTime(b.start)} à ${frenchTime(b.end)}. Durée à planifier : ${b.minutes} minutes.`,
  ];
  if (b.status === 'interrupted') {
    lines.push(
      `Période interrompue par un événement de l’école${present(b.eventTitle) ? ` (« ${b.eventTitle} »)` : ''} : planifie seulement les ${b.minutes} minutes qui restent.`,
    );
  } else if (b.status === 'shortened') {
    lines.push(
      `Période écourtée${present(b.eventTitle) ? ` (« ${b.eventTitle} »)` : ''} : planifie seulement ${b.minutes} minutes.`,
    );
  }
  lines.push(`Matière : ${present(b.subjectLabel) ? b.subjectLabel : 'non précisée'}`);
  if (present(b.unitTitle)) lines.push(`Unité : ${b.unitTitle}`);
  lines.push(`Lieu : ${present(b.room) ? b.room : 'non précisé'}`);
  lines.push(`Groupes présents : ${b.groups.length ? b.groups.join(', ') : 'aucun groupe'}`);
  lines.push(
    b.needsActivity
      ? 'Activité pour les élèves : à préparer (la leçon fournie est absente ou trop mince).'
      : 'Activité pour les élèves : non demandée (activity doit être null).',
  );
  if (b.lesson) {
    const l = b.lesson;
    if (present(l.title)) lines.push(tagged('titre_lecon', l.title));
    if (present(l.objectives)) lines.push(tagged('objectifs', l.objectives));
    if (present(l.materials)) lines.push(tagged('materiel', l.materials));
    if (present(l.content)) lines.push(tagged('deroulement_prevu', l.content));
    if (present(l.subNotes)) lines.push(tagged('notes_pour_la_suppleance', l.subNotes));
  } else {
    lines.push('Aucune leçon n’est prévue pour cette période.');
    lines.push(
      present(b.fallback)
        ? tagged('activites_de_rechange', b.fallback)
        : 'Aucune activité de rechange n’a été fournie.',
    );
  }
  return lines.join('\n');
}

function userMessage(input: SubPlanAiInput): string {
  const groups = input.groups.length
    ? input.groups
        .map(
          (g) =>
            `- ${g.key} : ${present(g.levelLabel) ? g.levelLabel : 'niveau non précisé'}, ${g.size} élève${g.size > 1 ? 's' : ''}${present(g.levelDescription) ? `. Description du niveau : ${g.levelDescription}` : ''}`,
        )
        .join('\n')
    : '- aucun groupe de niveau';
  const grades = input.gradeLabels.filter(present);
  return [
    `Journée de suppléance : un ${input.weekday}.`,
    `Année d'études : ${grades.length ? grades.join(', ') : 'non précisée'}.`,
    '',
    'Groupes de niveau de français (les élèves ne sont jamais nommés) :',
    groups,
    '',
    input.faith
      ? [
          'Moment de foi déjà choisi pour la journée :',
          ...(present(input.faith.title) ? [tagged('titre_foi', input.faith.title)] : []),
          ...(present(input.faith.text) ? [tagged('texte_foi', input.faith.text)] : []),
        ].join('\n')
      : 'Moment de foi : aucun. Laisse faithSentence vide.',
    '',
    `Périodes à détailler (${input.blocks.length}), dans cet ordre :`,
    '',
    input.blocks.map(blockMessage).join('\n\n'),
  ].join('\n');
}

// ---------------------------------------------------------------------------------------
// Checks on an answer
// ---------------------------------------------------------------------------------------

/** « Élève A », « Adulte B »: the markers the redactor puts in place of people. */
const MARKER =
  /(?<![\p{L}\p{M}\p{N}])([ÉEée]l[èe]ve|[Aa]dulte)\s+([A-Z]{1,3})(?![\p{L}\p{M}\p{N}])/gu;
/** Health words the answer may only use when the teacher's text does (a safety note). */
const HEALTH = /allerg|[ée]pip?en|m[ée]dicament|diab[èe]te|asthme|convulsion/giu;

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function markersIn(text: string): Set<string> {
  return new Set(
    [...text.matchAll(MARKER)].map(
      (m) => `${fold(m[1]!) === 'adulte' ? 'Adulte' : 'Élève'} ${m[2]}`,
    ),
  );
}

/** Every string of a value, joined (for the marker and health word checks). */
function allText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(allText).join('\n');
  if (value && typeof value === 'object') return Object.values(value).map(allText).join('\n');
  return '';
}

/** Text of a block that students receive (their activity). */
function studentText(block: SubPlanAiOutputBlock): string[] {
  if (!block.activity) return [];
  return [
    block.activity.title,
    block.activity.studentInstructions,
    ...block.activity.perGroup.map((g) => g.studentInstructions),
  ];
}

export function validateSubPlan(output: SubPlanAiOutput, input: SubPlanAiInput): string[] {
  const problems: string[] = [];
  const L = SUB_PLAN_OUTPUT_LIMITS;
  const expected = input.blocks.map((b) => b.key);
  const got = output.blocks.map((b) => b.key.trim());
  for (const key of expected) {
    const count = got.filter((g) => g === key).length;
    if (count === 0) problems.push(`missing block ${key}`);
    if (count > 1) problems.push(`block ${key} appears ${count} times`);
  }
  for (const key of new Set(got))
    if (!expected.includes(key)) problems.push(`unknown block ${key}`);

  const labels = input.groups.map((g) => g.levelLabel).filter(present);
  const inputHealth = fold(allText(input));
  const inputMarkers = markersIn(allText(input));

  for (const out of output.blocks) {
    const block = input.blocks.find((b) => b.key === out.key.trim());
    if (!block) continue;
    const k = block.key;

    // Timed steps that fit the period.
    if (out.steps.length < L.steps.min || out.steps.length > L.steps.max) {
      problems.push(`${k}: ${out.steps.length} steps`);
    }
    if (out.steps.some((s) => !(s.minutes > 0))) problems.push(`${k}: a step without minutes`);
    const total = out.steps.reduce((n, s) => n + (s.minutes > 0 ? s.minutes : 0), 0);
    if (total < 0.6 * block.minutes || total > 1.1 * block.minutes) {
      problems.push(`${k}: steps take ${total} of ${block.minutes} minutes`);
    }
    if (out.steps.some((s) => !s.instruction.trim())) problems.push(`${k}: an empty step`);
    if (out.steps.some((s) => s.instruction.length > L.instruction)) {
      problems.push(`${k}: a step is too long`);
    }
    if (out.steps.some((s) => s.say.length > L.say)) problems.push(`${k}: a say line is too long`);
    if (out.overview.length > L.overview) problems.push(`${k}: overview too long`);
    if (out.ifTimeRemains.length > L.ifTimeRemains) problems.push(`${k}: ifTimeRemains too long`);
    if (out.materialsChecklist.length > L.materials.items) {
      problems.push(`${k}: too many materials`);
    }
    if (out.materialsChecklist.some((m) => m.length > L.materials.length)) {
      problems.push(`${k}: a material is too long`);
    }

    // One instruction per group of the class, and no one else's groups.
    const groups = block.groups;
    const diffGroups = out.differentiation.map((d) => d.group.trim());
    for (const g of new Set(diffGroups)) {
      if (!groups.includes(g)) problems.push(`${k}: unknown group ${g}`);
    }
    if (new Set(diffGroups).size !== diffGroups.length) problems.push(`${k}: a group twice`);
    if (groups.length > 1) {
      for (const g of groups) {
        if (!diffGroups.includes(g)) problems.push(`${k}: no instructions for ${g}`);
      }
    }
    if (out.differentiation.some((d) => !d.instruction.trim())) {
      problems.push(`${k}: an empty group instruction`);
    }
    if (out.differentiation.some((d) => d.instruction.length > L.differentiation)) {
      problems.push(`${k}: a group instruction is too long`);
    }

    // The activity, when the lesson is missing or thin: one version per group.
    if (block.needsActivity && !out.activity) problems.push(`${k}: activity missing`);
    if (out.activity) {
      const a = out.activity;
      if (!a.title.trim() || !a.studentInstructions.trim()) {
        problems.push(`${k}: empty activity`);
      }
      if (a.title.length > L.activityTitle) problems.push(`${k}: activity title too long`);
      if (a.studentInstructions.length > L.studentInstructions) {
        problems.push(`${k}: activity instructions too long`);
      }
      const per = a.perGroup.map((p) => p.group.trim());
      for (const g of groups) if (!per.includes(g)) problems.push(`${k}: no activity for ${g}`);
      for (const g of new Set(per)) {
        if (!groups.includes(g)) problems.push(`${k}: activity for unknown group ${g}`);
      }
      if (new Set(per).size !== per.length) problems.push(`${k}: an activity group twice`);
      if (a.perGroup.some((p) => !p.studentInstructions.trim())) {
        problems.push(`${k}: an empty activity for a group`);
      }
      if (a.perGroup.some((p) => p.studentInstructions.length > L.perGroup)) {
        problems.push(`${k}: an activity for a group is too long`);
      }
    }
    // Students must never see themselves labelled « Débutant » (D-042).
    if (studentText(out).some((t) => mentionsLevelLabel(t, labels))) {
      problems.push(`level name shown to students in ${k}`);
    }

    // People: only the markers the input had. Health: only what the teacher wrote.
    const text = allText(out);
    for (const marker of markersIn(text)) {
      if (!inputMarkers.has(marker)) problems.push(`${k}: a person not in the input`);
    }
    for (const m of text.matchAll(HEALTH)) {
      if (!inputHealth.includes(fold(m[0]))) problems.push(`${k}: a health word not in the input`);
    }
  }

  if (output.dayOverview.length > L.dayOverview) problems.push('day overview too long');
  const dayText = `${output.dayOverview}\n${output.faithSentence}`;
  for (const marker of markersIn(dayText)) {
    if (!inputMarkers.has(marker)) problems.push('a person not in the input');
  }
  for (const m of dayText.matchAll(HEALTH)) {
    if (!inputHealth.includes(fold(m[0]))) problems.push('a health word not in the input');
  }
  const faith = output.faithSentence.trim();
  if (input.faith && !faith) problems.push('faith sentence missing');
  if (!input.faith && faith) problems.push('faith sentence without a faith moment');
  if (faith.length > L.faithSentence) problems.push('faith sentence too long');
  return problems;
}

// ---------------------------------------------------------------------------------------
// The fake provider's answer: deterministic, built from the de-identified input, and following
// the prompt's rules closely enough to pass `validate` and the evaluation checks.
// ---------------------------------------------------------------------------------------

/** Maternelle, jardin, 1re and 2e année: short steps and a movement break. */
const YOUNG = /maternelle|jardin|^\s*1re|^\s*2e/i;

function clipText(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** Sentences of a text, each short enough for one step. */
function sentences(text: string | null, max = 360): string[] {
  if (!text) return [];
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => /\p{L}/u.test(s))
    .map((s) => clipText(s, max));
}

/** Pieces of a note of at most `max` characters, never cutting a sentence that fits. */
function pieces(text: string, max: number): string[] {
  const out: string[] = [];
  for (const s of sentences(text, max)) {
    const last = out.at(-1);
    if (last !== undefined && last.length + 1 + s.length <= max)
      out[out.length - 1] = `${last} ${s}`;
    else out.push(s);
  }
  return out;
}

/** Splits `total` minutes over `count` steps (each at least 1). */
function spread(total: number, count: number): number[] {
  const base = Math.floor(total / count);
  return Array.from({ length: count }, (_, i) => base + (i < total % count ? 1 : 0));
}

const KEEP_GOING = [
  'Poursuivez le travail : circulez et aidez les élèves qui en ont besoin.',
  'Vérifiez où en est chaque groupe et encouragez les élèves à s’entraider.',
];

/**
 * « repérer l’idée… » after a colon (objectives start with a verb). A word in capitals (« ALF »)
 * and a marker (« Élève A ») stay as they are.
 */
const lowerFirst = (s: string) =>
  /^\p{Lu}\p{Ll}/u.test(s) && !/^(?:Élève|Adulte)\s/u.test(s)
    ? s[0]!.toLowerCase() + s.slice(1)
    : s;

const GROUP_TASKS = [
  'Dessine ce que tu as appris. Écris un mot sous chaque dessin.',
  'Écris deux phrases pour expliquer ce que tu as appris.',
  'Écris un court paragraphe, puis ajoute une question que tu te poses.',
];

function fakeBlock(b: SubPlanAiBlockInput, input: SubPlanAiInput): SubPlanAiOutputBlock {
  const young = input.gradeLabels.some((g) => YOUNG.test(g));
  const labels = input.groups.map((g) => g.levelLabel).filter(present);
  const forStudents = (text: string, fallback: string) =>
    mentionsLevelLabel(text, labels) ? fallback : text;
  const lesson = b.lesson;
  const subject = present(b.subjectLabel) ? b.subjectLabel : 'la période';
  const title = lesson && present(lesson.title) ? lesson.title : subject;
  const objective = lowerFirst(
    clipText(
      lesson && present(lesson.objectives) ? lesson.objectives : `découvrir « ${title} »`,
      300,
    ),
  );
  const activityTitle = clipText(forStudents(title, subject), SUB_PLAN_OUTPUT_LIMITS.activityTitle);

  // The body: the teacher's own steps (or her fallback activities), her notes as written.
  const body: string[] = [];
  if (lesson) {
    const content = sentences(lesson.content).slice(0, 5);
    body.push(
      ...(content.length
        ? content
        : [
            `Travail guidé sur « ${clipText(title, 200)} » : modélisez un exemple au tableau, puis faites travailler les élèves en dyades.`,
          ]),
    );
    if (present(lesson.subNotes)) {
      body.push(...pieces(lesson.subNotes, 380).map((p) => clipText(`À retenir : ${p}`, 400)));
    }
  } else {
    const fallback = sentences(b.fallback).slice(0, 4);
    body.push(
      ...(fallback.length
        ? fallback.map((s) => clipText(`Activité de rechange : ${s}`, 400))
        : ['Proposez une activité calme en lien avec la matière, puis circulez pour aider.']),
    );
  }
  if (b.needsActivity) {
    body.push(
      `Distribuez l’activité « ${activityTitle} » : chaque groupe reçoit sa version des consignes.`,
    );
  }

  // Minutes: 10 % to present the goal, 10 % to close, a movement break for young classes.
  const intro = Math.max(1, Math.round(b.minutes * 0.1));
  const outro = Math.max(1, Math.round(b.minutes * 0.1));
  const moveBreak = young && b.minutes >= 30 ? 2 : 0;
  const room = SUB_PLAN_OUTPUT_LIMITS.steps.max - 2 - (moveBreak ? 1 : 0);
  const middleMinutes = b.minutes - intro - outro - moveBreak;
  let middle = body.slice(0, room);
  // Young classes: no step over 8 minutes when there is room for more steps.
  while (young && middle.length < room && middleMinutes / middle.length > 8) {
    middle.push(KEEP_GOING[middle.length % KEEP_GOING.length]!);
  }
  middle = middle.slice(0, Math.max(1, Math.min(middle.length, middleMinutes)));
  const minutes = spread(middleMinutes, middle.length);

  const steps: SubPlanAiOutputBlock['steps'] = [
    {
      minutes: intro,
      instruction: clipText(`Présentez l’objectif : ${objective}`, 400),
      say: `« ${clipText(`Aujourd’hui, voici notre objectif : ${objective}`, 390)} »`,
    },
    ...middle.map((instruction, i) => ({ minutes: minutes[i]!, instruction, say: '' })),
  ];
  if (moveBreak) {
    steps.splice(Math.ceil(steps.length / 2), 0, {
      minutes: moveBreak,
      instruction: 'Pause active : faites bouger les élèves (étirements, sauts sur place).',
      say: '« Levez-vous, on bouge un peu avant de continuer! »',
    });
  }
  steps.push({
    minutes: outro,
    instruction:
      'Faites un retour en grand groupe : demandez à quelques élèves ce qu’ils retiennent.',
    say: '',
  });

  const groupInfo = new Map(input.groups.map((g) => [g.key, g]));
  return {
    key: b.key,
    overview: clipText(`${subject} : ${title}${present(b.room) ? ` (${b.room})` : ''}`, 800),
    steps,
    differentiation: b.groups.map((key) => {
      const g = groupInfo.get(key);
      return {
        group: key,
        instruction: clipText(
          g && present(g.levelDescription)
            ? `Même tâche, adaptée au niveau : ${lowerFirst(g.levelDescription)}`
            : 'Mêmes consignes que le reste de la classe, avec votre appui au besoin.',
          500,
        ),
      };
    }),
    ifTimeRemains: clipText(
      sentences(b.fallback)[0] ?? 'Lecture libre en silence jusqu’à la fin de la période.',
      500,
    ),
    materialsChecklist: (lesson?.materials ?? '')
      .split(/[;,\n]+/)
      .map((m) => m.trim())
      .filter(Boolean)
      .slice(0, 10)
      .map((m) => clipText(m, 150)),
    activity: b.needsActivity
      ? {
          title: activityTitle,
          studentInstructions: forStudents(
            clipText(
              `Lis la consigne avec ton ou ta camarade, puis fais la tâche dans ton cahier. But : ${objective}`,
              1000,
            ),
            'Lis la consigne avec ton ou ta camarade, puis fais la tâche dans ton cahier.',
          ),
          perGroup: b.groups.map((key, i) => ({
            group: key,
            studentInstructions:
              GROUP_TASKS[
                b.groups.length === 1
                  ? 1
                  : Math.round((i * (GROUP_TASKS.length - 1)) / (b.groups.length - 1))
              ]!,
          })),
        }
      : null,
  };
}

function fakeAnswer(input: SubPlanAiInput): SubPlanAiOutput {
  const subjects = [...new Set(input.blocks.map((b) => b.subjectLabel).filter(present))];
  const topic =
    input.blocks.map((b) => b.lesson?.title).find(present) ?? subjects[0] ?? 'la journée';
  return {
    dayOverview: clipText(
      `Journée du ${input.weekday} : ${input.blocks.length} période${input.blocks.length > 1 ? 's' : ''} détaillée${input.blocks.length > 1 ? 's' : ''}${subjects.length ? ` (${subjects.join(', ')})` : ''}. Suivez les étapes minutées et gardez le même objectif pour tous les groupes.`,
      1200,
    ),
    blocks: input.blocks.map((b) => fakeBlock(b, input)),
    faithSentence: input.faith
      ? clipText(
          `Aujourd’hui, pensons à « ${present(input.faith.title) ? input.faith.title : 'notre moment de foi'} » en lien avec « ${topic} ».`,
          400,
        )
      : '',
  };
}

export const subPlanFeature: FeatureDefinition<SubPlanAiInput, SubPlanAiOutput> = {
  name: SUB_PLAN,
  promptVersion: 'v1',
  inputSchema: subPlanAiInputSchema,
  outputSchema: subPlanAiOutputSchema,
  // Room for adaptive thinking plus the whole answer at the largest request (10 periods of
  // 3,000 characters of lesson each): timed steps with « Dites : » lines, one instruction per
  // group and an activity per period, about 25k tokens of French at most before any thinking.
  // Opus 5.5 always thinks and thinking counts toward this limit; a cut-off answer is not
  // retried (aiTooLong), so the limit is generous. Needs a streamed call (see providers.ts), and
  // the evaluation set has a case at that largest size to show it fits the job's 13 minutes.
  maxTokens: 64_000,

  redactInput(input: SubPlanAiInput, redactor: Redactor) {
    const { input: clean, dropped } = redactSubPlanInput(input, redactor);
    // A field with a personal detail is left out rather than blocking the plan;
    // assertSafeOutbound (run.ts) still refuses anything that remains.
    return { input: clean, blocked: [], dropped: dropped.map((d) => d.path) };
  },

  buildUserMessage: userMessage,
  validate: validateSubPlan,
  fake: fakeAnswer,
};
