import 'server-only';
import { isLibraryItemType, type LibraryItemType } from '@lynx/content';
import { localDateIn, type CatholicReference, type LocalDate } from '@lynx/domain';
import { z } from 'zod';
import { aiOn, librarySchools, type SessionContext } from '../session';
import { createSupabaseServerClient } from '../supabase';
import { loadLanguageLevels, type LevelOption } from './differentiate';
import { loadLibrarySearchOptions, type GradeOption, type SubjectOption } from './library-search';

/**
 * « Créer avec l’IA » (DECISIONS D-072, D-073, D-074): what the request form needs, the values a
 * request starts from (an attente from « Parcourir le curriculum », or an earlier request to
 * send again), and the library's AI jobs. Everything is read as the user, under row level
 * security; the request itself is built by the database from the ids the form sends.
 */

export interface GenerateSchool {
  id: string;
  boardId: string;
  name: string;
  /** The school's AI is on and its board allows it. */
  aiEnabled: boolean;
  /** The board forbids AI (then the principal cannot turn it on). */
  boardOff: boolean;
  /** The school's local date, for the faith suggestion's rotation. */
  today: LocalDate;
}

/** A Catholic reference the teacher may link (active; global or of one of her boards). */
export type GenerateReference = CatholicReference;

export interface GenerateFormContext {
  /** Device drafts are kept per user (D-044). */
  userId: string;
  schools: GenerateSchool[];
  grades: GradeOption[];
  subjects: (SubjectOption & { boardId: string | null })[];
  anglaisStartGrade: number;
  /** Active levels: board levels, then the teacher's own. */
  levels: LevelOption[];
  references: GenerateReference[];
  /** The first grade of her classes (the form's default). */
  defaultGrade: string | null;
}

/** What the form holds; the request sends ids and choices only. */
export interface GenerateFormValues {
  schoolId: string;
  itemType: LibraryItemType;
  gradeCodes: string[];
  subjectId: string;
  expectationIds: string[];
  /** « Créer aussi une version par niveau ». */
  withLevels: boolean;
  levelIds: string[];
  /** « Ajouter un lien avec la foi ». */
  faith: boolean;
  catholicReferenceId: string;
  /** The teacher picked the reference herself (the suggestion no longer replaces it). */
  referenceChosen: boolean;
  durationMinutes: number;
  subFriendly: boolean;
  teacherNote: string;
}

export async function loadGenerateForm(
  session: SessionContext,
  locale: string,
): Promise<GenerateFormContext> {
  const supabase = await createSupabaseServerClient();
  const schools = librarySchools(session);
  const boardIds = [...new Set(schools.map((s) => s.boardId))];
  const [options, levels, references] = await Promise.all([
    loadLibrarySearchOptions(session, locale),
    loadLanguageLevels(locale),
    supabase
      .from('catholic_references')
      .select('id, board_id, type, title, text_fr, grade_min, grade_max, liturgical_season, tags')
      .eq('active', true)
      .order('title'),
  ]);
  const { data: subjectBoards } = await supabase
    .from('subjects')
    .select('id, board_id')
    .in(
      'id',
      options.subjects.map((s) => s.id),
    );
  const boardOf = new Map((subjectBoards ?? []).map((s) => [s.id, s.board_id]));
  return {
    userId: session.userId,
    schools: schools.map((s) => {
      const board = session.boards.find((b) => b.id === s.boardId);
      return {
        id: s.id,
        boardId: s.boardId,
        name: s.name,
        aiEnabled: aiOn(session, s),
        boardOff: board?.settings.ai.allowed === false,
        today: localDateIn(s.timezone),
      };
    }),
    grades: options.grades,
    subjects: options.subjects.map((s) => ({ ...s, boardId: boardOf.get(s.id) ?? null })),
    anglaisStartGrade: options.anglaisStartGrade,
    levels: levels.filter((l) => l.active && boardIds.includes(l.boardId)),
    references: (references.data ?? [])
      .filter((r) => r.board_id === null || boardIds.includes(r.board_id))
      .map((r) => ({
        id: r.id,
        boardId: r.board_id,
        type: r.type,
        title: r.title,
        textFr: r.text_fr,
        gradeMin: r.grade_min,
        gradeMax: r.grade_max,
        liturgicalSeason: r.liturgical_season,
        tags: r.tags,
      })),
    defaultGrade: options.myGrades[0] ?? null,
  };
}

/** A new request: the teacher's first grade, her first school with AI on, a worksheet. */
export function defaultGenerateValues(context: GenerateFormContext): GenerateFormValues {
  const school = context.schools.find((s) => s.aiEnabled) ?? context.schools[0];
  return {
    schoolId: school?.id ?? '',
    itemType: 'worksheet',
    gradeCodes: context.defaultGrade ? [context.defaultGrade] : [],
    subjectId: '',
    expectationIds: [],
    withLevels: true,
    levelIds: context.levels
      .filter((l) => !l.personal && (!school || l.boardId === school.boardId))
      .map((l) => l.id),
    faith: false,
    catholicReferenceId: '',
    referenceChosen: false,
    durationMinutes: 30,
    subFriendly: false,
    teacherNote: '',
  };
}

/**
 * The values for « Créer avec l’IA pour cette attente » (`?exp=`): the attente's grade, subject
 * and the attente itself. Null when the attente is not readable.
 */
export async function valuesForExpectation(
  context: GenerateFormContext,
  expectationId: string,
): Promise<GenerateFormValues | null> {
  if (!z.uuid().safeParse(expectationId).success) return null;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('curriculum_expectations')
    .select('id, grade_code, subject_id')
    .eq('id', expectationId)
    .maybeSingle();
  if (!data) return null;
  return {
    ...defaultGenerateValues(context),
    gradeCodes: [data.grade_code],
    subjectId: data.subject_id,
    expectationIds: [data.id],
  };
}

const jobInputSchema = z.object({
  itemType: z.string(),
  gradeCodes: z.array(z.string()),
  subjectId: z.string(),
  expectations: z.array(z.object({ expectationId: z.string() })),
  levels: z.array(z.object({ languageLevelId: z.string() })),
  catholic: z.object({ referenceId: z.string() }).nullable(),
  durationMinutes: z.number(),
  subFriendly: z.boolean(),
  teacherNote: z.string(),
});

/**
 * The values of an earlier request of the teacher's (`?resume=`), to send again after a failure.
 * Null when it is not hers, not a library request, or gone (jobs are kept 30 days).
 */
export async function valuesForJob(
  context: GenerateFormContext,
  jobId: string,
): Promise<GenerateFormValues | null> {
  if (!z.uuid().safeParse(jobId).success) return null;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('ai_jobs')
    .select('school_id, input')
    .eq('id', jobId)
    .eq('feature', 'library_item')
    .maybeSingle();
  const input = jobInputSchema.safeParse(data?.input);
  if (!data || !input.success || !isLibraryItemType(input.data.itemType)) return null;
  const i = input.data;
  return {
    ...defaultGenerateValues(context),
    schoolId: data.school_id,
    itemType: i.itemType as LibraryItemType,
    gradeCodes: i.gradeCodes,
    subjectId: i.subjectId,
    expectationIds: i.expectations.map((e) => e.expectationId),
    withLevels: i.levels.length > 0,
    levelIds: i.levels.map((l) => l.languageLevelId),
    faith: i.catholic !== null,
    catholicReferenceId: i.catholic?.referenceId ?? '',
    referenceChosen: i.catholic !== null,
    durationMinutes: i.durationMinutes,
    subFriendly: i.subFriendly,
    teacherNote: i.teacherNote,
  };
}

export type LibraryJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

/**
 * The status of the teacher's recent « Créer avec l’IA » requests (or « Créer une banque avec
 * l’IA »'s): a device draft that was sent comes back only if its request failed (D-035).
 */
export async function loadLibraryJobStatuses(
  feature: 'library_item' | 'report_comment_bank' = 'library_item',
): Promise<Record<string, LibraryJobStatus>> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('ai_jobs')
    .select('id, status')
    .eq('feature', feature)
    .order('created_at', { ascending: false })
    .limit(50);
  return Object.fromEntries((data ?? []).map((j) => [j.id, j.status]));
}

/** The library's AI features: « Créer avec l’IA », its versions per level, comment banks. */
export const LIBRARY_AI_FEATURES = [
  'library_item',
  'library_levels',
  'report_comment_bank',
] as const;
export type LibraryAiFeature = (typeof LIBRARY_AI_FEATURES)[number];

const featureOf = (value: string): LibraryAiFeature =>
  (LIBRARY_AI_FEATURES as readonly string[]).includes(value)
    ? (value as LibraryAiFeature)
    : 'library_item';

export interface LibraryJobView {
  id: string;
  feature: LibraryAiFeature;
  status: LibraryJobStatus;
  /** A key under `errors` (`invalidOutput`, `libraryChanged`, `aiBudgetReached`…). */
  errorCode: string | null;
  createdAt: string;
  /**
   * The new resource (library_item, report_comment_bank), or the resource the levels are for
   * (library_levels).
   */
  itemId: string | null;
  itemType: LibraryItemType | null;
}

const idOf = (value: unknown): string | null =>
  typeof value === 'string' && z.uuid().safeParse(value).success ? value : null;

/** One of the teacher's library AI requests (row level security: her own only). */
export async function loadLibraryJob(jobId: string): Promise<LibraryJobView | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('ai_jobs')
    .select('id, feature, status, error_code, created_at, input, result')
    .eq('id', jobId)
    .in('feature', [...LIBRARY_AI_FEATURES])
    .maybeSingle();
  if (!data) return null;
  const input = (data.input ?? {}) as Record<string, unknown>;
  const result = (data.result ?? {}) as Record<string, unknown>;
  const feature = featureOf(data.feature);
  return {
    id: data.id,
    feature,
    status: data.status,
    errorCode: data.error_code,
    createdAt: data.created_at,
    itemId: feature === 'library_levels' ? idOf(input.itemId) : idOf(result.itemId),
    itemType: isLibraryItemType(input.itemType) ? input.itemType : null,
  };
}

/**
 * The teacher's library AI requests still being prepared (« En préparation »), newest first: for
 * the hub and « Mes ressources ».
 */
export async function loadOpenLibraryJobs(): Promise<LibraryJobView[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('ai_jobs')
    .select('id, feature, status, error_code, created_at, input')
    .in('feature', [...LIBRARY_AI_FEATURES])
    .in('status', ['queued', 'running'])
    .order('created_at', { ascending: false })
    .limit(10);
  return (data ?? []).map((j) => {
    const input = (j.input ?? {}) as Record<string, unknown>;
    const feature = featureOf(j.feature);
    return {
      id: j.id,
      feature,
      status: j.status,
      errorCode: j.error_code,
      createdAt: j.created_at,
      itemId: feature === 'library_levels' ? idOf(input.itemId) : null,
      itemType: isLibraryItemType(input.itemType) ? input.itemType : null,
    };
  });
}

/** Whether « Créer avec l’IA » is offered: a library school whose AI is on. */
export function canGenerate(session: SessionContext): boolean {
  return librarySchools(session).some((s) => aiOn(session, s));
}
