/**
 * Library resources in substitute plans (SPEC 9.4.3, DECISIONS D-077, D-062).
 *
 * The plan builder offers each assigned lesson a resource from `sources.library`: the lesson's
 * own reviewed resource first, otherwise the board-approved one that suits the period best. The
 * block then stores a snapshot, so the plan reads the same whatever happens to the resource
 * afterwards (a change to a resource marks the plans that name it out of date instead):
 *
 * - the teacher document (« Guide ») of the base version, which never holds an answer key;
 * - one student document per set of groups: each group gets the version of its level, else the
 *   base version, and groups sharing a version share one document. Student documents never name
 *   a level (the renderer never does), and carry no version number: printed pages carry the
 *   group's key instead.
 *
 * The item id is only a link for the owner (« Voir le corrigé »): the database never trusts it
 * (D-048). Answer keys never reach a plan: the sources hold none, and the renderers used here take
 * none.
 */
import {
  LIBRARY_ITEM_TYPES,
  TYPE_INFO,
  renderStudentDoc,
  renderTeacherDoc,
  renderedDocSchema,
  subFriendlyAllowed,
} from '@lynx/content';
import { z } from 'zod';
import type { SubPlanBlock, SubPlanStep } from './schema';
import { isThinLesson } from './scripts';
import {
  libraryReasons,
  type LibraryReason,
  type SubPlanSourceLibraryCandidate,
  type SubPlanSourceLibraryItem,
} from './sources';
import { clip } from './text';

/** A resource may run this many minutes over the period and still fit it. */
export const LIBRARY_FIT_MARGIN_MINUTES = 10;
/**
 * A plan's JSON over this size loses snapshots from its last blocks first, with the plan warning
 * `library_trimmed` (the database refuses plans over 256 KB; lessons are shortened past 240 KB).
 */
export const MAX_LIBRARY_PLAN_BYTES = 200_000;
/** The base version and up to five levels. */
export const MAX_LIBRARY_STUDENT_DOCS = 6;

const MAX_STEPS = 12;

export const subPlanLibraryStudentDocSchema = z.object({
  /** The plan's groups (« G1 »…) that get this version; empty when the class has no groups. */
  groupKeys: z.array(z.string().regex(/^G\d{1,2}$/)).max(40),
  doc: renderedDocSchema,
});

export const subPlanLibrarySchema = z.object({
  itemId: z.uuid(),
  type: z.enum(LIBRARY_ITEM_TYPES),
  title: z.string().max(200),
  boardApproved: z.boolean(),
  reason: z.enum(libraryReasons),
  durationMinutes: z.number().int().min(1).max(600).nullable(),
  /** A key exists: it stays with the teacher (never in the plan). */
  hasAnswerKey: z.boolean(),
  teacherDoc: renderedDocSchema,
  /** Empty for resources without a student sheet (a lesson plan). */
  studentDocs: z.array(subPlanLibraryStudentDocSchema).max(MAX_LIBRARY_STUDENT_DOCS),
});
export type SubPlanLibrary = z.infer<typeof subPlanLibrarySchema>;
export type SubPlanLibraryStudentDoc = z.infer<typeof subPlanLibraryStudentDocSchema>;

export interface LibraryChoice {
  item: SubPlanSourceLibraryItem;
  reason: LibraryReason;
}

export interface LibraryChoiceInput {
  /** Minutes the substitute teaches in the period (plannedMinutes). */
  blockMinutes: number;
  /** The lesson's candidates, as the loader ordered them. */
  candidates: readonly SubPlanSourceLibraryCandidate[];
  items: ReadonlyMap<string, SubPlanSourceLibraryItem> | readonly SubPlanSourceLibraryItem[];
  /** Resources already in another period of the absence: each is used once. */
  used: ReadonlySet<string>;
}

function itemMap(
  items: LibraryChoiceInput['items'],
): ReadonlyMap<string, SubPlanSourceLibraryItem> {
  return items instanceof Map
    ? items
    : new Map((items as readonly SubPlanSourceLibraryItem[]).map((i) => [i.id, i]));
}

/** Whether a resource has a sheet for students (lesson plans and teacher guides do not). */
export function hasStudentSheet(type: SubPlanSourceLibraryItem['type']): boolean {
  return TYPE_INFO[type].audience !== 'teacher';
}

/**
 * The same rules as the loader, checked again: whatever the sources say, a plan only gets a
 * sub-friendly resource of a type a substitute may run, reviewed or approved (approved when it
 * is offered for an attente).
 */
function eligible(item: SubPlanSourceLibraryItem, reason: LibraryReason): boolean {
  if (!item.subFriendly || !subFriendlyAllowed(item.type, item.safetyNotes)) return false;
  if (reason === 'expectation') return item.status === 'board_approved';
  return item.status === 'board_approved' || item.status === 'teacher_reviewed';
}

/**
 * A lesson's candidates, best first: its own resource, then the others by D-077's order: a
 * student sheet, more attentes in common, fitting the period (at most 10 minutes over), the
 * closest duration, the most used, then the id. Resources already used are left out.
 */
export function rankLibraryCandidates(input: LibraryChoiceInput): LibraryChoice[] {
  const items = itemMap(input.items);
  const seen = new Set<string>();
  const options = input.candidates.flatMap((c) => {
    const item = items.get(c.itemId);
    if (!item || seen.has(item.id) || input.used.has(item.id) || !eligible(item, c.reason)) {
      return [];
    }
    seen.add(item.id);
    return [{ item, reason: c.reason, overlap: c.overlap }];
  });

  const minutes = Math.max(0, input.blockMinutes);
  const fits = (d: number | null) => d !== null && d <= minutes + LIBRARY_FIT_MARGIN_MINUTES;
  const distance = (d: number | null) =>
    d === null ? Number.POSITIVE_INFINITY : Math.abs(d - minutes);
  options.sort(
    (a, b) =>
      Number(b.reason === 'linked') - Number(a.reason === 'linked') ||
      Number(hasStudentSheet(b.item.type)) - Number(hasStudentSheet(a.item.type)) ||
      b.overlap - a.overlap ||
      Number(fits(b.item.durationMinutes)) - Number(fits(a.item.durationMinutes)) ||
      distance(a.item.durationMinutes) - distance(b.item.durationMinutes) ||
      b.item.usageCount - a.item.usageCount ||
      (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0),
  );
  return options.map(({ item, reason }) => ({ item, reason }));
}

/** The resource a lesson's period gets, or null when none of its candidates can be used. */
export function chooseLibraryItem(input: LibraryChoiceInput): LibraryChoice | null {
  return rankLibraryCandidates(input)[0] ?? null;
}

type Group = { key: string; levelId: string | null };

/**
 * The block's snapshot of a resource for the groups of its class (in the plan's order). Null
 * when the resource has no base version or its documents do not fit the plan's schema: the
 * builder then tries the next candidate.
 */
export function librarySnapshot(
  item: SubPlanSourceLibraryItem,
  groups: readonly Group[],
  options: { reason: LibraryReason },
): SubPlanLibrary | null {
  const base = item.versions.find((v) => v.levelId === null);
  if (!base) return null;
  const title = item.title.trim();
  const connection = item.catholicConnection?.trim() || null;

  const teacherDoc = renderTeacherDoc(
    {
      itemTitle: title,
      number: null,
      subjectCode: item.subjectCode,
      durationMinutes: item.durationMinutes,
      materials: item.materials,
      safetyNotes: item.safetyNotes,
      faith: connection ? { connection, referenceTitle: item.catholicReferenceTitle } : null,
    },
    item.type,
    base.content,
  );

  const studentDocs: SubPlanLibraryStudentDoc[] = [];
  if (hasStudentSheet(item.type)) {
    // The version each group gets, in the order the groups come (the plan's level order).
    const byVersion = new Map<string | null, string[]>();
    for (const group of groups) {
      const level =
        group.levelId && item.versions.some((v) => v.levelId === group.levelId)
          ? group.levelId
          : null;
      byVersion.set(level, [...(byVersion.get(level) ?? []), group.key]);
    }
    if (byVersion.size === 0) byVersion.set(null, []);
    let entries = [...byVersion.entries()];
    if (entries.length > MAX_LIBRARY_STUDENT_DOCS) {
      // More versions than a plan keeps: the groups of the last levels get the base version.
      const kept = entries
        .filter(([level]) => level !== null)
        .slice(0, MAX_LIBRARY_STUDENT_DOCS - 1);
      const keptKeys = new Set(kept.flatMap(([, keys]) => keys));
      entries = [...kept, [null, groups.map((g) => g.key).filter((k) => !keptKeys.has(k))]];
    }
    for (const [level, groupKeys] of entries) {
      const version = item.versions.find((v) => v.levelId === level) ?? base;
      const doc = renderStudentDoc(item.type, version.content, {
        itemTitle: title,
        // Printed pages carry the group's key, never a version number or a level (D-042).
        number: null,
        faith: connection ? { connection, onStudentSheet: item.faithOnStudentSheet } : null,
      });
      if (doc) studentDocs.push({ groupKeys, doc });
    }
  }

  const parsed = subPlanLibrarySchema.safeParse({
    itemId: item.id,
    type: item.type,
    title: clip(title, 200),
    boardApproved: item.status === 'board_approved',
    reason: options.reason,
    durationMinutes: item.durationMinutes,
    hasAnswerKey: item.hasAnswerKey,
    teacherDoc,
    studentDocs,
  });
  return parsed.success ? parsed.data : null;
}

/**
 * The step that sends the substitute to the resource: « Distribuez « … » : voir « Matériel pour
 * les élèves ». », or, for a resource without a student sheet, to its guide.
 */
export function libraryStepText(library: Pick<SubPlanLibrary, 'title' | 'studentDocs'>): string {
  return clip(
    library.studentDocs.length > 0
      ? `Distribuez « ${library.title} » : voir « Matériel pour les élèves ».`
      : `Suivez la ressource « ${library.title} » : voir « Guide de la ressource ».`,
    1000,
  );
}

/**
 * Where the resource's step goes: before the lesson's main step (the longest one, the first of
 * them on a tie), so the sheets are handed out once the lesson is introduced.
 */
function insertBeforeMain(steps: readonly SubPlanStep[], added: SubPlanStep): SubPlanStep[] {
  let main = -1;
  steps.forEach((s, i) => {
    if (s.minutes !== null && (main < 0 || s.minutes > (steps[main]!.minutes ?? 0))) main = i;
  });
  const at = main < 0 ? steps.length : main;
  return [...steps.slice(0, at), added, ...steps.slice(at)].slice(0, MAX_STEPS);
}

/**
 * A lesson block with its resource: the snapshot, the step pointing to it, and no `thin_lesson`
 * warning (the resource is the activity).
 */
export function attachLibrary(block: SubPlanBlock, library: SubPlanLibrary): SubPlanBlock {
  return {
    ...block,
    library,
    steps: insertBeforeMain(block.steps, { minutes: null, text: libraryStepText(library) }),
    warnings: block.warnings.filter((w) => w !== 'thin_lesson'),
  };
}

/** The block as it would be without its resource (the plan size budget, `hideLibrary`). */
export function detachLibrary<
  B extends Pick<SubPlanBlock, 'lesson' | 'warnings'> & {
    library: SubPlanLibrary | null;
    steps: readonly { text: string }[];
  },
>(block: B): B {
  if (!block.library) return block;
  const text = libraryStepText(block.library);
  const thin = !!block.lesson && isThinLesson(block.lesson);
  return {
    ...block,
    library: null,
    steps: block.steps.filter((s) => s.text !== text),
    warnings:
      thin && !block.warnings.includes('thin_lesson')
        ? [...block.warnings, 'thin_lesson']
        : block.warnings,
  };
}
