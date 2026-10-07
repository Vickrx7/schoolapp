import type { JobHelpers } from 'graphile-worker';
import { describe, expect, it, vi } from 'vitest';
import { classModeMaintenance } from './class-mode';
import { CRONTAB_LINES, cronTask } from './crontab';
import { buildSubscriptions, subscribersFor, type HandlerContext } from './handlers';
import { libraryMaintenance, tickBulkRuns } from './library-bulk';
import { retentionMaintenance } from './retention';
import { provisionInvitation, syncStaffAuth } from './staff';
import { workerState } from './state';
import { buildTaskList } from './tasks';

// The Phase 5 task bodies are their slices' (S1, S6); here only the wiring is checked.
vi.mock('./class-mode', () => ({ classModeMaintenance: vi.fn(async () => undefined) }));
vi.mock('./library-bulk', () => ({
  tickBulkRuns: vi.fn(async () => undefined),
  libraryMaintenance: vi.fn(async () => undefined),
}));
// The Phase 6 bodies are their slices' (S2 retention, S4 staff accounts); here only the wiring.
vi.mock('./retention', () => ({ retentionMaintenance: vi.fn(async () => undefined) }));
vi.mock('./staff', () => ({
  provisionInvitation: vi.fn(async () => undefined),
  syncStaffAuth: vi.fn(async () => undefined),
}));

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function context(query = vi.fn(async () => ({ rows: [] }))): HandlerContext {
  return {
    integrations: {} as HandlerContext['integrations'],
    logger,
    pool: { query } as unknown as HandlerContext['pool'],
    ai: null,
    authAdmin: null,
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

describe('the Phase 6 tasks and handlers', () => {
  const event = (eventType: string, aggregateId: string | null) => ({
    eventId: '00000000-0000-4000-8000-000000000001',
    eventType,
    boardId: null,
    schoolId: null,
    aggregateType: null,
    aggregateId,
    payload: {},
    occurredAt: new Date().toISOString(),
  });

  it('runs retention nightly after the other clean-ups (D-105)', async () => {
    expect(CRONTAB_LINES).toContain(
      '53 3 * * * retention_maintenance ?jobKey=retention_maintenance',
    );
    const ctx = context();
    await tasks(ctx).retention_maintenance!({}, {} as JobHelpers);
    expect(retentionMaintenance).toHaveBeenCalledWith({ db: ctx.pool, logger: ctx.logger });
  });

  it('provisions an invited person’s account and follows access changes (D-107)', async () => {
    const subs = buildSubscriptions({ logEvents: false });
    expect(subscribersFor(subs, 'staff_invitation.created').map((s) => s.handler)).toEqual([
      'staff_invitation_provision',
    ]);
    expect(subscribersFor(subs, 'staff.access_changed').map((s) => s.handler)).toEqual([
      'staff_auth_sync',
    ]);
    const ctx = context();
    const provision = subs.find((s) => s.handler === 'staff_invitation_provision')!;
    await provision.run(event('staff_invitation.created', 'invitation-1'), ctx);
    expect(provisionInvitation).toHaveBeenCalledWith('invitation-1', {
      pool: ctx.pool,
      authAdmin: null,
      logger: ctx.logger,
    });
    const sync = subs.find((s) => s.handler === 'staff_auth_sync')!;
    await sync.run(event('staff.access_changed', 'user-1'), ctx);
    expect(syncStaffAuth).toHaveBeenCalledWith('user-1', {
      pool: ctx.pool,
      authAdmin: null,
      logger: ctx.logger,
    });
    // An event without its aggregate is dropped, not retried forever.
    vi.mocked(syncStaffAuth).mockClear();
    await sync.run(event('staff.access_changed', null), ctx);
    expect(syncStaffAuth).not.toHaveBeenCalled();
  });

  it('remembers when the outbox was last drained, for the heartbeat (D-112)', async () => {
    // An empty outbox: begin, a batch of nothing, commit.
    const query = vi.fn(async () => ({ rows: [] }));
    const helpers = {
      withPgClient: async <T>(fn: (client: unknown) => Promise<T>) => fn({ query }),
    } as unknown as JobHelpers;
    const before = Date.now();
    await tasks().dispatch_outbox!({}, helpers);
    expect(workerState().lastDispatchAt?.getTime()).toBeGreaterThanOrEqual(before);
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
