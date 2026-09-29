import type { Task, TaskList } from 'graphile-worker';
import { z } from 'zod';
import { classModeMaintenance } from './class-mode';
import type { HandlerContext, Subscription } from './handlers';
import { libraryMaintenance, tickBulkRuns } from './library-bulk';
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
  /** BULK_MAX_RUN_USD (D-096). */
  bulkMaxRunUsd: number;
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

  // Class mode (D-089): closes expired sessions (their answers are deleted) and applies retention.
  const classModeMaintenanceTask: Task = async () => {
    await classModeMaintenance({ db: options.context.pool, logger: options.context.logger });
  };

  // Bulk generation (D-095 to D-098): one step for every running run. Two ticks can overlap (a
  // kick while one runs), so each run is locked in the database while a tick works on it.
  const libraryBulkTick: Task = async () => {
    await tickBulkRuns({
      pool: options.context.pool,
      ai: options.context.ai,
      logger: options.context.logger,
      maxRunUsd: options.bulkMaxRunUsd,
    });
  };

  // Daily library clean-up (D-101).
  const libraryMaintenanceTask: Task = async () => {
    await libraryMaintenance({ db: options.context.pool, logger: options.context.logger });
  };

  return {
    dispatch_outbox: dispatch,
    handle_event: handleEvent,
    ai_maintenance: aiMaintenance,
    sub_access_maintenance: subAccessMaintenance,
    class_mode_maintenance: classModeMaintenanceTask,
    library_bulk_tick: libraryBulkTick,
    library_maintenance: libraryMaintenanceTask,
  };
}
