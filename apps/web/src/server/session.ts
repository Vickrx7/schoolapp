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
  settings: SchoolSettings;
  modules: ModuleKey[];
  roles: AppRole[];
}

export interface SessionContext {
  userId: string;
  email: string;
  displayName: string;
  honorific: string | null;
  roles: { role: AppRole; boardId: string; schoolId: string | null }[];
  schools: SchoolContext[];
  boards: { id: string; name: string; settings: BoardSettings; isAdmin: boolean }[];
}

/** The signed-in user's profile, roles, schools and licensed modules (once per request). */
export const getSession = cache(async (): Promise<SessionContext | null> => {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const userId = auth.user.id;
  const [profile, roles] = await Promise.all([
    supabase
      .from('users')
      .select('email, display_name, honorific, deactivated_at')
      .eq('id', userId)
      .maybeSingle(),
    supabase.from('user_roles').select('role, board_id, school_id').eq('user_id', userId),
  ]);
  if (!profile.data || profile.data.deactivated_at) return null;

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
            'id, board_id, name, short_name, timezone, schedule_type, cycle_length, student_alerts_enabled, settings',
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

  return {
    userId,
    email: profile.data.email,
    displayName: profile.data.display_name,
    honorific: profile.data.honorific,
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
  };
});

/** For pages and actions that require a signed-in user. */
export async function requireSession(): Promise<SessionContext> {
  const session = await getSession();
  if (!session) redirect('/login');
  return session;
}

export const hasRole = (school: SchoolContext, ...roles: AppRole[]) =>
  school.roles.some((r) => roles.includes(r));

export const hasModule = (school: SchoolContext, module: ModuleKey) =>
  school.modules.includes(module);

/** Schools where the user teaches and the Teaching module is licensed. */
export const teachingSchools = (session: SessionContext) =>
  session.schools.filter((s) => hasRole(s, 'teacher') && hasModule(s, 'teaching'));

export const findSchool = (session: SessionContext, schoolId: string) =>
  session.schools.find((s) => s.id === schoolId) ?? null;
