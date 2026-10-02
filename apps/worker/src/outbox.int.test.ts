/**
 * Integration test: needs a migrated database (DATABASE_URL), e.g. the local Supabase stack.
 * Run with `pnpm test:int`.
 */
import { createMockIntegrations } from '@lynx/integrations';
import { runMigrations } from 'graphile-worker';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OutboxEvent, Subscription } from './handlers';
import { createLogger } from './logger';
import { dispatchOutbox } from './outbox';
import { buildTaskList } from './tasks';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required for integration tests');

const pool = new pg.Pool({ connectionString });
const received: OutboxEvent[] = [];
const subs: Subscription[] = [
  { handler: 'test_all', events: ['*'], run: async (e) => void received.push(e) },
  { handler: 'test_lessons', events: ['lesson.completed'], run: async () => undefined },
];

beforeAll(async () => {
  await runMigrations({ pgPool: pool });
});

afterAll(async () => {
  await pool.query(
    `delete from graphile_worker._private_jobs where key like 'event:%test%' or payload::text like '%test_%'`,
  );
  await pool.query(`delete from public.event_outbox where event_type like 'test.%'`);
  await pool.end();
});

describe('outbox dispatch', () => {
  it('creates one job per subscribed handler and marks events dispatched', async () => {
    const { rows } = await pool.query<{ id: string }>(
      `select app.emit_event('test.dispatched', null, null, 'thing', gen_random_uuid(), '{"n": 1}') as id`,
    );
    const eventId = rows[0]!.id;

    const client = await pool.connect();
    try {
      // Other pending events (e.g. from the seed) may be dispatched too; that's fine.
      await dispatchOutbox(client, subs, 1000);
    } finally {
      client.release();
    }

    const outbox = await pool.query(
      'select dispatched_at from public.event_outbox where event_id = $1',
      [eventId],
    );
    expect(outbox.rows[0].dispatched_at).not.toBeNull();

    const jobs = await pool.query<{ key: string }>(
      `select key from graphile_worker._private_jobs where key like $1 order by key`,
      [`event:${eventId}:%`],
    );
    expect(jobs.rows.map((j) => j.key)).toEqual([`event:${eventId}:test_all`]);
  });

  it('does not dispatch the same event twice', async () => {
    const { rows } = await pool.query<{ id: string }>(
      `select app.emit_event('test.once', null, null, null, null) as id`,
    );
    const client = await pool.connect();
    try {
      await dispatchOutbox(client, subs, 1000);
      await dispatchOutbox(client, subs, 1000);
    } finally {
      client.release();
    }
    const jobs = await pool.query(
      `select count(*)::int as n from graphile_worker._private_jobs where key like $1`,
      [`event:${rows[0]!.id}:%`],
    );
    expect(jobs.rows[0].n).toBe(1);
  });

  it('runs the handler with the stored event', async () => {
    const { rows } = await pool.query<{ id: string }>(
      `select app.emit_event('test.handled', null, null, 'thing', null, '{"hello": "monde"}') as id`,
    );
    const tasks = buildTaskList({
      subscriptions: subs,
      context: {
        integrations: createMockIntegrations(),
        logger: createLogger('test'),
        pool,
        ai: null,
        authAdmin: null,
      },
      batchSize: 10,
      aiJobRetentionDays: 30,
      bulkMaxRunUsd: 100,
    });
    const helpers = {
      withPgClient: async <T>(fn: (c: pg.PoolClient) => Promise<T>) => {
        const c = await pool.connect();
        try {
          return await fn(c);
        } finally {
          c.release();
        }
      },
      logger: { warn: () => undefined },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await tasks.handle_event!({ eventId: rows[0]!.id, handler: 'test_all' }, helpers as any);
    expect(received.at(-1)).toMatchObject({
      eventType: 'test.handled',
      payload: { hello: 'monde' },
    });
  });
});
