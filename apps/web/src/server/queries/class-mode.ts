import 'server-only';
import { cache } from 'react';
import { classPortalConfigured } from '../class-portal/db';
import { liveStateSchema, type LiveState } from '../class-portal/schemas';
import { parseSessionAggregate, type SessionAggregate } from '../class-mode/aggregate';
import { classModeOverviewSchema, type ClassModeOverview } from '../class-mode/overview';
import { reportError } from '../errors';
import { hasModule, hasRole, type SessionContext } from '../session';
import { createSupabaseServerClient } from '../supabase';

/**
 * What the teacher's class-mode screens read (DECISIONS D-084 to D-090), as the signed-in user:
 * row level security and the class-mode functions decide (the class team with a teacher role,
 * `app.my_class_ids()`). Never a device's number beside its answers, never a key before the
 * reveal.
 */

export interface QuizClass {
  id: string;
  name: string;
  schoolName: string;
  /** One of the item's grades: listed first. */
  matchesGrades: boolean;
}

/**
 * « Classe » in « Lancer un quiz sur les appareils »: the classes where the user is on the class
 * team and teaches at a school with the Library module, those matching the item's grades first.
 * Cached per request (the item page renders the slot once per version).
 */
export const loadQuizClasses = cache(
  async (session: SessionContext, gradeKey: string): Promise<QuizClass[]> => {
    const grades = new Set(gradeKey ? gradeKey.split(',') : []);
    const schools = new Map(
      session.schools
        .filter((s) => hasModule(s, 'library') && hasRole(s, 'teacher'))
        .map((s) => [s.id, s]),
    );
    if (!schools.size) return [];
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('class_teachers')
      .select('classes!inner(id, name, school_id, class_grades(grade_code))')
      .eq('user_id', session.userId);
    if (error) {
      reportError('loadQuizClasses', error);
      return [];
    }
    return (data ?? [])
      .map((row) => row.classes)
      .filter((c) => schools.has(c.school_id))
      .map((c) => {
        const school = schools.get(c.school_id)!;
        return {
          id: c.id,
          name: c.name,
          schoolName: school.shortName ?? school.name,
          matchesGrades: c.class_grades.some((g) => grades.has(g.grade_code)),
        };
      })
      .sort(
        (a, b) =>
          Number(b.matchesGrades) - Number(a.matchesGrades) ||
          a.name.localeCompare(b.name, 'fr-CA'),
      );
  },
);

export interface ClassModeTab extends ClassModeOverview {
  /** « Garder les résultats » as ticked for the open session (the end dialog starts with it). */
  openKeep: boolean;
}

/**
 * The class tab: the open session, kept results and settings (`class_mode_overview`, which also
 * closes an expired session of the class first, D-089). Null when the user may not run class mode
 * in this class.
 */
export async function loadClassModeTab(classId: string): Promise<ClassModeTab | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('class_mode_overview', { p_class_id: classId });
  if (error) {
    if (error.code !== '42501') reportError('loadClassModeTab', error);
    return null;
  }
  const parsed = classModeOverviewSchema.safeParse(data);
  if (!parsed.success) {
    reportError('loadClassModeTab', { message: 'unreadable overview' });
    return null;
  }
  let openKeep = false;
  if (parsed.data.open) {
    const { data: open } = await supabase
      .from('class_sessions')
      .select('keep_aggregate_results')
      .eq('id', parsed.data.open.id)
      .maybeSingle();
    openKeep = open?.keep_aggregate_results ?? false;
  }
  return { ...parsed.data, openKeep };
}

/**
 * The class's link token (« Lien de la classe », D-084), created on first use. Null when devices
 * are not configured on this server or the class has no Library module.
 */
export async function loadClassLinkToken(classId: string): Promise<string | null> {
  if (!classPortalConfigured()) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('class_mode_link', { p_class_id: classId });
  if (error) {
    if (error.code !== '42501') reportError('loadClassLinkToken', error);
    return null;
  }
  return typeof data === 'string' ? data : null;
}

export interface ProjectorSession {
  id: string;
  classId: string;
  live: LiveState;
}

/**
 * The projector of a session: its class and state (`class_session_live`, which closes it first if
 * it expired). Null when the user may not see it (not the class team) or it is gone.
 */
export async function loadProjectorSession(sessionId: string): Promise<ProjectorSession | null> {
  const supabase = await createSupabaseServerClient();
  const { data: row } = await supabase
    .from('class_sessions')
    .select('id, class_id')
    .eq('id', sessionId)
    .maybeSingle();
  if (!row) return null;
  const { data, error } = await supabase.rpc('class_session_live', { p_session_id: sessionId });
  if (error) {
    if (error.code !== '42501') reportError('loadProjectorSession', error);
    return null;
  }
  const live = liveStateSchema.safeParse(data);
  if (!live.success) {
    reportError('loadProjectorSession', { message: 'unreadable state' });
    return null;
  }
  return { id: row.id, classId: row.class_id, live: live.data };
}

export interface SessionResults {
  sessionId: string;
  classId: string;
  itemTitle: string | null;
  /** The content's language (`ang` → en-CA), for the prompts and choices shown. */
  lang: 'fr-CA' | 'en-CA';
  savedAt: string;
  /** Null when the stored results cannot be shown (another version, a damaged row). */
  aggregate: SessionAggregate | null;
}

/** « Résultats gardés » of one session of the class: class counts only (D-089). */
export async function loadSessionResults(
  classId: string,
  sessionId: string,
): Promise<SessionResults | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('class_sessions')
    .select(
      'id, class_id, item_title, content_lang, class_session_results!inner(aggregate, saved_at)',
    )
    .eq('id', sessionId)
    .eq('class_id', classId)
    .eq('status', 'closed')
    .maybeSingle();
  if (error) {
    reportError('loadSessionResults', error);
    return null;
  }
  const results = data?.class_session_results;
  const kept = Array.isArray(results) ? results[0] : results;
  if (!data || !kept) return null;
  return {
    sessionId: data.id,
    classId: data.class_id,
    itemTitle: data.item_title,
    lang: data.content_lang === 'en-CA' ? 'en-CA' : 'fr-CA',
    savedAt: kept.saved_at,
    aggregate: parseSessionAggregate(kept.aggregate),
  };
}
