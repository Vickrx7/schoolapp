/**
 * The « classe exemple » a pilot teacher can try the app with (DECISIONS D-109; Assumption on its
 * content): « Classe exemple (3e année) » or 5e, with 20 invented first names, the seed's weekly
 * timetable, and a Français and a Mathématiques unit of 8 lessons, lessons 1 to 3 done. It never
 * reaches a substitute plan and is deleted 60 days after it is made (`samplePurgeDate`).
 *
 * `buildSampleClass` builds the payload that `public.create_sample_class` saves (security
 * invoker: row level security and column grants check every row the teacher writes);
 * `sampleClassSchema` mirrors that function's limits. The units are in `content-3e.ts` and
 * `content-5e.ts`; the timetable is the demo seed's (`supabase/seed.sql`), without its teachers
 * and rooms.
 */
import { mapStrings, normalizeFrenchTypography } from '@lynx/content';
import { z } from 'zod';
import { addDays, isLocalDate, isWeekend, timeToMinutes, type LocalDate } from '../dates';
import { blockKinds, firstNameSchema, localTimeSchema } from '../forms';
import { SAMPLE_UNITS_3E } from './content-3e';
import { SAMPLE_UNITS_5E } from './content-5e';

/** The grades a sample class exists for. */
export const SAMPLE_GRADES = ['3', '5'] as const;
export type SampleGrade = (typeof SAMPLE_GRADES)[number];

/**
 * Invented first names (20), none a French word once accents are removed, all accepted by the
 * prompts' first-name guard (`packages/ai/src/prompts-privacy.test.ts`): once a sample class
 * exists, these are students of the school, and the AI privacy check looks for them. None is a
 * demo student, a demo staff member or one of the AI's character names.
 */
export const SAMPLE_FIRST_NAMES: readonly string[] = [
  'Anouk',
  'Aurèle',
  'Corentin',
  'Élio',
  'Ewen',
  'Héloïse',
  'Ilona',
  'Isaure',
  'Lysandre',
  'Maëlys',
  'Mahaut',
  'Maxence',
  'Mélina',
  'Naïma',
  'Odilon',
  'Philémon',
  'Soren',
  'Timéo',
  'Ysaline',
  'Zélie',
];

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

/**
 * Language levels as ranks (1 = the board's first active level, débutant … 4, enrichi), in the
 * seed's 3e année distribution: 3 / 4 / 10 / 3. Spread over the alphabetical list.
 */
const LEVEL_RANKS: readonly number[] = [3, 3, 1, 2, 3, 4, 3, 2, 3, 3, 1, 3, 4, 2, 3, 3, 1, 2, 4, 3];

/** The class's routine blocks, every day (as in the seed). */
const ROUTINE_BLOCKS: readonly Omit<SampleBlock, 'dayKey'>[] = [
  {
    start: '08:45',
    end: '08:55',
    kind: 'routine',
    subjectCode: null,
    title: 'Entrée, prière du matin et O Canada',
  },
  {
    start: '10:35',
    end: '11:15',
    kind: 'nutrition_break',
    subjectCode: null,
    title: 'Première pause santé',
  },
  {
    start: '12:55',
    end: '13:35',
    kind: 'nutrition_break',
    subjectCode: null,
    title: 'Deuxième pause santé',
  },
  {
    start: '15:15',
    end: '15:20',
    kind: 'routine',
    subjectCode: null,
    title: 'Rangement, prière et départ',
  },
];

/** The six periods of each day: the seed's 3e and 5e timetables (Monday to Friday). */
const PERIODS = [
  ['08:55', '09:45'],
  ['09:45', '10:35'],
  ['11:15', '12:05'],
  ['12:05', '12:55'],
  ['13:35', '14:25'],
  ['14:25', '15:15'],
] as const;

const WEEK: Record<SampleGrade, readonly (readonly string[])[]> = {
  '3': [
    ['fra', 'mat', 'fra', 'ere', 'sci', 'art'],
    ['fra', 'mat', 'fra', 'etu', 'eps', 'mat'],
    ['fra', 'mat', 'sci', 'ere', 'fra', 'eps'],
    ['fra', 'mat', 'fra', 'etu', 'eps', 'art'],
    ['fra', 'mat', 'ere', 'sci', 'fra', 'eps'],
  ],
  '5': [
    ['mat', 'fra', 'ang', 'fra', 'sci', 'ere'],
    ['mat', 'fra', 'etu', 'fra', 'sci', 'eps'],
    ['mat', 'fra', 'ang', 'ere', 'fra', 'art'],
    ['mat', 'fra', 'sci', 'fra', 'etu', 'eps'],
    ['mat', 'fra', 'ang', 'sci', 'art', 'ere'],
  ],
};

type SampleBlock = SampleClassPayload['blocks'][number];

/** The most blocks `create_sample_class` accepts. */
const MAX_BLOCKS = 80;

/**
 * The timetable over `dayCount` day keys (5 at a weekly school, the cycle's length at a
 * rotating-day school, where the week's pattern repeats). Long cycles keep only the periods, and
 * as many days as fit in `MAX_BLOCKS`.
 */
function sampleBlocks(gradeCode: SampleGrade, dayCount: number): SampleBlock[] {
  const perDay = PERIODS.length + ROUTINE_BLOCKS.length;
  const withRoutines = dayCount * perDay <= MAX_BLOCKS;
  const days = Math.min(
    dayCount,
    Math.floor(MAX_BLOCKS / (withRoutines ? perDay : PERIODS.length)),
  );
  const blocks: SampleBlock[] = [];
  for (let dayKey = 1; dayKey <= days; dayKey++) {
    const subjects = WEEK[gradeCode][(dayKey - 1) % 5]!;
    if (withRoutines) for (const routine of ROUTINE_BLOCKS) blocks.push({ ...routine, dayKey });
    PERIODS.forEach(([start, end], i) => {
      blocks.push({ dayKey, start, end, kind: 'subject', subjectCode: subjects[i]!, title: null });
    });
  }
  return blocks.sort((a, b) => a.dayKey - b.dayKey || a.start.localeCompare(b.start));
}

/** The `count` weekdays before `today`, oldest first. */
export function weekdaysBefore(today: LocalDate, count: number): LocalDate[] {
  const days: LocalDate[] = [];
  for (let d = addDays(today, -1); days.length < count; d = addDays(d, -1)) {
    if (!isWeekend(d)) days.unshift(d);
  }
  return days;
}

/** How many lessons of each unit are already « taught ». */
export const SAMPLE_LESSONS_TAUGHT = 3;

/**
 * The sample class of a grade, as of `today`: lessons 1 to 3 of each unit were taught on the 3
 * weekdays before it. `dayCount` is the school's number of day keys (5 at a weekly school, the
 * cycle's length at a rotating-day school). The French text goes through the typography fixes
 * (`normalizeFrenchTypography`), so it reads as Canadian French should.
 */
export function buildSampleClass(input: {
  gradeCode: SampleGrade;
  today: LocalDate;
  dayCount?: number;
}): SampleClassPayload {
  const { gradeCode, today } = input;
  const dayCount = Math.max(1, Math.min(20, Math.trunc(input.dayCount ?? 5)));
  const taughtOn = weekdaysBefore(today, SAMPLE_LESSONS_TAUGHT);
  const payload: SampleClassPayload = {
    name: `Classe exemple (${gradeCode}e année)`,
    gradeCodes: [gradeCode],
    students: SAMPLE_FIRST_NAMES.map((firstName, i) => ({
      firstName,
      levelRank: LEVEL_RANKS[i]!,
    })),
    blocks: sampleBlocks(gradeCode, dayCount),
    units: sampleUnits(gradeCode).map((unit) => ({
      subjectCode: unit.subjectCode,
      title: unit.title,
      description: unit.description,
      lessons: unit.lessons.map((lesson) => ({ ...lesson })),
      taughtOn: taughtOn.slice(0, Math.min(SAMPLE_LESSONS_TAUGHT, unit.lessons.length)),
    })),
  };
  return sampleClassSchema.parse(
    mapStrings(payload, (text) =>
      isLocalDate(text) || /^[0-9]{2}:[0-9]{2}$/.test(text) || /^[a-z0-9_]+$/.test(text)
        ? text
        : normalizeFrenchTypography(text),
    ),
  );
}
