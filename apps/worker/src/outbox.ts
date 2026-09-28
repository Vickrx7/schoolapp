/**
 * Outbox dispatcher: turns new rows in public.event_outbox into one graphile-worker job per
 * subscribed handler, in a single transaction, then marks the rows dispatched. Each handler
 * then runs (and retries) independently, so one failing integration cannot block the others.
 */
import type { PoolClient } from 'pg';
import { subscribersFor, type OutboxEvent, type Subscription } from './handlers';

interface OutboxRow {
  id: string;
  event_id: string;
  event_type: string;
  board_id: string | null;
  school_id: string | null;
  aggregate_type: string | null;
  aggregate_id: string | null;
  payload: Record<string, unknown>;
  occurred_at: Date;
}

export function toEvent(row: OutboxRow): OutboxEvent {
  return {
    eventId: row.event_id,
    eventType: row.event_type,
    boardId: row.board_id,
    schoolId: row.school_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    payload: row.payload,
    occurredAt: row.occurred_at.toISOString(),
  };
}

/** Dispatches up to `batchSize` pending events. Returns how many were dispatched. */
export async function dispatchOutbox(
  client: PoolClient,
  subscriptions: readonly Subscription[],
  batchSize: number,
): Promise<number> {
  await client.query('begin');
  try {
    const { rows } = await client.query<OutboxRow>(
      `select id, event_id, event_type, board_id, school_id, aggregate_type, aggregate_id, payload, occurred_at
       from public.event_outbox
       where dispatched_at is null
       order by id
       limit $1
       for update skip locked`,
      [batchSize],
    );

    for (const row of rows) {
      for (const sub of subscribersFor(subscriptions, row.event_type)) {
        await client.query(
          `select graphile_worker.add_job(
             'handle_event',
             json_build_object('eventId', $1::text, 'handler', $2::text),
             job_key => $3,
             job_key_mode => 'preserve_run_at',
             max_attempts => 10
           )`,
          [row.event_id, sub.handler, `event:${row.event_id}:${sub.handler}`],
        );
      }
    }

    if (rows.length > 0) {
      await client.query(
        `update public.event_outbox
         set dispatched_at = now(), dispatch_attempts = dispatch_attempts + 1
         where id = any($1::bigint[])`,
        [rows.map((r) => r.id)],
      );
    }
    await client.query('commit');
    return rows.length;
  } catch (err) {
    await client.query('rollback');
    throw err;
  }
}

export async function loadEvent(client: PoolClient, eventId: string): Promise<OutboxEvent | null> {
  const { rows } = await client.query<OutboxRow>(
    `select id, event_id, event_type, board_id, school_id, aggregate_type, aggregate_id, payload, occurred_at
     from public.event_outbox where event_id = $1`,
    [eventId],
  );
  return rows[0] ? toEvent(rows[0]) : null;
}
