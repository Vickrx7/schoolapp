/**
 * The worker's heartbeat and health check (DECISIONS D-112).
 *
 * - An in-process timer, every 60 s and not a graphile-worker job (so long AI jobs holding every
 *   slot cannot starve it), records `app.record_heartbeat('worker', release, {lastDispatchAt})`
 *   (`state.ts`) and then GETs `HEARTBEAT_URL_WORKER` when set (2 s timeout, errors ignored): the
 *   external monitor receives no data, only the ping.
 * - `GET /healthz` on `WORKER_HEALTH_PORT` (0: off) answers 200 while the last successful beat is
 *   less than 180 s old, else 503. The body says nothing more.
 *
 * Started in `index.ts` before the runner; `stop()` at shutdown.
 */
import { createServer, type Server } from 'node:http';
import type { Pool } from 'pg';
import type { Logger } from './logger';
import { workerState } from './state';

/** How often the worker beats. */
export const HEARTBEAT_INTERVAL_MS = 60_000;
/** How old the last successful beat may be for `/healthz` to answer 200 (three beats). */
export const HEALTHY_WITHIN_MS = 180_000;
/** The external monitor's ping gives up after this long. */
export const PING_TIMEOUT_MS = 2_000;
/** `system_heartbeats.release` holds at most 40 characters. */
const RELEASE_MAX = 40;

export interface HeartbeatOptions {
  /** Only `query` is used. */
  pool: Pick<Pool, 'query'>;
  logger: Logger;
  /** APP_RELEASE (D-117). */
  release: string;
  /** HEARTBEAT_URL_WORKER, pinged after each recorded beat. */
  heartbeatUrl?: string;
  /** Tests: replaces the global fetch for the ping. */
  fetch?: typeof fetch;
  /** Tests: the clock. */
  now?: () => number;
}

export interface Heartbeat {
  /**
   * Records one beat, then pings the monitor. True when the database took it. Never throws; a
   * tick still running is awaited instead of starting a second one.
   */
  tick(): Promise<boolean>;
  /** When the last beat the database took was recorded (ms since the epoch), or null. */
  lastSuccessAt(): number | null;
  /** Resolves once no beat is running. */
  idle(): Promise<void>;
}

/** Whether the worker is healthy: its last successful beat is recent enough. */
export function isHealthy(
  lastSuccessAt: number | null,
  now: number,
  withinMs: number = HEALTHY_WITHIN_MS,
): boolean {
  return lastSuccessAt !== null && now - lastSuccessAt < withinMs;
}

/** The error's code or name only: no message, which could carry anything. */
function errorCode(err: unknown): string {
  if (err && typeof err === 'object') {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z_]{1,40}$/.test(code)) return code;
    const name = (err as { name?: unknown }).name;
    if (typeof name === 'string') return name.slice(0, 40);
  }
  return 'unknown';
}

export function createHeartbeat(options: HeartbeatOptions): Heartbeat {
  const now = options.now ?? Date.now;
  const doFetch = options.fetch ?? fetch;
  const release = options.release.slice(0, RELEASE_MAX);
  let lastSuccess: number | null = null;
  let inFlight: Promise<boolean> | null = null;
  let failing = false;

  const ping = async (url: string) => {
    try {
      const res = await doFetch(url, { signal: AbortSignal.timeout(PING_TIMEOUT_MS) });
      await res.body?.cancel();
    } catch {
      // The monitor notices missing pings by itself.
    }
  };

  const beat = async (): Promise<boolean> => {
    try {
      const lastDispatchAt = workerState().lastDispatchAt;
      await options.pool.query(
        `select app.record_heartbeat('worker', $1, jsonb_build_object('lastDispatchAt', $2::timestamptz))`,
        [release, lastDispatchAt ? lastDispatchAt.toISOString() : null],
      );
    } catch (err) {
      if (!failing) options.logger.warn('heartbeat failed', { error: errorCode(err) });
      failing = true;
      return false;
    }
    lastSuccess = now();
    if (failing) options.logger.info('heartbeat recorded again');
    failing = false;
    if (options.heartbeatUrl) await ping(options.heartbeatUrl);
    return true;
  };

  return {
    tick() {
      inFlight ??= beat().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
    lastSuccessAt: () => lastSuccess,
    async idle() {
      if (inFlight) await inFlight;
    },
  };
}

/** `GET /healthz`: 200 or 503 with a one-word status, never details. Anything else is 404. */
export function createHealthServer(healthy: () => boolean): Server {
  return createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    if ((req.method === 'GET' || req.method === 'HEAD') && path === '/healthz') {
      const ok = healthy();
      res.writeHead(ok ? 200 : 503, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      res.end(
        req.method === 'HEAD' ? undefined : JSON.stringify({ status: ok ? 'ok' : 'unavailable' }),
      );
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'not_found' }));
  });
}

export interface HealthOptions {
  pool: Pick<Pool, 'query'>;
  logger: Logger;
  /** APP_RELEASE (D-117). */
  release: string;
  /** WORKER_HEALTH_PORT; 0 starts no server. */
  port: number;
  /** HEARTBEAT_URL_WORKER, pinged after each recorded beat. */
  heartbeatUrl?: string;
  /** Tests: a faster beat (default HEARTBEAT_INTERVAL_MS). */
  intervalMs?: number;
  /** Tests: a shorter staleness (default HEALTHY_WITHIN_MS). */
  healthyWithinMs?: number;
}

export interface HealthHandle {
  /** Whether `/healthz` answers 200 now. */
  healthy(): boolean;
  /** When the last beat the database took was recorded (ms since the epoch), or null. */
  lastSuccessAt(): number | null;
  /** Stops the timer and closes the server. */
  stop(): Promise<void>;
}

export async function startHealth(options: HealthOptions): Promise<HealthHandle> {
  const heartbeat = createHeartbeat(options);
  const withinMs = options.healthyWithinMs ?? HEALTHY_WITHIN_MS;
  const healthy = () => isHealthy(heartbeat.lastSuccessAt(), Date.now(), withinMs);

  // The first beat at once (not awaited: the worker starts even if the database is slow).
  void heartbeat.tick();
  const timer = setInterval(
    () => void heartbeat.tick(),
    options.intervalMs ?? HEARTBEAT_INTERVAL_MS,
  );
  timer.unref();

  let server: Server | null = null;
  if (options.port > 0) {
    const s = createHealthServer(healthy);
    await new Promise<void>((resolve, reject) => {
      s.once('error', reject);
      s.listen(options.port, () => {
        s.off('error', reject);
        resolve();
      });
    });
    server = s;
    options.logger.info('health check listening', { port: options.port });
  }

  return {
    healthy,
    lastSuccessAt: heartbeat.lastSuccessAt,
    async stop() {
      clearInterval(timer);
      if (server) {
        const s = server;
        server = null;
        await new Promise<void>((resolve) => s.close(() => resolve()));
      }
      // A beat still running finishes before the pool is closed.
      await heartbeat.idle();
    },
  };
}
