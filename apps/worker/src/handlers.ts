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
import type { Logger } from './logger';

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
}

export type EventHandler = (event: OutboxEvent, ctx: HandlerContext) => Promise<void>;

export interface Subscription {
  /** Stable name: it is part of each job's key, so renaming it re-delivers events. */
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

  // Example of an integration reacting to an event. absence.published arrives in Phase 3;
  // then this issues the substitute a day-only door credential through VantageCore.
  subs.push({
    handler: 'access_control_substitute_credential',
    events: ['absence.published'],
    run: async (event, { logger }) => {
      logger.info('would issue a day-only door credential (Phase 3)', { eventId: event.eventId });
    },
  });

  return subs;
}

export function subscribersFor(subs: readonly Subscription[], eventType: string): Subscription[] {
  return subs.filter((s) => s.events.includes('*') || s.events.includes(eventType));
}
