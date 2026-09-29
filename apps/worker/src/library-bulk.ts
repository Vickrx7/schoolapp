/**
 * Bulk generation of board drafts with the Message Batches API (DECISIONS D-095 to D-098).
 * `tickBulkRuns` moves every running run one step: it refuses a run the board or this server no
 * longer allows, submits one batch sized to the run's cost cap, sends a cancellation, or reads the
 * results of an ended batch into board drafts and deletes the batch from the provider.
 * `libraryMaintenance` is the daily clean-up (planned runs never started, `sent_text` after 30
 * days, runs stuck in submission, staged pack imports). Logs carry run and request ids, counts,
 * costs and problem codes only: never an input, a message or an answer.
 *
 * Registered as the tasks `library_bulk_tick` (every 5 minutes, and at once when a run starts or
 * a cancellation is asked: the `library_bulk_kick` handler) and `library_maintenance` (daily).
 *
 * Privacy (D-098): each request is prepared by the same code as an on-demand call
 * (`prepareCall`: validated, de-identified with everyone of the board, refused when a personal
 * detail remains) and each answer checked by the same code too (`checkOutput`). When the results
 * arrive, every request is prepared again: if what it would send differs from what was sent (the
 * board's people changed), its answer is not used (`redaction_changed`), so names are never put
 * back against markers they were not written with.
 */
import {
  checkOutput,
  countedInputTokens,
  estimateCostUsd,
  fallbackInputTokens,
  findPersonalInfo,
  fitWithinCap,
  libraryItemFeature,
  loadPrompt,
  prepareCall,
  schemaJsonText,
  worstCaseUsd,
  type AiBatchProvider,
  type BatchItem,
  type KnownPerson,
  type LibraryItemAiOutput,
  type LibraryItemInput,
  type PreparedCall,
} from '@lynx/ai';
import type { Pool, PoolClient } from 'pg';
import { loadBoardPeople, type AiRuntime } from './ai';
import type { Logger } from './logger';

/** Only `query` is used, so a client inside a transaction works too (tests). */
type Db = Pick<Pool, 'query'>;

const feature = libraryItemFeature;

export interface BulkTickContext {
  /**
   * The worker's pool (each run is worked on with a connection of its own, locked for the run),
   * or a client already in a transaction (tests: everything runs on it).
   */
  pool: Pool | PoolClient;
  /** Null when AI is turned off for this deployment: a running run then fails (`aiUnavailable`). */
  ai: AiRuntime | null;
  logger: Logger;
  /** BULK_MAX_RUN_USD: a run whose cap is higher is refused before submission (`overLimit`). */
  maxRunUsd: number;
}

interface RunRow {
  id: string;
  board_id: string;
  status: string;
  max_cost_usd: number;
  batch_id: string | null;
  submit_started_at: Date | null;
  cancel_requested_at: Date | null;
  cancel_sent_at: Date | null;
}

const errorText = (error: unknown) =>
  error instanceof Error
    ? `${error.name}${'code' in error ? ` ${String(error.code)}` : ''}`
    : 'error';

/** Every running run, one step each. A run another tick is working on is left alone. */
export async function tickBulkRuns(ctx: BulkTickContext): Promise<void> {
  const { rows } = await ctx.pool.query<{ id: string }>(
    `select id from public.library_bulk_runs where status = 'running' order by started_at, id`,
  );
  for (const { id } of rows) {
    try {
      await withRunLock(ctx.pool, id, (db) => tickRun(db, id, ctx));
    } catch (error) {
      // The run stays as it is; the next tick tries again (every step can be repeated).
      ctx.logger.error('bulk run step failed', { runId: id, error: errorText(error) });
    }
  }
}

/**
 * Runs `fn` while holding the run's advisory lock (two ticks can overlap: a kick while one runs),
 * on a connection of its own when given the pool, so the lock and its release share one session.
 */
async function withRunLock(
  pool: Pool | PoolClient,
  runId: string,
  fn: (db: Db) => Promise<void>,
): Promise<void> {
  const isClient = typeof (pool as Partial<PoolClient>).release === 'function';
  const client = isClient ? null : await (pool as Pool).connect();
  const db: Db = client ?? pool;
  const key = `library_bulk:${runId}`;
  try {
    const { rows } = await db.query<{ locked: boolean }>(
      'select pg_try_advisory_lock(hashtextextended($1, 0)) as locked',
      [key],
    );
    if (!rows[0]?.locked) return;
    try {
      await fn(db);
    } finally {
      await db.query('select pg_advisory_unlock(hashtextextended($1, 0))', [key]);
    }
  } finally {
    client?.release();
  }
}

async function loadRun(db: Db, runId: string): Promise<RunRow | undefined> {
  const { rows } = await db.query<RunRow>(
    `select id, board_id, status, max_cost_usd::float8 as max_cost_usd, batch_id, submit_started_at,
            cancel_requested_at, cancel_sent_at
       from public.library_bulk_runs where id = $1`,
    [runId],
  );
  return rows[0];
}

async function finish(
  db: Db,
  runId: string,
  status: 'completed' | 'cancelled' | 'failed',
  error: string | null = null,
): Promise<Record<string, unknown>> {
  const { rows } = await db.query<{ report: Record<string, unknown> | null }>(
    'select app.library_bulk_finish($1, $2, $3) as report',
    [runId, status, error],
  );
  return rows[0]?.report ?? {};
}

async function tickRun(db: Db, runId: string, ctx: BulkTickContext): Promise<void> {
  const { logger } = ctx;
  const run = await loadRun(db, runId);
  if (!run || run.status !== 'running') return;
  const batch = ctx.ai?.provider.batch;

  if (run.batch_id === null) {
    // Submission began but its batch id was never recorded (the worker stopped mid-way): the
    // daily clean-up fails the run. It is never sent again.
    if (run.submit_started_at !== null) return;
    if (run.cancel_requested_at !== null) {
      await finish(db, run.id, 'cancelled');
      logger.info('bulk run cancelled before submission', { runId: run.id });
      return;
    }
    if (!ctx.ai || !batch) {
      await finish(db, run.id, 'failed', 'aiUnavailable');
      logger.warn('bulk run failed', { runId: run.id, code: 'aiUnavailable' });
      return;
    }
    const allowed = await db.query<{ allowed: boolean }>(
      'select app.library_bulk_ai_allowed($1) as allowed',
      [run.board_id],
    );
    if (!allowed.rows[0]?.allowed) {
      await finish(db, run.id, 'failed', 'aiDisabled');
      logger.warn('bulk run failed', { runId: run.id, code: 'aiDisabled' });
      return;
    }
    if (run.max_cost_usd > ctx.maxRunUsd) {
      await finish(db, run.id, 'failed', 'overLimit');
      logger.warn('bulk run failed', {
        runId: run.id,
        code: 'overLimit',
        maxCostUsd: run.max_cost_usd,
        limitUsd: ctx.maxRunUsd,
      });
      return;
    }
    const batchId = await submitRun(db, run, ctx.ai, batch, logger);
    if (batchId === null) return;
    run.batch_id = batchId;
  }

  if (!ctx.ai || !batch) {
    // The batch exists: its results wait until AI is back on this server.
    logger.warn('bulk run waits: AI is off on this server', { runId: run.id });
    return;
  }
  if (run.cancel_requested_at !== null && run.cancel_sent_at === null) {
    await batch.cancel(run.batch_id);
    await db.query('update public.library_bulk_runs set cancel_sent_at = now() where id = $1', [
      run.id,
    ]);
    logger.info('bulk batch cancellation sent', { runId: run.id, batchId: run.batch_id });
  }
  const status = await batch.status(run.batch_id);
  if (status.state !== 'ended') return;
  await collectResults(db, { ...run, batch_id: run.batch_id }, ctx.ai, batch, logger);
}

/** A request ready for the batch, with its worst case. */
interface Candidate {
  id: string;
  item: BatchItem;
  sentSha256: string;
  sentText: string;
  worstCaseUsd: number;
}

/**
 * Prepares every planned request, sizes the batch to the cap (D-096) and sends it once. Returns
 * the batch id, or null when nothing was sent (the run is then finished).
 */
async function submitRun(
  db: Db,
  run: RunRow,
  ai: AiRuntime,
  batch: AiBatchProvider,
  logger: Logger,
): Promise<string | null> {
  const { rows: requests } = await db.query<{ id: string; input: unknown }>(
    `select id, input from public.library_bulk_requests
      where run_id = $1 and status = 'planned' order by id`,
    [run.id],
  );
  const [people, systemPrompt] = await Promise.all([
    loadBoardPeople(db, run.board_id),
    loadPrompt(feature.name, feature.promptVersion),
  ]);

  const failed: { id: string; reason: string }[] = [];
  const candidates: Candidate[] = [];
  let counted = 0;
  let fallbacks = 0;
  let sum = 0;
  for (const request of requests) {
    const prepared = prepareCall(feature, request.input, { systemPrompt, people });
    if (!prepared.ok) {
      failed.push({ id: request.id, reason: prepared.errorCode });
      logger.warn('bulk request not sent', {
        runId: run.id,
        requestId: request.id,
        code: prepared.errorCode,
        problems: prepared.problems,
      });
      continue;
    }
    const item = batchItem(request.id, prepared);
    // Counting tokens is free but not instant: requests after the cap is reached are left out
    // anyway, so they are not counted.
    let inputTokens: number;
    if (sum > run.max_cost_usd) {
      inputTokens = fallbackInputTokens(item.system, item.user, schemaJsonText(item.schema));
    } else {
      try {
        inputTokens = countedInputTokens(await batch.countInputTokens(item));
        counted++;
      } catch {
        // A token always covers at least a byte: the bytes are an upper bound.
        inputTokens = fallbackInputTokens(item.system, item.user, schemaJsonText(item.schema));
        fallbacks++;
      }
    }
    const worst = worstCaseUsd(inputTokens, item.maxTokens, ai.price);
    sum += worst;
    candidates.push({
      id: request.id,
      item,
      sentSha256: prepared.sentSha256,
      sentText: prepared.user,
      worstCaseUsd: worst,
    });
  }

  const { fit, rest } = fitWithinCap(candidates, run.max_cost_usd);
  await db.query('select app.library_bulk_mark_submitting($1, $2::jsonb, $3::jsonb)', [
    run.id,
    JSON.stringify(
      fit.map((c) => ({
        id: c.id,
        worstCaseUsd: c.worstCaseUsd,
        sentSha256: c.sentSha256,
        sentText: c.sentText,
      })),
    ),
    JSON.stringify(failed),
  ]);
  const summary = {
    runId: run.id,
    submitted: fit.length,
    costCap: rest.length,
    failed: failed.length,
    counted,
    fallbacks,
    worstCaseUsd: fit.reduce((n, c) => n + c.worstCaseUsd, 0),
  };
  if (!fit.length) {
    await finish(db, run.id, 'completed');
    logger.info('bulk run finished with nothing to send', summary);
    return null;
  }

  let batchId: string;
  try {
    ({ batchId } = await batch.submit(fit.map((c) => c.item)));
  } catch (error) {
    // Never sent again: a failed call may still have created the batch (D-096).
    await finish(db, run.id, 'failed', 'submitFailed');
    logger.error('bulk batch not submitted', { ...summary, error: errorText(error) });
    return null;
  }
  await db.query('update public.library_bulk_runs set batch_id = $2 where id = $1', [
    run.id,
    batchId,
  ]);
  logger.info('bulk batch submitted', { ...summary, batchId });
  return batchId;
}

function batchItem(
  customId: string,
  prepared: PreparedCall<LibraryItemInput, LibraryItemAiOutput>,
): BatchItem {
  return {
    customId,
    system: prepared.system,
    user: prepared.user,
    schema: prepared.schema,
    maxTokens: prepared.maxTokens,
    fake: () => feature.fake(prepared.input),
  };
}

/** Why an answer is unusable, as the request's failure code. */
export function failureCode(stopReason: string): string {
  switch (stopReason) {
    case 'refusal':
      return 'aiRefused';
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return 'aiTooLong';
    case 'invalid_json':
    case 'invalid_schema':
      return 'invalidOutput';
    case 'batch_invalid_request':
    case 'batch_server_error':
    case 'batch_expired':
    case 'batch_canceled':
      return stopReason;
    default:
      return 'aiError';
  }
}

/** Every string of an answer (titles, texts, questions, keys, safety notes). */
function answerStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    if (value.trim()) out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) answerStrings(v, out);
  } else if (typeof value === 'object' && value !== null) {
    for (const v of Object.values(value)) answerStrings(v, out);
  }
  return out;
}

/**
 * Codes for the reviewer about a checked answer (never its content): `student_name` when it holds
 * the first name of a student of the board (characters take names the request allowed, so this is
 * a coincidence to check before the whole board sees it, D-066), `personal_details` for an e-mail
 * address, a phone number or another detail the privacy tools block.
 */
export function reviewerProblems(output: unknown, people: readonly KnownPerson[]): string[] {
  const findings = findPersonalInfo(answerStrings(output), people);
  return [
    ...(findings.studentNames.length ? ['student_name'] : []),
    ...(findings.blocked.length ? ['personal_details'] : []),
  ];
}

/** Reads an ended batch into the run's requests, deletes it at the provider, ends the run. */
async function collectResults(
  db: Db,
  run: RunRow & { batch_id: string },
  ai: AiRuntime,
  batch: AiBatchProvider,
  logger: Logger,
): Promise<void> {
  const { rows: requests } = await db.query<{
    id: string;
    input: unknown;
    sent_sha256: string | null;
  }>(
    `select id, input, sent_sha256 from public.library_bulk_requests
      where run_id = $1 and status = 'submitted' order by id`,
    [run.id],
  );
  const counts: Record<string, number> = {};
  const count = (key: string) => (counts[key] = (counts[key] ?? 0) + 1);

  if (requests.length) {
    const [people, systemPrompt] = await Promise.all([
      loadBoardPeople(db, run.board_id),
      loadPrompt(feature.name, feature.promptVersion),
    ]);
    // Each request prepared again: the same input with the same people sends the same text.
    const prepared = new Map<string, PreparedCall<LibraryItemInput, LibraryItemAiOutput> | null>();
    const pending = new Map<string, BatchItem>();
    for (const request of requests) {
      const again = prepareCall(feature, request.input, { systemPrompt, people });
      const same = again.ok && again.sentSha256 === request.sent_sha256;
      prepared.set(request.id, same ? again : null);
      pending.set(
        request.id,
        again.ok
          ? batchItem(request.id, again)
          : {
              customId: request.id,
              system: '',
              user: '',
              schema: feature.outputSchema,
              maxTokens: feature.maxTokens,
              fake: () => null,
            },
      );
    }

    const seen = new Set<string>();
    for await (const result of batch.results(run.batch_id, pending)) {
      if (seen.has(result.customId) || !prepared.has(result.customId)) continue;
      seen.add(result.customId);
      const call = prepared.get(result.customId) ?? null;
      let output: LibraryItemAiOutput | null = null;
      let errorCode: string | null = null;
      let status: 'succeeded' | 'failed' | 'invalid_output' = 'failed';
      let problems: string[] = [];
      if (call === null) {
        errorCode = 'redaction_changed';
      } else if (result.output === null) {
        errorCode = failureCode(result.stopReason);
        status = errorCode === 'invalidOutput' ? 'invalid_output' : 'failed';
      } else {
        const checked = checkOutput(
          feature,
          result.output as LibraryItemAiOutput,
          call.input,
          call.redactor,
        );
        if (checked.ok) {
          output = checked.output;
          status = 'succeeded';
          problems = reviewerProblems(output, people);
        } else {
          errorCode = 'invalidOutput';
          status = 'invalid_output';
          logger.warn('bulk answer unusable', {
            runId: run.id,
            requestId: result.customId,
            problems: checked.problems,
          });
        }
      }
      const generation = {
        provider: ai.provider.name,
        model: result.model,
        promptVersion: feature.promptVersion,
        // As on-demand calls record them (ai_generations has no cache-write column).
        inputTokens: result.usage.inputTokens + result.usage.cacheWriteTokens,
        outputTokens: result.usage.outputTokens,
        cacheReadTokens: result.usage.cacheReadTokens,
        costUsd: estimateCostUsd(result.usage, ai.price, { batch: true }),
        status,
        latencyMs: null,
        providerRequestId: result.requestId,
      };
      const recorded = await db.query<{ outcome: string }>(
        'select app.library_bulk_record_result($1, $2::jsonb, $3::jsonb, $4, $5::text[]) as outcome',
        [
          result.customId,
          JSON.stringify(generation),
          output === null ? null : JSON.stringify(output),
          errorCode,
          problems,
        ],
      );
      const outcome = recorded.rows[0]?.outcome ?? 'failed';
      count(outcome === 'failed' ? `failed:${errorCode ?? 'invalidOutput'}` : outcome);
    }
  }

  // The batch's data leaves the provider as soon as it is read (D-101).
  try {
    await batch.remove(run.batch_id);
  } catch (error) {
    logger.warn('bulk batch not deleted at the provider', {
      runId: run.id,
      batchId: run.batch_id,
      error: errorText(error),
    });
  }
  const report = await finish(db, run.id, run.cancel_requested_at ? 'cancelled' : 'completed');
  logger.info('bulk run finished', {
    runId: run.id,
    batchId: run.batch_id,
    results: counts,
    created: report.created,
    failed: report.failed,
    spentUsd: report.spentUsd,
  });
}

export interface LibraryMaintenanceContext {
  db: Pick<Pool, 'query'>;
  logger: Logger;
}

/** What `app.library_maintenance()` did, as counts. */
export type LibraryMaintenanceCounts = Record<string, number>;

/** The daily library clean-up (D-101); logs the counts when something was done. */
export async function libraryMaintenance(
  ctx: LibraryMaintenanceContext,
): Promise<LibraryMaintenanceCounts> {
  const { rows } = await ctx.db.query<{ counts: unknown }>(
    'select app.library_maintenance() as counts',
  );
  const raw = rows[0]?.counts;
  const counts: LibraryMaintenanceCounts = {};
  if (typeof raw === 'object' && raw !== null) {
    for (const [key, value] of Object.entries(raw)) {
      const n = Number(value);
      counts[key] = Number.isInteger(n) && n > 0 ? n : 0;
    }
  }
  if (Object.values(counts).some((n) => n > 0)) {
    ctx.logger.info('library maintenance done', counts);
  }
  return counts;
}
