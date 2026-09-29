import type { Task, TaskList } from 'graphile-worker';
import { z } from 'zod';
import type { HandlerContext, Subscription } from './handlers';
import { dispatchOutbox, loadEvent } from './outbox';

const handleEventPayload = z.object({ eventId: z.uuid(), handler: z.string().min(1) });

/** What app.sub_access_maintenance() removed (counts only). */
interface SubAccessMaintenanceCounts {
  codesDeleted: number;
  attemptsDeleted: number;
  reportsPurged: number;
}

export function buildTaskList(options: {
  subscriptions: readonly Subscription[];
  context: HandlerContext;
  batchSize: number;
  aiJobRetentionDays: number;
}): TaskList {
  const dispatch: Task = async (_payload, helpers) => {
    // Drain the outbox in batches.
    let dispatched: number;
    do {
      dispatched = await helpers.withPgClient((client) =>
        dispatchOutbox(client, options.subscriptions, options.batchSize),
      );
    } while (dispatched === options.batchSize);
  };

  const handleEvent: Task = async (payload, helpers) => {
    const { eventId, handler } = handleEventPayload.parse(payload);
    const sub = options.subscriptions.find((s) => s.handler === handler);
    if (!sub) {
      helpers.logger.warn(`no handler named ${handler}; dropping job`);
      return;
    }
    const event = await helpers.withPgClient((client) => loadEvent(client, eventId));
    if (!event) {
      helpers.logger.warn(`event ${eventId} no longer exists; dropping job`);
      return;
    }
    await sub.run(event, options.context);
  };

  // Fails AI jobs stuck after a crash and deletes old ones (inputs can name students).
  const aiMaintenance: Task = async (_payload, helpers) => {
    const deleted = await helpers.withPgClient((client) =>
      client.query<{ deleted: number }>('select app.ai_jobs_maintenance($1) as deleted', [
        options.aiJobRetentionDays,
      ]),
    );
    const count = deleted.rows[0]?.deleted ?? 0;
    if (count > 0) options.context.logger.info('old AI jobs deleted', { count });
  };

  // Substitute access retention (DECISIONS D-059): codes (and their sessions) 30 days after
  // they expire, sign-in attempts after a day, and a report's free text and absent-student list
  // 60 days after confirmation (or after the plan date if never confirmed).
  const subAccessMaintenance: Task = async (_payload, helpers) => {
    const { rows } = await helpers.withPgClient((client) =>
      client.query<{ counts: SubAccessMaintenanceCounts }>(
        'select app.sub_access_maintenance() as counts',
      ),
    );
    options.context.logger.info('substitute access retention done', { ...rows[0]?.counts });
  };

  return {
    dispatch_outbox: dispatch,
    handle_event: handleEvent,
    ai_maintenance: aiMaintenance,
    sub_access_maintenance: subAccessMaintenance,
  };
}
