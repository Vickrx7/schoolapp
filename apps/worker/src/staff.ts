/**
 * Staff accounts (DECISIONS D-107).
 *
 * - `provisionInvitation` (handler `staff_invitation_provision`, event `staff_invitation.created`
 *   `{invitationId}`): finds or creates the Auth account, calls `app.complete_staff_invitation`
 *   (which checks again for conflicts and cancellation), and only then unbans it; deletes an
 *   account it created for an invitation that was cancelled or conflicts. Network errors and 5xx
 *   throw (graphile-worker retries); a 4xx fails the invitation as `authRefused`.
 * - `syncStaffAuth` (handler `staff_auth_sync`, event `staff.access_changed` `{userId}`): reads
 *   `users.deactivated_at` and bans or unbans the account; an account missing from Auth is done.
 *
 * Both are idempotent: an event can be delivered twice, and a restore hands recent events back
 * (deploy/backup/restore.sh). Each works under an advisory lock (the invitation's address, or the
 * person), so two deliveries, or two invitations of one address from different boards, never
 * interleave: the second sees what the first did. Logs carry ids and codes only, never an address.
 */
import type { Pool } from 'pg';
import { AuthAdminError, type AuthAdmin } from './auth-admin';
import type { Logger } from './logger';

export interface StaffContext {
  pool: Pool;
  /** Null when this server has no Auth admin settings (invitations fail as `authNotConfigured`). */
  authAdmin: AuthAdmin | null;
  logger: Logger;
}

type InvitationError = 'authNotConfigured' | 'authRefused' | 'emailConflict';

/**
 * Runs `fn` while holding a session advisory lock on its own connection. The lock is released
 * at the end; a connection whose unlock failed is closed instead, which releases it too.
 */
async function withAdvisoryLock<T>(pool: Pool, key: string, fn: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let healthy = false;
  try {
    await client.query('select pg_advisory_lock(hashtextextended($1, 0))', [key]);
    try {
      return await fn();
    } finally {
      try {
        await client.query('select pg_advisory_unlock(hashtextextended($1, 0))', [key]);
        healthy = true;
      } catch {
        // Closed below.
      }
    }
  } finally {
    client.release(!healthy);
  }
}

async function invitation(
  pool: Pool,
  invitationId: string,
): Promise<{ email: string; status: string } | null> {
  const { rows } = await pool.query<{ email: string; status: string }>(
    'select email, status from public.staff_invitations where id = $1',
    [invitationId],
  );
  return rows[0] ?? null;
}

async function failInvitation(
  pool: Pool,
  invitationId: string,
  code: InvitationError,
): Promise<string> {
  const { rows } = await pool.query<{ result: string }>(
    'select app.fail_staff_invitation($1, $2) as result',
    [invitationId, code],
  );
  return rows[0]!.result;
}

const pgCode = (error: unknown): unknown =>
  typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;

/**
 * Deletes an Auth account this run created for an invitation that did not complete, unless a
 * profile uses it meanwhile (then it belongs to someone).
 */
async function discardCreatedAccount(ctx: StaffContext, userId: string): Promise<void> {
  const { rows } = await ctx.pool.query('select 1 from public.users where id = $1', [userId]);
  if (rows.length > 0) return;
  try {
    await ctx.authAdmin!.deleteUser(userId);
  } catch (error) {
    if (!(error instanceof AuthAdminError && error.kind === 'notFound')) throw error;
  }
}

export async function provisionInvitation(invitationId: string, ctx: StaffContext): Promise<void> {
  const { pool, authAdmin, logger } = ctx;
  const first = await invitation(pool, invitationId);
  if (!first || first.status !== 'pending') {
    logger.info('invitation already processed', { invitationId, status: first?.status ?? 'gone' });
    return;
  }
  if (!authAdmin) {
    const status = await failInvitation(pool, invitationId, 'authNotConfigured');
    logger.warn('invitation failed', { invitationId, code: 'authNotConfigured', status });
    return;
  }

  await withAdvisoryLock(pool, `lynx.staff_email:${first.email}`, async () => {
    // Again under the lock: another delivery may have finished it meanwhile.
    const current = await invitation(pool, invitationId);
    if (!current || current.status !== 'pending') {
      logger.info('invitation already processed', {
        invitationId,
        status: current?.status ?? 'gone',
      });
      return;
    }

    let userId = await authAdmin.findUserId(current.email);
    let created = false;
    if (!userId) {
      try {
        userId = (await authAdmin.createUser(current.email)).id;
        created = true;
      } catch (error) {
        if (!(error instanceof AuthAdminError)) throw error;
        if (error.kind === 'exists') {
          // Made outside this worker meanwhile (the operator's CLI): use it.
          userId = await authAdmin.findUserId(current.email);
          if (!userId) throw error;
        } else if (error.kind === 'refused') {
          const status = await failInvitation(pool, invitationId, 'authRefused');
          logger.warn('invitation failed', {
            invitationId,
            code: 'authRefused',
            status,
            authStatus: error.status,
            authCode: error.code,
          });
          return;
        } else {
          throw error;
        }
      }
    }

    let result: string;
    try {
      const { rows } = await pool.query<{ result: string }>(
        'select app.complete_staff_invitation($1, $2) as result',
        [invitationId, userId],
      );
      result = rows[0]!.result;
    } catch (error) {
      // The address was taken by another profile at the last moment (users.email is unique).
      if (pgCode(error) !== '23505') throw error;
      await failInvitation(pool, invitationId, 'emailConflict');
      result = 'conflict';
    }

    if (result === 'ready') {
      // A new account is not banned; an existing one (access restored by this invitation, or an
      // account left by an interrupted run) follows the profile, which is now active.
      if (!created) await syncStaffAuth(userId, ctx);
    } else if (created) {
      await discardCreatedAccount(ctx, userId);
    }
    logger.info('invitation processed', { invitationId, result, created });
  });
}

export async function syncStaffAuth(userId: string, ctx: StaffContext): Promise<void> {
  const { pool, authAdmin, logger } = ctx;
  if (!authAdmin) {
    // The database already refuses everything to a removed person; only the sign-in itself stays.
    logger.warn('staff accounts are not configured: sign-in not updated', { userId });
    return;
  }
  await withAdvisoryLock(pool, `lynx.staff_auth:${userId}`, async () => {
    const { rows } = await pool.query<{ deactivated: boolean }>(
      'select deactivated_at is not null as deactivated from public.users where id = $1',
      [userId],
    );
    const profile = rows[0];
    if (!profile) {
      // Deleted by the operator, who deletes the Auth account too.
      logger.info('staff sign-in unchanged: no profile', { userId });
      return;
    }
    try {
      await authAdmin.setBanned(userId, profile.deactivated);
    } catch (error) {
      if (error instanceof AuthAdminError && error.kind === 'notFound') {
        logger.info('staff sign-in unchanged: no Auth account', { userId });
        return;
      }
      throw error;
    }
    logger.info('staff sign-in updated', { userId, banned: profile.deactivated });
  });
}
