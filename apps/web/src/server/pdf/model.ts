/**
 * What the plan PDF prints (DECISIONS D-053), as plain strings ready to lay out: the schedule
 * with lessons and steps, groups with first names, the class notes, contacts, the end of the day
 * and the faith moment. Plan content is the teacher's French; labels follow the interface.
 *
 * Paper cannot be audited or taken back, so two things never reach it:
 * - safety and medical alerts: there is no alerts input at all, and the alerts section is a fixed
 *   sentence sending the reader to the app or the direction;
 * - « Gestion de classe »: the plan must be composed for the 'pdf' audience (which drops it), and
 *   this builder never reads it anyway (the labels have no heading for it).
 *
 * Pure and not server-only, so it can be unit tested.
 */
import type {
  AbsencePart,
  ComposedBlock,
  ComposedSubPlan,
  LocalDate,
  SubPlanClassNotes,
} from '@lynx/domain';
import type { PlanContext, PlanLevel, RosterStudent } from '../../components/sub-plans/types';
import { localized, type AppLocale } from '../../i18n/config';
import { formatLocalDate, formatTime, formatTimeRange } from '../../lib/format';

/** The interface words the PDF needs, in the reader's language (labels.ts builds them). */
export interface PlanPdfLabels {
  locale: AppLocale;
  title: string;
  documentTitle: (date: string) => string;
  confidential: string;
  page: (page: number, total: number) => string;
  alertsElsewhere: string;
  /** Shown instead of the PDF when it cannot be rendered. */
  failed: string;
  /** The link back from the failure page. */
  failedBack: string;
  classOf: (name: string) => string;
  dayOfCycle: (n: number) => string;
  part: Record<AbsencePart, string>;
  status: Record<'shortened' | 'replaced' | 'interrupted', string>;
  role: Record<'homeroom' | 'subject' | 'support', string>;
  overview: string;
  absenceNote: string;
  sections: Record<
    'schedule' | 'events' | 'groups' | 'classNotes' | 'contacts' | 'endOfDay' | 'faith',
    string
  >;
  block: Record<
    | 'steps'
    | 'say'
    | 'ifTime'
    | 'materials'
    | 'objectives'
    | 'content'
    | 'subNotes'
    | 'notes'
    | 'teacherNote'
    | 'taught',
    string
  > & {
    lesson: (n: number, unit: string) => string;
    gap: (title: string) => string;
    otherAdult: (name: string) => string;
    minutes: (n: number) => string;
  };
  /** The AI layer's parts of a block (3b, D-052). */
  ai: Record<'overview' | 'differentiation' | 'activity', string>;
  /** No « Gestion de classe »: it is never printed. */
  classNotes: Record<'arrival' | 'routines' | 'dismissal' | 'fallbackActivities', string>;
  contacts: Record<'office' | 'neighbour' | 'arrival' | 'emergency', string>;
  groups: { noLevel: string; hint: string; count: (count: number) => string };
  endOfDayAt: (time: string) => string;
}

/** A piece of a section: teacher text is kept as typed (line breaks included). */
export type PdfPart =
  | { kind: 'heading'; text: string }
  | { kind: 'text'; label: string | null; text: string }
  | { kind: 'list'; label: string | null; items: string[] }
  | { kind: 'group'; title: string; meta: string; names: string; description: string | null };

export interface PlanPdfStep {
  /** « 10 min », or null for a step without a duration. */
  minutes: string | null;
  text: string;
  /** « Dites : … », label included (AI layer, 3b). */
  say: string | null;
}

export interface PlanPdfBlock {
  key: string;
  /** « 8 h 55 – 9 h 45 » */
  time: string;
  title: string;
  /** The class (when the plan covers several), a status other than normal, the room. */
  tags: string[];
  /** « Avec M. Leblanc » */
  otherAdult: string | null;
  event: { title: string; notes: string | null } | null;
  lesson: { heading: string; title: string; gap: string | null } | null;
  /** Lesson details and the timetable note, before the steps. */
  details: PdfPart[];
  steps: PlanPdfStep[];
  /** The teacher's note and the AI layer's extras, after the steps. */
  extras: PdfPart[];
}

export interface PlanPdfSection {
  id: 'schedule' | 'events' | 'groups' | 'classNotes' | 'contacts' | 'endOfDay' | 'faith';
  title: string;
  parts: PdfPart[];
  /** The schedule section only. */
  blocks: PlanPdfBlock[];
}

/** The plan's own language (the builder and teachers write French; D-033). */
const PLAN_CONTENT_LANG = 'fr-CA';

export interface PlanPdfModel {
  /** Document properties: no names, only the date. */
  info: { title: string; language: string };
  /** A file name with the date only, e.g. plan-suppleance-2026-10-21.pdf. */
  fileName: string;
  header: {
    schoolName: string;
    title: string;
    /** The classes, or « Classe de Mme Tremblay » when the plan covers none. */
    heading: string;
    /** Date, part of day, cycle day and hours; then teacher and rooms. */
    lines: string[];
  };
  /** The teacher's note to the office and the substitute, and her overview of the day. */
  intro: PdfPart[];
  /** Always the fixed sentence: alerts are never printed. */
  alertsNotice: string;
  sections: PlanPdfSection[];
  /** « Déroulement », above each block's steps. */
  stepsLabel: string;
  footer: { confidential: string; page: (page: number, total: number) => string };
}

/** Teacher text as typed: Windows line breaks and tabs made plain, trailing space removed. */
export function clean(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '    ')
    .replace(/[ \u00a0]+$/gm, '')
    .trim();
}

export function nonBlank(text: string | null | undefined): string | null {
  const v = text == null ? '' : clean(text);
  return v ? v : null;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Whether a template step already quotes this text (as the web view decides, block-card.tsx). */
const quoted = (block: ComposedBlock, text: string | null) =>
  !!text && block.steps.some((s) => s.text.includes(text.trim()));

function textPart(label: string | null, text: string | null | undefined): PdfPart[] {
  const v = nonBlank(text);
  return v ? [{ kind: 'text', label, text: v }] : [];
}

function listPart(label: string | null, items: readonly string[]): PdfPart[] {
  const cleaned = items.map((i) => nonBlank(i)).filter((i): i is string => i !== null);
  return cleaned.length ? [{ kind: 'list', label, items: cleaned }] : [];
}

function pdfBlock(
  block: ComposedBlock,
  labels: PlanPdfLabels,
  showClass: boolean,
  groupName: (key: string) => string,
): PlanPdfBlock {
  const { locale } = labels;
  const lesson = block.lesson;
  const details: PdfPart[] = [...textPart(labels.ai.overview, block.ai?.overview)];
  if (lesson) {
    if (!quoted(block, lesson.objectives)) {
      details.push(...textPart(labels.block.objectives, lesson.objectives));
    }
    details.push(...textPart(labels.block.materials, lesson.materials));
    if (!quoted(block, lesson.subNotes)) {
      details.push(...textPart(labels.block.subNotes, lesson.subNotes));
    }
    if (!quoted(block, lesson.content)) {
      details.push(...textPart(labels.block.content, lesson.content));
    }
  }
  details.push(...textPart(labels.block.notes, block.notes));

  // The AI layer's instructions by group are for the adult (level names allowed); the students'
  // own copies of an activity are a separate document (never with a level name, D-042).
  const activity = block.ai?.activity;
  const extras: PdfPart[] = [
    ...textPart(labels.block.teacherNote, block.teacherNote),
    ...listPart(
      labels.ai.differentiation,
      (block.ai?.differentiation ?? []).map((d) => `${groupName(d.group)} — ${d.instruction}`),
    ),
    ...textPart(
      labels.ai.activity,
      activity ? `${activity.title}\n${activity.studentInstructions}` : null,
    ),
    ...listPart(labels.block.materials, block.ai?.materialsChecklist ?? []),
    ...textPart(labels.block.ifTime, block.ai?.ifTimeRemains),
  ];

  const eventTime = block.event?.start ? ` · ${formatTime(block.event.start, locale)}` : '';
  return {
    key: block.key,
    time: formatTimeRange(block.start, block.end, locale),
    title: block.title,
    tags: [
      showClass ? block.className : null,
      block.status !== 'normal' ? labels.status[block.status] : null,
      block.roomName,
    ].filter((t): t is string => !!t),
    otherAdult: block.otherAdult ? labels.block.otherAdult(block.otherAdult) : null,
    event: block.event
      ? { title: `${block.event.title}${eventTime}`, notes: nonBlank(block.event.notes) }
      : null,
    lesson: lesson
      ? {
          heading:
            labels.block.lesson(lesson.sequenceNumber, lesson.unitTitle) +
            (lesson.assignment === 'taught' ? ` · ${labels.block.taught}` : ''),
          title: lesson.title,
          gap: lesson.gapBefore ? labels.block.gap(lesson.gapBefore) : null,
        }
      : null,
    details,
    steps: block.steps
      .map((s) => {
        const say = nonBlank(s.say);
        return {
          minutes: s.minutes ? labels.block.minutes(s.minutes) : null,
          text: clean(s.text),
          say: say ? `${labels.block.say} ${say}` : null,
        };
      })
      .filter((s) => s.text),
    extras,
  };
}

/** Per class: a heading when the plan covers several classes, then that class's parts. */
function perClass(
  plan: ComposedSubPlan,
  notes: readonly SubPlanClassNotes[],
  parts: (n: SubPlanClassNotes) => PdfPart[],
): PdfPart[] {
  const several = plan.classes.length > 1;
  const name = (id: string) => plan.classes.find((c) => c.classId === id)?.name ?? '';
  return notes.flatMap((n) => {
    const own = parts(n);
    if (own.length === 0) return [];
    return several ? [{ kind: 'heading' as const, text: name(n.classId) }, ...own] : own;
  });
}

function groupParts(
  plan: ComposedSubPlan,
  roster: readonly RosterStudent[],
  levels: readonly PlanLevel[],
  labels: PlanPdfLabels,
): PdfPart[] {
  const names = new Map(roster.map((s) => [s.id, s.firstName]));
  const levelById = new Map(levels.map((l) => [l.id, l]));
  const byClass = plan.classes
    .map((c) => ({
      cls: c,
      groups: plan.groups
        .filter((g) => g.classId === c.classId)
        .map((g) => ({
          key: g.key,
          level: g.levelId ? (levelById.get(g.levelId) ?? null) : null,
          names: g.studentIds.map((id) => names.get(id)).filter((n): n is string => !!n),
        }))
        .filter((g) => g.names.length > 0),
    }))
    .filter((c) => c.groups.length > 0);
  if (byClass.length === 0) return [];
  return [
    { kind: 'text', label: null, text: labels.groups.hint },
    ...byClass.flatMap(({ cls, groups }): PdfPart[] => [
      ...(byClass.length > 1 ? [{ kind: 'heading' as const, text: cls.name }] : []),
      ...groups.map((g): PdfPart => ({
        kind: 'group',
        title: g.level
          ? localized(labels.locale, g.level.labelFr, g.level.labelEn)
          : labels.groups.noLevel,
        meta: `${g.key} · ${labels.groups.count(g.names.length)}`,
        names: g.names.join(', '),
        description: nonBlank(g.level?.descriptionFr),
      })),
    ]),
  ];
}

/** plan-suppleance-2026-10-21.pdf: the date only, never a name. */
export function planPdfFileName(date: LocalDate): string {
  return `plan-suppleance-${date}.pdf`;
}

/**
 * The PDF of one day's plan. `plan` must be composed for the 'pdf' audience; anything else is
 * refused, so a caller cannot print the owner's or the direction's copy by mistake.
 */
export function buildPlanPdfModel(
  plan: ComposedSubPlan,
  context: PlanContext,
  roster: readonly RosterStudent[],
  levels: readonly PlanLevel[],
  labels: PlanPdfLabels,
): PlanPdfModel {
  if (plan.audience !== 'pdf') throw new Error('The plan PDF needs the pdf audience');
  const { locale } = labels;
  const several = plan.classes.length > 1;
  const rooms = [...new Set(plan.classes.map((c) => c.roomName).filter((r): r is string => !!r))];
  const longDate = capitalize(
    formatLocalDate(plan.date, locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
  );

  const sections: PlanPdfSection[] = [];
  const section = (id: PlanPdfSection['id'], parts: PdfPart[], blocks: PlanPdfBlock[] = []) => {
    if (parts.length > 0 || blocks.length > 0) {
      sections.push({ id, title: labels.sections[id], parts, blocks });
    }
  };

  const levelById = new Map(levels.map((l) => [l.id, l]));
  const groupNames = new Map(
    plan.groups.map((g) => {
      const level = g.levelId ? levelById.get(g.levelId) : undefined;
      const name = level ? localized(locale, level.labelFr, level.labelEn) : labels.groups.noLevel;
      return [g.key, `${g.key} · ${name}`];
    }),
  );
  section(
    'schedule',
    [],
    plan.blocks.map((b) => pdfBlock(b, labels, several, (key) => groupNames.get(key) ?? key)),
  );
  section(
    'events',
    plan.dayEvents.map((e): PdfPart => ({
      kind: 'text',
      label: null,
      text: e.start
        ? `${e.title} · ${e.end ? formatTimeRange(e.start, e.end, locale) : formatTime(e.start, locale)}`
        : e.title,
    })),
  );
  section('groups', groupParts(plan, roster, levels, labels));
  section(
    'classNotes',
    perClass(plan, plan.classNotes, (n) => [
      ...textPart(labels.classNotes.arrival, n.arrival),
      ...textPart(labels.classNotes.routines, n.routines),
      ...textPart(labels.classNotes.dismissal, n.dismissal),
      ...textPart(labels.classNotes.fallbackActivities, n.fallbackActivities),
    ]),
  );

  const className = (id: string) => plan.classes.find((c) => c.classId === id)?.name ?? '';
  const forClass = (label: string, classId: string) =>
    several ? `${label} · ${className(classId)}` : label;
  section('contacts', [
    ...textPart(labels.contacts.office, context.officePhone),
    ...plan.classNotes.flatMap((n) =>
      n.neighbour
        ? textPart(
            forClass(labels.contacts.neighbour, n.classId),
            n.neighbour.note ? `${n.neighbour.name} — ${n.neighbour.note}` : n.neighbour.name,
          )
        : [],
    ),
    ...plan.classNotes.flatMap((n) =>
      n.team.flatMap((m) => textPart(forClass(labels.role[m.role], n.classId), m.name)),
    ),
    ...textPart(labels.contacts.arrival, context.arrivalInstructions),
    ...textPart(labels.contacts.emergency, context.emergencyInfo),
  ]);
  section('endOfDay', [
    { kind: 'text', label: null, text: labels.endOfDayAt(formatTime(plan.endOfDay.time, locale)) },
    ...listPart(null, plan.endOfDay.checklist),
  ]);
  if (plan.faith) {
    section('faith', [
      ...(plan.faith.title ? [{ kind: 'heading' as const, text: plan.faith.title }] : []),
      ...textPart(null, plan.faith.text),
      ...textPart(null, plan.faith.linkSentence),
    ]);
  }

  return {
    // The plan itself is in French whatever the reader's language (only the labels follow it).
    info: { title: labels.documentTitle(plan.date), language: PLAN_CONTENT_LANG },
    fileName: planPdfFileName(plan.date),
    header: {
      schoolName: context.schoolName,
      title: labels.title,
      heading:
        plan.classes.length > 0
          ? plan.classes.map((c) => c.name).join(' · ')
          : labels.classOf(context.teacherName),
      lines: [
        [
          longDate,
          labels.part[plan.part],
          plan.day.kind === 'cycle' && plan.day.dayKey ? labels.dayOfCycle(plan.day.dayKey) : null,
          formatTimeRange(plan.window.start, plan.window.end, locale),
        ]
          .filter(Boolean)
          .join(' · '),
        // Without classes, the heading already says whose class it is.
        ...(plan.classes.length > 0
          ? [[labels.classOf(context.teacherName), ...rooms].join(' · ')]
          : []),
      ],
    },
    intro: [
      ...textPart(labels.absenceNote, context.absenceNote),
      ...textPart(labels.overview, plan.overview),
    ],
    alertsNotice: labels.alertsElsewhere,
    sections,
    stepsLabel: labels.block.steps,
    footer: { confidential: labels.confidential, page: labels.page },
  };
}
