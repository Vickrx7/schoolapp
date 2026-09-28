import type { Task, TaskList } from 'graphile-worker';
import { z } from 'zod';
import type { HandlerContext, Subscription } from './handlers';
import { dispatchOutbox, loadEvent } from './outbox';

const handleEventPayload = z.object({ eventId: z.uuid(), handler: z.string().min(1) });

export function buildTaskList(options: {
  subscriptions: readonly Subscription[];
  context: HandlerContext;
  batchSize: number;
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

  return { dispatch_outbox: dispatch, handle_event: handleEvent };
}
