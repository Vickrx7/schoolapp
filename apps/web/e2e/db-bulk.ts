/**
 * Database helpers of the bulk generation spec (Phase 5, DECISIONS D-095 to D-098): a run planned
 * and started for the demo board with the functions the operator's CLI calls
 * (`public.library_bulk_plan` and `public.library_bulk_start`, here as the database owner like
 * `db.ts`), waiting for the worker (fake provider) to finish it, and cleaning up.
 */
import { SEED, query } from './db';

/**
 * Cancels the demo board's planned or running runs (one active run per board, D-097): a run left
 * by an earlier failed spec would refuse the plan (LXB03).
 */
export async function clearActiveBulkRuns(): Promise<void> {
  await query(
    `select app.library_bulk_finish(id, 'cancelled') from public.library_bulk_runs
      where board_id = $1 and status in ('planned', 'running')`,
    [SEED.board],
  );
}

/**
 * Plans a run for the demo board (3e année Mathématiques by default, every board level) and
 * starts it; the worker's `library_bulk_kick` handler runs its tick at once.
 */
export async function startBulkRun(options: {
  types: string[];
  maxCostUsd: number;
  gradeCode?: string;
  subjectCode?: string;
  expectationCodes?: string[];
}): Promise<{ runId: string; planned: number }> {
  const [subject] = await query<{ id: string }>(
    'select id from public.subjects where code = $1 and board_id is null',
    [options.subjectCode ?? 'mat'],
  );
  const params = {
    gradeCodes: [options.gradeCode ?? '3'],
    subjectId: subject!.id,
    types: options.types,
    levels: 'all',
    perExpectation: 1,
    // The CLI sends each type's default duration; any valid one does here.
    durations: Object.fromEntries(options.types.map((t) => [t, 20])),
    ...(options.expectationCodes ? { expectationCodes: options.expectationCodes } : {}),
  };
  const [row] = await query<{ plan: { runId: string; planned: number } }>(
    'select public.library_bulk_plan($1, $2::jsonb, $3, null) as plan',
    [SEED.board, JSON.stringify(params), options.maxCostUsd],
  );
  const plan = row!.plan;
  await query('select public.library_bulk_start($1)', [plan.runId]);
  return plan;
}

/** Waits for the worker to end the run; returns its status. */
export async function waitForBulkRun(runId: string, timeoutMs = 60_000): Promise<string> {
  const started = Date.now();
  for (;;) {
    const [row] = await query<{ status: string }>(
      'select status from public.library_bulk_runs where id = $1',
      [runId],
    );
    if (row && row.status !== 'planned' && row.status !== 'running') return row.status;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`bulk run ${runId} is still ${row?.status}: is the worker running?`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** The run's drafts, oldest first. */
export async function bulkDrafts(runId: string) {
  return query<{ id: string; title: string; status: string }>(
    `select id, title, status::text from public.library_items
      where bulk_run_id = $1 order by created_at, id`,
    [runId],
  );
}

/**
 * Gives a draft a title of the spec's own (so a search finds it) and refreshes its search
 * document, as the editor's save would.
 */
export async function renameDraft(itemId: string, title: string): Promise<void> {
  await query('update public.library_items set title = $2 where id = $1', [itemId, title]);
  await query('select app.library_refresh_search($1)', [itemId]);
}

/** Deletes the run's drafts (approved ones included), then the run and its requests. */
export async function deleteBulkRun(runId: string): Promise<void> {
  await query('delete from public.library_items where bulk_run_id = $1', [runId]);
  await query('delete from public.library_bulk_runs where id = $1', [runId]);
}

/**
 * Marks an item as one of the demo content pack's (as `import-pack --apply` leaves a resource
 * that was not ready: the board's own draft, not proposed).
 */
export async function markFromDemoPack(itemId: string): Promise<void> {
  await query(
    `update public.library_items set content_pack_id = (
       select id from public.content_packs where board_id = $2 and slug = 'demo')
     where id = $1`,
    [itemId, SEED.board],
  );
}
