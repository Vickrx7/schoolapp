/**
 * Operations (DECISIONS D-105, D-112; Phase 6 slice S2): the board's retention settings, which
 * only the operator may change (every lower bound is 365 days; the database refuses anything
 * else), and the operator's status with counts (heartbeats, the outbox, AI jobs, pending
 * invitations). Every settings change is audited for the board (`board.settings_changed`, D-106).
 *
 *   pnpm admin set-retention --board csc-demo [--audit-days 1095] [--sub-plan-days 365]
 *     [--class-days 365] [--ai-usage-days 730] [--feedback-days 365]
 *   pnpm admin status
 */
import type { Json } from '@lynx/db';
import {
  parseBoardSettings,
  RETENTION_LIMITS,
  type BoardSettings,
  type RetentionKey,
} from '@lynx/domain';
import type { CliValues } from '../args';
import { check, CliError, need, type Command } from '../context';

/** Each retention option and the setting it sets. */
export const RETENTION_OPTIONS = {
  'audit-days': 'auditDays',
  'sub-plan-days': 'subPlanDays',
  'class-days': 'classDaysAfterYearEnd',
  'ai-usage-days': 'aiUsageDays',
  'feedback-days': 'feedbackDays',
} as const satisfies Record<string, RetentionKey>;

type RetentionOption = keyof typeof RETENTION_OPTIONS;

/**
 * The retention options given, checked against RETENTION_LIMITS (whole days within the bounds;
 * at least a year each). At least one is needed.
 */
export function parseRetentionOptions(values: CliValues): Partial<Record<RetentionKey, number>> {
  const settings: Partial<Record<RetentionKey, number>> = {};
  for (const [option, key] of Object.entries(RETENTION_OPTIONS) as [
    RetentionOption,
    RetentionKey,
  ][]) {
    const raw = values[option];
    if (raw === undefined) continue;
    const { min, max } = RETENTION_LIMITS[key];
    const days = Number(raw);
    if (!/^\d+$/.test(raw.trim()) || days < min || days > max)
      throw new CliError(
        `--${option} must be a whole number of days from ${min} to ${max} (at least a year: MFIPPA Reg. 823 s.5, DECISIONS D-105).`,
      );
    settings[key] = days;
  }
  if (Object.keys(settings).length === 0)
    throw new CliError(
      `Give at least one of ${Object.keys(RETENTION_OPTIONS)
        .map((o) => `--${o}`)
        .join(', ')}.`,
    );
  return settings;
}

/** What the board keeps, as the nightly job reads it. */
export function retentionSummary(name: string, retention: BoardSettings['retention']): string {
  return [
    `${name} keeps:`,
    `the audit log ${retention.auditDays} days,`,
    `substitute plans ${retention.subPlanDays} days after their date,`,
    `students' first names ${retention.classDaysAfterYearEnd} days after their school year,`,
    `AI usage ${retention.aiUsageDays} days,`,
    `feedback ${retention.feedbackDays} days.`,
    "The board's admins see this change in their audit log.",
  ].join(' ');
}

interface HeartbeatStatus {
  component: string;
  at: string;
  release: string | null;
  details: Record<string, unknown>;
}

export interface OperatorStatus {
  at: string;
  heartbeats: HeartbeatStatus[];
  outbox: { pending: number; oldestPendingAt: string | null; failing: number };
  aiJobs: { queued: number; running: number; failedLastDay: number };
  invitations: { pending: number };
}

const COMPONENTS = ['worker', 'retention', 'backup'] as const;

/** « 3 min ago », « 5 h ago », « 2 d ago ». */
function ago(fromIso: string, nowIso: string): string {
  const s = Math.max(0, Math.round((Date.parse(nowIso) - Date.parse(fromIso)) / 1000));
  if (s < 120) return `${s} s ago`;
  if (s < 7200) return `${Math.round(s / 60)} min ago`;
  if (s < 172_800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

export function formatOperatorStatus(status: OperatorStatus): string {
  const lines = [`Status at ${status.at}`, 'Heartbeats:'];
  for (const component of COMPONENTS) {
    const beat = status.heartbeats.find((h) => h.component === component);
    if (!beat) {
      lines.push(`  ${component.padEnd(10)} never`);
      continue;
    }
    const details = Object.keys(beat.details).length > 0 ? `  ${JSON.stringify(beat.details)}` : '';
    lines.push(
      `  ${component.padEnd(10)} ${beat.at} (${ago(beat.at, status.at)})${beat.release ? `  release ${beat.release}` : ''}${details}`,
    );
  }
  const { outbox, aiJobs, invitations } = status;
  lines.push(
    `Outbox: ${outbox.pending} pending${outbox.oldestPendingAt ? ` (oldest ${ago(outbox.oldestPendingAt, status.at)})` : ''}, ${outbox.failing} failing (3 attempts or more)`,
    `AI jobs: ${aiJobs.queued} queued, ${aiJobs.running} running, ${aiJobs.failedLastDay} failed in the last 24 h`,
    `Invitations: ${invitations.pending} pending`,
  );
  return lines.join('\n');
}

export const opsCommands: Record<string, Command> = {
  async 'set-retention'(ctx) {
    const slug = need(ctx, 'board');
    const changes = parseRetentionOptions(ctx.values);
    const board = check(
      await ctx.db.from('boards').select('id, name, settings').eq('slug', slug).maybeSingle(),
      `board "${slug}"`,
    );
    const settings = (board.settings ?? {}) as Record<string, unknown>;
    const stored = settings.retention;
    const retention = {
      ...(typeof stored === 'object' && stored !== null && !Array.isArray(stored) ? stored : {}),
      ...changes,
    };
    const next = { ...settings, retention };
    // The database checks the values again (app.boards_guard_retention_settings) and audits the
    // change for the board (board.settings_changed).
    check(
      await ctx.db
        .from('boards')
        .update({ settings: next as Json })
        .eq('id', board.id)
        .select('id')
        .single(),
      'update board',
    );
    return retentionSummary(board.name, parseBoardSettings(next).retention);
  },

  async status(ctx) {
    const { data, error } = await ctx.db.rpc('operator_status');
    if (error) throw new CliError(`status: ${error.message}`);
    return formatOperatorStatus(data as unknown as OperatorStatus);
  },
};
