import { describe, expect, it } from 'vitest';
import { CLASS_PORTAL_GATE, GONE_TOKEN_CACHE, createGate, createNegativeCache } from './gate';

/** A task that finishes when the test says so. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('bounded-concurrency gate (W4)', () => {
  it('runs 5 calls at once, queues 50, and answers busy after that', async () => {
    expect(CLASS_PORTAL_GATE).toEqual({ maxRunning: 5, maxWaiting: 50 });
    const gate = createGate();
    const tasks = Array.from({ length: 55 }, () => deferred<number>());
    let started = 0;
    let peak = 0;
    let active = 0;
    const calls = tasks.map((t, i) =>
      gate.run(async () => {
        started++;
        active++;
        peak = Math.max(peak, active);
        const value = await t.promise;
        active--;
        return value + i;
      }),
    );
    await flush();
    expect(started).toBe(5);
    expect(gate.running).toBe(5);
    expect(gate.waiting).toBe(50);

    expect(await gate.run(async () => 'never')).toEqual({ status: 'busy' });
    expect(gate.waiting).toBe(50);

    tasks.forEach((t) => t.resolve(1000));
    const results = await Promise.all(calls);
    expect(results.every((r) => r.status === 'ok')).toBe(true);
    expect(results[54]).toEqual({ status: 'ok', value: 1054 });
    expect(peak).toBe(5);
    expect(gate.running).toBe(0);
    expect(gate.waiting).toBe(0);
  });

  it('serves waiting calls first come, first served', async () => {
    const gate = createGate({ maxRunning: 1, maxWaiting: 3 });
    const first = deferred<void>();
    const order: string[] = [];
    const calls = [
      gate.run(async () => {
        await first.promise;
        order.push('a');
      }),
      gate.run(() => order.push('b')),
      gate.run(() => order.push('c')),
    ];
    await flush();
    // A call that arrives while the first finishes still queues behind b and c.
    first.resolve();
    calls.push(gate.run(() => order.push('d')));
    await Promise.all(calls);
    expect(order).toEqual(['a', 'b', 'c', 'd']);
  });

  it('gives the turn back when a task fails', async () => {
    const gate = createGate({ maxRunning: 1, maxWaiting: 1 });
    await expect(
      gate.run(async () => {
        throw new Error('statement timeout');
      }),
    ).rejects.toThrow('statement timeout');
    await expect(
      gate.run(() => {
        throw new Error('sync failure');
      }),
    ).rejects.toThrow('sync failure');
    expect(gate.running).toBe(0);
    expect(await gate.run(() => 'ok')).toEqual({ status: 'ok', value: 'ok' });
  });

  it('answers busy at once when nothing may wait', async () => {
    const gate = createGate({ maxRunning: 1, maxWaiting: 0 });
    const t = deferred<string>();
    const running = gate.run(() => t.promise);
    expect(await gate.run(() => 'x')).toEqual({ status: 'busy' });
    t.resolve('done');
    expect(await running).toEqual({ status: 'ok', value: 'done' });
  });

  it('refuses nonsense limits', () => {
    expect(() => createGate({ maxRunning: 0 })).toThrow(RangeError);
    expect(() => createGate({ maxWaiting: -1 })).toThrow(RangeError);
    expect(() => createGate({ maxRunning: 1.5 })).toThrow(RangeError);
  });
});

describe('negative cache (W4)', () => {
  const clock = () => {
    let t = 1_000_000;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  };

  it('remembers a gone token for 60 seconds by default', () => {
    expect(GONE_TOKEN_CACHE).toEqual({ maxEntries: 10_000, ttlMs: 60_000 });
    const c = clock();
    const cache = createNegativeCache({ now: c.now });
    expect(cache.has('a')).toBe(false);
    cache.add('a');
    expect(cache.has('a')).toBe(true);
    c.advance(59_999);
    expect(cache.has('a')).toBe(true);
    c.advance(1);
    expect(cache.has('a')).toBe(false);
    expect(cache.size).toBe(0);
  });

  it('does not extend the time to live on a hit, but does on a new add', () => {
    const c = clock();
    const cache = createNegativeCache({ ttlMs: 100, now: c.now });
    cache.add('a');
    c.advance(60);
    expect(cache.has('a')).toBe(true);
    c.advance(40);
    expect(cache.has('a')).toBe(false);
    cache.add('b');
    c.advance(60);
    cache.add('b');
    c.advance(60);
    expect(cache.has('b')).toBe(true);
  });

  it('drops the least recently used key when full', () => {
    const c = clock();
    const cache = createNegativeCache({ maxEntries: 3, now: c.now });
    cache.add('a');
    cache.add('b');
    cache.add('c');
    expect(cache.has('a')).toBe(true); // a is now the most recently used
    cache.add('d');
    expect(cache.size).toBe(3);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('c')).toBe(true);
    expect(cache.has('d')).toBe(true);
  });

  it('holds at most 10,000 keys by default', () => {
    const cache = createNegativeCache();
    for (let i = 0; i < 10_050; i++) cache.add(`token-${i}`);
    expect(cache.size).toBe(10_000);
    expect(cache.has('token-0')).toBe(false);
    expect(cache.has('token-49')).toBe(false);
    expect(cache.has('token-50')).toBe(true);
    expect(cache.has('token-10049')).toBe(true);
  });

  it('forgets a key on delete and everything on clear', () => {
    const cache = createNegativeCache();
    cache.add('a');
    cache.add('b');
    cache.delete('a');
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('refuses nonsense limits', () => {
    expect(() => createNegativeCache({ maxEntries: 0 })).toThrow(RangeError);
    expect(() => createNegativeCache({ ttlMs: 0 })).toThrow(RangeError);
    expect(() => createNegativeCache({ ttlMs: Number.NaN })).toThrow(RangeError);
  });
});
