/**
 * Staff accounts and boards, by the operator only (DECISIONS D-106, D-107; Phase 6 slice S1).
 * Board admins invite, change roles and remove access in « Conseil »; deleting an account or a
 * board stays here, on request. Any production data access for support is recorded first, and the
 * board sees it in its audit log (`operator.access`).
 *
 *   pnpm admin log-operator-access --board csc-demo --reason support|incident|restore|migration
 *   pnpm admin delete-user --email prof@conseil.ca [--all-boards] --yes
 *     (refused while the account is active, LXU06; a person in several boards needs --all-boards)
 *   pnpm admin delete-board --board csc-exemple --confirm csc-exemple --exported --yes
 *     (after the board was offered its audit log and library export)
 *
 * Addresses travel in request bodies (`accountIdByEmail`), never in a URL (D-119). The database
 * deletes the data (`operator_delete_staff_account`, `operator_delete_board`); this command then
 * deletes the Auth accounts, which hold the address and sign-in history.
 */
import {
  accountIdByEmail,
  boardBySlug,
  CliError,
  need,
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
    `${n(result.feedback)} feedback message(s). Shared resources stay, without an author. ${auth}`,
  ].join(' ');
}

export interface DeletedBoard {
  userIds: string[];
  schools: number;
  classes: number;
  libraryItems: number;
  people: number;
  auditRows: number;
}

export function deletedBoardSummary(
  name: string,
  result: DeletedBoard,
  authDeleted: number,
): string {
  return [
    `Deleted ${name}: ${result.schools} school(s), ${result.classes} class(es),`,
    `${result.libraryItems} resource(s), ${result.people} person(s) who worked there only`,
    `(${authDeleted} sign-in account(s) deleted), ${result.auditRows} audit row(s).`,
    'People who also work in another board keep their account there.',
  ].join(' ');
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
    return `Recorded: IP Lynx accesses the data of ${board.name} (${reason}). The board's admins see it in their audit log.`;
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

  async 'delete-board'(ctx) {
    const slug = need(ctx, 'board');
    if (ctx.values.confirm?.trim() !== slug)
      throw new CliError(`Type the board's slug again to confirm: --confirm ${slug}`);
    if (!ctx.values.exported)
      throw new CliError(
        'Offer the board its audit log (CSV, « Journal d’audit ») and its library (pnpm admin export-pack) first, then add --exported.',
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
    if (error) throw new CliError(`delete board ${slug}: ${error.message}`);
    const result = data as unknown as DeletedBoard;
    let authDeleted = 0;
    for (const userId of result.userIds) {
      if (await deleteAuthUser(ctx, userId)) authDeleted += 1;
    }
    return deletedBoardSummary(board.name, result, authDeleted);
  },
};
