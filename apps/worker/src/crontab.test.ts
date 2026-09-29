import type { JobHelpers } from 'graphile-worker';
import { describe, expect, it, vi } from 'vitest';
import { classModeMaintenance } from './class-mode';
import { CRONTAB_LINES, cronTask } from './crontab';
import { buildSubscriptions, subscribersFor, type HandlerContext } from './handlers';
import { libraryMaintenance, tickBulkRuns } from './library-bulk';
import { buildTaskList } from './tasks';

// The Phase 5 task bodies are their slices' (S1, S6); here only the wiring is checked.
vi.mock('./class-mode', () => ({ classModeMaintenance: vi.fn(async () => undefined) }));
vi.mock('./library-bulk', () => ({
  tickBulkRuns: vi.fn(async () => undefined),
  libraryMaintenance: vi.fn(async () => undefined),
}));

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function context(query = vi.fn(async () => ({ rows: [] }))): HandlerContext {
  return {
    integrations: {} as HandlerContext['integrations'],
    logger,
    pool: { query } as unknown as HandlerContext['pool'],
    ai: null,
  };
}

function tasks(ctx = context()) {
  return buildTaskList({
    subscriptions: buildSubscriptions({ logEvents: false }),
    context: ctx,
    batchSize: 100,
    aiJobRetentionDays: 30,
    bulkMaxRunUsd: 100,
  });
}

describe('the worker’s schedule', () => {
  it('runs only tasks the worker knows, each under its own job key', () => {
    const known = Object.keys(tasks());
    for (const line of CRONTAB_LINES) {
      const task = cronTask(line);
      expect(known, line).toContain(task);
      expect(line, line).toContain(`?jobKey=${task}`);
    }
  });

  it('schedules the Phase 5 maintenance and bulk tasks', () => {
    expect(CRONTAB_LINES).toEqual(
      expect.arrayContaining([
        '*/5 * * * * class_mode_maintenance ?jobKey=class_mode_maintenance',
        '*/5 * * * * library_bulk_tick ?jobKey=library_bulk_tick',
        '23 3 * * * library_maintenance ?jobKey=library_maintenance',
      ]),
    );
  });

  it('hands the Phase 5 tasks the pool, the AI runtime, the logger and the bulk cap', async () => {
    const ctx = context();
    const list = tasks(ctx);
    const helpers = {} as JobHelpers;
    await list.class_mode_maintenance!({}, helpers);
    expect(classModeMaintenance).toHaveBeenCalledWith({ db: ctx.pool, logger: ctx.logger });
    await list.library_bulk_tick!({}, helpers);
    expect(tickBulkRuns).toHaveBeenCalledWith({
      pool: ctx.pool,
      ai: null,
      logger: ctx.logger,
      maxRunUsd: 100,
    });
    await list.library_maintenance!({}, helpers);
    expect(libraryMaintenance).toHaveBeenCalledWith({ db: ctx.pool, logger: ctx.logger });
  });
});

describe('the bulk kick', () => {
  const subs = buildSubscriptions({ logEvents: false });

  it('listens to a run that starts and to a cancellation only', () => {
    const kick = subs.find((s) => s.handler === 'library_bulk_kick');
    expect(kick?.events).toEqual(['library_bulk_run.started', 'library_bulk_run.cancel_requested']);
    for (const type of ['library_bulk_run.started', 'library_bulk_run.cancel_requested']) {
      expect(subscribersFor(subs, type).map((s) => s.handler)).toContain('library_bulk_kick');
    }
    expect(subscribersFor(subs, 'library_bulk_run.completed').map((s) => s.handler)).not.toContain(
      'library_bulk_kick',
    );
  });

  it('queues the bulk tick now, under the tick’s job key', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const kick = subs.find((s) => s.handler === 'library_bulk_kick')!;
    await kick.run(
      {
        eventId: '00000000-0000-4000-8000-000000000001',
        eventType: 'library_bulk_run.started',
        boardId: null,
        schoolId: null,
        aggregateType: 'library_bulk_run',
        aggregateId: '00000000-0000-4000-8000-000000000002',
        payload: { runId: '00000000-0000-4000-8000-000000000002' },
        occurredAt: new Date().toISOString(),
      },
      context(query),
    );
    expect(query).toHaveBeenCalledTimes(1);
    const [sql] = query.mock.calls[0] as unknown as [string];
    expect(sql).toMatch(/graphile_worker\.add_job\('library_bulk_tick'/);
    expect(sql).toMatch(/job_key => 'library_bulk_tick'/);
    // `replace` (the default mode) moves a waiting tick to now.
    expect(sql).not.toMatch(/job_key_mode|run_at/);
  });
});
