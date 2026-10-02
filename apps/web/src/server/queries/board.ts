import 'server-only';
import type { AppRole, ModuleKey, ScheduleType } from '@lynx/db';
import {
  localDateIn,
  parseSchoolSettings,
  REPORT_PERIOD_KINDS,
  type BoardSettings,
  type LocalDate,
  type ReportPeriod,
  type ReportPeriodKind,
  type SchoolSettings,
} from '@lynx/domain';
import { cache } from 'react';
import { z } from 'zod';
import { notFound, redirect } from 'next/navigation';
import { adminBoards, landingFor, requireSession, type SessionContext } from '../session';
import { createSupabaseServerClient } from '../supabase';

/**
 * « Conseil » (DECISIONS D-107, D-108, D-112): what a board's admins see of their board, read as
 * the signed-in admin (row level security and the board admins' definer functions). Never a
 * student, a teacher's planning or anyone's AI use (D-013, D-104).
 */

export interface AdminBoard {
  id: string;
  name: string;
  settings: BoardSettings;
}

/** The board a « Conseil » page shows: `?board=` when the person administers it, else the first. */
export function pickAdminBoard(
  session: SessionContext,
  requested: string | string[] | null | undefined,
): AdminBoard | null {
  const boards = adminBoards(session);
  const wanted = typeof requested === 'string' ? requested : null;
  return boards.find((b) => b.id === wanted) ?? boards[0] ?? null;
}

/** `?board=…` for links between « Conseil » pages, only when the person administers several. */
export function boardQuery(session: SessionContext, boardId: string): string {
  return adminBoards(session).length > 1 ? `?board=${boardId}` : '';
}

export interface BoardSchool {
  id: string;
  name: string;
  shortName: string | null;
  timezone: string;
  scheduleType: ScheduleType;
  cycleLength: number | null;
  studentAlertsEnabled: boolean;
  aiEnabled: boolean;
  settings: SchoolSettings;
  /** Licensed and valid today (school-local), as in the session. */
  modules: ModuleKey[];
}

export interface BoardBasics {
  id: string;
  name: string;
  timezone: string;
  schools: BoardSchool[];
}

/** The board and its schools (once per request). */
export const loadBoardBasics = cache(async (boardId: string): Promise<BoardBasics | null> => {
  const supabase = await createSupabaseServerClient();
  const [board, schools] = await Promise.all([
    supabase.from('boards').select('id, name, default_timezone').eq('id', boardId).maybeSingle(),
    supabase
      .from('schools')
      .select(
        'id, name, short_name, timezone, schedule_type, cycle_length, student_alerts_enabled, ai_enabled, settings',
      )
      .eq('board_id', boardId)
      .order('name'),
  ]);
  if (!board.data) return null;
  const schoolRows = schools.data ?? [];
  const { data: entitlements } = schoolRows.length
    ? await supabase
        .from('module_entitlements')
        .select('school_id, module, enabled, valid_from, valid_until')
        .in(
          'school_id',
          schoolRows.map((s) => s.id),
        )
    : { data: [] };
  return {
    id: board.data.id,
    name: board.data.name,
    timezone: board.data.default_timezone,
    schools: schoolRows.map((s) => {
      const today = localDateIn(s.timezone);
      return {
        id: s.id,
        name: s.name,
        shortName: s.short_name,
        timezone: s.timezone,
        scheduleType: s.schedule_type,
        cycleLength: s.cycle_length,
        studentAlertsEnabled: s.student_alerts_enabled,
        aiEnabled: s.ai_enabled,
        settings: parseSchoolSettings(s.settings),
        modules: (entitlements ?? [])
          .filter(
            (e) =>
              e.school_id === s.id &&
              e.enabled &&
              e.valid_from <= today &&
              (e.valid_until === null || e.valid_until >= today),
          )
          .map((e) => e.module),
      };
    }),
  };
});

export interface BoardPage {
  session: SessionContext;
  board: AdminBoard;
  boards: AdminBoard[];
  basics: BoardBasics;
  /** `?board=…` for links between « Conseil » pages (empty with a single board). */
  query: string;
  /** A school of the board has the Library module. */
  library: boolean;
}

/**
 * What every « Conseil » page starts with: the signed-in board admin and the board shown. People
 * who administer no board get « Page introuvable », or their own landing page at `/board`.
 */
export async function requireBoardPage(
  requested: string | string[] | undefined,
  { landing = false }: { landing?: boolean } = {},
): Promise<BoardPage> {
  const session = await requireSession();
  const board = pickAdminBoard(session, requested);
  if (!board) {
    if (landing) redirect(landingFor(session));
    notFound();
  }
  const basics = await loadBoardBasics(board.id);
  if (!basics) notFound();
  return {
    session,
    board,
    boards: adminBoards(session),
    basics,
    query: boardQuery(session, board.id),
    library: boardHasLibrary(basics),
  };
}

/** Whether a school's contact details are filled in (the office phone substitutes call). */
export const hasContact = (school: BoardSchool) => Boolean(school.settings.contact.officePhone);

export const boardHasLibrary = (basics: BoardBasics) =>
  basics.schools.some((s) => s.modules.includes('library'));

// ---------------------------------------------------------------------------------------
// « Aperçu »
// ---------------------------------------------------------------------------------------

export type ChecklistKey =
  'year' | 'reportPeriods' | 'contact' | 'staff' | 'calendar' | 'reviewers';

export interface ChecklistItem {
  key: ChecklistKey;
  done: boolean;
  href: string;
}

const componentSchema = z.object({ ok: z.boolean(), at: z.string().nullable() });
const systemStatusSchema = z.object({
  state: z.enum(['ok', 'problem']),
  worker: componentSchema,
  backup: componentSchema,
  retention: componentSchema,
});
export type SystemStatus = z.infer<typeof systemStatusSchema>;

export interface BoardOverview {
  checklist: ChecklistItem[];
  /** Null when it could not be read (the card says so). */
  status: SystemStatus | null;
}

/**
 * « Pour bien démarrer le conseil », computed from the board's data: a school year that is not
 * over, its three report periods (D-124), every school's office phone, someone besides the
 * board's admins, a PA day or holiday still to come, and (with the Library module) someone who
 * approves resources. Then the « État du système » (`system_status()`: a state and three times,
 * never counts).
 */
export async function loadBoardOverview(
  basics: BoardBasics,
  query: string,
): Promise<BoardOverview> {
  const supabase = await createSupabaseServerClient();
  const today = localDateIn(basics.timezone);
  const library = boardHasLibrary(basics);
  const [years, periods, staff, events, reviewers, status] = await Promise.all([
    supabase
      .from('school_years')
      .select('id', { count: 'exact', head: true })
      .eq('board_id', basics.id)
      .gte('ends_on', today),
    supabase
      .from('report_periods')
      .select('school_year_id, kind, school_years!inner(board_id, ends_on)')
      .eq('school_years.board_id', basics.id)
      .gte('school_years.ends_on', today),
    supabase
      .from('user_roles')
      .select('id', { count: 'exact', head: true })
      .eq('board_id', basics.id)
      .neq('role', 'board_admin'),
    supabase
      .from('school_calendar_events')
      .select('id', { count: 'exact', head: true })
      .eq('board_id', basics.id)
      .in('event_type', ['pa_day', 'holiday'])
      .gte('ends_on', today),
    library
      ? supabase
          .from('library_reviewers')
          .select('user_id', { count: 'exact', head: true })
          .eq('board_id', basics.id)
          .eq('approves_content', true)
      : Promise.resolve({ count: 0 }),
    supabase.rpc('system_status'),
  ]);
  const parsed = systemStatusSchema.safeParse(status.data);
  // A year that is not over with its three periods.
  const kindsByYear = new Map<string, Set<string>>();
  for (const p of periods.data ?? []) {
    kindsByYear.set(p.school_year_id, (kindsByYear.get(p.school_year_id) ?? new Set()).add(p.kind));
  }
  const checklist: ChecklistItem[] = [
    { key: 'year', done: (years.count ?? 0) > 0, href: `/board/years${query}` },
    {
      key: 'reportPeriods',
      done: [...kindsByYear.values()].some((kinds) => kinds.size === REPORT_PERIOD_KINDS.length),
      href: `/board/years${query}`,
    },
    {
      key: 'contact',
      done: basics.schools.length > 0 && basics.schools.every(hasContact),
      href: `/board/schools${query}`,
    },
    { key: 'staff', done: (staff.count ?? 0) > 0, href: `/board/staff${query}` },
    { key: 'calendar', done: (events.count ?? 0) > 0, href: '/calendar' },
  ];
  if (library) {
    checklist.push({
      key: 'reviewers',
      done: (reviewers.count ?? 0) > 0,
      href: `/board/reviewers${query}`,
    });
  }
  return { checklist, status: status.error || !parsed.success ? null : parsed.data };
}

// ---------------------------------------------------------------------------------------
// « Personnel »
// ---------------------------------------------------------------------------------------

export type StaffStatus = 'active' | 'neverSignedIn' | 'removed';

export interface StaffRoleRow {
  id: string;
  role: AppRole;
  schoolId: string | null;
  /** The school's short name (« É.É.C. Saint-Exemple »), or null for a board-wide role. */
  schoolName: string | null;
}

export interface StaffPerson {
  userId: string;
  displayName: string;
  honorific: string | null;
  email: string;
  status: StaffStatus;
  roles: StaffRoleRow[];
}

export interface PendingInvitation {
  id: string;
  displayName: string;
  email: string;
  role: AppRole;
  schoolName: string | null;
  status: 'pending' | 'failed';
  errorCode: string | null;
  createdAt: string;
}

export interface BoardStaff {
  people: StaffPerson[];
  invitations: PendingInvitation[];
}

const ROLE_ORDER: Record<string, number> = {
  board_admin: 0,
  principal: 1,
  vice_principal: 2,
  teacher: 3,
  office_admin: 4,
  facilities: 5,
  parent: 6,
};

function sortRoles(roles: StaffRoleRow[]): StaffRoleRow[] {
  return [...roles].sort(
    (a, b) =>
      (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) ||
      (a.schoolName ?? '').localeCompare(b.schoolName ?? '', 'fr'),
  );
}

/**
 * Everyone with a role in the board (their roles there only), whether they ever signed in (never
 * when), and the invitations being prepared or that failed in the last 30 days.
 */
export async function loadBoardStaff(basics: BoardBasics): Promise<BoardStaff> {
  const supabase = await createSupabaseServerClient();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [roles, signIns, invitations] = await Promise.all([
    supabase
      .from('user_roles')
      .select('id, user_id, role, school_id')
      .eq('board_id', basics.id)
      .neq('role', 'parent'),
    supabase.rpc('board_staff_sign_ins', { p_board_id: basics.id }),
    supabase
      .from('staff_invitations')
      .select(
        'id, display_name, email, role, school_id, status, error_code, created_at, processed_at',
      )
      .eq('board_id', basics.id)
      .or(`status.eq.pending,and(status.eq.failed,processed_at.gte.${since})`)
      .order('created_at', { ascending: false }),
  ]);
  const roleRows = roles.data ?? [];
  const userIds = [...new Set(roleRows.map((r) => r.user_id))];
  const { data: users } = userIds.length
    ? await supabase
        .from('users')
        .select('id, display_name, honorific, email, deactivated_at')
        .in('id', userIds)
    : { data: [] };
  const schoolName = new Map(basics.schools.map((s) => [s.id, s.shortName ?? s.name]));
  const signedIn = new Map((signIns.data ?? []).map((r) => [r.user_id, r.has_signed_in]));

  const people: StaffPerson[] = (users ?? [])
    .map((u) => ({
      userId: u.id,
      displayName: u.display_name,
      honorific: u.honorific,
      email: u.email,
      status: (u.deactivated_at
        ? 'removed'
        : signedIn.get(u.id) === false
          ? 'neverSignedIn'
          : 'active') as StaffStatus,
      roles: sortRoles(
        roleRows
          .filter((r) => r.user_id === u.id)
          .map((r) => ({
            id: r.id,
            role: r.role,
            schoolId: r.school_id,
            schoolName: r.school_id ? (schoolName.get(r.school_id) ?? null) : null,
          })),
      ),
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'fr'));

  return {
    people,
    invitations: (invitations.data ?? []).map((i) => ({
      id: i.id,
      displayName: i.display_name,
      email: i.email,
      role: i.role,
      schoolName: i.school_id ? (schoolName.get(i.school_id) ?? null) : null,
      status: i.status === 'failed' ? 'failed' : 'pending',
      errorCode: i.error_code,
      createdAt: i.created_at,
    })),
  };
}

export interface StaffPersonDetail extends StaffPerson {
  /** Designated to approve the board's resources (D-064). */
  reviewer: boolean;
}

/** One person of the board: null unless they hold a role in it. */
export async function loadStaffPerson(
  basics: BoardBasics,
  userId: string,
): Promise<StaffPersonDetail | null> {
  const supabase = await createSupabaseServerClient();
  const [user, roles, signIns, reviewer] = await Promise.all([
    supabase
      .from('users')
      .select('id, display_name, honorific, email, deactivated_at')
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('user_roles')
      .select('id, role, school_id')
      .eq('board_id', basics.id)
      .eq('user_id', userId)
      .neq('role', 'parent'),
    supabase.rpc('board_staff_sign_ins', { p_board_id: basics.id }),
    supabase
      .from('library_reviewers')
      .select('user_id')
      .eq('board_id', basics.id)
      .eq('user_id', userId)
      .maybeSingle(),
  ]);
  if (!user.data || !roles.data?.length) return null;
  const schoolName = new Map(basics.schools.map((s) => [s.id, s.shortName ?? s.name]));
  const signedIn = (signIns.data ?? []).find((r) => r.user_id === userId)?.has_signed_in;
  return {
    userId: user.data.id,
    displayName: user.data.display_name,
    honorific: user.data.honorific,
    email: user.data.email,
    status: user.data.deactivated_at ? 'removed' : signedIn === false ? 'neverSignedIn' : 'active',
    roles: sortRoles(
      roles.data.map((r) => ({
        id: r.id,
        role: r.role,
        schoolId: r.school_id,
        schoolName: r.school_id ? (schoolName.get(r.school_id) ?? null) : null,
      })),
    ),
    reviewer: Boolean(reviewer.data),
  };
}

export interface InvitationView {
  id: string;
  boardId: string;
  displayName: string;
  email: string;
  role: AppRole;
  schoolName: string | null;
  status: 'pending' | 'ready' | 'failed' | 'cancelled';
  errorCode: string | null;
  /** The person already had an account in the board: the role was given at once. */
  immediate: boolean;
}

/** An invitation of a board the person administers (row level security), or null. */
export async function loadInvitation(invitationId: string): Promise<InvitationView | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('staff_invitations')
    .select(
      'id, board_id, display_name, email, role, status, error_code, created_at, processed_at, schools(name)',
    )
    .eq('id', invitationId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    boardId: data.board_id,
    displayName: data.display_name,
    email: data.email,
    role: data.role,
    schoolName: data.schools?.name ?? null,
    status: data.status as InvitationView['status'],
    errorCode: data.error_code,
    // invite_staff stamps both in one transaction when it grants the role itself; the worker
    // completes later.
    immediate: data.status === 'ready' && data.processed_at === data.created_at,
  };
}

// ---------------------------------------------------------------------------------------
// « Années scolaires », « Approbation des ressources »
// ---------------------------------------------------------------------------------------

export interface BoardYear {
  id: string;
  name: string;
  startsOn: LocalDate;
  endsOn: LocalDate;
  /** Its report periods (D-124), in the order of the kinds. */
  periods: ReportPeriod[];
}

const isKind = (kind: string): kind is ReportPeriodKind =>
  (REPORT_PERIOD_KINDS as readonly string[]).includes(kind);

export async function loadBoardYears(boardId: string): Promise<BoardYear[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('school_years')
    .select(
      'id, name, starts_on, ends_on, report_periods(kind, starts_on, ends_on, due_on, issued_on)',
    )
    .eq('board_id', boardId)
    .order('starts_on', { ascending: false });
  return (data ?? []).map((y) => ({
    id: y.id,
    name: y.name,
    startsOn: y.starts_on,
    endsOn: y.ends_on,
    periods: y.report_periods
      .flatMap((p) =>
        isKind(p.kind)
          ? [
              {
                kind: p.kind,
                startsOn: p.starts_on,
                endsOn: p.ends_on,
                dueOn: p.due_on,
                issuedOn: p.issued_on,
              },
            ]
          : [],
      )
      .sort((a, b) => REPORT_PERIOD_KINDS.indexOf(a.kind) - REPORT_PERIOD_KINDS.indexOf(b.kind)),
  }));
}

export interface ReviewerRow {
  /** One of the person's roles in the board: how `set_library_reviewer` names them. */
  roleId: string;
  userId: string;
  displayName: string;
  approvesContent: boolean;
  reviewsFaith: boolean;
}

export interface BoardReviewers {
  reviewers: ReviewerRow[];
  /** Active staff of the board who are not designated yet. */
  candidates: { roleId: string; userId: string; displayName: string }[];
}

export async function loadReviewers(boardId: string): Promise<BoardReviewers> {
  const supabase = await createSupabaseServerClient();
  const [designations, roles] = await Promise.all([
    supabase
      .from('library_reviewers')
      .select('user_id, approves_content, reviews_faith')
      .eq('board_id', boardId),
    supabase
      .from('user_roles')
      .select('id, user_id, role')
      .eq('board_id', boardId)
      .neq('role', 'parent')
      .order('created_at'),
  ]);
  const roleRows = roles.data ?? [];
  const userIds = [...new Set(roleRows.map((r) => r.user_id))];
  const { data: users } = userIds.length
    ? await supabase.from('users').select('id, display_name, deactivated_at').in('id', userIds)
    : { data: [] };
  const userById = new Map((users ?? []).map((u) => [u.id, u]));
  const roleOf = new Map<string, string>();
  for (const r of roleRows) if (!roleOf.has(r.user_id)) roleOf.set(r.user_id, r.id);
  const designated = new Map((designations.data ?? []).map((d) => [d.user_id, d]));
  const byName = (a: { displayName: string }, b: { displayName: string }) =>
    a.displayName.localeCompare(b.displayName, 'fr');
  return {
    reviewers: [...designated.values()]
      .filter((d) => roleOf.has(d.user_id) && userById.has(d.user_id))
      .map((d) => ({
        roleId: roleOf.get(d.user_id)!,
        userId: d.user_id,
        displayName: userById.get(d.user_id)!.display_name,
        approvesContent: d.approves_content,
        reviewsFaith: d.reviews_faith,
      }))
      .sort(byName),
    candidates: [...roleOf.entries()]
      .filter(
        ([userId]) => !designated.has(userId) && userById.get(userId)?.deactivated_at === null,
      )
      .map(([userId, roleId]) => ({
        roleId,
        userId,
        displayName: userById.get(userId)!.display_name,
      }))
      .sort(byName),
  };
}

// ---------------------------------------------------------------------------------------
// « Utilisation de l'IA »
// ---------------------------------------------------------------------------------------

export interface UsageRow {
  /** Null for the board's bulk generation (D-096). */
  schoolId: string | null;
  schoolName: string | null;
  requests: number;
  failed: number;
  costUsd: number;
}

/** Per school (every school, zeros included) and the bulk line when it has requests (D-104). */
export async function loadBoardUsage(basics: BoardBasics, month: string): Promise<UsageRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('board_ai_usage', {
    p_board_id: basics.id,
    p_month: month,
  });
  if (error) throw new Error(`board_ai_usage: ${error.code ?? 'error'}`);
  const schoolName = new Map(basics.schools.map((s) => [s.id, s.name]));
  return (data ?? []).map((r) => ({
    schoolId: r.school_id,
    schoolName: r.school_id ? (schoolName.get(r.school_id) ?? null) : null,
    requests: Number(r.requests),
    failed: Number(r.failed),
    costUsd: Number(r.cost_usd),
  }));
}

// ---------------------------------------------------------------------------------------
// « Commentaires reçus »
// ---------------------------------------------------------------------------------------

export const FEEDBACK_STATUSES = ['new', 'read', 'done'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export interface FeedbackRow {
  id: string;
  kind: 'problem' | 'idea' | 'question';
  message: string;
  route: string | null;
  errorRef: string | null;
  release: string | null;
  device: 'phone' | 'tablet' | 'desktop' | null;
  status: FeedbackStatus;
  createdAt: string;
  schoolName: string | null;
  /** Shown only when the person agreed to be contacted. */
  sender: { name: string; email: string } | null;
  mayContact: boolean;
}

export async function loadFeedback(
  basics: BoardBasics,
  status: FeedbackStatus | null,
): Promise<FeedbackRow[]> {
  const supabase = await createSupabaseServerClient();
  let request = supabase
    .from('feedback')
    .select(
      'id, kind, message, route, error_ref, app_release, device, status, created_at, school_id, user_id, may_contact',
    )
    .eq('board_id', basics.id)
    .order('created_at', { ascending: false })
    .limit(200);
  if (status) request = request.eq('status', status);
  const { data } = await request;
  const rows = data ?? [];
  const senderIds = [
    ...new Set(rows.filter((r) => r.may_contact && r.user_id).map((r) => r.user_id!)),
  ];
  const { data: users } = senderIds.length
    ? await supabase.from('users').select('id, display_name, email').in('id', senderIds)
    : { data: [] };
  const userById = new Map((users ?? []).map((u) => [u.id, u]));
  const schoolName = new Map(basics.schools.map((s) => [s.id, s.name]));
  return rows.map((r) => {
    const sender = r.may_contact && r.user_id ? userById.get(r.user_id) : undefined;
    return {
      id: r.id,
      kind: r.kind as FeedbackRow['kind'],
      message: r.message,
      route: r.route,
      errorRef: r.error_ref,
      release: r.app_release,
      device: r.device as FeedbackRow['device'],
      status: r.status as FeedbackStatus,
      createdAt: r.created_at,
      schoolName: r.school_id ? (schoolName.get(r.school_id) ?? null) : null,
      sender: sender ? { name: sender.display_name, email: sender.email } : null,
      mayContact: r.may_contact,
    };
  });
}
