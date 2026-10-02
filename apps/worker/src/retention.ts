/**
 * Nightly retention (DECISIONS D-105; Phase 6 slice S2 writes it): `select
 * app.retention_maintenance() as counts` purges what D-018, D-059 and D-105 promised, per board
 * (`boards.settings.retention`), writes one `retention.purged` audit row per board and the
 * `retention` heartbeat. The class purge removes students and keeps the teacher's planning.
 *
 * Registered as the task `retention_maintenance` (`53 3 * * *`). Logs carry totals only. Does
 * nothing until S2 fills it.
 */
import type { Pool } from 'pg';
import type { Logger } from './logger';

export interface RetentionContext {
  /** Only `query` is used, so a client inside a transaction works too (tests). */
  db: Pick<Pool, 'query'>;
  logger: Logger;
}

export async function retentionMaintenance(_ctx: RetentionContext): Promise<void> {}
