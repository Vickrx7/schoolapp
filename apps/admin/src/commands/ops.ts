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
import { notYetAvailable, type Command } from '../context';

export const opsCommands: Record<string, Command> = {
  async 'set-retention'() {
    return notYetAvailable('set-retention');
  },
  async status() {
    return notYetAvailable('status');
  },
};
