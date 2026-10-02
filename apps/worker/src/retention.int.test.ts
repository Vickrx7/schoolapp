/**
 * Integration test for the nightly retention task (DECISIONS D-105): the worker's
 * `retention_maintenance` runs `app.retention_maintenance()`, logs its totals (counts only) and
 * the `retention` heartbeat is updated. Needs a migrated and seeded database (DATABASE_URL). Runs
 * in a transaction that is rolled back. Run with `pnpm test:int`, with the worker stopped.
 */
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import type { Logger } from './logger';
import { RETENTION_COUNT_KEYS, retentionMaintenance } from './retention';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required for integration tests');

const pool = new pg.Pool({ connectionString });

afterAll(async () => {
  await pool.end();
});

interface LogEntry {
  message: string;
  data?: Record<string, unknown>;
}

function recordingLogger(): Logger & { entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  return {
    entries,
    info: (message, data) => void entries.push({ message, data }),
    warn: (message, data) => void entries.push({ message, data }),
    error: (message, data) => void entries.push({ message, data }),
  };
}

describe('retention_maintenance (D-105)', () => {
  it('purges, logs totals only and records the retention heartbeat', async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      // An event dispatched 91 days ago and one still pending.
      await client.query(
        `insert into public.event_outbox (event_type, occurred_at, dispatched_at, payload) values
           ('test.retention_int', now() - interval '100 days', now() - interval '91 days', '{}'),
           ('test.retention_int', now() - interval '100 days', null, '{}')`,
      );
      const logger = recordingLogger();
      const totals = await retentionMaintenance({ db: client, logger });

      expect(totals.outbox).toBeGreaterThanOrEqual(1);
      const { rows: left } = await client.query<{ n: number }>(
        `select count(*)::int as n from public.event_outbox where event_type = 'test.retention_int'`,
      );
      expect(left[0]!.n).toBe(1);

      expect(logger.entries).toHaveLength(1);
      const [entry] = logger.entries;
      expect(entry!.message).toBe('retention done');
      expect(Object.keys(entry!.data ?? {}).sort()).toEqual(
        [...RETENTION_COUNT_KEYS, 'authLogs'].sort(),
      );
      for (const value of Object.values(entry!.data ?? {})) {
        expect(typeof value === 'number' || value === 'not_permitted').toBe(true);
      }

      const { rows: beat } = await client.query<{ fresh: boolean; outbox: number }>(
        `select beat_at = now() as fresh, (details ->> 'outbox')::int as outbox
         from public.system_heartbeats where component = 'retention'`,
      );
      expect(beat[0]).toEqual({ fresh: true, outbox: totals.outbox });

      // A second run on the same connection works (no leftover temporary state).
      const again = await retentionMaintenance({ db: client, logger });
      expect(again.outbox).toBe(0);
    } finally {
      await client.query('rollback').catch(() => undefined);
      client.release();
    }
  });
});
