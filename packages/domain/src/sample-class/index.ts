/**
 * The « classe exemple » a pilot teacher can try the app with (DECISIONS D-109; Assumption on its
 * content): « Classe exemple (3e année) » or 5e, with 20 invented first names, the seed's weekly
 * timetable, and a Français and a Mathématiques unit of 8 lessons, lessons 1 to 3 done. It never
 * reaches a substitute plan and is deleted 60 days after it is made (`samplePurgeDate`).
 *
 * `buildSampleClass` builds the payload that `public.create_sample_class` saves (security
 * invoker: row level security and column grants check every row the teacher writes);
 * `sampleClassSchema` mirrors that function's limits. The names, the timetable and the units are
 * slice S6's (`content-3e.ts`, `content-5e.ts`); until then building one fails.
 */
import { z } from 'zod';
import { isLocalDate, timeToMinutes, type LocalDate } from '../dates';
import { blockKinds, firstNameSchema, localTimeSchema } from '../forms';
import { SAMPLE_UNITS_3E } from './content-3e';
import { SAMPLE_UNITS_5E } from './content-5e';

/** The grades a sample class exists for. */
export const SAMPLE_GRADES = ['3', '5'] as const;
export type SampleGrade = (typeof SAMPLE_GRADES)[number];

/**
 * Invented first names (20), none a French word once accents are removed, all accepted by the
 * prompts' first-name guard (`packages/ai/src/prompts-privacy.test.ts`). Slice S6 writes them.
 */
export const SAMPLE_FIRST_NAMES: readonly string[] = [];

const subjectCode = z.string().regex(/^[a-z0-9_]{1,20}$/);
const text = (max: number) => z.string().trim().min(1).max(max);
const optional = (max: number) => z.string().trim().max(max).nullable();

const sampleBlockSchema = z
  .object({
    /** 1–5 (Monday–Friday) at a weekly school, 1–n at a rotating-day school. */
    dayKey: z.number().int().min(1).max(20),
    start: localTimeSchema,
    end: localTimeSchema,
    kind: z.enum(blockKinds),
    /** A standard subject's code (`fra`, `mat`…); required for a subject period. */
    subjectCode: subjectCode.nullable(),
    title: optional(80),
  })
  .refine((b) => timeToMinutes(b.end) > timeToMinutes(b.start), 'endBeforeStart')
  .refine((b) => b.kind !== 'subject' || b.subjectCode !== null, 'subjectRequired');

const sampleLessonSchema = z.object({
  title: text(160),
  objectives: optional(4000),
  materials: optional(4000),
  content: optional(20000),
  /** What a substitute needs (lesson 4 has some, so the « Fiche » makes sense). */
  subNotes: optional(4000),
  durationMinutes: z.number().int().min(1).max(600).nullable(),
});

const sampleUnitSchema = z
  .object({
    subjectCode,
    title: text(120),
    description: optional(2000),
    lessons: z.array(sampleLessonSchema).min(1).max(20),
    /** The dates lessons 1, 2, 3… were taught, oldest first. */
    taughtOn: z.array(z.string().refine(isLocalDate, 'invalidDate')).max(20),
  })
  .refine((u) => u.taughtOn.length <= u.lessons.length, 'tooMany');

/** What `public.create_sample_class(p_school_id, p_sample)` accepts. */
export const sampleClassSchema = z.object({
  name: text(80),
  gradeCodes: z
    .array(z.string().regex(/^[A-Z0-9]{1,4}$/))
    .min(1)
    .max(3),
  students: z
    .array(
      z.object({
        firstName: firstNameSchema,
        /** 1 = the board's first active level (débutant) … 4 (enrichi). */
        levelRank: z.number().int().min(1).max(4),
      }),
    )
    .min(1)
    .max(30),
  blocks: z.array(sampleBlockSchema).max(80),
  units: z.array(sampleUnitSchema).max(3),
});

export type SampleClassPayload = z.infer<typeof sampleClassSchema>;
export type SampleLessonContent = z.infer<typeof sampleLessonSchema>;

/** A unit of a sample class as written in `content-3e.ts` / `content-5e.ts` (no dates yet). */
export interface SampleUnitContent {
  subjectCode: string;
  title: string;
  description: string | null;
  lessons: readonly SampleLessonContent[];
}

const UNITS: Record<SampleGrade, readonly SampleUnitContent[]> = {
  '3': SAMPLE_UNITS_3E,
  '5': SAMPLE_UNITS_5E,
};

/** The units of a grade's sample class (empty until slice S6 writes them). */
export function sampleUnits(gradeCode: SampleGrade): readonly SampleUnitContent[] {
  return UNITS[gradeCode];
}

/** The sample class of a grade, as of `today` (the 3 weekdays before it are « taught »). */
export function buildSampleClass(input: {
  gradeCode: SampleGrade;
  today: LocalDate;
}): SampleClassPayload {
  // Slice S6 builds it from SAMPLE_FIRST_NAMES, the seed's weekly timetable and sampleUnits().
  throw new Error(
    `buildSampleClass: the ${input.gradeCode}e année sample class is not available yet (Phase 6, slice S6)`,
  );
}
