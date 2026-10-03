/**
 * Integration test for bulk generation (DECISIONS D-095 to D-098), end to end with the fake
 * provider's batches: the operator's plan built by the database, the worker's tick (prepare with
 * everyone of the board, size to the cap, submit once, read, check, record, delete the batch),
 * and the board's drafts. Needs a migrated and seeded database (DATABASE_URL). Everything runs in
 * transactions that are rolled back, so the demo data is untouched. Run with `pnpm test:int`,
 * with the worker stopped.
 */
import {
  createFakeProvider,
  priceFor,
  type AiBatchProvider,
  type AiProvider,
  type BatchItem,
  type BatchItemResult,
} from '@lynx/ai';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import type { AiRuntime } from './ai';
import { tickBulkRuns } from './library-bulk';
import type { Logger } from './logger';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required for integration tests');

// From supabase/seed.sql: the demo board, Isabelle's 3e année class, 3e année Mathématiques.
const BOARD = 'b0000000-0000-4000-8000-000000000001';
const CLASS_3 = 'e0000000-0000-4000-8000-000000000003';
const B1_1 = '20000000-0000-4000-8000-000000030b11';
const B1_2 = '20000000-0000-4000-8000-000000030b12';

const pool = new pg.Pool({ connectionString });
const silent: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

afterAll(async () => {
  await pool.end();
});

/** Runs `fn` in a transaction that is always rolled back, with no other active run on the board. */
async function inRollback(fn: (db: pg.PoolClient) => Promise<void>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `delete from public.library_bulk_runs where status in ('planned', 'running')`,
    );
    await client.query(`update public.boards set settings = settings - 'ai' where id = $1`, [
      BOARD,
    ]);
    await fn(client);
  } finally {
    await client.query('rollback').catch(() => undefined);
    client.release();
  }
}

/** The fake provider, its batch calls recorded, with optional changes to what it answers. */
function spyProvider(
  options: {
    /** How many status calls answer « in progress » before « ended ». */
    busyFor?: number;
    answer?: (result: BatchItemResult) => BatchItemResult;
  } = {},
) {
  const fake = createFakeProvider().batch!;
  const calls: string[] = [];
  const submitted: BatchItem[][] = [];
  let statusCalls = 0;
  const batch: AiBatchProvider = {
    countInputTokens: (item) => {
      calls.push('count');
      return fake.countInputTokens(item);
    },
    submit: async (items) => {
      calls.push('submit');
      submitted.push([...items]);
      return fake.submit(items);
    },
    status: async (batchId) => {
      calls.push('status');
      statusCalls++;
      return statusCalls <= (options.busyFor ?? 0)
        ? { state: 'in_progress' }
        : fake.status(batchId);
    },
    results: async function* (batchId, pending) {
      calls.push('results');
      for await (const result of fake.results(batchId, pending)) {
        yield options.answer ? options.answer(result) : result;
      }
    },
    cancel: async (batchId) => {
      calls.push('cancel');
      return fake.cancel(batchId);
    },
    remove: async (batchId) => {
      calls.push('remove');
      return fake.remove(batchId);
    },
  };
  const provider: AiProvider = { ...createFakeProvider(), batch };
  const ai: AiRuntime = { provider, price: priceFor('fake') };
  return { ai, calls, submitted };
}

async function subjectId(db: pg.PoolClient, code: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    'select id from public.subjects where code = $1 and board_id is null',
    [code],
  );
  return rows[0]!.id;
}

/** Plans a run for the demo board, 3e année Mathématiques, as the operator's CLI does. */
async function plan(
  db: pg.PoolClient,
  types: string[],
  options: { maxCost?: number; note?: string | null; extra?: Record<string, unknown> } = {},
): Promise<string> {
  const params = {
    gradeCodes: ['3'],
    subjectId: await subjectId(db, 'mat'),
    types,
    levels: 'all',
    perExpectation: 1,
    // The CLI sends each type's default duration (TYPE_INFO); any valid one does here.
    durations: Object.fromEntries(types.map((t) => [t, 30])),
    ...options.extra,
  };
  const { rows } = await db.query<{ plan: { runId: string } }>(
    'select public.library_bulk_plan($1, $2::jsonb, $3, $4) as plan',
    [BOARD, JSON.stringify(params), options.maxCost ?? 25, options.note ?? null],
  );
  return rows[0]!.plan.runId;
}

async function start(db: pg.PoolClient, runId: string) {
  await db.query('select public.library_bulk_start($1)', [runId]);
}

async function requests(db: pg.PoolClient, runId: string) {
  const { rows } = await db.query<{
    id: string;
    expectation_id: string;
    item_type: string;
    status: string;
    reason: string | null;
    worst_case_usd: string | null;
    item_id: string | null;
    sent_sha256: string | null;
    sent_text: string | null;
  }>(
    `select id, expectation_id, item_type, status, reason, worst_case_usd, item_id, sent_sha256,
            sent_text
       from public.library_bulk_requests where run_id = $1 order by id`,
    [runId],
  );
  return rows;
}

async function runRow(db: pg.PoolClient, runId: string) {
  const { rows } = await db.query<{
    status: string;
    error_code: string | null;
    batch_id: string | null;
    spent_usd: string;
    max_cost_usd: string;
    report: Record<string, unknown> | null;
  }>(
    `select status, error_code, batch_id, spent_usd, max_cost_usd, report
       from public.library_bulk_runs where id = $1`,
    [runId],
  );
  return rows[0]!;
}

// B1.2 already has an approved worksheet, quiz and game in the demo library: the tests that need
// one request to send use a type it has none of (« Affiche d'ancrage »).
describe('bulk generation (library_bulk_tick)', () => {
  it('turns a planned run into board drafts in one tick with the fake provider', async () => {
    await inRollback(async (db) => {
      const runId = await plan(db, ['worksheet', 'exit_ticket'], {
        extra: { expectationCodes: ['B1.1', 'B1.2'] },
        note: 'Automne.',
      });
      await start(db, runId);
      const { ai, calls, submitted } = spyProvider();
      await tickBulkRuns({ pool: db, ai, logger: silent, maxRunUsd: 100 });

      const run = await runRow(db, runId);
      expect(run.status).toBe('completed');
      expect(run.batch_id).toMatch(/^fake-batch-/);
      const rows = await requests(db, runId);
      const planned = rows.filter((r) => r.status !== 'skipped');
      expect(planned.length).toBeGreaterThan(0);
      expect(planned.every((r) => r.status === 'created' && r.item_id)).toBe(true);
      expect(submitted).toHaveLength(1);
      expect(submitted[0]!.map((i) => i.customId).sort()).toEqual(planned.map((r) => r.id).sort());
      expect(calls.filter((c) => c === 'submit')).toHaveLength(1);
      expect(calls.at(-1)).toBe('remove');
      // What was sent: kept for 30 days, with its hash; no name of the board in it.
      for (const r of planned) {
        expect(r.sent_sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(r.sent_text).toContain('Automne.');
        expect(r.sent_text).not.toMatch(/Samuel|Hugo|Maëlle|Tremblay/);
      }

      const { rows: drafts } = await db.query<{
        board_owned: boolean;
        author_id: string | null;
        school_id: string | null;
        source: string;
        status: string;
        share_scope: string;
        bulk_run_id: string;
        prompt_version: string;
        model: string;
        versions: number;
        g_school: string | null;
        g_user: string | null;
        g_batch: string;
        g_board: string;
      }>(
        `select i.board_owned, i.author_id, i.school_id, i.source, i.status, i.share_scope,
                i.bulk_run_id, i.prompt_version, i.model,
                (select count(*)::int from public.library_item_versions v where v.item_id = i.id) as versions,
                g.school_id as g_school, g.user_id as g_user, g.batch_id as g_batch, g.board_id as g_board
           from public.library_items i join public.ai_generations g on g.id = i.ai_generation_id
          where i.bulk_run_id = $1`,
        [runId],
      );
      expect(drafts).toHaveLength(planned.length);
      for (const d of drafts) {
        expect(d).toMatchObject({
          board_owned: true,
          author_id: null,
          school_id: null,
          source: 'ai_generated',
          status: 'draft',
          share_scope: 'private',
          bulk_run_id: runId,
          prompt_version: 'v1',
          model: 'fake',
          g_school: null,
          g_user: null,
          g_batch: run.batch_id,
          g_board: BOARD,
        });
        // A base version and one per board level (worksheet and exit ticket have levels).
        expect(d.versions).toBe(5);
      }
      expect(run.report).toMatchObject({ created: planned.length, failed: {} });
      expect(Number(run.spent_usd)).toBeGreaterThan(0);
      expect(Number(run.spent_usd)).toBeLessThanOrEqual(Number(run.max_cost_usd));
    });
  });

  it('sends exactly the prefix that fits under the cap; the rest is skipped', async () => {
    await inRollback(async (db) => {
      // About $0.16 at worst per request with the fake's price: $0.50 sends 3.
      const runId = await plan(db, ['worksheet'], { maxCost: 0.5 });
      await start(db, runId);
      const { ai } = spyProvider();
      await tickBulkRuns({ pool: db, ai, logger: silent, maxRunUsd: 100 });

      const rows = (await requests(db, runId)).filter(
        (r) => r.status !== 'skipped' || r.reason === 'cost_cap',
      );
      const sent = rows.filter((r) => r.status === 'created');
      const capped = rows.filter((r) => r.reason === 'cost_cap');
      expect(sent.length).toBeGreaterThan(0);
      expect(capped.length).toBeGreaterThan(0);
      // In id order: every sent request comes before every capped one.
      expect(rows.slice(0, sent.length).every((r) => r.status === 'created')).toBe(true);
      const worst = sent.reduce((n, r) => n + Number(r.worst_case_usd), 0);
      expect(worst).toBeLessThanOrEqual(0.5);
      const run = await runRow(db, runId);
      expect(Number(run.spent_usd)).toBeLessThanOrEqual(0.5);
      expect(run.report).toMatchObject({ skipped: { costCap: capped.length } });
    });
  });

  it('fails an answer that does not pass the checks, without retrying it', async () => {
    await inRollback(async (db) => {
      const runId = await plan(db, ['anchor_chart'], { extra: { expectationCodes: ['B1.2'] } });
      await start(db, runId);
      const { ai, calls } = spyProvider({
        answer: (result) => ({
          ...result,
          output: { ...(result.output as Record<string, unknown>), title: '' },
        }),
      });
      await tickBulkRuns({ pool: db, ai, logger: silent, maxRunUsd: 100 });
      const [row] = await requests(db, runId);
      expect(row).toMatchObject({ status: 'failed', reason: 'invalidOutput', item_id: null });
      expect(calls.filter((c) => c === 'submit' || c === 'results')).toEqual(['submit', 'results']);
      const { rows } = await db.query(
        `select g.status, g.estimated_cost_usd > 0 as billed from public.ai_generations g
           join public.library_bulk_requests r on r.ai_generation_id = g.id where r.id = $1`,
        [row!.id],
      );
      expect(rows[0]).toEqual({ status: 'invalid_output', billed: true });
      expect((await runRow(db, runId)).report).toMatchObject({
        created: 0,
        failed: { invalidOutput: 1 },
      });
    });
  });

  it('cancels a run before submission: its planned requests are skipped', async () => {
    await inRollback(async (db) => {
      const runId = await plan(db, ['anchor_chart'], {
        extra: { expectationCodes: ['B1.1', 'B1.2'] },
      });
      await start(db, runId);
      await db.query('select public.library_bulk_cancel($1)', [runId]);
      const { ai, calls } = spyProvider();
      await tickBulkRuns({ pool: db, ai, logger: silent, maxRunUsd: 100 });
      expect(calls).toEqual([]);
      expect((await runRow(db, runId)).status).toBe('cancelled');
      const rows = await requests(db, runId);
      expect(rows.every((r) => r.status === 'skipped' && r.reason === 'cancelled')).toBe(true);
    });
  });

  it('refuses a request whose note holds a phone number, and sends nothing', async () => {
    await inRollback(async (db) => {
      const runId = await plan(db, ['anchor_chart'], {
        extra: { expectationCodes: ['B1.2'] },
        note: 'Appelez le 613-555-0123 pour les questions.',
      });
      await start(db, runId);
      const { ai, calls } = spyProvider();
      await tickBulkRuns({ pool: db, ai, logger: silent, maxRunUsd: 100 });
      expect(calls.filter((c) => c === 'submit')).toEqual([]);
      const [row] = await requests(db, runId);
      expect(row).toMatchObject({ status: 'failed', reason: 'personalInfo', sent_text: null });
      expect((await runRow(db, runId)).status).toBe('completed');
    });
  });

  it('does not use an answer when the board’s people changed since it was sent', async () => {
    await inRollback(async (db) => {
      // A board-approved worksheet for B1.1 whose title names someone who is not (yet) a student.
      const { rows: items } = await db.query<{ id: string }>(
        `insert into public.library_items (board_id, type, title, status, share_scope, source,
           board_owned, subject_id, duration_minutes, materials, approved_at)
         values ($1, 'worksheet', 'Le marché de Zéphyrine', 'board_approved', 'board',
           'board_created', true, $2, 30, 'Crayons', now())
         returning id`,
        [BOARD, await subjectId(db, 'mat')],
      );
      await db.query(
        'insert into public.library_item_expectations (item_id, expectation_id) values ($1, $2)',
        [items[0]!.id, B1_1],
      );
      const runId = await plan(db, ['worksheet'], {
        extra: { expectationCodes: ['B1.1', 'B1.2'], perExpectation: 2, levels: 'none' },
      });
      await start(db, runId);
      const { ai } = spyProvider({ busyFor: 1 });
      await tickBulkRuns({ pool: db, ai, logger: silent, maxRunUsd: 100 });
      const sent = await requests(db, runId);
      expect(sent.map((r) => r.status)).toEqual(['submitted', 'submitted']);
      expect(sent.find((r) => r.expectation_id === B1_1)!.sent_text).toContain('Zéphyrine');

      // A student named Zéphyrine joins the board before the results are read.
      await db.query('insert into public.students (class_id, first_name) values ($1, $2)', [
        CLASS_3,
        'Zéphyrine',
      ]);
      await tickBulkRuns({ pool: db, ai, logger: silent, maxRunUsd: 100 });
      const rows = await requests(db, runId);
      expect(rows.find((r) => r.expectation_id === B1_1)).toMatchObject({
        status: 'failed',
        reason: 'redaction_changed',
        item_id: null,
      });
      expect(rows.find((r) => r.expectation_id === B1_2)).toMatchObject({ status: 'created' });
      // Its cost is recorded all the same.
      const { rows: gens } = await db.query(
        `select g.status, g.error_code from public.ai_generations g
           join public.library_bulk_requests r on r.ai_generation_id = g.id
          where r.run_id = $1 and r.expectation_id = $2`,
        [runId, B1_1],
      );
      expect(gens[0]).toEqual({ status: 'failed', error_code: 'redaction_changed' });
    });
  });

  it('refuses a run whose cap is above BULK_MAX_RUN_USD before sending anything', async () => {
    await inRollback(async (db) => {
      const runId = await plan(db, ['anchor_chart'], {
        maxCost: 150,
        extra: { expectationCodes: ['B1.2'] },
      });
      await start(db, runId);
      const { ai, calls } = spyProvider();
      await tickBulkRuns({ pool: db, ai, logger: silent, maxRunUsd: 100 });
      expect(calls).toEqual([]);
      const run = await runRow(db, runId);
      expect(run).toMatchObject({ status: 'failed', error_code: 'overLimit' });
      const [row] = await requests(db, runId);
      expect(row).toMatchObject({ status: 'failed', reason: 'overLimit' });
    });
  });

  it('fails a run when AI is off on the server or for the board', async () => {
    await inRollback(async (db) => {
      const runId = await plan(db, ['anchor_chart'], { extra: { expectationCodes: ['B1.2'] } });
      await start(db, runId);
      await tickBulkRuns({ pool: db, ai: null, logger: silent, maxRunUsd: 100 });
      expect(await runRow(db, runId)).toMatchObject({
        status: 'failed',
        error_code: 'aiUnavailable',
      });

      const second = await plan(db, ['anchor_chart'], { extra: { expectationCodes: ['B1.2'] } });
      await start(db, second);
      await db.query(
        `update public.boards set settings = jsonb_set(settings, '{ai}', '{"allowed": false}')
          where id = $1`,
        [BOARD],
      );
      const { ai, calls } = spyProvider();
      await tickBulkRuns({ pool: db, ai, logger: silent, maxRunUsd: 100 });
      expect(calls).toEqual([]);
      expect(await runRow(db, second)).toMatchObject({
        status: 'failed',
        error_code: 'aiDisabled',
      });
    });
  });
});
