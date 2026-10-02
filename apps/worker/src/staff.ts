/**
 * Staff accounts (DECISIONS D-107; Phase 6 slice S4 writes it).
 *
 * - `provisionInvitation` (handler `staff_invitation_provision`, event `staff_invitation.created`
 *   `{invitationId}`): finds or creates the Auth account, calls `app.complete_staff_invitation`
 *   (which checks again for conflicts and cancellation), and only then unbans it; deletes an
 *   account it created for an invitation that was cancelled or conflicts. Network errors and 5xx
 *   throw (graphile-worker retries); a 4xx fails the invitation as `authRefused`.
 * - `syncStaffAuth` (handler `staff_auth_sync`, event `staff.access_changed` `{userId}`): reads
 *   `users.deactivated_at` and bans or unbans the account; an account missing from Auth is done.
 *
 * Both are idempotent: an event can be delivered twice. Logs carry ids and codes only, never an
 * address. Both do nothing until S4 fills them.
 */
import type { Pool } from 'pg';
import type { AuthAdmin } from './auth-admin';
import type { Logger } from './logger';

export interface StaffContext {
  pool: Pool;
  /** Null when this server has no Auth admin settings (invitations fail as `authNotConfigured`). */
  authAdmin: AuthAdmin | null;
  logger: Logger;
}

export async function provisionInvitation(
  _invitationId: string,
  _ctx: StaffContext,
): Promise<void> {}

export async function syncStaffAuth(_userId: string, _ctx: StaffContext): Promise<void> {}
