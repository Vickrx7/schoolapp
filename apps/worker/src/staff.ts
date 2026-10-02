/**
 * Staff accounts (DECISIONS D-107).
 *
 * - `provisionInvitation` (handler `staff_invitation_provision`, event `staff_invitation.created`
 *   `{invitationId}`): finds or creates the Auth account, calls `app.complete_staff_invitation`
 *   (which checks again for conflicts, cancellation and whether the inviter still administers the
 *   board), and only then unbans an existing account; deletes an account it created for an
 *   invitation that was cancelled or conflicts. Network errors and 5xx throw (graphile-worker
 *   retries); a 4xx fails the invitation as `authRefused`. A delivery for an invitation that is
 *   already `ready` makes its account follow the profile again: a retry after the unban failed
 *   (Auth did not answer once the invitation had completed) or a restore handing the event back
 *   still lifts the ban.
 * - `syncStaffAuth` (handler `staff_auth_sync`, event `staff.access_changed` `{userId}`): reads
 *   `users.deactivated_at` and bans or unbans the account; an account missing from Auth is done.
 *
 * Both are idempotent: an event can be delivered twice, and a restore hands recent events back
 * (deploy/backup/restore.sh). Each works under an advisory lock (the invitation's address, or the
 * person), so two deliveries, or two invitations of one address from different boards, never
 * interleave: the second sees what the first did. A job holds one connection at most: everything
 * under a lock runs on the lock's own connection, and the ban sync of an invitation runs on the
 * connection that holds the address's lock (D-107, as amended in the Phase 6 review: nested
 * checkouts could take every connection of the pool and stop the worker). Logs carry ids and
 * codes only, never an address.
 */
import type { Pool, PoolClient } from 'pg';
import { AuthAdminError, type AuthAdmin, type Queryable } from './auth-admin';
import type { Logger } from './logger';

export interface StaffContext {
  pool: Pool;
  /** Null when this server has no Auth admin settings (invitations fail as `authNotConfigured`). */
  authAdmin: AuthAdmin | null;
  logger: Logger;
}

type InvitationError = 'authNotConfigured' | 'authRefused' | 'emailConflict';

/**
 * Runs `fn` while holding a session advisory lock. Given the pool, on a connection of its own,
 * released at the end (a connection whose unlock failed is closed instead, which releases the
 * lock too); given a connection (a caller already holding another lock on it), on that one.
 * `fn` gets the connection: every query under the lock goes through it.
 */
async function withAdvisoryLock<T>(
  db: Pool | PoolClient,
  key: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const given = typeof (db as Partial<PoolClient>).release === 'function';
  const client = given ? (db as PoolClient) : await (db as Pool).connect();
  let healthy = false;
  try {
    await client.query('select pg_advisory_lock(hashtextextended($1, 0))', [key]);
    try {
      return await fn(client);
    } finally {
      try {
        await client.query('select pg_advisory_unlock(hashtextextended($1, 0))', [key]);
        healthy = true;
      } catch {
        // Closed below (or by the caller that owns the connection).
      }
    }
  } finally {
    if (!given) client.release(!healthy);
  }
}

async function invitation(
  db: Queryable,
  invitationId: string,
): Promise<{ email: string; status: string; user_id: string | null } | null> {
  const { rows } = await db.query<{ email: string; status: string; user_id: string | null }>(
    'select email, status, user_id from public.staff_invitations where id = $1',
    [invitationId],
  );
  return rows[0] ?? null;
}

async function failInvitation(
  db: Queryable,
  invitationId: string,
  code: InvitationError,
): Promise<string> {
  const { rows } = await db.query<{ result: string }>(
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
async function discardCreatedAccount(
  db: Queryable,
  authAdmin: AuthAdmin,
  userId: string,
): Promise<void> {
  const { rows } = await db.query('select 1 from public.users where id = $1', [userId]);
  if (rows.length > 0) return;
  try {
    await authAdmin.deleteUser(userId);
  } catch (error) {
    if (!(error instanceof AuthAdminError && error.kind === 'notFound')) throw error;
  }
}

export async function provisionInvitation(invitationId: string, ctx: StaffContext): Promise<void> {
  const { pool, authAdmin, logger } = ctx;
  const first = await invitation(pool, invitationId);
  if (!first || first.status !== 'pending') {
    if (first?.status === 'ready' && first.user_id) {
      // Completed already: its account follows the profile (an unban that failed is retried).
      await syncStaffAuth(first.user_id, ctx);
    }
    logger.info('invitation already processed', { invitationId, status: first?.status ?? 'gone' });
    return;
  }
  if (!authAdmin) {
    const status = await failInvitation(pool, invitationId, 'authNotConfigured');
    logger.warn('invitation failed', { invitationId, code: 'authNotConfigured', status });
    return;
  }

  await withAdvisoryLock(pool, `lynx.staff_email:${first.email}`, async (db) => {
    // Again under the lock: another delivery may have finished it meanwhile.
    const current = await invitation(db, invitationId);
    if (!current || current.status !== 'pending') {
      logger.info('invitation already processed', {
        invitationId,
        status: current?.status ?? 'gone',
      });
      return;
    }

    let userId = await authAdmin.findUserId(current.email, db);
    let created = false;
    if (!userId) {
      try {
        userId = (await authAdmin.createUser(current.email)).id;
        created = true;
      } catch (error) {
        if (!(error instanceof AuthAdminError)) throw error;
        if (error.kind === 'exists') {
          // Made outside this worker meanwhile (the operator's CLI): use it.
          userId = await authAdmin.findUserId(current.email, db);
          if (!userId) throw error;
        } else if (error.kind === 'refused') {
          const status = await failInvitation(db, invitationId, 'authRefused');
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
      const { rows } = await db.query<{ result: string }>(
        'select app.complete_staff_invitation($1, $2) as result',
        [invitationId, userId],
      );
      result = rows[0]!.result;
    } catch (error) {
      // The address was taken by another profile at the last moment (users.email is unique).
      if (pgCode(error) !== '23505') throw error;
      await failInvitation(db, invitationId, 'emailConflict');
      result = 'conflict';
    }

    if (result === 'ready') {
      // A new account is not banned; an existing one (access restored by this invitation, or an
      // account left by an interrupted run) follows the profile, which is now active. On this
      // connection: the job never holds a second one. If Auth does not answer, the job throws
      // and its retry finds the invitation `ready` and syncs again (above).
      if (!created) await syncStaffAuthOn(db, userId, ctx);
    } else if (created) {
      await discardCreatedAccount(db, authAdmin, userId);
    }
    logger.info('invitation processed', { invitationId, result, created });
  });
}

export async function syncStaffAuth(userId: string, ctx: StaffContext): Promise<void> {
  await syncStaffAuthOn(ctx.pool, userId, ctx);
}

/** `syncStaffAuth` on `db`: the pool, or a connection the caller holds (and keeps). */
async function syncStaffAuthOn(
  db: Pool | PoolClient,
  userId: string,
  ctx: StaffContext,
): Promise<void> {
  const { authAdmin, logger } = ctx;
  if (!authAdmin) {
    // The database already refuses everything to a removed person; only the sign-in itself stays.
    logger.warn('staff accounts are not configured: sign-in not updated', { userId });
    return;
  }
  await withAdvisoryLock(db, `lynx.staff_auth:${userId}`, async (client) => {
    const { rows } = await client.query<{ deactivated: boolean }>(
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
