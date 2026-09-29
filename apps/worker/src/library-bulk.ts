/**
 * Bulk generation of board drafts with the Message Batches API (DECISIONS D-095 to D-098; slice
 * S6). `tickBulkRuns` moves every running run one step: it refuses a run the board or this
 * server no longer allows, submits one batch sized to the run's cost cap, sends a cancellation,
 * or reads the results of an ended batch into board drafts and deletes the batch from the
 * provider. `libraryMaintenance` is the daily clean-up (planned runs never started, `sent_text`
 * after 30 days, runs stuck in submission, staged pack imports). Logs carry run and request
 * ids, counts, costs and problem codes only.
 *
 * Registered as the tasks `library_bulk_tick` (every 5 minutes, and at once when a run starts
 * or a cancellation is asked: the `library_bulk_kick` handler) and `library_maintenance` (daily).
 * Both do nothing until S6 fills them.
 */
import type { Pool } from 'pg';
import type { AiRuntime } from './ai';
import type { Logger } from './logger';

export interface BulkTickContext {
  pool: Pool;
  /** Null when AI is turned off for this deployment: a running run then fails (`aiUnavailable`). */
  ai: AiRuntime | null;
  logger: Logger;
  /** BULK_MAX_RUN_USD: a run whose cap is higher is refused before submission (`overLimit`). */
  maxRunUsd: number;
}

export async function tickBulkRuns(_ctx: BulkTickContext): Promise<void> {}

export interface LibraryMaintenanceContext {
  db: Pick<Pool, 'query'>;
  logger: Logger;
}

export async function libraryMaintenance(_ctx: LibraryMaintenanceContext): Promise<void> {}
