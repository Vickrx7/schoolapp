/**
 * The worker's heartbeat and health check (DECISIONS D-112; Phase 6 slice S2 writes them).
 *
 * - An in-process timer, every 60 s and not a graphile-worker job (so long AI jobs holding every
 *   slot cannot starve it), records `app.record_heartbeat('worker', release, {lastDispatchAt})`
 *   (`state.ts`) and then GETs `HEARTBEAT_URL_WORKER` when set (2 s timeout, errors ignored): the
 *   external monitor receives no data.
 * - `GET /healthz` on `WORKER_HEALTH_PORT` (0: off) answers 200 while the last tick succeeded
 *   less than 180 s ago, else 503.
 *
 * Started in `index.ts` before the runner; `stop()` at shutdown. Does nothing until S2 fills it.
 */
import type { Pool } from 'pg';
import type { Logger } from './logger';

export interface HealthOptions {
  pool: Pool;
  logger: Logger;
  /** APP_RELEASE (D-117). */
  release: string;
  /** WORKER_HEALTH_PORT; 0 starts no server. */
  port: number;
  /** HEARTBEAT_URL_WORKER, pinged after each recorded beat. */
  heartbeatUrl?: string;
}

export interface HealthHandle {
  /** Stops the timer and closes the server. */
  stop(): Promise<void>;
}

export async function startHealth(_options: HealthOptions): Promise<HealthHandle> {
  return { stop: async () => undefined };
}
