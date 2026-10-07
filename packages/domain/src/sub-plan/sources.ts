/**
 * Everything a substitute plan is built from, as returned by `app.sub_plan_sources` (the one
 * loader used by the web server and the worker; DECISIONS D-047). Keys are camelCase, times
 * 'HH:MM'. Unknown keys are stripped, so a student's name can never reach the builder even if
 * the loader returned one. Empty lists may come back as null (`jsonb_agg` over no rows).
 *
 * `library` comes from a second loader, `app.sub_plan_library_sources` (D-077), merged in by the
 * web server and the worker. It is read leniently: a resource that does not parse is left out,
 * and a library part that does not parse at all is empty, so the library can never keep a plan
 * from being built.
 */
import { LIBRARY_ITEM_TYPES } from '@lynx/content';
import { z } from 'zod';
import { blockKinds, calendarEventTypes, localDateSchema, localTimeSchema } from '../forms';
import { parseSchoolSettings } from '../settings';
import { catholicReferenceTypes, liturgicalSeasons } from './catholic';

const uuid = z.uuid();

/** Null or missing becomes null. */
function orNull<T extends z.ZodType>(schema: T) {
  return schema.nullish().transform((v): z.output<T> | null => v ?? null);
}

/** Null or missing becomes an empty list. */
function list<T extends z.ZodType>(item: T) {
  return z
    .array(item)
    .nullish()
    .transform((v): z.output<T>[] => v ?? []);
}

/** Items that do not parse are left out (the rest of the list is kept). */
function lenientList<T extends z.ZodType>(item: T) {
  return z
    .array(z.unknown())
    .nullish()
    .transform((v): z.output<T>[] =>
      (v ?? []).flatMap((x) => {
        const parsed = item.safeParse(x);
        return parsed.success ? [parsed.data] : [];
      }),
    );
}

const teamRole = z.enum(['homeroom', 'subject', 'support']);

/** Why a resource is offered for a lesson: its own link, or a shared attente (D-077). */
export const libraryReasons = ['linked', 'expectation'] as const;
export type LibraryReason = (typeof libraryReasons)[number];

const libraryItemStatuses = [
  'draft',
  'teacher_reviewed',
  'board_approved',
  'rejected',
  'archived',
] as const;

/**
 * A resource a plan may use, without its answer key (the loader never reads keys; a key given
 * anyway is stripped here with every other unknown field). `content` is read by the renderers of
 * @lynx/content, which cope with anything.
 */
const subPlanLibraryItemSchema = z.object({
  id: uuid,
  type: z.enum(LIBRARY_ITEM_TYPES),
  title: z.string(),
  status: z.enum(libraryItemStatuses),
  subFriendly: z.boolean(),
  durationMinutes: orNull(z.number().int()),
  materials: orNull(z.string()),
  safetyNotes: z.unknown().transform((v) => v ?? null),
  catholicConnection: orNull(z.string()),
  catholicReferenceTitle: orNull(z.string()),
  faithOnStudentSheet: z.boolean().catch(false),
  subjectCode: orNull(z.string()),
  usageCount: z.number().int().min(0).catch(0),
  /** Whether a key with answers exists: the plan then says the key stays with the teacher. */
  hasAnswerKey: z.boolean(),
  /** The base version (levelId null) and the versions for the classes' students' levels. */
  versions: lenientList(
    z.object({
      levelId: orNull(uuid),
      schemaVersion: z.number().int(),
      content: z.unknown(),
    }),
  ),
});

const subPlanLibrarySourcesSchema = z.object({
  /** Per open lesson, its candidates best first (the lesson's own resource first). */
  lessonCandidates: lenientList(
    z.object({
      lessonId: uuid,
      candidates: lenientList(
        z.object({
          itemId: uuid,
          reason: z.enum(libraryReasons),
          /** Attentes the resource shares with the lesson. */
          overlap: z.number().int().min(0).catch(0),
        }),
      ),
    }),
  ),
  items: lenientList(subPlanLibraryItemSchema),
});
type SubPlanLibrarySources = z.output<typeof subPlanLibrarySourcesSchema>;

export const subPlanSourcesSchema = z.object({
  /** The school's local date when the sources were read. */
  today: localDateSchema,
  teacher: z.object({ id: uuid, displayName: z.string(), honorific: orNull(z.string()) }),
  school: z.object({
    id: uuid,
    boardId: uuid,
    timezone: z.string(),
    scheduleType: z.enum(['weekly', 'cycle']),
    cycleLength: orNull(z.number().int().min(2).max(20)),
    /** The raw schools.settings, parsed leniently (invalid values fall back to defaults). */
    settings: z.unknown().transform((v) => parseSchoolSettings(v)),
  }),
  /**
   * The teacher's classes at the school whose school year overlaps the dates, with her role in
   * each and their year's first and last day (a plan day covers only the classes of its year).
   */
  classes: list(
    z.object({
      id: uuid,
      name: z.string(),
      roomId: orNull(uuid),
      role: teamRole,
      yearStartsOn: orNull(localDateSchema),
      yearEndsOn: orNull(localDateSchema),
      grades: list(z.object({ code: z.string(), ordinal: z.number().int(), labelFr: z.string() })),
    }),
  ),
  /** Active members of those classes' teams (the teacher included). */
  team: list(
    z.object({
      classId: uuid,
      userId: uuid,
      displayName: z.string(),
      honorific: orNull(z.string()),
      role: teamRole,
    }),
  ),
  /** Every timetable block of those classes, all day keys. */
  blocks: list(
    z.object({
      id: uuid,
      classId: uuid,
      dayKey: z.number().int().min(1).max(20),
      startTime: localTimeSchema,
      endTime: localTimeSchema,
      kind: z.enum(blockKinds),
      subjectId: orNull(uuid),
      title: orNull(z.string()),
      teacherId: orNull(uuid),
      roomId: orNull(uuid),
      notes: orNull(z.string()),
    }),
  ),
  /** Board, school and class events of the period (from the last rotation anchor for cycles). */
  events: list(
    z.object({
      id: uuid,
      eventType: z.enum(calendarEventTypes),
      title: z.string(),
      notes: orNull(z.string()),
      startsOn: localDateSchema,
      endsOn: localDateSchema,
      startTime: orNull(localTimeSchema),
      endTime: orNull(localTimeSchema),
      affectsSchedule: z.boolean(),
      classId: orNull(uuid),
    }),
  ),
  anchors: list(z.object({ anchorDate: localDateSchema, cycleDay: z.number().int().min(1) })),
  rooms: list(z.object({ id: uuid, name: z.string() })),
  subjects: list(z.object({ id: uuid, labelFr: z.string() })),
  /** Active units of the classes, with their lessons. */
  units: list(
    z.object({
      id: uuid,
      classId: uuid,
      subjectId: uuid,
      title: z.string(),
      lessons: list(
        z.object({
          id: uuid,
          sequenceNumber: z.number().int(),
          title: z.string(),
          objectives: orNull(z.string()),
          materials: orNull(z.string()),
          content: orNull(z.string()),
          subNotes: orNull(z.string()),
          durationMinutes: orNull(z.number().int()),
        }),
      ),
    }),
  ),
  progress: list(
    z.object({
      lessonId: uuid,
      status: z.enum(['completed', 'skipped', 'pending_confirmation']),
      taughtOn: orNull(localDateSchema),
    }),
  ),
  /** Students of the classes: ids and levels only, never names. */
  students: list(z.object({ id: uuid, classId: uuid, levelId: orNull(uuid), active: z.boolean() })),
  levels: list(
    z.object({
      id: uuid,
      labelFr: z.string(),
      labelEn: orNull(z.string()),
      descriptionFr: orNull(z.string()),
      sortOrder: z.number().int(),
    }),
  ),
  /** « Fiche de suppléance » per class (class_sub_profiles); the neighbour only if active. */
  profiles: list(
    z.object({
      classId: uuid,
      arrivalNotes: orNull(z.string()),
      routinesNotes: orNull(z.string()),
      classroomManagementNotes: orNull(z.string()),
      dismissalNotes: orNull(z.string()),
      fallbackActivities: orNull(z.string()),
      neighbourNote: orNull(z.string()),
      neighbour: orNull(z.object({ displayName: z.string(), honorific: orNull(z.string()) })),
    }),
  ),
  /** Active references shared by every board or owned by the school's board. */
  catholicReferences: list(
    z.object({
      id: uuid,
      boardId: orNull(uuid),
      type: z.enum(catholicReferenceTypes),
      title: z.string(),
      textFr: z.string(),
      gradeMin: z.number().int(),
      gradeMax: z.number().int(),
      liturgicalSeason: orNull(z.enum(liturgicalSeasons)),
      tags: list(z.string()),
    }),
  ),
  /** Other days of the same absence (only when loaded for an existing absence). */
  siblings: list(
    z.object({
      planDate: localDateSchema,
      /** False once the day is a fixed snapshot (released today, or a substitute signed in). */
      refreshable: z.boolean(),
      hasSession: z.boolean(),
      reportStatus: z.enum(['none', 'draft', 'submitted', 'confirmed']),
      /** Lessons the stored plan assigned (assignment 'assigned'). */
      assignedLessonIds: list(uuid),
    }),
  ),
  /**
   * Days of the teacher's other absences in the week before this one starts, so back-to-back
   * absences continue the sequence.
   */
  earlierPlans: list(
    z.object({
      planDate: localDateSchema,
      part: z.enum(['full_day', 'am', 'pm']),
      reportStatus: z.enum(['none', 'draft', 'submitted', 'confirmed']),
      assignedLessonIds: list(uuid),
    }),
  ),
  /** Library resources for the open lessons (`app.sub_plan_library_sources`, D-077). */
  library: z
    .unknown()
    .optional()
    .transform((v): SubPlanLibrarySources => {
      const parsed = subPlanLibrarySourcesSchema.safeParse(v);
      return parsed.success ? parsed.data : { lessonCandidates: [], items: [] };
    }),
});

export type SubPlanSources = z.output<typeof subPlanSourcesSchema>;
export type SubPlanSourcesInput = z.input<typeof subPlanSourcesSchema>;
export type SubPlanSourceClass = SubPlanSources['classes'][number];
export type SubPlanSourceBlock = SubPlanSources['blocks'][number];
export type SubPlanSourceEvent = SubPlanSources['events'][number];
export type SubPlanSourceUnit = SubPlanSources['units'][number];
export type SubPlanSourceLesson = SubPlanSourceUnit['lessons'][number];
export type SubPlanSourceProfile = SubPlanSources['profiles'][number];
export type SubPlanSourceStudent = SubPlanSources['students'][number];
export type SubPlanSourceLevel = SubPlanSources['levels'][number];
export type SubPlanSourceSibling = SubPlanSources['siblings'][number];
export type SubPlanSourceEarlierPlan = SubPlanSources['earlierPlans'][number];
export type SubPlanSourceLibrary = SubPlanSources['library'];
export type SubPlanSourceLibraryItem = SubPlanSourceLibrary['items'][number];
export type SubPlanSourceLibraryCandidate =
  SubPlanSourceLibrary['lessonCandidates'][number]['candidates'][number];
