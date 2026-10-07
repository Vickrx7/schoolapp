import 'server-only';
import type { Json } from '@lynx/db';
import {
  AUDIT_EXPORT_LIMIT,
  auditRpcFilters,
  type AuditFilters,
  type AuditScope,
  type AuditScopes,
} from '../audit/filters';
import { parseAuditRows, type AuditRow } from '../audit/rows';
import { adminBoards, directionSchools, type SessionContext } from '../session';
import { createSupabaseServerClient } from '../supabase';

/**
 * « Journal d'audit » (DECISIONS D-103), read as the signed-in person through
 * `list_audit_entries`, the only reader of the log: the database decides which entries and which
 * labels the person may see. These loaders only choose the scope and the page.
 */

/**
 * Where the person may read the log: the schools they direct (principal or vice-principal) and
 * the boards they administer, with each board's schools (for « École » in the board's view).
 */
export async function loadAuditScopes(session: SessionContext): Promise<AuditScopes> {
  const schools = directionSchools(session).map((s) => ({
    id: s.id,
    name: s.name,
    boardId: s.boardId,
    timezone: s.timezone,
  }));
  const admin = adminBoards(session);
  if (admin.length === 0) return { schools, boards: [] };
  const supabase = await createSupabaseServerClient();
  const ids = admin.map((b) => b.id);
  const [boards, boardSchools] = await Promise.all([
    supabase.from('boards').select('id, name, default_timezone').in('id', ids),
    supabase.from('schools').select('id, name, board_id').in('board_id', ids).order('name'),
  ]);
  return {
    schools,
    boards: admin.map((b) => {
      const row = (boards.data ?? []).find((r) => r.id === b.id);
      return {
        id: b.id,
        name: row?.name ?? b.name,
        timezone: row?.default_timezone ?? 'America/Toronto',
        schools: (boardSchools.data ?? [])
          .filter((s) => s.board_id === b.id)
          .map((s) => ({ id: s.id, name: s.name })),
      };
    }),
  };
}

export interface AuditPerson {
  id: string;
  name: string;
}

/**
 * « Personne »: the staff of the scope (a school's, or a board's), as row level security lets the
 * person read them. Former staff are not offered; their entries stay in the list.
 */
export async function loadAuditPeople(scope: AuditScope): Promise<AuditPerson[]> {
  const supabase = await createSupabaseServerClient();
  const roles =
    scope.kind === 'school' || scope.schoolId
      ? await supabase
          .from('user_roles')
          .select('user_id')
          .eq('school_id', scope.schoolId!)
          .neq('role', 'parent')
      : await supabase
          .from('user_roles')
          .select('user_id')
          .eq('board_id', scope.boardId)
          .neq('role', 'parent');
  const ids = [...new Set((roles.data ?? []).map((r) => r.user_id))];
  if (ids.length === 0) return [];
  const { data } = await supabase.from('users').select('id, display_name').in('id', ids);
  return (data ?? [])
    .map((u) => ({ id: u.id, name: u.display_name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

/** One call of the viewer's function. Errors throw: the page shows its error panel. */
async function listEntries(
  filters: Record<string, unknown>,
  before: number | null,
  limit: number,
): Promise<AuditRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('list_audit_entries', {
    p_filters: filters as Json,
    // Generated types show the optional bigint as a number; null means « from the newest ».
    p_before_id: before as number,
    p_limit: limit,
  });
  if (error) throw new Error(`list_audit_entries: ${error.code ?? 'error'}`);
  return parseAuditRows(data);
}

/** A page of entries, newest first, and whether older ones exist. */
export async function loadAuditPage(
  filters: AuditFilters,
  scopes: AuditScopes,
  pageSize: number,
): Promise<{ rows: AuditRow[]; hasMore: boolean }> {
  const rows = await listEntries(
    { ...auditRpcFilters(filters, scopes) },
    filters.before,
    pageSize + 1,
  );
  return { rows: rows.slice(0, pageSize), hasMore: rows.length > pageSize };
}

/** The latest entries for the direction's dashboard (« Accès aux alertes »). */
export async function loadRecentAuditEntries(
  rpcFilters: Record<string, unknown>,
  limit: number,
): Promise<AuditRow[]> {
  return listEntries(rpcFilters, null, limit);
}

/** Every entry of the filters' period for the CSV, newest first, at most 10,000. */
export async function loadAuditExport(
  filters: AuditFilters,
  scopes: AuditScopes,
): Promise<AuditRow[]> {
  const rpcFilters = { ...auditRpcFilters(filters, scopes) };
  const rows: AuditRow[] = [];
  let before: number | null = null;
  while (rows.length < AUDIT_EXPORT_LIMIT) {
    const size = Math.min(1000, AUDIT_EXPORT_LIMIT - rows.length);
    const page = await listEntries(rpcFilters, before, size);
    rows.push(...page);
    if (page.length < size) break;
    before = page.at(-1)!.id;
  }
  return rows;
}

/**
 * Records the export (`audit_log.exported`, read by the school's direction and the board's admins)
 * once the file is built. Throws when it cannot: an export that is not recorded is not sent.
 */
export async function logAuditExport(
  filters: AuditFilters,
  scopes: AuditScopes,
  rows: number,
): Promise<void> {
  const rpc = auditRpcFilters(filters, scopes);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('log_audit_export', {
    // Generated types show nullable uuid arguments as strings.
    p_board_id: (filters.scope.kind === 'board' ? filters.scope.boardId : null) as string,
    p_school_id: (rpc.schoolId ?? null) as string,
    p_filters: { category: rpc.category ?? null, from: rpc.from, to: rpc.to } as Json,
    p_rows: rows,
  });
  if (error) throw new Error(`log_audit_export: ${error.code ?? 'error'}`);
}
