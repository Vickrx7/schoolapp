import { EventEmitter } from 'node:events';
import { PrivacyViolation } from '@lynx/ai';
import { createLogger } from '@lynx/observability';
import { describe, expect, it } from 'vitest';
import { graphileLogOptions, reportJobFailures } from './job-errors';

/** Sentinels from a failed AI job: none may reach a log line. */
const SENTINELS = ['Léa', 'Nathan', 'parent.lea@courriel.ca', '613-555-0142'];

function collect() {
  const lines: string[] = [];
  const logger = createLogger('jobs', {
    component: 'worker',
    release: 'test',
    write: (line) => lines.push(line),
  });
  return { lines, logger };
}

describe('failed jobs in the logs (D-111)', () => {
  it('logs a job that failed for good with its task and a scrubbed error only', () => {
    const { lines, logger } = collect();
    const events = new EventEmitter();
    reportJobFailures({ events: events as never }, logger);
    const error = new PrivacyViolation([
      { kind: 'name', match: 'Léa' },
      { kind: 'name', match: 'Nathan' },
    ]);
    events.emit('job:failed', {
      job: {
        id: '17',
        task_identifier: 'ai_run_job',
        attempts: 25,
        max_attempts: 25,
        payload: { note: 'Léa et Nathan, parent.lea@courriel.ca, 613-555-0142' },
      },
      error,
    });
    expect(lines).toHaveLength(1);
    for (const sentinel of SENTINELS) expect(lines[0]).not.toContain(sentinel);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      level: 'error',
      component: 'worker',
      scope: 'jobs',
      message: 'job failed for good',
      task: 'ai_run_job',
      jobId: '17',
      attempts: 25,
      maxAttempts: 25,
      error: {
        name: 'PrivacyViolation',
        message: 'refusing to send personal information (name, name)',
      },
    });
  });

  it("replaces graphile-worker's console logger with a scrubbing one", () => {
    const { lines, logger } = collect();
    const { logger: graphile } = graphileLogOptions(logger);
    const error = Object.assign(new Error('Key (email)=(parent.lea@courriel.ca) already exists'), {
      findings: [{ kind: 'name', match: 'Léa' }],
    });
    graphile!
      .scope({ label: 'job', taskIdentifier: 'staff_invitation_provision', jobId: '9' })
      .error(`Failed task 9 (staff_invitation_provision) with error '${error.message}'`, {
        failure: true,
        job: { payload: { name: 'Léa' } },
        error,
      });
    expect(lines).toHaveLength(1);
    for (const sentinel of SENTINELS) expect(lines[0]).not.toContain(sentinel);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      level: 'error',
      task: 'staff_invitation_provision',
      jobId: '9',
      error: { message: 'Key (email)=(…) already exists' },
    });
  });
});
