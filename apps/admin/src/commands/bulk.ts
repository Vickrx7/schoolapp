/**
 * Bulk generation of board drafts with the Message Batches API (DECISIONS D-095 to D-098; slice
 * S6): one batch per run, a hard worst-case cost cap (`--max-cost`, never above
 * BULK_MAX_RUN_USD), deduplication before generation, and a report here. Run by the operator,
 * one board at a time; the drafts land in the reviewers' « Brouillons du conseil (IA) ».
 *
 *   pnpm admin bulk-plan --board csc-demo --grade 3 --subject mat --types worksheet,quiz --max-cost 25
 *     [--strand B] [--expectations B1.1,B1.2 | --from-coverage 2] [--levels all|none]
 *     [--per-expectation 1] [--sub-friendly] [--note "…"]
 *   pnpm admin bulk-start --run <id>
 *   pnpm admin bulk-status --run <id>
 *   pnpm admin bulk-cancel --run <id>
 *   pnpm admin bulk-report --run <id> [--csv]
 */
import { notYetAvailable, type Command } from '../context';

export const bulkCommands: Record<string, Command> = {
  async 'bulk-plan'() {
    return notYetAvailable('bulk-plan');
  },
  async 'bulk-start'() {
    return notYetAvailable('bulk-start');
  },
  async 'bulk-status'() {
    return notYetAvailable('bulk-status');
  },
  async 'bulk-cancel'() {
    return notYetAvailable('bulk-cancel');
  },
  async 'bulk-report'() {
    return notYetAvailable('bulk-report');
  },
};
