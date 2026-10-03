/**
 * Event handlers: how modules and integrations react to domain events.
 *
 * Modules never call each other directly; they emit events (app.emit_event in Postgres) and
 * subscribe here. Handlers must be idempotent: a handler can run more than once for the
 * same event (retries), so use event.eventId as the idempotency key.
 */
import type { Integrations } from '@lynx/integrations';
import type { Pool } from 'pg';
import { runAiJob, type AiRuntime } from './ai';
import type { AuthAdmin } from './auth-admin';
import type { Logger } from './logger';
import { provisionInvitation, syncStaffAuth } from './staff';
import { refreshAbsencePlans } from './sub-plans/refresh';

export interface OutboxEvent {
  eventId: string;
  eventType: string;
  boardId: string | null;
  schoolId: string | null;
  aggregateType: string | null;
  aggregateId: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface HandlerContext {
  integrations: Integrations;
  logger: Logger;
  pool: Pool;
  /** Null when AI is turned off for this deployment (AI_PROVIDER=none). */
  ai: AiRuntime | null;
  /**
   * Supabase Auth's admin API for staff accounts (D-107); null without SUPABASE_URL and
   * SUPABASE_SERVICE_ROLE_KEY (invitations then fail as `authNotConfigured`).
   */
  authAdmin: AuthAdmin | null;
}

export type EventHandler = (event: OutboxEvent, ctx: HandlerContext) => Promise<void>;

export interface Subscription {
  /**
   * Stable name, stored in each queued job and its key. Renaming one drops the jobs already
   * queued under the old name, and events dispatched earlier are not delivered again.
   */
  handler: string;
  /** Event types to receive; '*' means all. */
  events: readonly string[];
  run: EventHandler;
}

export function buildSubscriptions(options: { logEvents: boolean }): Subscription[] {
  const subs: Subscription[] = [];

  if (options.logEvents) {
    subs.push({
      handler: 'log_event',
      events: ['*'],
      run: async (event, { logger }) => {
        logger.info('event', {
          eventId: event.eventId,
          eventType: event.eventType,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
        });
      },
    });
  }

  // AI requests: the job row holds the input; the event only says which job to run.
  subs.push({
    handler: 'ai_run_job',
    events: ['ai.job_requested'],
    run: async (event, { pool, ai, logger }) => {
      if (event.aggregateId) await runAiJob(event.aggregateId, { pool, ai, logger });
    },
  });

  // Substitute plans follow what they were built from until they are fixed (DECISIONS D-047).
  // The absence's mark makes a repeated run a no-op; an event caused by the teacher's earlier
  // absence (its lessons changed) rebuilds even without a mark.
  subs.push({
    handler: 'sub_plan_refresh',
    events: ['absence.sources_changed'],
    run: async (event, { pool, logger }) => {
      if (!event.aggregateId) return;
      const force = event.payload.cause === 'earlier_absence';
      await refreshAbsencePlans(event.aggregateId, { pool, logger, force });
    },
  });

  // Bulk generation (D-095, D-101): a run that starts, or a cancellation, runs the bulk tick now
  // instead of at its next 5-minute slot. The job key keeps at most one tick waiting: `replace`
  // (the default) moves a queued tick to now; while one is running a new one is queued, since
  // the running one may have read the runs before the change (each run is locked in the
  // database while a tick works on it).
  subs.push({
    handler: 'library_bulk_kick',
    events: ['library_bulk_run.started', 'library_bulk_run.cancel_requested'],
    run: async (_event, { pool }) => {
      await pool.query(
        "select graphile_worker.add_job('library_bulk_tick', '{}'::json, job_key => 'library_bulk_tick')",
      );
    },
  });

  // Staff accounts (D-107): the worker creates the Auth account a board admin's invitation needs,
  // then grants the role; and bans or unbans an account whose access was removed or restored.
  // The events carry ids only; the handlers read the current state, so a repeat is harmless.
  subs.push({
    handler: 'staff_invitation_provision',
    events: ['staff_invitation.created'],
    run: async (event, { pool, authAdmin, logger }) => {
      if (event.aggregateId)
        await provisionInvitation(event.aggregateId, { pool, authAdmin, logger });
    },
  });
  subs.push({
    handler: 'staff_auth_sync',
    events: ['staff.access_changed'],
    run: async (event, { pool, authAdmin, logger }) => {
      if (event.aggregateId) await syncStaffAuth(event.aggregateId, { pool, authAdmin, logger });
    },
  });

  // Example of an integration reacting to an event: a day-only door credential for the
  // substitute (VantageCore). Phase 3 makes no integration calls (DECISIONS D-060), so this only
  // logs. The event carries ids, dates and the part of day; log the ids only.
  subs.push({
    handler: 'access_control_substitute_credential',
    events: ['absence.published'],
    run: async (event, { logger }) => {
      logger.info('would issue a day-only door credential', {
        eventId: event.eventId,
        aggregateId: event.aggregateId,
      });
    },
  });

  return subs;
}

export function subscribersFor(subs: readonly Subscription[], eventType: string): Subscription[] {
  return subs.filter((s) => s.events.includes('*') || s.events.includes(eventType));
}
