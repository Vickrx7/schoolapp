import { parseBoardSettings, RETENTION_LIMITS } from '@lynx/domain';
import { describe, expect, it } from 'vitest';
import { parseCli } from '../args';
import { CliError, createContext } from '../context';
import {
  formatOperatorStatus,
  opsCommands,
  parseRetentionOptions,
  RETENTION_OPTIONS,
  retentionSummary,
} from './ops';

/** A command run with no settings at all: it must refuse before reading them or the database. */
async function refusal(argv: string[]): Promise<string> {
  const { command, values } = parseCli(argv);
  try {
    await opsCommands[command!]!(createContext(values));
  } catch (err) {
    expect(err).toBeInstanceOf(CliError);
    return (err as Error).message;
  }
  throw new Error('expected a refusal');
}

describe('set-retention (D-105)', () => {
  it('has one option per retention setting', () => {
    expect(Object.values(RETENTION_OPTIONS).sort()).toEqual(Object.keys(RETENTION_LIMITS).sort());
  });

  it('takes whole days within the bounds', () => {
    expect(
      parseRetentionOptions(
        parseCli(['set-retention', '--audit-days', '1095', '--feedback-days', '365']).values,
      ),
    ).toEqual({ auditDays: 1095, feedbackDays: 365 });
    expect(
      parseRetentionOptions(
        parseCli([
          'set-retention',
          '--sub-plan-days',
          '1095',
          '--class-days',
          '400',
          '--ai-usage-days',
          '3650',
        ]).values,
      ),
    ).toEqual({ subPlanDays: 1095, classDaysAfterYearEnd: 400, aiUsageDays: 3650 });
  });

  it('refuses less than a year, more than the bound, fractions and words, before anything else', async () => {
    expect(await refusal(['set-retention', '--board', 'csc-demo', '--audit-days', '30'])).toMatch(
      /--audit-days must be a whole number of days from 365 to 3650/,
    );
    expect(
      await refusal(['set-retention', '--board', 'csc-demo', '--sub-plan-days', '1096']),
    ).toMatch(/--sub-plan-days .* from 365 to 1095/);
    expect(
      await refusal(['set-retention', '--board', 'csc-demo', '--class-days', '400.5']),
    ).toMatch(/--class-days/);
    expect(
      await refusal(['set-retention', '--board', 'csc-demo', '--feedback-days', 'deux ans']),
    ).toMatch(/--feedback-days/);
    expect(await refusal(['set-retention', '--board', 'csc-demo'])).toMatch(
      /at least one of --audit-days/,
    );
    expect(await refusal(['set-retention', '--audit-days', '1095'])).toMatch(/--board is required/);
  });

  it('says what the board keeps', () => {
    expect(
      retentionSummary(
        'CSC Démo',
        parseBoardSettings({ retention: { auditDays: 1095 } }).retention,
      ),
    ).toBe(
      "CSC Démo keeps: the audit log 1095 days, substitute plans 365 days after their date, students' first names 365 days after their school year, AI usage 730 days, feedback 365 days. The board's admins see this change in their audit log.",
    );
  });
});

describe('status (D-112)', () => {
  it('prints the heartbeats, the outbox, AI jobs and invitations', () => {
    expect(
      formatOperatorStatus({
        at: '2026-11-12T12:00:00Z',
        heartbeats: [
          {
            component: 'worker',
            at: '2026-11-12T11:59:00Z',
            release: '0.6.0',
            details: { lastDispatchAt: '2026-11-12T11:58:30Z' },
          },
          {
            component: 'retention',
            at: '2026-11-12T03:53:10Z',
            release: null,
            details: { subPlans: 2 },
          },
        ],
        outbox: { pending: 3, oldestPendingAt: '2026-11-12T11:30:00Z', failing: 1 },
        aiJobs: { queued: 0, running: 2, failedLastDay: 1 },
        invitations: { pending: 4 },
      }),
    ).toBe(
      [
        'Status at 2026-11-12T12:00:00Z',
        'Heartbeats:',
        '  worker     2026-11-12T11:59:00Z (60 s ago)  release 0.6.0  {"lastDispatchAt":"2026-11-12T11:58:30Z"}',
        '  retention  2026-11-12T03:53:10Z (8 h ago)  {"subPlans":2}',
        '  backup     never',
        'Outbox: 3 pending (oldest 30 min ago), 1 failing (3 attempts or more)',
        'AI jobs: 0 queued, 2 running, 1 failed in the last 24 h',
        'Invitations: 4 pending',
      ].join('\n'),
    );
  });
});
