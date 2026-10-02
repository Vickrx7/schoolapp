import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSubscriptions, subscribersFor } from './handlers';

/**
 * A restore hands the events of the hour before the backup back to the worker, because queued
 * jobs are not backed up (deploy/backup/restore.sh, DECISIONS D-115). Every handler of such an
 * event runs again, so the list may only hold events whose handlers read the current state and
 * make a repeat harmless.
 */
const restoreScript = readFileSync(
  new URL('../../../deploy/backup/restore.sh', import.meta.url),
  'utf8',
);

function redispatchedEvents(): string[] {
  const list = /^REDISPATCH_EVENTS=\(\n([\s\S]*?)\n\)$/m.exec(restoreScript)?.[1];
  if (!list) throw new Error('REDISPATCH_EVENTS not found in restore.sh');
  return list.split('\n').map((line) => line.trim());
}

/** Handlers that only read the current state (or only log), checked one by one. */
const IDEMPOTENT_HANDLERS = new Set([
  'log_event', // logs ids
  'ai_run_job', // claims the job only while it is still queued
  'sub_plan_refresh', // the absence's mark makes a repeat a no-op (D-047)
  'library_bulk_kick', // queues the bulk tick under one job key
  'staff_invitation_provision', // stops unless the invitation is still pending (D-107)
  'staff_auth_sync', // bans or unbans to match users.deactivated_at
]);

describe('the events a restore hands back to the worker', () => {
  const subscriptions = buildSubscriptions({ logEvents: true });

  it('are events the worker handles, each by idempotent handlers only', () => {
    const events = redispatchedEvents();
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event).toMatch(/^[a-z_]+(\.[a-z_]+)+$/);
      const handlers = subscribersFor(subscriptions, event).map((s) => s.handler);
      // More than the catch-all logger: a misspelt event would only be logged.
      expect(
        handlers.filter((h) => h !== 'log_event'),
        event,
      ).not.toEqual([]);
      for (const handler of handlers)
        expect(IDEMPOTENT_HANDLERS, `${event}: ${handler}`).toContain(handler);
    }
  });

  it('leave out events with effects outside the database', () => {
    expect(redispatchedEvents()).not.toContain('absence.published');
  });
});
