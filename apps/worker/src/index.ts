/**
 * Background worker: a Postgres-backed job queue (graphile-worker) plus the event outbox
 * dispatcher. Runs anywhere Node runs; needs only Postgres (no hosted job service).
 */
import { loadEnv, workerEnvSchema } from '@lynx/config';
import { createIntegrations } from '@lynx/integrations';
import { run } from 'graphile-worker';
import pg from 'pg';
import { buildSubscriptions } from './handlers';
import { createLogger } from './logger';
import { buildTaskList } from './tasks';

const env = loadEnv(workerEnvSchema);
const logger = createLogger('worker');
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: env.WORKER_CONCURRENCY + 3 });
pool.on('error', (err) => logger.error('idle database connection failed', { error: err.message }));

const subscriptions = buildSubscriptions({ logEvents: env.LOG_EVENTS });
const integrations = createIntegrations(env.INTEGRATIONS_MODE, createLogger('integrations'));

const runner = await run({
  pgPool: pool,
  concurrency: env.WORKER_CONCURRENCY,
  noHandleSignals: true,
  taskList: buildTaskList({
    subscriptions,
    context: { integrations, logger: createLogger('events') },
    batchSize: env.OUTBOX_BATCH_SIZE,
  }),
  // Safety net: sweep the outbox every minute in case a notification was missed.
  crontab: '* * * * * dispatch_outbox ?jobKey=dispatch_outbox&jobKeyMode=preserve_run_at',
});

const wake = () =>
  runner
    .addJob('dispatch_outbox', {}, { jobKey: 'dispatch_outbox', jobKeyMode: 'preserve_run_at' })
    .catch((err: unknown) => logger.error('could not queue dispatch', { error: String(err) }));

// Dispatch immediately when app.emit_event() sends a notification.
const listener = await pool.connect();
let stopping = false;

const shutdown = async (reason: string) => {
  if (stopping) return;
  stopping = true;
  logger.info('shutting down', { reason });
  listener.release();
  await runner.stop();
  await pool.end();
};

listener.on('notification', () => void wake());
listener.on('error', (err) => {
  // The one-minute cron sweep keeps events flowing; exit so the process manager restarts us
  // with a fresh LISTEN connection.
  logger.error('notification connection lost', { error: err.message });
  process.exitCode = 1;
  void shutdown('listener-error');
});
await listener.query('listen event_outbox');
await wake();

logger.info('worker started', {
  concurrency: env.WORKER_CONCURRENCY,
  integrations: env.INTEGRATIONS_MODE,
});

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await runner.promise;
