import { describe, expect, it, vi } from 'vitest';
import { buildHealth, checkReady, runProbes } from './health';

const ok = (status: number) => Promise.resolve({ status });

describe('health checks (D-112)', () => {
  it('liveness gives the release and nothing else', () => {
    expect(buildHealth('0.6.0')).toEqual({ status: 'ok', release: '0.6.0' });
  });

  it('is ready when Auth, PostgREST and the portals answer', async () => {
    const fetch = vi.fn((_url: string, _init: RequestInit) => ok(200));
    const ping = vi.fn(() => Promise.resolve());
    await expect(
      checkReady({
        supabaseUrl: 'http://127.0.0.1:54321/',
        anonKey: 'anon-key',
        portalPools: [{ name: 'subPortal', ping }],
        fetch,
      }),
    ).resolves.toEqual({ ok: true, failing: [] });
    expect(fetch.mock.calls.map(([url, init]) => [url, init.method ?? 'GET'])).toEqual([
      ['http://127.0.0.1:54321/auth/v1/health', 'GET'],
      ['http://127.0.0.1:54321/rest/v1/', 'HEAD'],
    ]);
    expect(fetch.mock.calls[0]![1].headers).toEqual({ apikey: 'anon-key' });
    expect(ping).toHaveBeenCalledOnce();
  });

  it('counts a PostgREST refusal as up, and 5xx or a failed Auth as down', async () => {
    const run = (auth: number, rest: number) =>
      checkReady({
        supabaseUrl: 'http://x',
        anonKey: 'k',
        portalPools: [],
        fetch: (url) => ok(url.includes('/auth/') ? auth : rest),
      });
    await expect(run(200, 401)).resolves.toEqual({ ok: true, failing: [] });
    await expect(run(200, 503)).resolves.toEqual({ ok: false, failing: ['rest'] });
    await expect(run(500, 200)).resolves.toEqual({ ok: false, failing: ['auth'] });
    await expect(run(404, 502)).resolves.toEqual({ ok: false, failing: ['auth', 'rest'] });
  });

  it('fails a probe that throws or takes longer than its time', async () => {
    const started = Date.now();
    await expect(
      checkReady({
        supabaseUrl: 'http://x',
        anonKey: 'k',
        portalPools: [
          { name: 'subPortal', ping: () => Promise.reject(new Error('password authentication')) },
          { name: 'classPortal', ping: () => new Promise(() => undefined) },
        ],
        fetch: (_url, init) =>
          new Promise((_, reject) =>
            init.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
          ),
        timeoutMs: 50,
      }),
    ).resolves.toEqual({ ok: false, failing: ['auth', 'rest', 'subPortal', 'classPortal'] });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('runs the probes at once', async () => {
    const slow = (name: string) => ({
      name,
      check: () => new Promise<void>((resolve) => setTimeout(resolve, 100)),
    });
    const started = Date.now();
    await expect(runProbes([slow('a'), slow('b'), slow('c')], 1000)).resolves.toEqual({
      ok: true,
      failing: [],
    });
    expect(Date.now() - started).toBeLessThan(290);
  });
});
