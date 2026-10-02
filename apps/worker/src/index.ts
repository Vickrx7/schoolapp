/**
 * Background worker: a Postgres-backed job queue (graphile-worker) plus the event outbox
 * dispatcher. Runs anywhere Node runs; needs only Postgres (no hosted job service).
 */
import { loadEnv, workerEnvSchema } from '@lynx/config';
import { createIntegrations } from '@lynx/integrations';
import { run } from 'graphile-worker';
import pg from 'pg';
import { createAiRuntime } from './ai';
import { createAuthAdmin } from './auth-admin';
import { CRONTAB_LINES } from './crontab';
import { buildSubscriptions } from './handlers';
import { startHealth } from './health';
import { graphileLogOptions, reportJobFailures } from './job-errors';
import { createLogger } from './logger';
import { checkSchema } from './schema-guard';
import { buildTaskList } from './tasks';

const env = loadEnv(workerEnvSchema);
const logger = createLogger('worker');
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: env.WORKER_CONCURRENCY + 3 });
pool.on('error', (err) => logger.error('idle database connection failed', { error: err.message }));

// A database without this release's migrations: stop before taking any job (D-114).
const missing = await checkSchema({ pool, logger });
if (missing.length > 0) {
  logger.error('the database is missing migrations of this release: run migrate first', {
    missing,
  });
  await pool.end();
  process.exit(1);
}

const subscriptions = buildSubscriptions({ logEvents: env.LOG_EVENTS });
const integrations = createIntegrations(env.INTEGRATIONS_MODE, createLogger('integrations'));
const ai = createAiRuntime(env);
const authAdmin = createAuthAdmin(env, pool);

// The heartbeat runs on its own timer, outside the job queue (D-112).
const health = await startHealth({
  pool,
  logger: createLogger('health'),
  release: env.APP_RELEASE,
  port: env.WORKER_HEALTH_PORT,
  heartbeatUrl: env.HEARTBEAT_URL_WORKER,
});

const runner = await run({
  pgPool: pool,
  concurrency: env.WORKER_CONCURRENCY,
  noHandleSignals: true,
  ...graphileLogOptions(createLogger('graphile')),
  taskList: buildTaskList({
    subscriptions,
    context: { integrations, logger: createLogger('events'), pool, ai, authAdmin },
    batchSize: env.OUTBOX_BATCH_SIZE,
    aiJobRetentionDays: env.AI_JOB_RETENTION_DAYS,
    bulkMaxRunUsd: env.BULK_MAX_RUN_USD,
  }),
  crontab: CRONTAB_LINES.join('\n'),
});
// Failed jobs are logged with their error scrubbed (D-111).
reportJobFailures(runner, createLogger('jobs'));

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
  await health.stop();
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
  ai: ai ? `${ai.provider.name}:${ai.provider.model}` : 'off',
  staffAccounts: authAdmin ? 'on' : 'off',
  release: env.APP_RELEASE,
});

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await runner.promise;
