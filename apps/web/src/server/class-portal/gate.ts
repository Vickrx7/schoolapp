/**
 * Load shedding for the device API (DECISIONS D-083). A class of 30 devices polls
 * about 20 times a second, and the portal pool has 5 connections, so each web server process:
 *
 * - lets at most 5 portal calls run at once and 50 wait for a turn, first come first served;
 *   any further call gets `busy` at once, which the route handler answers with 503 and
 *   `Retry-After: 2` (the device's poller backs off), instead of piling up behind the pool;
 * - remembers device tokens the database called `gone` for 60 seconds (at most 10,000 of them,
 *   least recently used dropped first), so a flood of random tokens never reaches the database.
 *   Tokens are random and never reused, so a token that is gone cannot come back.
 *
 * Nothing here knows about the database: `db.ts` wraps its pool with a gate, and the route
 * handlers keep a negative cache of token hashes (never raw tokens). Pure so it is unit-tested.
 */

/** Seconds a device waits after `busy` (`Retry-After`). */
export const BUSY_RETRY_AFTER_SECONDS = 2;

// ---------------------------------------------------------------------------------------
// Bounded-concurrency gate
// ---------------------------------------------------------------------------------------

export interface GateOptions {
  /** Calls running at once (the pool's size). */
  maxRunning?: number;
  /** Calls waiting for a turn; one more is `busy`. */
  maxWaiting?: number;
}

export const CLASS_PORTAL_GATE: Required<GateOptions> = { maxRunning: 5, maxWaiting: 50 };

export type GateResult<T> = { status: 'ok'; value: T } | { status: 'busy' };

export interface Gate {
  /**
   * Runs the task when a turn is free, or `busy` when too many calls already wait. The task's
   * own error is thrown as it is, and its turn is given back either way.
   */
  run<T>(task: () => Promise<T> | T): Promise<GateResult<T>>;
  /** Calls running now. */
  readonly running: number;
  /** Calls waiting for a turn now. */
  readonly waiting: number;
}

export function createGate(options: GateOptions = {}): Gate {
  const maxRunning = options.maxRunning ?? CLASS_PORTAL_GATE.maxRunning;
  const maxWaiting = options.maxWaiting ?? CLASS_PORTAL_GATE.maxWaiting;
  if (!Number.isInteger(maxRunning) || maxRunning < 1) throw new RangeError('maxRunning');
  if (!Number.isInteger(maxWaiting) || maxWaiting < 0) throw new RangeError('maxWaiting');

  let running = 0;
  const queue: (() => void)[] = [];

  // A finished call hands its turn to the first waiting one, so a call arriving in between
  // cannot jump the queue.
  const release = () => {
    const next = queue.shift();
    if (next) next();
    else running--;
  };

  return {
    get running() {
      return running;
    },
    get waiting() {
      return queue.length;
    },
    async run<T>(task: () => Promise<T> | T): Promise<GateResult<T>> {
      if (running < maxRunning) running++;
      else if (queue.length < maxWaiting) await new Promise<void>((resolve) => queue.push(resolve));
      else return { status: 'busy' };
      try {
        return { status: 'ok', value: await task() };
      } finally {
        release();
      }
    },
  };
}

// ---------------------------------------------------------------------------------------
// Negative cache (LRU with a time to live)
// ---------------------------------------------------------------------------------------

export interface NegativeCacheOptions {
  maxEntries?: number;
  ttlMs?: number;
  /** The clock, in milliseconds (tests pass their own). */
  now?: () => number;
}

export const GONE_TOKEN_CACHE = { maxEntries: 10_000, ttlMs: 60_000 } as const;

export interface NegativeCache {
  /** Whether the key was added less than the time to live ago. A hit makes it recently used. */
  has(key: string): boolean;
  /** Adds the key (again) for the time to live, dropping the least recently used when full. */
  add(key: string): void;
  delete(key: string): void;
  clear(): void;
  /** Keys held, including expired ones not dropped yet. */
  readonly size: number;
}

export function createNegativeCache(options: NegativeCacheOptions = {}): NegativeCache {
  const maxEntries = options.maxEntries ?? GONE_TOKEN_CACHE.maxEntries;
  const ttlMs = options.ttlMs ?? GONE_TOKEN_CACHE.ttlMs;
  const now = options.now ?? Date.now;
  if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new RangeError('maxEntries');
  if (!(ttlMs > 0)) throw new RangeError('ttlMs');

  // Key → expiry time. A Map keeps insertion order: the first key is the least recently used.
  const entries = new Map<string, number>();

  return {
    has(key) {
      const expiresAt = entries.get(key);
      if (expiresAt === undefined) return false;
      entries.delete(key);
      if (expiresAt <= now()) return false;
      entries.set(key, expiresAt);
      return true;
    },
    add(key) {
      entries.delete(key);
      entries.set(key, now() + ttlMs);
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
    },
    delete(key) {
      entries.delete(key);
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}
