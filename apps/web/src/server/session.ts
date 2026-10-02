import 'server-only';
import type { AppRole, ModuleKey, ScheduleType } from '@lynx/db';
import {
  localDateIn,
  parseBoardSettings,
  parseSchoolSettings,
  type BoardSettings,
  type SchoolSettings,
} from '@lynx/domain';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { landingPath, type LandingPath } from '@/lib/landing';
import type { LibraryReviewerRole } from './library/view-model';
import { createSupabaseServerClient } from './supabase';

export interface SchoolContext {
  id: string;
  boardId: string;
  name: string;
  shortName: string | null;
  timezone: string;
  scheduleType: ScheduleType;
  cycleLength: number | null;
  studentAlertsEnabled: boolean;
  aiEnabled: boolean;
  settings: SchoolSettings;
  modules: ModuleKey[];
  roles: AppRole[];
}

export interface SessionContext {
  userId: string;
  email: string;
  displayName: string;
  honorific: string | null;
  preferredLocale: string;
  /**
   * The pilot terms the user accepted (DECISIONS D-109, D-110): the version and when, both null
   * until « Bienvenue ». `termsState(termsVersion)` (@lynx/domain) says whether to ask or remind.
   */
  termsVersion: string | null;
  termsAcceptedAt: string | null;
  /** When the user hid the « Pour bien commencer » checklist (D-109). */
  onboardingDismissedAt: string | null;
  roles: { role: AppRole; boardId: string; schoolId: string | null }[];
  schools: SchoolContext[];
  boards: { id: string; name: string; settings: BoardSettings; isAdmin: boolean }[];
  /**
   * The user's own designations as a library reviewer (DECISIONS D-064), for boards where the
   * user is active staff (as `app.library_reviewer` requires).
   */
  libraryReviewer: LibraryReviewerRole[];
}

export type SessionState =
  | { status: 'anonymous' }
  /** Signed in, but the account has no profile or was deactivated. */
  | { status: 'inactive' }
  | { status: 'active'; session: SessionContext };

/** The signed-in user's profile, roles, schools and licensed modules (once per request). */
export const loadSessionState = cache(async (): Promise<SessionState> => {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { status: 'anonymous' };

  const userId = auth.user.id;
  const [profile, roles, reviewers] = await Promise.all([
    supabase
      .from('users')
      .select(
        'email, display_name, honorific, preferred_locale, deactivated_at, terms_version, terms_accepted_at, onboarding_dismissed_at',
      )
      .eq('id', userId)
      .maybeSingle(),
    supabase.from('user_roles').select('role, board_id, school_id').eq('user_id', userId),
    supabase
      .from('library_reviewers')
      .select('board_id, approves_content, reviews_faith')
      .eq('user_id', userId),
  ]);
  if (!profile.data || profile.data.deactivated_at) return { status: 'inactive' };

  const roleRows = roles.data ?? [];
  const schoolIds = [
    ...new Set(roleRows.map((r) => r.school_id).filter((id): id is string => id !== null)),
  ];
  const boardIds = [...new Set(roleRows.map((r) => r.board_id))];

  const [schools, boards, entitlements] = await Promise.all([
    schoolIds.length
      ? supabase
          .from('schools')
          .select(
            'id, board_id, name, short_name, timezone, schedule_type, cycle_length, student_alerts_enabled, ai_enabled, settings',
          )
          .in('id', schoolIds)
          .order('name')
      : Promise.resolve({ data: [] as never[] }),
    boardIds.length
      ? supabase.from('boards').select('id, name, settings').in('id', boardIds)
      : Promise.resolve({ data: [] as never[] }),
    schoolIds.length
      ? supabase
          .from('module_entitlements')
          .select('school_id, module, enabled, valid_from, valid_until')
          .in('school_id', schoolIds)
      : Promise.resolve({ data: [] as never[] }),
  ]);

  const session: SessionContext = {
    userId,
    email: profile.data.email,
    displayName: profile.data.display_name,
    honorific: profile.data.honorific,
    preferredLocale: profile.data.preferred_locale,
    termsVersion: profile.data.terms_version,
    termsAcceptedAt: profile.data.terms_accepted_at,
    onboardingDismissedAt: profile.data.onboarding_dismissed_at,
    roles: roleRows.map((r) => ({ role: r.role, boardId: r.board_id, schoolId: r.school_id })),
    schools: (schools.data ?? []).map((s) => {
      const today = localDateIn(s.timezone);
      return {
        id: s.id,
        boardId: s.board_id,
        name: s.name,
        shortName: s.short_name,
        timezone: s.timezone,
        scheduleType: s.schedule_type,
        cycleLength: s.cycle_length,
        studentAlertsEnabled: s.student_alerts_enabled,
        aiEnabled: s.ai_enabled,
        settings: parseSchoolSettings(s.settings),
        modules: (entitlements.data ?? [])
          .filter(
            (e) =>
              e.school_id === s.id &&
              e.enabled &&
              e.valid_from <= today &&
              (e.valid_until === null || e.valid_until >= today),
          )
          .map((e) => e.module),
        roles: roleRows.filter((r) => r.school_id === s.id).map((r) => r.role),
      };
    }),
    boards: (boards.data ?? []).map((b) => ({
      id: b.id,
      name: b.name,
      settings: parseBoardSettings(b.settings),
      isAdmin: roleRows.some((r) => r.board_id === b.id && r.role === 'board_admin'),
    })),
    libraryReviewer: (reviewers.data ?? [])
      .filter((r) =>
        roleRows.some((role) => role.board_id === r.board_id && role.role !== 'parent'),
      )
      .map((r) => ({
        boardId: r.board_id,
        approvesContent: r.approves_content,
        reviewsFaith: r.reviews_faith,
      })),
  };
  return { status: 'active', session };
});

export async function getSession(): Promise<SessionContext | null> {
  const state = await loadSessionState();
  return state.status === 'active' ? state.session : null;
}

/** For pages and actions that require a signed-in, active user. */
export async function requireSession(): Promise<SessionContext> {
  const state = await loadSessionState();
  if (state.status === 'anonymous') redirect('/login');
  if (state.status === 'inactive') redirect('/auth/no-access');
  return state.session;
}

export const hasRole = (school: SchoolContext, ...roles: AppRole[]) =>
  school.roles.some((r) => roles.includes(r));

export const hasModule = (school: SchoolContext, module: ModuleKey) =>
  school.modules.includes(module);

/** Schools where the user teaches and the Teaching module is licensed. */
export const teachingSchools = (session: SessionContext) =>
  session.schools.filter((s) => hasRole(s, 'teacher') && hasModule(s, 'teaching'));

/**
 * Schools whose « Suppléances » board the user sees: direction and office staff, where the
 * Teaching module is licensed (DECISIONS D-056, D-060).
 */
export const substituteBoardSchools = (session: SessionContext) =>
  session.schools.filter(
    (s) => hasRole(s, 'principal', 'vice_principal', 'office_admin') && hasModule(s, 'teaching'),
  );

/** Whether a school's AI is on: its principal turned it on and its board allows AI. */
export const aiOn = (session: SessionContext, school: SchoolContext) =>
  school.aiEnabled &&
  (session.boards.find((b) => b.id === school.boardId)?.settings.ai.allowed ?? true);

/** Schools where the user may use AI features (teachers and direction). */
export const aiSchools = (session: SessionContext) =>
  session.schools.filter((s) => hasRole(s, 'teacher', 'principal', 'vice_principal'));

/**
 * Schools where the user may use the library (« Banque de ressources », DECISIONS D-078):
 * teachers and direction, where the Library module is licensed. Office staff have no library
 * screens.
 */
export const librarySchools = (session: SessionContext) =>
  session.schools.filter(
    (s) => hasModule(s, 'library') && hasRole(s, 'teacher', 'principal', 'vice_principal'),
  );

/** Library pages and navigation: a library school, or a reviewer designation (D-078). */
export const showLibrary = (session: SessionContext) =>
  librarySchools(session).length > 0 || session.libraryReviewer.length > 0;

export const findSchool = (session: SessionContext, schoolId: string) =>
  session.schools.find((s) => s.id === schoolId) ?? null;

/**
 * Schools the user directs, as principal or vice-principal: « Direction » and the audit log
 * (DECISIONS D-102, D-103). Whatever modules the school has.
 */
export const directionSchools = (session: SessionContext) =>
  session.schools.filter((s) => hasRole(s, 'principal', 'vice_principal'));

/** Boards the user administers: « Conseil » and the board's audit log (D-103, D-107). */
export const adminBoards = (session: SessionContext) => session.boards.filter((b) => b.isAdmin);

/**
 * Where the user lands after signing in, and from « Aujourd'hui » when not teaching (D-118):
 * teachers « Aujourd'hui », the direction « Direction », office staff « Suppléances », board
 * admins « Conseil », anyone else « Calendrier » (`lib/landing.ts`).
 */
export const landingFor = (session: SessionContext): LandingPath =>
  landingPath({
    teaches: teachingSchools(session).length > 0,
    directs: directionSchools(session).length > 0,
    seesSubstituteBoard: substituteBoardSchools(session).length > 0,
    administersBoard: adminBoards(session).length > 0,
  });
