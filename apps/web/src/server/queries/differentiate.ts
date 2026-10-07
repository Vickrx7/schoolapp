import 'server-only';
import type { DifferentiateInput, DifferentiateOutput } from '@lynx/ai/features/differentiate';
import { localized } from '@/i18n/config';
import { aiOn, aiSchools, type SessionContext } from '../session';
import { createSupabaseServerClient } from '../supabase';

export interface LevelOption {
  id: string;
  boardId: string;
  label: string;
  description: string | null;
  personal: boolean;
  active: boolean;
}

/** Board levels first, then the user's own, each in their configured order. */
export async function loadLanguageLevels(locale: string): Promise<LevelOption[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('language_levels')
    .select('id, board_id, label_fr, label_en, description_fr, owner_user_id, active, sort_order')
    .order('sort_order')
    .order('label_fr');
  return (data ?? [])
    .map((l) => ({
      id: l.id,
      boardId: l.board_id,
      label: localized(locale, l.label_fr, l.label_en),
      description: l.description_fr,
      personal: l.owner_user_id !== null,
      active: l.active,
    }))
    .sort((a, b) => Number(a.personal) - Number(b.personal));
}

export interface DifferentiateFormContext {
  /** Drafts on the device are kept per user. */
  userId: string;
  /** `aiEnabled` is the effective state; `boardAllows` says whether the board forbids AI. */
  schools: {
    id: string;
    boardId: string;
    name: string;
    aiEnabled: boolean;
    boardAllows: boolean;
  }[];
  levels: LevelOption[];
  grades: { code: string; label: string; ordinal: number }[];
  subjects: { id: string; label: string; gradeMin: number; gradeMax: number }[];
  defaultGrade: string | null;
}

export async function loadDifferentiateForm(
  session: SessionContext,
  locale: string,
): Promise<DifferentiateFormContext> {
  const supabase = await createSupabaseServerClient();
  const [levels, grades, subjects, classGrades] = await Promise.all([
    loadLanguageLevels(locale),
    supabase.from('grades').select('code, label_fr, label_en, ordinal').order('ordinal'),
    supabase
      .from('subjects')
      .select('id, label_fr, label_en, grade_min, grade_max, sort_order')
      .eq('active', true)
      .order('sort_order'),
    supabase
      .from('class_teachers')
      .select('classes!inner(class_grades(grade_code, grades(ordinal)))')
      .eq('user_id', session.userId)
      .limit(1),
  ]);
  const firstClassGrades = classGrades.data?.[0]?.classes.class_grades ?? [];
  const defaultGrade =
    [...firstClassGrades].sort((a, b) => (a.grades?.ordinal ?? 0) - (b.grades?.ordinal ?? 0))[0]
      ?.grade_code ?? null;

  return {
    userId: session.userId,
    schools: aiSchools(session).map((s) => ({
      id: s.id,
      boardId: s.boardId,
      name: s.name,
      aiEnabled: aiOn(session, s),
      boardAllows: session.boards.find((b) => b.id === s.boardId)?.settings.ai.allowed ?? true,
    })),
    levels: levels.filter((l) => l.active),
    grades: (grades.data ?? []).map((g) => ({
      code: g.code,
      label: localized(locale, g.label_fr, g.label_en),
      ordinal: g.ordinal,
    })),
    subjects: (subjects.data ?? []).map((s) => ({
      id: s.id,
      label: localized(locale, s.label_fr, s.label_en),
      gradeMin: s.grade_min,
      gradeMax: s.grade_max,
    })),
    defaultGrade,
  };
}

export interface JobSummary {
  id: string;
  schoolId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  errorCode: string | null;
  title: string | null;
  createdAt: string;
}

export async function loadRecentJobs(): Promise<JobSummary[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('ai_jobs')
    .select('id, school_id, status, error_code, created_at, input')
    .eq('feature', 'differentiate')
    .order('created_at', { ascending: false })
    .limit(10);
  return (data ?? []).map((j) => ({
    id: j.id,
    schoolId: j.school_id,
    status: j.status,
    errorCode: j.error_code,
    title:
      typeof (j.input as { title?: unknown }).title === 'string'
        ? (j.input as { title: string }).title
        : null,
    createdAt: j.created_at,
  }));
}

export interface SavedSummary {
  id: string;
  schoolId: string | null;
  title: string;
  updatedAt: string;
}

/**
 * « Mes textes différenciés »: the user's library items saved from « Texte différencié »
 * (D-073), not the other AI resources (« Créer avec l'IA », whose generation's feature is
 * `library_item`). They open in the library.
 */
export async function loadSavedTexts(session: SessionContext): Promise<SavedSummary[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('library_items')
    .select('id, school_id, title, updated_at, ai_generations!inner(feature)')
    .eq('author_id', session.userId)
    .eq('source', 'ai_generated')
    .eq('ai_generations.feature', 'differentiate')
    .in('type', ['reading_passage', 'worksheet'])
    .order('updated_at', { ascending: false })
    .limit(30);
  return (data ?? []).map((i) => ({
    id: i.id,
    schoolId: i.school_id,
    title: i.title,
    updatedAt: i.updated_at,
  }));
}

export interface JobDetail {
  id: string;
  schoolId: string;
  createdAt: string;
  status: JobSummary['status'];
  errorCode: string | null;
  input: DifferentiateInput;
  result: DifferentiateOutput | null;
  sentText: string | null;
}

export async function loadJob(jobId: string): Promise<JobDetail | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('ai_jobs')
    .select('id, school_id, created_at, status, error_code, input, result, sent_text')
    .eq('id', jobId)
    .eq('feature', 'differentiate')
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    schoolId: data.school_id,
    createdAt: data.created_at,
    status: data.status,
    errorCode: data.error_code,
    input: data.input as unknown as DifferentiateInput,
    result: (data.result as unknown as DifferentiateOutput | null) ?? null,
    sentText: data.sent_text,
  };
}
