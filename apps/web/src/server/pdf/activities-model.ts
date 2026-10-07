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
 *   that are everyday words (Claire, Pierre), which count only when capitalized, and very short
 *   names (« Tú », « Lê »), which count only as spelled (D-145).
 * A word taken out becomes « … ». Student copies are in French, the content's language, whatever
 * the reader's language (D-046): nothing on the pages comes from the message files.
 *
 * A period's library resource (D-077) adds its students' pages: its student document in the
 * version of each group (the plan's snapshot), one copy per group of the class with the group's
 * key in the corner, like the activities. Those documents are library content, which never names
 * a level on a student sheet and is written without students' names (the library's own printing
 * prints them as they are, D-075), so they are printed as the library prints them.
 *
 * Pure and not server-only, so it can be unit tested.
 */
import type { RenderedDoc } from '@lynx/content';
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

/** A group's copy of a library resource's student document (D-077). */
export interface LibrarySheet {
  /** The timetable block the resource is for (not printed). */
  blockKey: string;
  /** The group's key (« G1 »), printed small for the adult; null when the class has no groups. */
  group: string | null;
  doc: RenderedDoc;
}

export interface ActivitiesPdfModel {
  /** Document properties: the date only, in French. */
  info: { title: string; language: 'fr-CA' };
  /** activites-eleves-2026-10-21.pdf: the date only, never a name. */
  fileName: string;
  /** « Ta tâche », above a group's own version. */
  taskLabel: string;
  /** The AI layer's activities (3b). */
  sheets: ActivitySheet[];
  /** The library resources' pages (D-077). */
  librarySheets: LibrarySheet[];
  /** The blocks of the day in order: pages are printed period by period. */
  blockOrder: string[];
}

/** Whether the plan has pages to print for students (the link is shown only then). */
export function hasActivitySheets(plan: ComposedSubPlan): boolean {
  return plan.blocks.some((b) => !!b.ai?.activity || (b.library?.studentDocs.length ?? 0) > 0);
}

/** Whether a model has any page to print. */
export function hasPages(model: ActivitiesPdfModel): boolean {
  return model.sheets.length + model.librarySheets.length > 0;
}

export function activitiesPdfFileName(date: LocalDate): string {
  return `activites-eleves-${date}.pdf`;
}

/**
 * The students' sheets of one day's plan, composed for the 'pdf' audience (anything else is
 * refused, as for the plan PDF). Empty when no period has an activity or a library resource.
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

  // A resource's version per group: one copy for each group of the class that gets it.
  const librarySheets = plan.blocks.flatMap((block): LibrarySheet[] => {
    const library = block.library;
    if (!library) return [];
    const groups = new Set(
      printedGroups.filter((g) => g.classId === block.classId).map((g) => g.key),
    );
    return library.studentDocs.flatMap(({ groupKeys, doc }): LibrarySheet[] => {
      // Built for a class without groups: one copy for the class, so the resource is never lost.
      if (groupKeys.length === 0) return [{ blockKey: block.key, group: null, doc }];
      // A version whose groups have no student on the roster any more is not printed.
      return groupKeys
        .filter((k) => groups.has(k))
        .map((group) => ({ blockKey: block.key, group, doc }));
    });
  });

  return {
    info: { title: `Activités pour les élèves — ${plan.date}`, language: 'fr-CA' },
    fileName: activitiesPdfFileName(plan.date),
    taskLabel: 'Ta tâche',
    sheets,
    librarySheets,
    blockOrder: plan.blocks.map((b) => b.key),
  };
}
