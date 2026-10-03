import { describe, expect, it } from 'vitest';
import {
  ERROR_POLL_MS,
  busyDelay,
  clockOffset,
  devicePollDelay,
  parseInstant,
  projectorPollDelay,
  secondsLeft,
} from './polling';

describe('class-mode polling (D-085)', () => {
  it('polls devices every 1.5 s ± 250 ms, and every 5 s after a failure', () => {
    expect(devicePollDelay(0, () => 0)).toBe(1250);
    expect(devicePollDelay(0, () => 0.5)).toBe(1500);
    expect(devicePollDelay(0, () => 0.999999)).toBe(1750);
    for (let i = 0; i < 100; i++) {
      const delay = devicePollDelay(0);
      expect(delay).toBeGreaterThanOrEqual(1250);
      expect(delay).toBeLessThanOrEqual(1750);
    }
    expect(devicePollDelay(1)).toBe(ERROR_POLL_MS);
    expect(devicePollDelay(7)).toBe(ERROR_POLL_MS);
  });

  it('polls the projector every second', () => {
    expect(projectorPollDelay(0)).toBe(1000);
    expect(projectorPollDelay(2)).toBe(ERROR_POLL_MS);
  });

  it('waits what Retry-After says when the portal is busy', () => {
    expect(busyDelay('2')).toBe(2000);
    expect(busyDelay(null)).toBe(2000);
    expect(busyDelay('abc')).toBe(2000);
    expect(busyDelay('0.2')).toBe(1000);
    expect(busyDelay('600')).toBe(30_000);
  });

  it('counts down on the server’s clock', () => {
    const now = Date.parse('2026-11-03T14:00:00.000Z');
    expect(secondsLeft(null, 0, now)).toBeNull();
    expect(secondsLeft('2026-11-03T14:00:20.000Z', 0, now)).toBe(20);
    // This device's clock runs 5 s behind the server's.
    const offset = clockOffset('2026-11-03T14:00:05.000+00:00', now);
    expect(offset).toBe(5000);
    expect(secondsLeft('2026-11-03T14:00:20.000Z', offset, now)).toBe(15);
    expect(secondsLeft('2026-11-03T13:59:00.000Z', 0, now)).toBe(0);
    expect(clockOffset('not a date', now)).toBe(0);
    // PostgreSQL's microseconds.
    expect(parseInstant('2026-11-03T14:05:00.123456+00:00')).toBe(
      Date.parse('2026-11-03T14:05:00.123Z'),
    );
  });
});
