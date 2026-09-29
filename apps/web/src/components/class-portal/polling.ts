/**
 * How often the class screens poll (DECISIONS D-085). Pure, so the rules are unit-tested:
 *
 * - a device asks every 1.5 s ± 250 ms while its page is visible (the jitter spreads 30 devices
 *   that joined at the same moment), and every 5 s after a failure, until a call works again;
 * - the projector asks every second, and every 5 s after a failure;
 * - a busy answer (503) waits what `Retry-After` says (2 s by default, D-083), at least a second.
 */

export const DEVICE_POLL_MS = 1500;
export const DEVICE_POLL_JITTER_MS = 250;
export const PROJECTOR_POLL_MS = 1000;
export const ERROR_POLL_MS = 5000;
const DEFAULT_BUSY_MS = 2000;

/** The next device poll after a success (`failures` 0) or a run of failures. */
export function devicePollDelay(failures: number, random: () => number = Math.random): number {
  if (failures > 0) return ERROR_POLL_MS;
  return Math.round(DEVICE_POLL_MS + (random() * 2 - 1) * DEVICE_POLL_JITTER_MS);
}

/** The next projector poll. */
export function projectorPollDelay(failures: number): number {
  return failures > 0 ? ERROR_POLL_MS : PROJECTOR_POLL_MS;
}

/** How long to wait after a 503, from its `Retry-After` (seconds). */
export function busyDelay(retryAfter: string | null): number {
  const seconds = Number(retryAfter);
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_BUSY_MS;
  return Math.min(Math.max(seconds * 1000, 1000), 30_000);
}

/**
 * An instant as PostgreSQL writes it in JSON (`2026-11-03T14:05:00.123456+00:00`), in
 * milliseconds. The fraction is cut to milliseconds first: some browsers (older Safari on iPads)
 * refuse six digits. NaN when it is not an instant.
 */
export function parseInstant(value: string): number {
  return Date.parse(value.replace(/(\.\d{3})\d+/, '$1'));
}

/**
 * Seconds left before `closesAt` (an ISO instant on the server's clock), for a countdown;
 * `offsetMs` is the server's clock minus this device's. Null without a timer.
 */
export function secondsLeft(
  closesAt: string | null,
  offsetMs: number,
  now = Date.now(),
): number | null {
  if (!closesAt) return null;
  const end = parseInstant(closesAt);
  if (!Number.isFinite(end)) return null;
  return Math.max(0, Math.ceil((end - (now + offsetMs)) / 1000));
}

/** The server's clock minus this device's, from a `serverNow` it sent. */
export function clockOffset(serverNow: string | null | undefined, now = Date.now()): number {
  const server = serverNow ? parseInstant(serverNow) : NaN;
  return Number.isFinite(server) ? server - now : 0;
}
