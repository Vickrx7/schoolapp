/**
 * « Activités pour les élèves » (DECISIONS D-053, 3b): the students' own copies of the activities
 * the AI layer prepared for the day (D-052), printed apart from the substitute's instructions
 * (SPEC 9.4.5). Each activity gets one page per group of its class, in the order of the day, so
 * the substitute hands each period's pages out at that period; the plan's « Groupes » section
 * says who is in which group.
 *
 * What students hold must never label them (D-042):
 * - no level name: a page carries only the group's key (« G1 »), small, for the adult. The answer
 *   was checked for level names when it came back (validateSubPlan), but a level may have been
 *   renamed since, and the group without a level was sent as « Sans niveau »: every one of those
 *   names is taken out here again, in any case, as the check finds them;
 * - no names: the builder never prints the roster; it reads it only to take out a first name that
 *   the answer holds (answers come back with real names in place of their markers). Names are
 *   found as the privacy layer finds them: in any case and with or without accents, except names
 *   that are everyday words (Claire, Pierre), which count only when capitalized.
 * A word taken out becomes « … ». Student copies are in French, the content's language, whatever
 * the reader's language (D-046): nothing on the pages comes from the message files.
 *
 * Pure and not server-only, so it can be unit tested.
 */
import { replaceLevelLabels } from '@lynx/ai/features/shared';
import { Redactor, type KnownPerson } from '@lynx/ai/privacy';
import { SUB_PLAN_AI_NO_LEVEL_LABEL, type ComposedSubPlan, type LocalDate } from '@lynx/domain';
import type { PlanLevel, RosterStudent } from '../../components/sub-plans/types';
import { nonBlank } from './model';

/** What stands where a name or a level's name was taken out. */
export const TAKEN_OUT = '…';

export interface ActivitySheet {
  /** The timetable block the activity is for (not printed). */
  blockKey: string;
  /** The group's key (« G1 »), printed small for the adult; null when the class has no groups. */
  group: string | null;
  /** The period's subject, above the title (« Sciences et technologie »). */
  subject: string | null;
  title: string;
  /** For the whole class. */
  instructions: string | null;
  /** This group's own version, under « Ta tâche ». */
  groupInstructions: string | null;
}

export interface ActivitiesPdfModel {
  /** Document properties: the date only, in French. */
  info: { title: string; language: 'fr-CA' };
  /** activites-eleves-2026-10-21.pdf: the date only, never a name. */
  fileName: string;
  /** « Ta tâche », above a group's own version. */
  taskLabel: string;
  sheets: ActivitySheet[];
}

/** Whether the plan has an activity to print for students (the link is shown only then). */
export function hasActivitySheets(plan: ComposedSubPlan): boolean {
  return plan.blocks.some((b) => !!b.ai?.activity);
}

export function activitiesPdfFileName(date: LocalDate): string {
  return `activites-eleves-${date}.pdf`;
}

/**
 * The students' sheets of one day's plan, composed for the 'pdf' audience (anything else is
 * refused, as for the plan PDF). Empty when no period has an activity.
 */
export function buildActivitiesPdfModel(
  plan: ComposedSubPlan,
  roster: readonly RosterStudent[],
  levels: readonly PlanLevel[],
): ActivitiesPdfModel {
  if (plan.audience !== 'pdf') throw new Error('The activity sheets need the pdf audience');

  const people: KnownPerson[] = roster.map((s) => ({ name: s.firstName, kind: 'student' }));
  const levelNames = [
    SUB_PLAN_AI_NO_LEVEL_LABEL,
    ...levels.flatMap((l) => [l.labelFr, l.labelEn ?? '']),
  ];
  /** Text a student reads: no name and no level's name; null when no word of it is left. */
  const forStudents = (text: string | null | undefined): string | null => {
    const typed = nonBlank(text);
    if (!typed) return null;
    // One redactor per text: nothing carries over from one text to the next.
    const unnamed = new Redactor(people)
      .redact(typed)
      .segments.map((s) => (s.placeholder ? TAKEN_OUT : s.text))
      .join('');
    const safe = replaceLevelLabels(unnamed, levelNames, TAKEN_OUT);
    return /[\p{L}\p{N}]/u.test(safe) ? nonBlank(safe) : null;
  };

  // Groups with a student still in the class, as the plan's « Groupes » section prints them.
  const onRoster = new Set(roster.map((s) => s.id));
  const printedGroups = plan.groups.filter((g) => g.studentIds.some((id) => onRoster.has(id)));

  const sheets = plan.blocks.flatMap((block): ActivitySheet[] => {
    const activity = block.ai?.activity;
    if (!activity) return [];
    const subject = forStudents(block.subjectLabel ?? block.title);
    const common = {
      blockKey: block.key,
      subject,
      title: forStudents(activity.title) ?? subject ?? '',
      instructions: forStudents(activity.studentInstructions),
    };
    const groups = printedGroups.filter((g) => g.classId === block.classId);
    // No group to print (no student of the class on the roster): one page for the class, so an
    // activity is never lost.
    if (groups.length === 0) return [{ ...common, group: null, groupInstructions: null }];
    const versions = new Map(activity.perGroup.map((p) => [p.group.trim(), p.studentInstructions]));
    return groups.map((g) => ({
      ...common,
      group: g.key,
      groupInstructions: forStudents(versions.get(g.key)),
    }));
  });

  return {
    info: { title: `Activités pour les élèves — ${plan.date}`, language: 'fr-CA' },
    fileName: activitiesPdfFileName(plan.date),
    taskLabel: 'Ta tâche',
    sheets,
  };
}
