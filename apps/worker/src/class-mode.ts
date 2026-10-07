/**
 * Class mode maintenance (DECISIONS D-089, D-101): every 5 minutes the worker closes the quiz
 * sessions that have expired, deleting their answers and devices (a kept class aggregate first,
 * when the teacher asked for it), and removes join failures after a day, closed sessions without
 * results after 30 days and kept results past the board's `classModeResultsRetentionDays`
 * (`app.class_sessions_maintenance()`). Every class-mode call also closes an expired session of
 * its class, so answers are deleted even when the worker is down.
 *
 * Registered as the task `class_mode_maintenance`. Logs carry counts only, and only when
 * something was done (the task runs 288 times a day).
 */
import type { Pool } from 'pg';
import type { Logger } from './logger';

export interface ClassModeMaintenanceContext {
  /** Only `query` is used, so a client inside a transaction works too (tests). */
  db: Pick<Pool, 'query'>;
  logger: Logger;
}

/** What `app.class_sessions_maintenance()` did, as counts. */
export interface ClassModeMaintenanceCounts {
  /** Expired sessions closed. */
  sessionsClosed: number;
  /** Answers and devices of those sessions, deleted. */
  responsesDeleted: number;
  participantsDeleted: number;
  /** Failed joins older than a day. */
  joinFailuresDeleted: number;
  /** Closed sessions without kept results, 30 days after they ended. */
  sessionsDeleted: number;
  /** Closed sessions whose kept results passed the board's retention (the results go too). */
  resultsDeleted: number;
}

const COUNT_KEYS = [
  'sessionsClosed',
  'responsesDeleted',
  'participantsDeleted',
  'joinFailuresDeleted',
  'sessionsDeleted',
  'resultsDeleted',
] as const satisfies readonly (keyof ClassModeMaintenanceCounts)[];

/** Counts from the database's JSON: anything missing or not a count reads as 0. */
function toCounts(value: unknown): ClassModeMaintenanceCounts {
  const source = (typeof value === 'object' && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const counts = {} as ClassModeMaintenanceCounts;
  for (const key of COUNT_KEYS) {
    const n = Number(source[key]);
    counts[key] = Number.isInteger(n) && n > 0 ? n : 0;
  }
  return counts;
}

export async function classModeMaintenance(
  ctx: ClassModeMaintenanceContext,
): Promise<ClassModeMaintenanceCounts> {
  const { rows } = await ctx.db.query<{ counts: unknown }>(
    'select app.class_sessions_maintenance() as counts',
  );
  const counts = toCounts(rows[0]?.counts);
  if (COUNT_KEYS.some((key) => counts[key] > 0)) {
    ctx.logger.info('class mode maintenance done', { ...counts });
  }
  return counts;
}
