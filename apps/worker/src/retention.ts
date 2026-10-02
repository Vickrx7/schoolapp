/**
 * Nightly retention (DECISIONS D-105): `select app.retention_maintenance() as totals` purges
 * what D-018, D-059 and D-105 promised, per board (`boards.settings.retention`), writes one
 * `retention.purged` audit row per board that lost something and the `retention` heartbeat. The
 * class purge removes students and keeps the teacher's planning.
 *
 * Registered as the task `retention_maintenance` (`53 3 * * *`). Logs carry totals only.
 */
import type { Pool } from 'pg';
import type { Logger } from './logger';

export interface RetentionContext {
  /** Only `query` is used, so a client inside a transaction works too (tests). */
  db: Pick<Pool, 'query'>;
  logger: Logger;
}

/** What one run removed, over every board (`app.retention_maintenance()`). */
export const RETENTION_COUNT_KEYS = [
  'boards',
  'subPlans',
  'absences',
  'classes',
  'students',
  'sampleClasses',
  'aiUsage',
  'feedback',
  'invitationsExpired',
  'invitationsDeleted',
  'auditRows',
  'outbox',
  /** Staff sign-in attempts older than two days (D-121). */
  'signInAttempts',
] as const;

export type RetentionCountKey = (typeof RETENTION_COUNT_KEYS)[number];

export type RetentionTotals = Record<RetentionCountKey, number> & {
  /** Supabase Auth's audit entries removed, or `not_permitted` where the database refuses. */
  authLogs: number | 'not_permitted';
};

/** The function's answer as counts only: anything else reads as 0. */
export function toRetentionTotals(raw: unknown): RetentionTotals {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const count = (value: unknown) => {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : 0;
  };
  const totals = Object.fromEntries(
    RETENTION_COUNT_KEYS.map((key) => [key, count(source[key])]),
  ) as Record<RetentionCountKey, number>;
  return {
    ...totals,
    authLogs: source.authLogs === 'not_permitted' ? 'not_permitted' : count(source.authLogs),
  };
}

export async function retentionMaintenance(ctx: RetentionContext): Promise<RetentionTotals> {
  const { rows } = await ctx.db.query<{ totals: unknown }>(
    'select app.retention_maintenance() as totals',
  );
  const totals = toRetentionTotals(rows[0]?.totals);
  ctx.logger.info('retention done', { ...totals });
  return totals;
}
