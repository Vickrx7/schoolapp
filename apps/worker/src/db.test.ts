import { describe, expect, it } from 'vitest';
import { CONNECTION_TIMEOUT_MS, workerPoolConfig } from './db';

describe('workerPoolConfig (D-107, Phase 6 review)', () => {
  it('sizes the pool for the jobs, the listener and the queue, and never waits forever', () => {
    const config = workerPoolConfig({ DATABASE_URL: 'postgresql://x', WORKER_CONCURRENCY: 4 });
    expect(config).toEqual({
      connectionString: 'postgresql://x',
      max: 7,
      connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    });
    expect(CONNECTION_TIMEOUT_MS).toBeGreaterThan(0);
    expect(CONNECTION_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
  });
});
