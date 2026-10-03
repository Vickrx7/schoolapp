import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createHealthServer,
  createHeartbeat,
  HEALTHY_WITHIN_MS,
  isHealthy,
  PING_TIMEOUT_MS,
  startHealth,
} from './health';
import { recordDispatch } from './state';

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe('isHealthy (D-112)', () => {
  it('is healthy while the last successful beat is less than 180 s old', () => {
    expect(HEALTHY_WITHIN_MS).toBe(180_000);
    expect(isHealthy(null, 1_000_000)).toBe(false);
    expect(isHealthy(1_000_000, 1_000_000 + 179_999)).toBe(true);
    expect(isHealthy(1_000_000, 1_000_000 + 180_000)).toBe(false);
    expect(isHealthy(1_000, 1_400, 500)).toBe(true);
  });
});

describe('createHeartbeat', () => {
  it('records the worker’s beat with its release and last dispatch, then pings the monitor', async () => {
    recordDispatch(new Date('2026-11-12T12:00:00Z'));
    const query = vi.fn(async () => ({ rows: [] }));
    const fetchMock = vi.fn(async () => new Response('ok'));
    const hb = createHeartbeat({
      pool: { query } as never,
      logger: logger(),
      release: 'r'.repeat(50),
      heartbeatUrl: 'https://hc.example.test/ping/abc',
      fetch: fetchMock as unknown as typeof fetch,
      now: () => 42,
    });
    expect(hb.lastSuccessAt()).toBeNull();
    expect(await hb.tick()).toBe(true);
    expect(hb.lastSuccessAt()).toBe(42);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("app.record_heartbeat('worker'"), [
      'r'.repeat(40),
      '2026-11-12T12:00:00.000Z',
    ]);
    // Only the URL: the monitor receives no data.
    expect(fetchMock).toHaveBeenCalledWith('https://hc.example.test/ping/abc', {
      signal: expect.any(AbortSignal),
    });
    expect(PING_TIMEOUT_MS).toBe(2_000);
  });

  it('does not ping when the database refused the beat, and logs the failure once', async () => {
    const log = logger();
    const query = vi.fn(async () => {
      throw Object.assign(new Error('connect ECONNREFUSED x@y.ca'), { code: 'ECONNREFUSED' });
    });
    const fetchMock = vi.fn(async () => new Response('ok'));
    const hb = createHeartbeat({
      pool: { query } as never,
      logger: log,
      release: 'dev',
      heartbeatUrl: 'https://hc.example.test/ping/abc',
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(await hb.tick()).toBe(false);
    expect(await hb.tick()).toBe(false);
    expect(hb.lastSuccessAt()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith('heartbeat failed', { error: 'ECONNREFUSED' });
  });

  it('ignores a monitor that fails, and never runs two beats at once', async () => {
    let release!: () => void;
    const query = vi.fn(
      () => new Promise<{ rows: [] }>((resolve) => (release = () => resolve({ rows: [] }))),
    );
    const hb = createHeartbeat({
      pool: { query } as never,
      logger: logger(),
      release: 'dev',
      heartbeatUrl: 'https://hc.example.test/ping/abc',
      fetch: (async () => {
        throw new Error('network down');
      }) as unknown as typeof fetch,
    });
    const first = hb.tick();
    const second = hb.tick();
    expect(query).toHaveBeenCalledTimes(1);
    release();
    expect(await first).toBe(true);
    expect(await second).toBe(true);
  });
});

describe('the health server', () => {
  const servers: { close(): void }[] = [];
  afterEach(() => {
    for (const s of servers.splice(0)) s.close();
  });

  async function serve(healthy: () => boolean): Promise<string> {
    const server = createHealthServer(healthy);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it('answers /healthz with 200 or 503 and nothing more', async () => {
    let ok = false;
    const base = await serve(() => ok);
    let res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: 'unavailable' });
    expect(res.headers.get('cache-control')).toBe('no-store');
    ok = true;
    res = await fetch(`${base}/healthz?x=1`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
    res = await fetch(`${base}/`);
    expect(res.status).toBe(404);
    await res.body?.cancel();
    res = await fetch(`${base}/healthz`, { method: 'POST' });
    expect(res.status).toBe(404);
    await res.body?.cancel();
  });
});

describe('startHealth', () => {
  it('beats at once and on its timer, with no server when the port is 0', async () => {
    vi.useFakeTimers();
    try {
      const query = vi.fn(async () => ({ rows: [] }));
      const handle = await startHealth({
        pool: { query } as never,
        logger: logger(),
        release: 'dev',
        port: 0,
        intervalMs: 1_000,
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(query).toHaveBeenCalledTimes(1);
      expect(handle.healthy()).toBe(true);
      await vi.advanceTimersByTimeAsync(3_000);
      expect(query).toHaveBeenCalledTimes(4);
      await handle.stop();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(query).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });
});
