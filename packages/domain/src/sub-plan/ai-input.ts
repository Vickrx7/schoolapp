/**
 * What « Ajouter des consignes détaillées (IA) » asks for, built from the composed plan
 * (DECISIONS D-052). The shape is `subPlanAiInputSchema` in @lynx/ai (written out here as a
 * structural type, so the domain package does not depend on the AI package).
 *
 * Only what a stranger needs to script the teaching periods goes in: grades, the weekday, groups
 * as level names, descriptions and sizes, each period's time, subject, room and lesson, the
 * class's « Activités de rechange » when there is no lesson, and the faith moment already chosen.
 * Never: student ids or names (groups go as sizes), class, school or staff names, alerts,
 * « Gestion de classe », arrival and dismissal notes, the absence note, the other adult of a
 * handover, report content. `ref` (timetable block and lesson ids) and the faith reference id
 * stay in Canada: the AI feature never puts them in the message, and the database uses them to
 * apply the answer to the right blocks only.
 *
 * A period with a library resource (D-077) already has its activity: the request only names the
 * resource in the lesson's notes, and asks for no activity.
 */
import { TYPE_INFO } from '@lynx/content';
import { isoWeekday, timeToMinutes } from '../dates';
import type { ComposedBlock, ComposedSubPlan } from './compose';
import { clip, clipOrNull } from './text';

/** Periods detailed in one request (SUB_PLAN_MAX_BLOCKS in @lynx/ai). */
export const SUB_PLAN_AI_MAX_BLOCKS = 10;
/** Shorter periods are left out (SUB_PLAN_MIN_BLOCK_MINUTES in @lynx/ai). */
export const SUB_PLAN_AI_MIN_MINUTES = 10;
/**
 * The level name the request gives the group of students without a level: a name students must
 * not see either (the activity sheets take it out like the others).
 */
export const SUB_PLAN_AI_NO_LEVEL_LABEL = 'Sans niveau';
const MAX_GROUPS = 20;
const MAX_GROUPS_PER_BLOCK = 8;

const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const;

export interface SubPlanAiInputShape {
  gradeLabels: string[];
  weekday: (typeof WEEKDAYS)[number];
  groups: { key: string; levelLabel: string; levelDescription: string | null; size: number }[];
  faith: { ref: string; title: string; text: string } | null;
  blocks: {
    key: string;
    ref: { blockKey: string; lessonId: string | null };
    start: string;
    end: string;
    minutes: number;
    status: 'normal' | 'shortened' | 'interrupted';
    eventTitle: string | null;
    subjectLabel: string;
    unitTitle: string | null;
    room: string | null;
    groups: string[];
    lesson: {
      title: string;
      objectives: string | null;
      materials: string | null;
      content: string | null;
      subNotes: string | null;
    } | null;
    fallback: string | null;
    needsActivity: boolean;
  }[];
}

/** A group's level, from the levels shown with the plan (only the French label is sent). */
export interface SubPlanAiLevel {
  id: string;
  labelFr: string;
  descriptionFr: string | null;
}

/**
 * Minutes the substitute teaches in a block: an interrupting event's minutes are taken out (as
 * the plan builder does for the template steps).
 */
export function plannedMinutes(block: Pick<ComposedBlock, 'start' | 'end' | 'status' | 'event'>) {
  const start = timeToMinutes(block.start);
  const end = timeToMinutes(block.end);
  let minutes = end - start;
  if (block.status === 'interrupted' && block.event) {
    const from = Math.max(start, block.event.start ? timeToMinutes(block.event.start) : 0);
    const to = Math.min(end, block.event.end ? timeToMinutes(block.event.end) : 24 * 60);
    minutes -= Math.max(0, to - from);
  }
  return minutes;
}

/**
 * Teaching periods the AI can script: subject blocks that are not replaced by an event, whose
 * lesson is not already checked off for that day, and long enough to plan.
 */
export function subPlanAiBlocks(composed: ComposedSubPlan): ComposedBlock[] {
  return composed.blocks
    .filter(
      (b) =>
        b.kind === 'subject' &&
        b.status !== 'replaced' &&
        b.lesson?.assignment !== 'taught' &&
        plannedMinutes(b) >= SUB_PLAN_AI_MIN_MINUTES,
    )
    .slice(0, SUB_PLAN_AI_MAX_BLOCKS);
}

/** « Activité prévue : « Le huard, oiseau des lacs » (Texte de lecture). » */
export function libraryActivityNote(library: { title: string; type: keyof typeof TYPE_INFO }) {
  return `Activité prévue : « ${library.title} » (${TYPE_INFO[library.type].labelFr}).`;
}

/** The lesson's note for the substitute, then the resource it uses, within the request's limit. */
function subNotesWith(subNotes: string | null, library: ComposedBlock['library']): string | null {
  if (!library) return clipOrNull(subNotes, 1000);
  const note = clip(libraryActivityNote(library), 1000);
  const own = clipOrNull(subNotes, Math.max(1, 1000 - note.length - 1));
  return own ? `${own}\n${note}` : note;
}

/**
 * The request for the plan as the teacher sees it now (composed for the 'owner' audience, with
 * her edits). Its `blocks` is empty when the day has no teaching period to script.
 */
export function buildSubPlanAiInput(
  composed: ComposedSubPlan,
  levels: readonly SubPlanAiLevel[],
): SubPlanAiInputShape {
  const blocks = subPlanAiBlocks(composed);
  const levelById = new Map(levels.map((l) => [l.id, l]));
  const classIds = new Set(blocks.map((b) => b.classId));

  // The groups of the classes these periods teach, in the plan's order.
  const groups = composed.groups
    .filter((g) => classIds.has(g.classId))
    .slice(0, MAX_GROUPS)
    .map((g) => {
      const level = g.levelId ? levelById.get(g.levelId) : undefined;
      return {
        key: g.key,
        classId: g.classId,
        levelLabel: clip(level?.labelFr ?? SUB_PLAN_AI_NO_LEVEL_LABEL, 60),
        levelDescription: clipOrNull(level?.descriptionFr, 500),
        size: Math.min(60, g.studentIds.length),
      };
    });

  const gradeLabels = [
    ...new Set(
      composed.classes.filter((c) => classIds.has(c.classId)).flatMap((c) => c.gradeLabels),
    ),
  ].slice(0, 4);

  const fallbackOf = new Map(composed.classNotes.map((n) => [n.classId, n.fallbackActivities]));
  const faith =
    composed.faith && !composed.faith.edited && composed.faith.referenceId
      ? {
          ref: composed.faith.referenceId,
          title: clip(composed.faith.title ?? '', 160),
          text: clip(composed.faith.text, 1000),
        }
      : null;

  return {
    gradeLabels,
    weekday: WEEKDAYS[isoWeekday(composed.date) - 1]!,
    groups: groups.map(({ classId: _classId, ...g }) => g),
    faith,
    blocks: blocks.map((b, i) => {
      const lesson = b.lesson;
      return {
        key: `B${i + 1}`,
        ref: { blockKey: b.key, lessonId: lesson?.lessonId ?? null },
        start: b.start,
        end: b.end,
        minutes: Math.min(240, plannedMinutes(b)),
        status: b.status === 'replaced' ? 'normal' : b.status,
        eventTitle: b.status !== 'normal' && b.event ? clip(b.event.title, 120) : null,
        subjectLabel: clip(b.subjectLabel ?? b.title, 80),
        unitTitle: lesson ? clip(lesson.unitTitle, 120) : null,
        room: clipOrNull(b.roomName, 60),
        groups: groups
          .filter((g) => g.classId === b.classId)
          .slice(0, MAX_GROUPS_PER_BLOCK)
          .map((g) => g.key),
        lesson: lesson
          ? {
              title: clip(lesson.title, 160),
              objectives: clipOrNull(lesson.objectives, 1000),
              materials: clipOrNull(lesson.materials, 1000),
              content: clipOrNull(lesson.content, 3000),
              subNotes: subNotesWith(lesson.subNotes, b.library),
            }
          : null,
        fallback: lesson ? null : clipOrNull(fallbackOf.get(b.classId), 1000),
        needsActivity: !b.library && (!lesson || b.warnings.includes('thin_lesson')),
      };
    }),
  };
}
