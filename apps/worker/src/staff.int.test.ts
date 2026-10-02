/**
 * Integration tests for staff accounts (DECISIONS D-107) against the local stack's real Auth
 * server: `provisionInvitation` (event `staff_invitation.created`) and `syncStaffAuth` (event
 * `staff.access_changed`). Needs DATABASE_URL, and SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 * (the local stack's, from .env.example, by default). Run with `pnpm test:int`, with the worker
 * stopped. Every account it makes is named staff-int-…@demo.lynx.test and deleted at the end.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { AuthAdminError, createAuthAdmin, type AuthAdmin } from './auth-admin';
import type { Logger } from './logger';
import { provisionInvitation, syncStaffAuth, type StaffContext } from './staff';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required for integration tests');

function exampleSetting(name: string): string | undefined {
  const example = readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8');
  return new RegExp(`^${name}=(.+)$`, 'm').exec(example)?.[1]?.trim();
}

const pool = new pg.Pool({ connectionString, max: 6 });
const authAdmin = createAuthAdmin(
  {
    SUPABASE_URL: process.env.SUPABASE_URL || exampleSetting('SUPABASE_URL'),
    SUPABASE_SERVICE_ROLE_KEY:
      process.env.SUPABASE_SERVICE_ROLE_KEY || exampleSetting('SUPABASE_SERVICE_ROLE_KEY'),
  },
  pool,
)!;

const BOARD = 'b0000000-0000-4000-8000-000000000001';
const SCHOOL = 'c0000000-0000-4000-8000-000000000001';
const NATHALIE = 'd0000000-0000-4000-8000-000000000006';
const RUN = Date.now().toString(36);
let counter = 0;
const newEmail = () => `staff-int-${RUN}-${++counter}@demo.lynx.test`;

afterAll(async () => {
  await pool.query(`delete from public.staff_invitations where email like 'staff-int-%'`);
  await pool.query(`delete from auth.users where email like 'staff-int-%'`);
  await pool.end();
});

interface LogEntry {
  level: string;
  message: string;
  data?: Record<string, unknown>;
}

function recordingLogger(): Logger & { entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  return {
    entries,
    info: (message, data) => void entries.push({ level: 'info', message, data }),
    warn: (message, data) => void entries.push({ level: 'warn', message, data }),
    error: (message, data) => void entries.push({ level: 'error', message, data }),
  };
}

const context = (admin: AuthAdmin | null = authAdmin) => {
  const logger = recordingLogger();
  return { ctx: { pool, authAdmin: admin, logger } satisfies StaffContext, logger };
};

/** A pending invitation, as `invite_staff` leaves it for the worker. */
async function invite(
  email: string,
  role: 'teacher' | 'vice_principal' = 'teacher',
  name = 'Personne Essai',
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into public.staff_invitations (board_id, school_id, email, display_name, honorific,
       role, invited_by)
     values ($1, $2, $3, $4, 'Mx', $5, $6) returning id`,
    [BOARD, SCHOOL, email, name, role, NATHALIE],
  );
  return rows[0]!.id;
}

async function invitationRow(id: string) {
  const { rows } = await pool.query<{
    status: string;
    error_code: string | null;
    user_id: string | null;
  }>('select status, error_code, user_id from public.staff_invitations where id = $1', [id]);
  return rows[0]!;
}

async function authAccounts(email: string) {
  const { rows } = await pool.query<{ id: string; banned: boolean }>(
    `select id, coalesce(banned_until > now(), false) as banned from auth.users
     where lower(email) = $1`,
    [email],
  );
  return rows;
}

async function setDeactivated(userId: string, deactivated: boolean) {
  await pool.query(
    `update public.users set deactivated_at = case when $2 then now() end where id = $1`,
    [userId, deactivated],
  );
}

describe('provisionInvitation (D-107)', () => {
  it('creates the account, the profile and the role; a repeat changes nothing', async () => {
    const email = newEmail();
    const id = await invite(email);
    const { ctx, logger } = context();
    await provisionInvitation(id, ctx);

    const accounts = await authAccounts(email);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.banned).toBe(false);
    const userId = accounts[0]!.id;
    // Its tokens carry the role the API's row level security is written for.
    const { rows: auth } = await pool.query<{ role: string; confirmed: boolean }>(
      `select role, email_confirmed_at is not null as confirmed from auth.users where id = $1`,
      [userId],
    );
    expect(auth[0]).toEqual({ role: 'authenticated', confirmed: true });
    expect(await invitationRow(id)).toEqual({ status: 'ready', error_code: null, user_id: userId });
    const { rows: profile } = await pool.query(
      `select u.display_name, u.honorific, u.deactivated_at, r.role, r.school_id
       from public.users u join public.user_roles r on r.user_id = u.id where u.id = $1`,
      [userId],
    );
    expect(profile).toEqual([
      {
        display_name: 'Personne Essai',
        honorific: 'Mx',
        deactivated_at: null,
        role: 'teacher',
        school_id: SCHOOL,
      },
    ]);

    // The event delivered again (a retry, or a restore handing it back): nothing changes.
    await provisionInvitation(id, ctx);
    expect(await authAccounts(email)).toHaveLength(1);
    expect((await invitationRow(id)).status).toBe('ready');
    expect(logger.entries.map((e) => e.message)).toEqual([
      'invitation processed',
      'invitation already processed',
    ]);
    // Ids, results and codes only: never the address or the name.
    const logged = JSON.stringify(logger.entries);
    expect(logged).not.toContain(email);
    expect(logged).not.toContain('Personne Essai');
  });

  it('gives one account when two deliveries run at once', async () => {
    const email = newEmail();
    const id = await invite(email);
    await Promise.all([
      provisionInvitation(id, context().ctx),
      provisionInvitation(id, context().ctx),
    ]);
    expect(await authAccounts(email)).toHaveLength(1);
    expect((await invitationRow(id)).status).toBe('ready');
  });

  it('fails as authNotConfigured on a server without the Auth admin settings', async () => {
    const email = newEmail();
    const id = await invite(email);
    await provisionInvitation(id, context(null).ctx);
    expect(await invitationRow(id)).toEqual({
      status: 'failed',
      error_code: 'authNotConfigured',
      user_id: null,
    });
    expect(await authAccounts(email)).toHaveLength(0);
  });

  it('deletes the account it created when the invitation was cancelled meanwhile', async () => {
    const email = newEmail();
    const id = await invite(email);
    let createdId = '';
    // « Annuler l'invitation » between the account's creation and the completion.
    const cancelling: AuthAdmin = {
      ...authAdmin,
      async createUser(address) {
        const user = await authAdmin.createUser(address);
        createdId = user.id;
        await pool.query(
          `update public.staff_invitations set status = 'cancelled', processed_at = now()
           where id = $1`,
          [id],
        );
        return user;
      },
    };
    const { ctx, logger } = context(cancelling);
    await provisionInvitation(id, ctx);
    expect(createdId).not.toBe('');
    expect(await authAccounts(email)).toHaveLength(0);
    expect((await invitationRow(id)).status).toBe('cancelled');
    const { rows } = await pool.query('select 1 from public.users where id = $1', [createdId]);
    expect(rows).toHaveLength(0);
    expect(logger.entries.at(-1)).toMatchObject({
      message: 'invitation processed',
      data: { result: 'cancelled', created: true },
    });
  });

  it('restores access removed by the board: the account is unbanned', async () => {
    const email = newEmail();
    await provisionInvitation(await invite(email), context().ctx);
    const userId = (await authAccounts(email))[0]!.id;
    await setDeactivated(userId, true);
    await syncStaffAuth(userId, context().ctx);
    expect((await authAccounts(email))[0]!.banned).toBe(true);

    // Invited again (another role): the worker completes it, then lifts the ban.
    const again = await invite(email, 'vice_principal');
    await provisionInvitation(again, context().ctx);
    expect(await invitationRow(again)).toEqual({
      status: 'ready',
      error_code: null,
      user_id: userId,
    });
    expect(await authAccounts(email)).toEqual([{ id: userId, banned: false }]);
    const { rows } = await pool.query<{ deactivated_at: Date | null }>(
      'select deactivated_at from public.users where id = $1',
      [userId],
    );
    expect(rows[0]!.deactivated_at).toBeNull();
  });

  it('fails as authRefused when Auth refuses the address', async () => {
    const id = await invite(newEmail());
    const refusing: AuthAdmin = {
      ...authAdmin,
      createUser: async () => {
        throw new AuthAdminError('refused', 422, 'email_address_invalid');
      },
    };
    const { ctx, logger } = context(refusing);
    await provisionInvitation(id, ctx);
    expect(await invitationRow(id)).toMatchObject({ status: 'failed', error_code: 'authRefused' });
    expect(logger.entries.at(-1)).toMatchObject({
      level: 'warn',
      data: { code: 'authRefused', authStatus: 422, authCode: 'email_address_invalid' },
    });
  });

  it('leaves the invitation pending for a retry when Auth does not answer', async () => {
    const id = await invite(newEmail());
    const down: AuthAdmin = {
      ...authAdmin,
      createUser: async () => {
        throw new AuthAdminError('transient', 503, null);
      },
    };
    await expect(provisionInvitation(id, context(down).ctx)).rejects.toThrow(AuthAdminError);
    expect((await invitationRow(id)).status).toBe('pending');
  });
});

describe('syncStaffAuth (D-107)', () => {
  it('bans and unbans the account to match the profile, as often as asked', async () => {
    const email = newEmail();
    await provisionInvitation(await invite(email), context().ctx);
    const userId = (await authAccounts(email))[0]!.id;

    await setDeactivated(userId, true);
    await syncStaffAuth(userId, context().ctx);
    await syncStaffAuth(userId, context().ctx);
    expect((await authAccounts(email))[0]!.banned).toBe(true);
    const { rows: ban } = await pool.query<{ far: boolean }>(
      `select banned_until > now() + interval '99 years' as far from auth.users where id = $1`,
      [userId],
    );
    expect(ban[0]!.far).toBe(true);

    await setDeactivated(userId, false);
    await syncStaffAuth(userId, context().ctx);
    expect((await authAccounts(email))[0]!.banned).toBe(false);
  });

  it('is done when the account is missing from Auth or has no profile', async () => {
    const email = newEmail();
    await provisionInvitation(await invite(email), context().ctx);
    const userId = (await authAccounts(email))[0]!.id;
    const gone: AuthAdmin = {
      ...authAdmin,
      setBanned: async () => {
        throw new AuthAdminError('notFound', 404, 'user_not_found');
      },
    };
    const { ctx, logger } = context(gone);
    await syncStaffAuth(userId, ctx);
    expect(logger.entries.at(-1)?.message).toBe('staff sign-in unchanged: no Auth account');

    let called = false;
    const watching: AuthAdmin = {
      ...authAdmin,
      setBanned: async () => {
        called = true;
      },
    };
    await syncStaffAuth('00000000-0000-4000-8000-00000000dead', context(watching).ctx);
    expect(called).toBe(false);
  });

  it('only logs without the Auth admin settings', async () => {
    const { ctx, logger } = context(null);
    await syncStaffAuth('00000000-0000-4000-8000-00000000dead', ctx);
    expect(logger.entries).toEqual([
      {
        level: 'warn',
        message: 'staff accounts are not configured: sign-in not updated',
        data: { userId: '00000000-0000-4000-8000-00000000dead' },
      },
    ]);
  });
});
