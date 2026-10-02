/**
 * Supabase Auth's admin API for staff accounts (DECISIONS D-107): the worker creates the accounts
 * board admins invite and bans or unbans those whose access is removed or restored. It needs
 * `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (the service role: the worker only, never the
 * web server); without them there is no admin (`null`) and invitations fail as
 * `authNotConfigured`.
 *
 * Every failure is an `AuthAdminError` whose `kind` says what the caller may do about it:
 * `transient` (no answer, a timeout, 429 or 5xx: throw, so graphile-worker tries again later),
 * `exists` (the address already has an account: look it up), `notFound` (no such account) or
 * `refused` (any other 4xx: Auth will not take this address or change). Errors carry the HTTP
 * status and Auth's error code only, never the address.
 */
import type { WorkerEnv } from '@lynx/config';
import { createClient } from '@supabase/supabase-js';
import type { Pool } from 'pg';

/** A pool or one of its connections. */
export type Queryable = Pick<Pool, 'query'>;

export interface AuthAdmin {
  /** Creates a confirmed account (no e-mail is sent) and returns its id. */
  createUser(email: string): Promise<{ id: string }>;
  /** Bans (`ban_duration` 876000h) or unbans an account. */
  setBanned(userId: string, banned: boolean): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  /**
   * The account with this address, read from `auth.users` through `db` (the connection a caller
   * holding a lock already has) or the worker's pool.
   */
  findUserId(email: string, db?: Queryable): Promise<string | null>;
}

export type AuthAdminErrorKind = 'transient' | 'exists' | 'notFound' | 'refused';

export class AuthAdminError extends Error {
  constructor(
    readonly kind: AuthAdminErrorKind,
    readonly status: number | null,
    readonly code: string | null,
  ) {
    super(`auth admin: ${kind}${status ? ` (${status}${code ? ` ${code}` : ''})` : ''}`);
    this.name = 'AuthAdminError';
  }
}

/** What an Auth admin API error means for the worker (see the module comment). */
export function authAdminErrorCode(error: {
  status?: number | null;
  code?: string | null;
}): AuthAdminErrorKind {
  const status = typeof error.status === 'number' ? error.status : 0;
  const code = typeof error.code === 'string' ? error.code : '';
  // No HTTP answer at all (network error, timeout), rate limits and server errors: try again.
  if (status === 0 || status === 408 || status === 429 || status >= 500) return 'transient';
  if (code === 'email_exists' || code === 'user_already_exists') return 'exists';
  if (status === 404 || code === 'user_not_found') return 'notFound';
  // Older Auth versions answer an existing address with a bare 422.
  if (status === 422 && code === '') return 'exists';
  return 'refused';
}

function toAuthAdminError(error: { status?: number; code?: string }): AuthAdminError {
  return new AuthAdminError(
    authAdminErrorCode(error),
    typeof error.status === 'number' && error.status > 0 ? error.status : null,
    typeof error.code === 'string' && /^[a-z_]{1,64}$/.test(error.code) ? error.code : null,
  );
}

/** Ten seconds per request: a stuck Auth server must not hold a job slot. */
const REQUEST_TIMEOUT_MS = 10_000;

function timedFetch(input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
}

/** A ban that outlasts any career; `none` lifts it. */
const BANNED = '876000h';

export function createAuthAdmin(
  env: Pick<WorkerEnv, 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'>,
  pool: Queryable,
): AuthAdmin | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: timedFetch },
  }).auth.admin;

  return {
    async createUser(email) {
      // The role every signed-in person's token carries (PostgREST's `authenticated`), set
      // here rather than left to the Auth server's default group, which may be unset.
      const { data, error } = await admin.createUser({
        email,
        email_confirm: true,
        role: 'authenticated',
      });
      if (error) throw toAuthAdminError(error);
      if (!data.user) throw new AuthAdminError('transient', null, null);
      return { id: data.user.id };
    },

    async setBanned(userId, banned) {
      const { error } = await admin.updateUserById(userId, {
        ban_duration: banned ? BANNED : 'none',
      });
      if (error) throw toAuthAdminError(error);
    },

    async deleteUser(userId) {
      const { error } = await admin.deleteUser(userId);
      if (error) throw toAuthAdminError(error);
    },

    async findUserId(email, db = pool) {
      const { rows } = await db.query<{ id: string }>(
        `select id from auth.users where lower(email) = lower($1)
         order by created_at, id limit 1`,
        [email],
      );
      return rows[0]?.id ?? null;
    },
  };
}
