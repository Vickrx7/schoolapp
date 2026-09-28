import type { Task, TaskList } from 'graphile-worker';
import { z } from 'zod';
import type { HandlerContext, Subscription } from './handlers';
import { dispatchOutbox, loadEvent } from './outbox';

const handleEventPayload = z.object({ eventId: z.uuid(), handler: z.string().min(1) });

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

  return { dispatch_outbox: dispatch, handle_event: handleEvent, ai_maintenance: aiMaintenance };
}
