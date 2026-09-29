/**
 * Everything a substitute plan is built from, as returned by `app.sub_plan_sources` (the one
 * loader used by the web server and the worker; DECISIONS D-047). Keys are camelCase, times
 * 'HH:MM'. Unknown keys are stripped, so a student's name can never reach the builder even if
 * the loader returned one. Empty lists may come back as null (`jsonb_agg` over no rows).
 */
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

const teamRole = z.enum(['homeroom', 'subject', 'support']);

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
  /** The teacher's classes at the school, with her role in each. */
  classes: list(
    z.object({
      id: uuid,
      name: z.string(),
      roomId: orNull(uuid),
      role: teamRole,
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
