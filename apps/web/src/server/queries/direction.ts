import 'server-only';
import type { LibraryItemStatus, LibraryItemType, ShareScope } from '@lynx/db';
import { addDays, formalStaffName, localDateIn, type LocalDate } from '@lynx/domain';
import type { AiUsage } from '@/components/school/ai-school-card';
import { recentAlertFilters } from '../audit/filters';
import type { AuditRow } from '../audit/rows';
import { directionSchools, hasModule, type SchoolContext, type SessionContext } from '../session';
import { createSupabaseServerClient } from '../supabase';
import { loadRecentAuditEntries } from './audit';
import { loadSubBoard, type SubBoardDay } from './sub-office';

/**
 * « Tableau de bord de la direction » (DECISIONS D-102): per school the person directs, the
 * day's absences (the « Suppléances » rows), the library contributions of this school year, the
 * month's AI totals and the latest alert entries of the audit log. Everything is read as the
 * signed-in principal: row level security and the direction's definer functions decide. Never
 * units, lessons, progress, class-mode activity, or anything counted per teacher.
 */

export interface ContributionItem {
  id: string;
  title: string;
  type: LibraryItemType;
  status: LibraryItemStatus;
  shareScope: ShareScope;
  /** « Mme Tremblay », as on the item page; null when the person cannot read the author. */
  authorName: string | null;
  boardOwned: boolean;
  updatedAt: string;
}

export interface Contributions {
  /** The first day counted: the school year's start (or a year ago without one). */
  since: LocalDate;
  /** `since` is the start of the school year. */
  schoolYear: boolean;
  /** Reviewed by their author and shared with the school. */
  school: number;
  /** Reviewed by their author and shared with the whole board. */
  board: number;
  /** Approved by the board. */
  approved: number;
  /** The 10 latest of these. */
  latest: ContributionItem[];
}

export interface DirectionSchool {
  school: SchoolContext;
  /** The school's date. */
  today: LocalDate;
  /** Today (or the next school day) and the next school day; null without the Teaching module. */
  days: SubBoardDay[] | null;
  /** Null without the Library module. */
  contributions: Contributions | null;
  /** Null when the totals could not be read. */
  ai: AiUsage | null;
  /** The latest alert entries of the last 7 days (newest first, at most 5). */
  alerts: AuditRow[];
}

/** How far back « Accès aux alertes » looks, today included. */
export const ALERT_DAYS = 7;
const ALERT_ENTRIES = 5;
const LATEST_ITEMS = 10;

/** A local date's midnight in a time zone, for the database to read as an instant (D-009). */
const zonedMidnight = (date: LocalDate, timeZone: string) => `${date} 00:00:00 ${timeZone}`;

/** The start of the school's current (or latest begun) school year. */
async function schoolYearStart(
  school: SchoolContext,
  today: LocalDate,
): Promise<{ since: LocalDate; schoolYear: boolean }> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('school_years')
    .select('starts_on')
    .eq('board_id', school.boardId)
    .lte('starts_on', today)
    .order('starts_on', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data
    ? { since: data.starts_on, schoolYear: true }
    : { since: addDays(today, -364), schoolYear: false };
}

/**
 * « Contributions à la banque de ressources »: how many of the school's resources were shared
 * with the school or the board after their author's review, and how many the board approved,
 * updated since the year began; then the 10 latest. Private drafts are never counted (the
 * direction cannot read them anyway).
 */
async function loadContributions(school: SchoolContext, today: LocalDate): Promise<Contributions> {
  const supabase = await createSupabaseServerClient();
  const { since, schoolYear } = await schoolYearStart(school, today);
  const from = zonedMidnight(since, school.timezone);
  const base = () =>
    supabase
      .from('library_items')
      .select('id', { count: 'exact', head: true })
      .eq('school_id', school.id)
      .gte('updated_at', from);
  const [shared, boardShared, approved, latest] = await Promise.all([
    base().eq('status', 'teacher_reviewed').eq('share_scope', 'school'),
    base().eq('status', 'teacher_reviewed').eq('share_scope', 'board'),
    base().eq('status', 'board_approved'),
    supabase
      .from('library_items')
      .select(
        'id, title, type, status, share_scope, board_owned, updated_at, author:users!library_items_author_id_fkey(display_name, honorific)',
      )
      .eq('school_id', school.id)
      .gte('updated_at', from)
      .or('and(status.eq.teacher_reviewed,share_scope.in.(school,board)),status.eq.board_approved')
      .order('updated_at', { ascending: false })
      .limit(LATEST_ITEMS),
  ]);
  return {
    since,
    schoolYear,
    school: shared.count ?? 0,
    board: boardShared.count ?? 0,
    approved: approved.count ?? 0,
    latest: (latest.data ?? []).map((item) => ({
      id: item.id,
      title: item.title,
      type: item.type,
      status: item.status,
      shareScope: item.share_scope,
      authorName: item.author
        ? formalStaffName(item.author.display_name, item.author.honorific)
        : null,
      boardOwned: item.board_owned,
      updatedAt: item.updated_at,
    })),
  };
}

/** The month's AI totals of the school (`ai_usage_summary`, the direction's function). */
async function loadAiUsage(school: SchoolContext): Promise<AiUsage | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('ai_usage_summary', { p_school_id: school.id });
  const row = data?.[0];
  if (error || !row) return null;
  return {
    spent: Number(row.school_spent_usd),
    allowance: Number(row.allowance_usd),
    poolSpent: Number(row.pool_spent_usd),
    poolTotal: Number(row.pool_usd),
    pooling: row.pooling,
    available: row.available,
    requests: Number(row.requests_this_month),
  };
}

export async function loadDirectionDashboard(session: SessionContext): Promise<DirectionSchool[]> {
  return Promise.all(
    directionSchools(session).map(async (school) => {
      const today = localDateIn(school.timezone);
      const [days, contributions, ai, alerts] = await Promise.all([
        hasModule(school, 'teaching') ? loadSubBoard(school, today, { access: false }) : null,
        hasModule(school, 'library') ? loadContributions(school, today) : null,
        loadAiUsage(school),
        loadRecentAuditEntries(
          { ...recentAlertFilters(school.id, addDays(today, -(ALERT_DAYS - 1)), school.timezone) },
          ALERT_ENTRIES,
        ),
      ]);
      return { school, today, days, contributions, ai, alerts };
    }),
  );
}
