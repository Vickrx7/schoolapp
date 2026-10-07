/**
 * « Journal d'audit » in the address (DECISIONS D-103): `/audit?school&board&from&to&category&
 * actor&type&entity&before`, read back into filters and written into links. Reading never fails:
 * a value that is not valid (an unknown category, an id that is not an id, a school the person
 * does not direct) is dropped or replaced by its default, so an old or hand-edited link still
 * opens. Pure (no server-only import): unit tested, and the filter form uses it in the browser.
 *
 * Scope: a school the person directs (`school`), or a board the person administers (`board`,
 * optionally narrowed to one of its schools with `school`). The period is a range of the scope's
 * local dates, `from` and `to` included (default the last 30 days, at most 365 so that a period
 * crossing a daylight-saving change stays inside the database's 366-day bound); the database turns
 * them into instants (D-009).
 */
import { addDays, daysBetween, isLocalDate, localDateIn, type LocalDate } from '@lynx/domain';
import { AUDIT_ACTOR_TYPES, type AuditActorType } from './rows';

export const AUDIT_CATEGORIES = [
  'alerts',
  'substitute',
  'access',
  'settings',
  'classes',
  'library',
  'audit',
  'system',
] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

/**
 * The categories a school's direction reads (catalogue audiences `direction` and
 * `direction_board`) and those a board's admins read (`direction_board` and `board`). The
 * catalogue test checks both against the migrations.
 */
export const DIRECTION_CATEGORIES: readonly AuditCategory[] = [
  'alerts',
  'substitute',
  'access',
  'settings',
  'classes',
  'audit',
];
export const BOARD_CATEGORIES: readonly AuditCategory[] = [
  'alerts',
  'access',
  'settings',
  'library',
  'audit',
  'system',
];

/** Entries per page (« Entrées plus anciennes » pages by id). */
export const AUDIT_PAGE_SIZE = 50;
/** At most this many entries in one CSV file (D-103). */
export const AUDIT_EXPORT_LIMIT = 10_000;
/** The default period: the last 30 days, today included. */
export const DEFAULT_PERIOD_DAYS = 30;
/** The longest period, in days with both ends included. */
export const MAX_PERIOD_DAYS = 365;

export interface AuditScopeSchool {
  id: string;
  name: string;
  boardId: string;
  timezone: string;
}

export interface AuditScopeBoard {
  id: string;
  name: string;
  timezone: string;
  schools: { id: string; name: string }[];
}

/** Where the person may read the log: schools they direct and boards they administer. */
export interface AuditScopes {
  schools: AuditScopeSchool[];
  boards: AuditScopeBoard[];
}

export type AuditScope =
  | { kind: 'school'; schoolId: string }
  | { kind: 'board'; boardId: string; schoolId: string | null };

export interface AuditFilters {
  scope: AuditScope;
  from: LocalDate;
  to: LocalDate;
  category: AuditCategory | null;
  /** An actor's user id (« Personne »). */
  actor: string | null;
  type: AuditActorType | null;
  /** One item's entries (a class, a plan, a person…). */
  entity: string | null;
  /** Keyset paging: entries older than this id. */
  before: number | null;
}

export type AuditSearchParams =
  URLSearchParams | Record<string, string | string[] | undefined> | null | undefined;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function param(params: AuditSearchParams, key: string): string | null {
  if (!params) return null;
  const value = params instanceof URLSearchParams ? params.get(key) : params[key];
  const one = Array.isArray(value) ? value[0] : value;
  const trimmed = typeof one === 'string' ? one.trim() : '';
  return trimmed === '' ? null : trimmed;
}

const uuidOrNull = (value: string | null) =>
  value && UUID_RE.test(value) ? value.toLowerCase() : null;

/** The scope a request asks for, or the person's first school, else first board. */
export function pickAuditScope(params: AuditSearchParams, scopes: AuditScopes): AuditScope | null {
  const school = uuidOrNull(param(params, 'school'));
  const board = uuidOrNull(param(params, 'board'));
  const adminBoard = board ? scopes.boards.find((b) => b.id === board) : undefined;
  if (adminBoard) {
    const inBoard = school && adminBoard.schools.some((s) => s.id === school) ? school : null;
    return { kind: 'board', boardId: adminBoard.id, schoolId: inBoard };
  }
  if (school) {
    if (scopes.schools.some((s) => s.id === school)) return { kind: 'school', schoolId: school };
    const owning = scopes.boards.find((b) => b.schools.some((s) => s.id === school));
    if (owning) return { kind: 'board', boardId: owning.id, schoolId: school };
  }
  if (scopes.schools[0]) return { kind: 'school', schoolId: scopes.schools[0].id };
  if (scopes.boards[0]) return { kind: 'board', boardId: scopes.boards[0].id, schoolId: null };
  return null;
}

/** The time zone the scope's dates are read in: the school's, or the board's. */
export function scopeTimeZone(scope: AuditScope, scopes: AuditScopes): string {
  if (scope.kind === 'school') {
    return scopes.schools.find((s) => s.id === scope.schoolId)?.timezone ?? 'America/Toronto';
  }
  return scopes.boards.find((b) => b.id === scope.boardId)?.timezone ?? 'America/Toronto';
}

/** The default period ending on `today`. */
export function defaultPeriod(today: LocalDate): { from: LocalDate; to: LocalDate } {
  return { from: addDays(today, -(DEFAULT_PERIOD_DAYS - 1)), to: today };
}

/**
 * The filters a request asks for, made valid: the scope (null when the person may read no log),
 * a period that ends no later than today and lasts at most 365 days, and the other filters when
 * well formed.
 */
export function parseAuditFilters(
  params: AuditSearchParams,
  scopes: AuditScopes,
  now: Date,
): AuditFilters | null {
  const scope = pickAuditScope(params, scopes);
  if (!scope) return null;
  const today = localDateIn(scopeTimeZone(scope, scopes), now);
  const fallback = defaultPeriod(today);

  const toParam = param(params, 'to');
  let to = toParam && isLocalDate(toParam) ? toParam : fallback.to;
  if (to > today) to = today;
  const fromParam = param(params, 'from');
  let from =
    fromParam && isLocalDate(fromParam) ? fromParam : addDays(to, -(DEFAULT_PERIOD_DAYS - 1));
  if (from > to) from = to;
  if (daysBetween(from, to) >= MAX_PERIOD_DAYS) from = addDays(to, -(MAX_PERIOD_DAYS - 1));

  const category = param(params, 'category');
  const type = param(params, 'type');
  const before = param(params, 'before');
  return {
    scope,
    from,
    to,
    category: (AUDIT_CATEGORIES as readonly string[]).includes(category ?? '')
      ? (category as AuditCategory)
      : null,
    actor: uuidOrNull(param(params, 'actor')),
    type: (AUDIT_ACTOR_TYPES as readonly string[]).includes(type ?? '')
      ? (type as AuditActorType)
      : null,
    entity: uuidOrNull(param(params, 'entity')),
    before: before && /^[1-9]\d{0,14}$/.test(before) ? Number(before) : null,
  };
}

/** The filters as a query string (without `?`), in a fixed order; empty filters are left out. */
export function toAuditSearchParams(filters: AuditFilters): URLSearchParams {
  const out = new URLSearchParams();
  if (filters.scope.kind === 'board') {
    out.set('board', filters.scope.boardId);
    if (filters.scope.schoolId) out.set('school', filters.scope.schoolId);
  } else {
    out.set('school', filters.scope.schoolId);
  }
  out.set('from', filters.from);
  out.set('to', filters.to);
  if (filters.category) out.set('category', filters.category);
  if (filters.actor) out.set('actor', filters.actor);
  if (filters.type) out.set('type', filters.type);
  if (filters.entity) out.set('entity', filters.entity);
  if (filters.before) out.set('before', String(filters.before));
  return out;
}

/** `/audit?…` for these filters with some changed (paging restarts unless `before` is given). */
export function auditHref(
  filters: AuditFilters,
  changes: Partial<AuditFilters> = {},
  path = '/audit',
): string {
  const next = { before: null, ...changes };
  return `${path}?${toAuditSearchParams({ ...filters, ...next }).toString()}`;
}

/** How many filters besides the scope differ from their defaults (« Filtres (2) »). */
export function auditFilterCount(filters: AuditFilters, today: LocalDate): number {
  const period = defaultPeriod(today);
  return [
    filters.from !== period.from || filters.to !== period.to,
    filters.category !== null,
    filters.actor !== null,
    filters.type !== null,
    filters.entity !== null,
  ].filter(Boolean).length;
}

/**
 * The categories worth offering in a scope: the direction's at a school (and the board's too when
 * the person also administers its board), the board's for a board (and the direction's too when
 * the person also directs one of its schools). In the order of AUDIT_CATEGORIES.
 */
export function auditCategoriesFor(scope: AuditScope, scopes: AuditScopes): AuditCategory[] {
  const offered = new Set<AuditCategory>();
  if (scope.kind === 'school') {
    DIRECTION_CATEGORIES.forEach((c) => offered.add(c));
    const boardId = scopes.schools.find((s) => s.id === scope.schoolId)?.boardId;
    if (scopes.boards.some((b) => b.id === boardId))
      BOARD_CATEGORIES.forEach((c) => offered.add(c));
  } else {
    BOARD_CATEGORIES.forEach((c) => offered.add(c));
    if (scopes.schools.some((s) => s.boardId === scope.boardId)) {
      DIRECTION_CATEGORIES.forEach((c) => offered.add(c));
    }
  }
  return AUDIT_CATEGORIES.filter((c) => offered.has(c));
}

/** A local date's midnight in a time zone, for the database to read as an instant (D-009). */
const zonedMidnight = (date: LocalDate, timeZone: string) => `${date} 00:00:00 ${timeZone}`;

/** The filters of `list_audit_entries` (and `log_audit_export`) for these filters. */
export interface AuditRpcFilters {
  schoolId?: string;
  boardId?: string;
  /** Inclusive. */
  from: string;
  /** Exclusive: the day after the last day. */
  to: string;
  category?: AuditCategory;
  actorUserId?: string;
  actorType?: AuditActorType;
  entityId?: string;
}

export function auditRpcFilters(filters: AuditFilters, scopes: AuditScopes): AuditRpcFilters {
  const timeZone = scopeTimeZone(filters.scope, scopes);
  const out: AuditRpcFilters = {
    from: zonedMidnight(filters.from, timeZone),
    to: zonedMidnight(addDays(filters.to, 1), timeZone),
  };
  if (filters.scope.kind === 'board') {
    out.boardId = filters.scope.boardId;
    if (filters.scope.schoolId) out.schoolId = filters.scope.schoolId;
  } else {
    out.schoolId = filters.scope.schoolId;
  }
  if (filters.category) out.category = filters.category;
  if (filters.actor) out.actorUserId = filters.actor;
  if (filters.type) out.actorType = filters.type;
  if (filters.entity) out.entityId = filters.entity;
  return out;
}

/**
 * The latest alert entries of a school from a given day (« Accès aux alertes (7 derniers jours) »
 * on the direction's dashboard): the filters of `list_audit_entries`.
 */
export function recentAlertFilters(
  schoolId: string,
  since: LocalDate,
  timeZone: string,
): { schoolId: string; category: 'alerts'; from: string } {
  // No `to`: up to now, included.
  return { schoolId, category: 'alerts', from: zonedMidnight(since, timeZone) };
}
