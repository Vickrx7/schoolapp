/**
 * Stored shapes of the substitute hand-off (DECISIONS D-048, D-054).
 *
 * A plan has three layers keyed by timetable block: the generated layer (`sub_plans.plan`,
 * `subPlanV1Schema`), the teacher's overlay (`sub_plans.edits`, `subPlanEditsSchema`) and, in
 * 3b, the AI layer (`sub_plans.ai`). School name, office phone, teacher name and first names are
 * not in the plan: they are read from tables when the plan is displayed, so the plan JSON never
 * grants access to anything (the database derives covered classes, roster and lessons itself).
 */
import { z } from 'zod';
import { blockKinds, calendarEventTypes, localDateSchema } from '../forms';
import { catholicReferenceTypes } from './catholic';

export const SUB_PLAN_SCHEMA_VERSION = 1;
export const SUB_PLAN_GENERATOR_VERSION = 'domain-1';

const uuid = z.uuid();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const text = (max: number) => z.string().max(max);
const nullableText = (max: number) => z.string().max(max).nullable();

export const absenceParts = ['full_day', 'am', 'pm'] as const;
export type AbsencePart = (typeof absenceParts)[number];

/** A plan block's kind: a timetable kind, or a homeroom block another adult teaches. */
export const subPlanBlockKinds = [...blockKinds, 'handover'] as const;
export type SubPlanBlockKind = (typeof subPlanBlockKinds)[number];

/** Cancelled blocks are left out of plans, so they have no status here. */
export const subPlanBlockStatuses = ['normal', 'shortened', 'interrupted', 'replaced'] as const;

export const blockWarningCodes = [
  /** A subject block whose class and subject have no active unit. */
  'no_active_unit',
  /** Every lesson of the active unit is done. */
  'unit_finished',
  /** The lesson was skipped over: a later lesson of the unit is already done. */
  'lesson_gap',
  /** No objectives, no materials and fewer than 80 characters of content. */
  'thin_lesson',
] as const;
export type BlockWarningCode = (typeof blockWarningCodes)[number];

export const planWarningCodes = [
  'unknown_cycle_day',
  'half_day_split_guessed',
  'students_without_level',
  'no_classes',
  'generation_failed',
] as const;
export type PlanWarningCode = (typeof planWarningCodes)[number];

export const subPlanStepSchema = z.object({
  minutes: z.number().int().min(1).max(240).nullable(),
  text: z.string().min(1).max(1000),
});
export type SubPlanStep = z.infer<typeof subPlanStepSchema>;

export const subPlanLessonSchema = z.object({
  lessonId: uuid,
  unitTitle: text(120),
  sequenceNumber: z.number().int(),
  title: text(160),
  objectives: nullableText(4000),
  materials: nullableText(4000),
  content: nullableText(20000),
  subNotes: nullableText(4000),
  /** 'taught': already checked off for this date; 'assigned': the next lesson to teach. */
  assignment: z.enum(['assigned', 'taught']),
  /** For a skipped-over lesson: the title of the first later lesson already done. */
  gapBefore: nullableText(160),
});

export const subPlanBlockSchema = z.object({
  /** timetable_blocks.id: edits and the AI layer are keyed by it. */
  key: uuid,
  classId: uuid,
  className: text(80),
  kind: z.enum(subPlanBlockKinds),
  start: hhmm,
  end: hhmm,
  status: z.enum(subPlanBlockStatuses),
  title: text(160),
  subjectLabel: nullableText(80),
  roomName: nullableText(60),
  /** The adult who takes the group in a handover, e.g. « M. Leblanc ». */
  otherAdult: nullableText(120),
  /** The calendar event that replaces or interrupts the block. */
  event: z
    .object({
      title: text(120),
      notes: nullableText(1000),
      start: hhmm.nullable(),
      end: hhmm.nullable(),
    })
    .nullable(),
  /** timetable_blocks.notes */
  notes: nullableText(500),
  lesson: subPlanLessonSchema.nullable(),
  steps: z.array(subPlanStepSchema).max(12),
  warnings: z.array(z.enum(blockWarningCodes)).max(5),
});
export type SubPlanBlock = z.infer<typeof subPlanBlockSchema>;
export type SubPlanLesson = z.infer<typeof subPlanLessonSchema>;

export const subPlanClassNotesSchema = z.object({
  classId: uuid,
  arrival: nullableText(2000),
  routines: nullableText(2000),
  /** Shown on screen to the substitute and direction only: never to office, never printed. */
  classManagement: nullableText(2000),
  dismissal: nullableText(2000),
  fallbackActivities: nullableText(2000),
  neighbour: z.object({ name: text(120), note: nullableText(200) }).nullable(),
  /** The rest of the class's teaching team (a co-homeroom teacher, rotary teachers...). */
  team: z
    .array(z.object({ name: text(120), role: z.enum(['homeroom', 'subject', 'support']) }))
    .max(8),
});
export type SubPlanClassNotes = z.infer<typeof subPlanClassNotesSchema>;

export const subPlanV1Schema = z
  .object({
    schemaVersion: z.literal(SUB_PLAN_SCHEMA_VERSION),
    date: localDateSchema,
    part: z.enum(absenceParts),
    /** The span the substitute covers (school-local times). */
    window: z.object({ start: hhmm, end: hhmm }),
    /** Where morning ends for half days (null when it cannot be determined). */
    split: hhmm.nullable(),
    day: z.object({
      kind: z.enum(['weekly', 'cycle']),
      /** Weekday (1 = Monday) or « Jour N »; null when the cycle day is unknown. */
      dayKey: z.number().int().min(1).max(20).nullable(),
    }),
    classes: z
      .array(
        z.object({
          classId: uuid,
          name: text(80),
          gradeLabels: z.array(text(40)).max(4),
          roomName: nullableText(60),
        }),
      )
      .max(12),
    /** Groups by language level; first names are joined from the roster when displayed. */
    groups: z
      .array(
        z.object({
          key: z.string().regex(/^G\d{1,2}$/),
          classId: uuid,
          levelId: uuid.nullable(),
          studentIds: z.array(uuid).max(60),
        }),
      )
      .max(40),
    /** « Événements du jour » that don't show on a block. */
    dayEvents: z
      .array(
        z.object({
          title: text(120),
          type: z.enum(calendarEventTypes),
          start: hhmm.nullable(),
          end: hhmm.nullable(),
        }),
      )
      .max(10),
    blocks: z.array(subPlanBlockSchema).max(40),
    classNotes: z.array(subPlanClassNotesSchema).max(12),
    endOfDay: z.object({ time: hhmm, checklist: z.array(text(300)).max(12) }),
    faith: z
      .object({
        referenceId: uuid,
        type: z.enum(catholicReferenceTypes),
        title: text(160),
        text: text(4000),
      })
      .nullable(),
    warnings: z
      .array(z.object({ code: z.enum(planWarningCodes), blockKey: uuid.nullable() }))
      .max(40),
    generator: z.object({
      version: z.literal(SUB_PLAN_GENERATOR_VERSION),
      generatedAt: z.iso.datetime(),
    }),
  })
  .refine((p) => new Set(p.blocks.map((b) => b.key)).size === p.blocks.length, {
    message: 'duplicateBlock',
    path: ['blocks'],
  })
  .refine((p) => new Set(p.groups.map((g) => g.key)).size === p.groups.length, {
    message: 'duplicateGroup',
    path: ['groups'],
  });
export type SubPlanV1 = z.infer<typeof subPlanV1Schema>;

// ---------------------------------------------------------------------------------------
// Teacher overlay (sub_plans.edits). Messages are translation keys.
// ---------------------------------------------------------------------------------------

export const subPlanStepEditSchema = z.strictObject({
  minutes: z.number().int().min(1).max(240).nullable(),
  text: z.string().trim().min(1, 'required').max(1000, 'tooLong'),
});
export type SubPlanStepEdit = z.infer<typeof subPlanStepEditSchema>;

export const subPlanBlockEditSchema = z.strictObject({
  /** The lesson the edit was written for: it applies only while the block keeps that lesson. */
  forLessonId: uuid.nullable(),
  steps: z.array(subPlanStepEditSchema).max(12, 'tooMany').optional(),
  teacherNote: z.string().trim().max(1000, 'tooLong').optional(),
});
export type SubPlanBlockEdit = z.infer<typeof subPlanBlockEditSchema>;

export const subPlanEditsSchema = z.strictObject({
  overview: z.string().trim().max(2000, 'tooLong').optional(),
  endOfDayChecklist: z
    .array(z.string().trim().min(1, 'required').max(300, 'tooLong'))
    .max(12, 'tooMany')
    .optional(),
  /** Null removes the faith moment; text replaces it. */
  faith: z
    .strictObject({ text: z.string().trim().min(1, 'required').max(1000, 'tooLong') })
    .nullable()
    .optional(),
  /** Keyed by timetable block id. */
  blocks: z
    .record(uuid, subPlanBlockEditSchema)
    .refine((r) => Object.keys(r).length <= 80, 'tooMany')
    .optional(),
});
export type SubPlanEdits = z.infer<typeof subPlanEditsSchema>;

// ---------------------------------------------------------------------------------------
// AI layer (3b, sub_plans.ai), read leniently: anything unexpected makes the layer ignored.
// Written by the database from the ai_jobs row: {jobId, appliedAt, refs: input.blocks, result}.
// ---------------------------------------------------------------------------------------

export const subPlanAiLayerSchema = z.object({
  jobId: z.string().optional(),
  appliedAt: z.string().optional(),
  /** The request's blocks: which timetable block and lesson each key 'B1'... was written for. */
  refs: z.array(
    z.object({
      key: z.string(),
      ref: z.object({ blockKey: uuid, lessonId: uuid.nullable() }),
    }),
  ),
  result: z.object({
    dayOverview: z.string(),
    blocks: z.array(
      z.object({
        key: z.string(),
        overview: z.string(),
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
    faithSentence: z.string(),
  }),
});
export type SubPlanAiLayer = z.infer<typeof subPlanAiLayerSchema>;

// ---------------------------------------------------------------------------------------
// End-of-day report (D-054). Outcomes and absent-student ids stay in plain `content`; free
// text is encrypted by the web server (subReportNotesSchema is the plaintext before that).
// ---------------------------------------------------------------------------------------

export const subReportOutcomes = ['done', 'partial', 'not_done'] as const;
export type SubReportOutcome = (typeof subReportOutcomes)[number];

export const subReportContentSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    lessons: z
      .array(
        z.strictObject({
          blockKey: uuid,
          lessonId: uuid,
          outcome: z.enum(subReportOutcomes),
        }),
      )
      .max(40, 'tooMany'),
    /** Removed by the 60-day purge, hence the default. */
    absentStudentIds: z.array(uuid).max(60, 'tooMany').default([]),
  })
  .refine((c) => new Set(c.lessons.map((l) => l.lessonId)).size === c.lessons.length, {
    message: 'invalid',
    path: ['lessons'],
  })
  .refine((c) => new Set(c.absentStudentIds).size === c.absentStudentIds.length, {
    message: 'invalid',
    path: ['absentStudentIds'],
  });
export type SubReportContent = z.infer<typeof subReportContentSchema>;

export const subReportNotesSchema = z.strictObject({
  /** Per lesson block, keyed by block key. */
  lessonNotes: z
    .record(uuid, z.string().trim().max(1000, 'tooLong'))
    .refine((r) => Object.keys(r).length <= 40, 'tooMany')
    .default({}),
  behaviour: z.string().trim().max(3000, 'tooLong').default(''),
  forTeacher: z.string().trim().max(3000, 'tooLong').default(''),
});
export type SubReportNotes = z.infer<typeof subReportNotesSchema>;
