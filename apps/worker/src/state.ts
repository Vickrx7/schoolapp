/**
 * What the worker knows about its own work, for its heartbeat (DECISIONS D-112): when the outbox
 * was last dispatched. `dispatch_outbox` runs every minute and on every notification, so an old
 * time means the queue is stuck even while the process is alive. In memory only.
 */

let lastDispatchAt: Date | null = null;

/** Called after each successful drain of the outbox. */
export function recordDispatch(at: Date = new Date()): void {
  lastDispatchAt = at;
}

export interface WorkerState {
  /** The last successful outbox dispatch, or null before the first one. */
  lastDispatchAt: Date | null;
}

export function workerState(): WorkerState {
  return { lastDispatchAt };
}
