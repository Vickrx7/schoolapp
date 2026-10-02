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
 */
import { notYetAvailable, type Command } from '../context';

export const staffCommands: Record<string, Command> = {
  async 'log-operator-access'() {
    return notYetAvailable('log-operator-access');
  },
  async 'delete-user'() {
    return notYetAvailable('delete-user');
  },
  async 'delete-board'() {
    return notYetAvailable('delete-board');
  },
};
