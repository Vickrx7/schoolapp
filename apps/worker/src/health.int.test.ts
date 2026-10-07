/**
 * Integration test for the worker's heartbeat and health check (DECISIONS D-112), against the
 * database (DATABASE_URL): `/healthz` answers 503 before a beat, 200 after, and 503 again once
 * the database can no longer be reached; and the timer keeps beating while long jobs hold every
 * graphile-worker slot (it is not a job). Run with `pnpm test:int`, with the worker stopped.
 */
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { Logger as GraphileLogger, run, type Runner } from 'graphile-worker';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { createHealthServer, createHeartbeat, isHealthy, startHealth } from './health';
import type { Logger } from './logger';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required for integration tests');

const silent: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
const pools: pg.Pool[] = [];

function newPool(max = 10): pg.Pool {
  const pool = new pg.Pool({ connectionString, max });
  pools.push(pool);
  return pool;
}

afterAll(async () => {
  for (const pool of pools) await pool.end().catch(() => undefined);
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function status(url: string): Promise<number> {
  const res = await fetch(url);
  await res.body?.cancel();
  return res.status;
}

async function workerBeat(pool: pg.Pool): Promise<{ at: Date; release: string } | undefined> {
  const { rows } = await pool.query<{ at: Date; release: string }>(
    `select beat_at as at, release from public.system_heartbeats where component = 'worker'`,
  );
  return rows[0];
}

describe('the worker heartbeat (D-112)', () => {
  it('answers 503 before a beat, 200 after, and 503 once the database is gone', async () => {
    const pool = newPool(2);
    const heartbeat = createHeartbeat({ pool, logger: silent, release: 'int-test' });
    const server = createHealthServer(() => isHealthy(heartbeat.lastSuccessAt(), Date.now(), 400));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/healthz`;
    try {
      expect(await status(url)).toBe(503);

      const before = Date.now();
      expect(await heartbeat.tick()).toBe(true);
      expect(await status(url)).toBe(200);
      const beat = await workerBeat(pool);
      expect(beat?.release).toBe('int-test');
      expect(beat!.at.getTime()).toBeGreaterThanOrEqual(before - 5_000);

      // The database becomes unreachable: beats fail and the check turns unhealthy.
      await pool.end();
      expect(await heartbeat.tick()).toBe(false);
      await sleep(500);
      expect(await heartbeat.tick()).toBe(false);
      expect(await status(url)).toBe(503);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('keeps beating while long jobs hold every slot', async () => {
    const concurrency = 4;
    // As in index.ts: the jobs and the heartbeat share one pool of concurrency + 3 connections.
    const pool = newPool(concurrency + 3);
    const task = `health_int_sleep_${Date.now()}`;
    let running = 0;
    let maxRunning = 0;
    const runner: Runner = await run({
      pgPool: pool,
      concurrency,
      noHandleSignals: true,
      pollInterval: 100,
      logger: new GraphileLogger(() => () => undefined),
      taskList: {
        [task]: async (_payload, helpers) => {
          running += 1;
          maxRunning = Math.max(maxRunning, running);
          // A long job holding a database connection, as a running AI job does.
          await helpers.withPgClient((client) => client.query('select pg_sleep(2.5)'));
          running -= 1;
        },
      },
    });
    const port = await freePort();
    const health = await startHealth({
      pool,
      logger: silent,
      release: 'int-test',
      port,
      intervalMs: 200,
      healthyWithinMs: 1_000,
    });
    try {
      for (let i = 0; i < concurrency; i += 1) await runner.addJob(task, {});
      // Wait until every slot is busy.
      for (let i = 0; i < 50 && running < concurrency; i += 1) await sleep(50);
      expect(running).toBe(concurrency);

      const first = health.lastSuccessAt();
      const firstBeat = await workerBeat(pool);
      await sleep(1_000);
      expect(running).toBe(concurrency);
      expect(health.lastSuccessAt()!).toBeGreaterThan(first ?? 0);
      expect((await workerBeat(pool))!.at.getTime()).toBeGreaterThan(firstBeat!.at.getTime());
      expect(await status(`http://127.0.0.1:${port}/healthz`)).toBe(200);
    } finally {
      await health.stop();
      await runner.stop();
    }
    expect(maxRunning).toBe(concurrency);
  });
});
