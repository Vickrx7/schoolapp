import { describe, expect, it } from 'vitest';
import { FIRST_POLL_MS, nextPollDelay, POLL_LIMIT_MS, pollExpired } from './poll';

describe('checking on a request', () => {
  it('checks less and less often while it waits, up to every 10 seconds', () => {
    const delays = [FIRST_POLL_MS];
    for (let i = 0; i < 20; i++) delays.push(nextPollDelay(delays.at(-1)!, 'waiting'));
    expect(delays.slice(0, 4)).toEqual([1_000, 1_500, 1_875, 2_344]);
    expect(delays.every((d, i) => i === 0 || d >= delays[i - 1]!)).toBe(true);
    expect(delays.at(-1)).toBe(10_000);
    // About 60 checks in 10 minutes instead of 400.
    let elapsed = 0;
    let checks = 0;
    for (let d = FIRST_POLL_MS; elapsed < 10 * 60_000; d = nextPollDelay(d, 'waiting')) {
      elapsed += d;
      checks++;
    }
    expect(checks).toBeLessThan(80);
  });

  it('backs off faster after an error but keeps trying', () => {
    expect(nextPollDelay(1_500, 'error')).toBe(3_000);
    expect(nextPollDelay(3_000, 'error')).toBe(6_000);
    expect(nextPollDelay(20_000, 'error')).toBe(30_000);
    expect(nextPollDelay(30_000, 'error')).toBe(30_000);
    // Back to normal once the server answers again.
    expect(nextPollDelay(30_000, 'waiting')).toBe(10_000);
  });

  it('gives up after the limit', () => {
    const created = '2026-09-28T13:00:00Z';
    const start = Date.parse(created);
    expect(pollExpired(created, start + POLL_LIMIT_MS - 1)).toBe(false);
    expect(pollExpired(created, start + POLL_LIMIT_MS + 1)).toBe(true);
    expect(pollExpired('not a date', start)).toBe(false);
  });
});
