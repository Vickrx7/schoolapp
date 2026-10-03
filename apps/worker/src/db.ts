/**
 * The worker's connection pool (DECISIONS D-107, as amended in the Phase 6 review). One
 * connection listens for events for good; each job running at once holds at most one more
 * (graphile-worker runs WORKER_CONCURRENCY jobs); the rest is for the queue itself and the
 * heartbeat. A job that cannot get a connection within CONNECTION_TIMEOUT_MS fails, and
 * graphile-worker tries it again later, instead of waiting forever and stopping every other job
 * and the heartbeat with it.
 */
import type { WorkerEnv } from '@lynx/config';
import type { PoolConfig } from 'pg';

export const CONNECTION_TIMEOUT_MS = 30_000;

export function workerPoolConfig(
  env: Pick<WorkerEnv, 'DATABASE_URL' | 'WORKER_CONCURRENCY'>,
): PoolConfig {
  return {
    connectionString: env.DATABASE_URL,
    max: env.WORKER_CONCURRENCY + 3,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  };
}
