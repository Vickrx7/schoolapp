/**
 * Supabase Auth's admin API for staff accounts (DECISIONS D-107; Phase 6 slice S4 writes it):
 * the worker creates the accounts board admins invite and bans or unbans those whose access is
 * removed or restored. It needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (the service role:
 * the worker only, never the web server); without them there is no admin (`null`) and
 * invitations fail as `authNotConfigured`.
 */
import type { WorkerEnv } from '@lynx/config';
import type { Pool } from 'pg';

export interface AuthAdmin {
  /** Creates a confirmed account (no e-mail is sent) and returns its id. */
  createUser(email: string): Promise<{ id: string }>;
  /** Bans (`ban_duration` 876000h) or unbans an account. */
  setBanned(userId: string, banned: boolean): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  /** The account with this address, read from `auth.users` through the worker's pool. */
  findUserId(email: string): Promise<string | null>;
}

/** Null until S4 writes it, and whenever the settings are missing. */
export function createAuthAdmin(
  _env: Pick<WorkerEnv, 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'>,
  _pool: Pick<Pool, 'query'>,
): AuthAdmin | null {
  return null;
}
