/**
 * Class mode maintenance (DECISIONS D-089, D-101; slice S1): every 5 minutes the worker closes
 * the quiz sessions that have expired, deleting their answers and devices (a kept class
 * aggregate first, when the teacher asked for it), and removes old join failures, closed
 * sessions without results and results past the board's retention (`app.class_sessions_
 * maintenance()`). Every class-mode call also closes an expired session of its class, so answers
 * are deleted even when the worker is down. Logs carry counts only.
 *
 * Registered as the task `class_mode_maintenance`. Does nothing until S1 fills it.
 */
import type { Pool } from 'pg';
import type { Logger } from './logger';

export interface ClassModeMaintenanceContext {
  /** Only `query` is used, so a client inside a transaction works too (tests). */
  db: Pick<Pool, 'query'>;
  logger: Logger;
}

export async function classModeMaintenance(_ctx: ClassModeMaintenanceContext): Promise<void> {}
