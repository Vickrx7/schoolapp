/** When the job page checks on a request again (see job-progress.tsx). */

export const FIRST_POLL_MS = 1_000;
const WAIT_CAP_MS = 10_000;
const ERROR_CAP_MS = 30_000;

/**
 * After this long, the page stops checking and says the request is taking too long. The worker
 * fails a running request after 15 minutes and a queued one after an hour, so the request may
 * still finish: the teacher can check again.
 */
export const POLL_LIMIT_MS = 15 * 60_000;

/**
 * The next delay: a little longer each time while the request waits (most finish within a
 * minute), and backing off faster after an error (server or connection), within caps.
 */
export function nextPollDelay(previous: number, outcome: 'waiting' | 'error'): number {
  return outcome === 'waiting'
    ? Math.min(Math.max(Math.round(previous * 1.25), 1_500), WAIT_CAP_MS)
    : Math.min(Math.max(previous * 2, 3_000), ERROR_CAP_MS);
}

/** Whether a request created at `createdAt` has been waiting past the limit. */
export function pollExpired(createdAt: string, now = Date.now()): boolean {
  const created = Date.parse(createdAt);
  return Number.isFinite(created) && now - created > POLL_LIMIT_MS;
}
