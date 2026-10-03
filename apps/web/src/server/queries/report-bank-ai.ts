import 'server-only';
import { z } from 'zod';
import { aiOn, librarySchools, type SessionContext } from '../session';
import { createSupabaseServerClient } from '../supabase';
import { loadLibrarySearchOptions, type GradeOption, type SubjectOption } from './library-search';

/**
 * « Créer une banque avec l’IA » (DECISIONS D-132): what the request form needs and the values a
 * request starts from (the links of « Bulletins », with ids only, or an earlier request to send
 * again). Read as the user, under row level security; the request itself is built by the
 * database from the ids the form sends.
 */

export interface ReportBankSchool {
  id: string;
  boardId: string;
  name: string;
  /** The school's AI is on and its board allows it. */
  aiEnabled: boolean;
  /** The board forbids AI (then the principal cannot turn it on). */
  boardOff: boolean;
}

export interface ReportBankFormContext {
  /** Device drafts are kept per user (D-044). */
  userId: string;
  schools: ReportBankSchool[];
  /** 1re to 8e année: kindergarten has no report card comments (D-008). */
  grades: GradeOption[];
  subjects: (SubjectOption & { boardId: string | null })[];
  /** The first grade of her classes (the form's default). */
  defaultGrade: string | null;
}

/** What the form holds; the request sends ids and choices only. */
export interface ReportBankFormValues {
  schoolId: string;
  scope: 'subject' | 'learning_skills' | 'religion';
  period: 'progress' | 'term';
  gradeCode: string;
  /** '' for none (the learning skills, or not chosen yet). */
  subjectId: string;
  expectationIds: string[];
  length: 'short' | 'medium';
  teacherNote: string;
}

export async function loadReportBankForm(
  session: SessionContext,
  locale: string,
): Promise<ReportBankFormContext> {
  const supabase = await createSupabaseServerClient();
  const options = await loadLibrarySearchOptions(session, locale);
  const { data: subjectBoards } = await supabase
    .from('subjects')
    .select('id, board_id')
    .in(
      'id',
      options.subjects.map((s) => s.id),
    );
  const boardOf = new Map((subjectBoards ?? []).map((s) => [s.id, s.board_id]));
  const grades = options.grades.filter((g) => g.ordinal >= 1 && g.ordinal <= 8);
  return {
    userId: session.userId,
    schools: librarySchools(session).map((s) => ({
      id: s.id,
      boardId: s.boardId,
      name: s.name,
      aiEnabled: aiOn(session, s),
      boardOff: session.boards.find((b) => b.id === s.boardId)?.settings.ai.allowed === false,
    })),
    grades,
    subjects: options.subjects.map((s) => ({ ...s, boardId: boardOf.get(s.id) ?? null })),
    defaultGrade: options.myGrades.find((g) => grades.some((x) => x.code === g)) ?? null,
  };
}

const jobInputSchema = z.object({
  scope: z.enum(['subject', 'learning_skills', 'religion']),
  period: z.enum(['progress', 'term']),
  length: z.enum(['short', 'medium']),
  gradeCodes: z.array(z.string()).min(1),
  subjectId: z.string().nullable(),
  expectations: z.array(z.object({ expectationId: z.string() })),
  teacherNote: z.string(),
});

/**
 * The values of an earlier bank request of the teacher's (`?resume=`), to send again after a
 * failure. Null when it is not hers, not a bank request, or gone (jobs are kept 30 days).
 */
export async function valuesForBankJob(
  jobId: string,
): Promise<(ReportBankFormValues & { schoolId: string }) | null> {
  if (!z.uuid().safeParse(jobId).success) return null;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('ai_jobs')
    .select('school_id, input')
    .eq('id', jobId)
    .eq('feature', 'report_comment_bank')
    .maybeSingle();
  const input = jobInputSchema.safeParse(data?.input);
  if (!data || !input.success) return null;
  const i = input.data;
  return {
    schoolId: data.school_id,
    scope: i.scope,
    period: i.period,
    gradeCode: i.gradeCodes[0]!,
    subjectId: i.subjectId ?? '',
    expectationIds: i.expectations.map((e) => e.expectationId),
    length: i.length,
    teacherNote: i.teacherNote,
  };
}
