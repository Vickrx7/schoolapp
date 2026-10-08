/**
 * Staff accounts and boards, by the operator only (DECISIONS D-106, D-107; Phase 6 slice S1).
 * Board admins invite, change roles and remove access in « Conseil »; deleting an account or a
 * board stays here, on request. Any production data access for support is recorded first, and the
 * board sees it in its audit log (`operator.access`).
 *
 *   pnpm admin log-operator-access --board csc-demo --reason support|incident|restore|migration
 *   pnpm admin delete-user --email prof@conseil.ca [--all-boards] --yes
 *     (refused while the account is active, LXU06; a person in several boards needs --all-boards)
 *   pnpm admin export-audit --board csc-exemple --out journal-csc-exemple.csv
 *     (the board's whole audit log, every audience and date, as CSV; recorded for the board, D-122)
 *   pnpm admin delete-board --board csc-exemple --confirm csc-exemple --exported --yes
 *     (after the board was offered its library, and within 7 days of export-audit)
 *
 * Addresses travel in request bodies (`accountIdByEmail`), never in a URL (D-119). The database
 * deletes the data (`operator_delete_staff_account`, `operator_delete_board`); this command then
 * deletes the Auth accounts, which hold the address and sign-in history. The board's log names
 * the operator as `OPERATOR_NAME` says (D-147).
 */
import { writeFileSync } from 'node:fs';
import { DEFAULT_OPERATOR_NAME } from '@lynx/config';
import {
  accountIdByEmail,
  boardBySlug,
  CliError,
  csvCell,
  need,
  operatorPath,
  type CliContext,
  type Command,
} from '../context';

export const OPERATOR_ACCESS_REASONS = ['support', 'incident', 'restore', 'migration'] as const;
export type OperatorAccessReason = (typeof OPERATOR_ACCESS_REASONS)[number];

/** `--reason`: one of the four the board will read in its audit log. */
export function parseReason(value: string | undefined): OperatorAccessReason {
  const reason = value?.trim();
  if (!reason) throw new CliError(`--reason is required: ${OPERATOR_ACCESS_REASONS.join('|')}`);
  if (!(OPERATOR_ACCESS_REASONS as readonly string[]).includes(reason))
    throw new CliError(`--reason must be one of ${OPERATOR_ACCESS_REASONS.join(', ')}`);
  return reason as OperatorAccessReason;
}

/** What the database refuses, in words the operator can act on (codes: DECISIONS D-107). */
export function staffErrorMessage(
  error: { code?: string; message: string },
  email: string,
): string {
  switch (error.code) {
    case 'LXU06':
      return `${email} still has access. Remove it first (« Retirer l’accès » in « Conseil », or pnpm admin deactivate --email ${email}).`;
    case 'LXU02':
      return `${email} works in several boards. Add --all-boards to delete their data in all of them.`;
    default:
      return `delete ${email}: ${error.message}`;
  }
}

export interface DeletedAccount {
  profile: boolean;
  boards?: number;
  roles?: number;
  classes?: number;
  plans?: number;
  libraryItems?: number;
  feedback?: number;
  /** Their invitations, in every board (they hold the address and the name). */
  invitations?: number;
}

export function deletedAccountSummary(
  email: string,
  result: DeletedAccount,
  authDeleted: boolean,
): string {
  const auth = authDeleted ? 'Its sign-in account is deleted.' : 'It had no sign-in account.';
  if (!result.profile) return `${email} had no profile, only a sign-in account. ${auth}`;
  const n = (v: number | undefined) => v ?? 0;
  return [
    `Deleted ${email} (${n(result.boards)} board${n(result.boards) === 1 ? '' : 's'}): ${n(result.roles)} role(s),`,
    `${n(result.classes)} class(es) they alone led (with their students and plans),`,
    `${n(result.plans)} other substitute plan(s), ${n(result.libraryItems)} private resource(s),`,
    `${n(result.feedback)} feedback message(s), ${n(result.invitations)} invitation(s).`,
    `Shared resources stay, without an author. ${auth}`,
  ].join(' ');
}

export interface DeletedBoard {
  userIds: string[];
  schools: number;
  classes: number;
  libraryItems: number;
  people: number;
  auditRows: number;
  /** Entries written after the last `export-audit`: they are not in its file. */
  auditRowsSinceExport?: number;
}

export function deletedBoardSummary(
  name: string,
  result: DeletedBoard,
  authDeleted: number,
): string {
  const since = result.auditRowsSinceExport ?? 0;
  return [
    `Deleted ${name}: ${result.schools} school(s), ${result.classes} class(es),`,
    `${result.libraryItems} resource(s), ${result.people} person(s) who worked there only`,
    `(${authDeleted} sign-in account(s) deleted), ${result.auditRows} audit row(s)`,
    `(${since} written after the export, not in its file).`,
    'People who also work in another board keep their account there.',
  ].join(' ');
}

/** What the database refuses when a board is deleted, in words the operator can act on. */
export function deleteBoardErrorMessage(
  error: { code?: string; message: string },
  slug: string,
): string {
  if (error.code === 'LXB01') {
    return `Export ${slug}'s whole audit log first (pnpm admin export-audit --board ${slug} --out <file>), at most 7 days before, and give the file to the board.`;
  }
  return `delete board ${slug}: ${error.message}`;
}

/** One entry of a board's whole audit log (`operator_export_audit`). */
export interface AuditExportRow {
  id: number;
  occurred_at: string;
  action: string;
  audience: string | null;
  category: string | null;
  school_id: string | null;
  school_name: string | null;
  actor_type: string;
  actor_user_id: string | null;
  /** The acting person's name; for the operator's entries, the name its CLI was set up with. */
  actor_name: string | null;
  entity_type: string | null;
  entity_id: string | null;
  details: unknown;
}

export const AUDIT_EXPORT_HEADER = [
  'id',
  'occurred_at',
  'action',
  'audience',
  'category',
  'school_id',
  'school_name',
  'actor_type',
  'actor_user_id',
  'actor_name',
  'entity_type',
  'entity_id',
  'details',
] as const;

/**
 * A cell that a spreadsheet will not run: names are typed by people, so a leading = + - @ (or a
 * tab or carriage return) is kept as text with a quote first, as the web app's CSV does.
 */
function textCell(value: string | number | null): string {
  if (value === null) return '';
  const s = String(value);
  return csvCell(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);
}

/**
 * The board's records (D-122): UTF-8 with a byte order mark (accents in Excel), comma-separated,
 * one line per entry, oldest first; the details as JSON, as stored. An operator's entry written
 * before its name was recorded reads « IP Lynx », as in « Journal d'audit » (D-147).
 */
export function auditExportCsv(rows: readonly AuditExportRow[]): string {
  const lines = rows.map((r) =>
    [
      r.id,
      r.occurred_at,
      r.action,
      r.audience,
      r.category,
      r.school_id,
      r.school_name,
      r.actor_type,
      r.actor_user_id,
      r.actor_name ?? (r.actor_type === 'service' ? DEFAULT_OPERATOR_NAME : null),
      r.entity_type,
      r.entity_id,
      JSON.stringify(r.details ?? {}),
    ]
      .map(textCell)
      .join(','),
  );
  return `\uFEFF${[AUDIT_EXPORT_HEADER.join(','), ...lines].join('\r\n')}\r\n`;
}

/** Every entry of the board, 1,000 at a time (the API's page). */
async function wholeAuditLog(ctx: CliContext, boardId: string): Promise<AuditExportRow[]> {
  const rows: AuditExportRow[] = [];
  for (let after = 0; ;) {
    const { data, error } = await ctx.db.rpc('operator_export_audit', {
      p_board_id: boardId,
      p_after_id: after,
      p_limit: 1000,
    });
    if (error) throw new CliError(`export the audit log: ${error.message}`);
    const page = (data ?? []) as unknown as AuditExportRow[];
    rows.push(...page);
    if (page.length < 1000) return rows;
    after = page[page.length - 1]!.id;
  }
}

/** Deletes an Auth account; one already gone counts as deleted. False when there was none. */
async function deleteAuthUser(ctx: CliContext, userId: string): Promise<boolean> {
  const { error } = await ctx.db.auth.admin.deleteUser(userId);
  if (!error) return true;
  if (error.status === 404) return false;
  throw new CliError(`delete sign-in account ${userId}: ${error.message}`);
}

export const staffCommands: Record<string, Command> = {
  async 'log-operator-access'(ctx) {
    const reason = parseReason(ctx.values.reason);
    const board = await boardBySlug(ctx, need(ctx, 'board'));
    const { error } = await ctx.db.rpc('log_operator_access', {
      p_board_id: board.id,
      p_reason: reason,
    });
    if (error) throw new CliError(`log operator access: ${error.message}`);
    return `Recorded: ${ctx.env.OPERATOR_NAME} accesses the data of ${board.name} (${reason}). The board's admins see it in their audit log.`;
  },

  async 'delete-user'(ctx) {
    const email = need(ctx, 'email').toLowerCase();
    if (!ctx.values.yes)
      throw new CliError(
        `This deletes ${email}'s account and data for good (DECISIONS D-107). Add --yes to go ahead.`,
      );
    const userId = await accountIdByEmail(ctx, email);
    if (!userId) throw new CliError(`No account uses ${email}.`);

    const { data, error } = await ctx.db.rpc('operator_delete_staff_account', {
      p_user_id: userId,
      p_all_boards: ctx.values['all-boards'] ?? false,
    });
    if (error) throw new CliError(staffErrorMessage(error, email));
    const authDeleted = await deleteAuthUser(ctx, userId);
    return deletedAccountSummary(email, data as unknown as DeletedAccount, authDeleted);
  },

  async 'export-audit'(ctx) {
    // Both options before the database: the file is never half written.
    const slug = need(ctx, 'board');
    const out = operatorPath(need(ctx, 'out'));
    const board = await boardBySlug(ctx, slug);
    const rows = await wholeAuditLog(ctx, board.id);
    try {
      // Never over another file; readable by the operator only (it names staff).
      writeFileSync(out, auditExportCsv(rows), { flag: 'wx', mode: 0o600 });
    } catch (err) {
      throw new CliError(`write ${out}: ${(err as Error).message}`);
    }
    const lastId = rows.length > 0 ? rows[rows.length - 1]!.id : 0;
    const { error } = await ctx.db.rpc('operator_log_audit_export', {
      p_board_id: board.id,
      p_last_id: lastId,
      p_rows: rows.length,
    });
    if (error) throw new CliError(`record the export: ${error.message}`);
    return [
      `Wrote ${rows.length} audit entr${rows.length === 1 ? 'y' : 'ies'} of ${board.name} to ${out}`,
      '(every audience and date). The board sees the export in its log. The file names staff:',
      'give it to the board (its privacy office), then delete your copy. delete-board accepts',
      'this export for 7 days.',
    ].join(' ');
  },

  async 'delete-board'(ctx) {
    const slug = need(ctx, 'board');
    if (ctx.values.confirm?.trim() !== slug)
      throw new CliError(`Type the board's slug again to confirm: --confirm ${slug}`);
    if (!ctx.values.exported)
      throw new CliError(
        'Offer the board its library (pnpm admin export-pack) first, then add --exported. Its whole audit log must be exported too (pnpm admin export-audit), at most 7 days before.',
      );
    if (!ctx.values.yes)
      throw new CliError(
        `This deletes ${slug} and all its data for good, its audit log included. Add --yes to go ahead.`,
      );
    const board = await boardBySlug(ctx, slug);
    const { data, error } = await ctx.db.rpc('operator_delete_board', {
      p_board_id: board.id,
      p_confirm_slug: slug,
    });
    if (error) throw new CliError(deleteBoardErrorMessage(error, slug));
    const result = data as unknown as DeletedBoard;
    let authDeleted = 0;
    for (const userId of result.userIds) {
      if (await deleteAuthUser(ctx, userId)) authDeleted += 1;
    }
    return deletedBoardSummary(board.name, result, authDeleted);
  },
};
