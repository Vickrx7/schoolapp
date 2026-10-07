/**
 * The admin CLI's options: one list for every command, so a command reads only what it needs
 * and an unknown option is refused before anything runs. Phase 5 slices use the options below
 * their comment; add a new option here, next to its command's group.
 */
import { parseArgs } from 'node:util';

export const CLI_OPTIONS = {
  // Boards, schools, staff and modules (commands/setup.ts).
  name: { type: 'string' },
  slug: { type: 'string' },
  'short-name': { type: 'string' },
  board: { type: 'string' },
  school: { type: 'string' },
  timezone: { type: 'string' },
  cycle: { type: 'string' },
  starts: { type: 'string' },
  ends: { type: 'string' },
  email: { type: 'string' },
  role: { type: 'string' },
  honorific: { type: 'string' },
  module: { type: 'string' },
  enabled: { type: 'string' },
  // AI budgets and usage (commands/ai.ts).
  allowance: { type: 'string' },
  ceiling: { type: 'string' },
  plan: { type: 'string' },
  allowed: { type: 'string' },
  'default-allowance': { type: 'string' },
  'ceiling-multiplier': { type: 'string' },
  pooling: { type: 'string' },
  month: { type: 'string' },
  csv: { type: 'boolean' },
  // Library reviewers and the curriculum import (commands/library.ts); the Catholic references'
  // import (commands/references.ts) takes --board --file --apply --confirm-licence.
  content: { type: 'string' },
  faith: { type: 'string' },
  file: { type: 'string' },
  apply: { type: 'boolean' },
  'confirm-licence': { type: 'boolean' },
  // Coverage (commands/coverage.ts): --board --grade --subject [--min] [--csv].
  grade: { type: 'string' },
  subject: { type: 'string' },
  min: { type: 'string' },
  // Bulk generation (commands/bulk.ts): bulk-plan also takes --board --grade --subject.
  types: { type: 'string' },
  'max-cost': { type: 'string' },
  strand: { type: 'string' },
  expectations: { type: 'string' },
  'from-coverage': { type: 'string' },
  levels: { type: 'string' },
  'per-expectation': { type: 'string' },
  'sub-friendly': { type: 'boolean' },
  note: { type: 'string' },
  run: { type: 'string' },
  // Content packs (commands/packs.ts): export-pack also takes --board --slug --grade --subject,
  // import-pack --board --file --apply.
  version: { type: 'string' },
  title: { type: 'string' },
  publisher: { type: 'string' },
  licence: { type: 'string' },
  'no-derivatives': { type: 'boolean' },
  'include-teacher-items': { type: 'boolean' },
  'include-pack-items': { type: 'boolean' },
  'allow-names': { type: 'string' },
  out: { type: 'string' },
  'level-map': { type: 'string' },
  approve: { type: 'boolean' },
  approver: { type: 'string' },
  // Retention (commands/ops.ts, D-105): set-retention --board and one or more of these, in days.
  'audit-days': { type: 'string' },
  'sub-plan-days': { type: 'string' },
  'class-days': { type: 'string' },
  'ai-usage-days': { type: 'string' },
  'feedback-days': { type: 'string' },
  // Accounts and boards (commands/staff.ts, D-106, D-107, D-122): log-operator-access --board
  // --reason, delete-user --email, export-audit --board --out, delete-board --board --confirm
  // <slug> --exported.
  reason: { type: 'string' },
  'all-boards': { type: 'boolean' },
  confirm: { type: 'string' },
  exported: { type: 'boolean' },
  yes: { type: 'boolean' },
} as const;

/** `pnpm admin <command> [options]`: the command and its options (unknown ones throw). */
export function parseCli(argv: readonly string[]) {
  const [command, ...rest] = argv;
  const { values } = parseArgs({ args: rest, options: CLI_OPTIONS, strict: true });
  return { command, values };
}

export type CliValues = ReturnType<typeof parseCli>['values'];
export type CliOption = keyof CliValues;
