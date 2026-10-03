/**
 * A database just restored from a backup (deploy/backup/restore.sh; DECISIONS D-115), checked by
 * the backup-restore CI job and the local drill:
 *
 *   psql … -f deploy/ci/restore-fixture.sql      # on the demo data, before the backup
 *   deploy/backup/backup.sh, then a fresh database, then deploy/backup/restore.sh
 *   RESTORE_SMOKE=1 pnpm test:int -- restore-smoke
 *
 * Skipped otherwise: it needs that restored database. Needs DATABASE_URL, SUPABASE_URL,
 * SUPABASE_ANON_KEY and MAILPIT_URL (the local stack's by default), and removes the fixture's rows
 * at the end so the pgTAP suite can run next.
 */
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const FIXTURE_USER = 'fe000000-0000-4000-8000-000000000001';
const FIXTURE_ABSENCE = 'fe000000-0000-4000-8000-000000000002';
/** A seeded teacher (supabase/seed.sql). */
const RESTORED_TEACHER = 'isabelle.tremblay@demo.lynx.test';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';

let pool: pg.Pool;

/** The 6-digit code of the newest e-mail to `email` sent after `after` (ms). */
async function emailedCode(email: string, after: number): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}&limit=5`,
    );
    const body = (await res.json()) as { messages?: { ID: string; Created: string }[] };
    const message = body.messages?.find((m) => new Date(m.Created).getTime() >= after - 2000);
    if (message) {
      const full = (await (await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)).json()) as {
        Text: string;
      };
      const code = /\b(\d{6})\b/.exec(full.Text)?.[1];
      if (code) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no code arrived for ${email}`);
}

describe.skipIf(!process.env.RESTORE_SMOKE)('a restored database (D-115)', () => {
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  });

  afterAll(async () => {
    await pool.query('delete from public.event_outbox where aggregate_id = any($1::uuid[])', [
      [FIXTURE_USER, FIXTURE_ABSENCE],
    ]);
    await pool.query('delete from auth.users where id = $1', [FIXTURE_USER]);
    await pool.end();
  });

  it('bans again everyone whose access was removed', async () => {
    const { rows } = await pool.query<{ id: string; banned: boolean }>(
      `select u.id, a.banned_until > now() + interval '99 years' as banned
         from public.users u join auth.users a on a.id = u.id
        where u.deactivated_at is not null`,
    );
    // The fixture's person was deactivated, not yet banned, when the backup was taken.
    expect(rows.map((r) => r.id)).toContain(FIXTURE_USER);
    expect(rows.filter((r) => !r.banned)).toEqual([]);
    const { rows: active } = await pool.query<{ n: string }>(
      `select count(*) as n from public.users u join auth.users a on a.id = u.id
        where u.deactivated_at is null and a.banned_until > now()`,
    );
    expect(Number(active[0]!.n)).toBe(0);
  });

  it('hands recent events back to the worker’s idempotent handlers only', async () => {
    const { rows } = await pool.query<{ event_type: string; dispatched: boolean }>(
      `select event_type, dispatched_at is not null as dispatched from public.event_outbox
        where aggregate_id = any($1::uuid[]) order by event_type`,
      [[FIXTURE_USER, FIXTURE_ABSENCE]],
    );
    expect(rows).toEqual([
      { event_type: 'absence.published', dispatched: true },
      { event_type: 'staff.access_changed', dispatched: false },
    ]);
  });

  it('lets a restored account sign in with an e-mailed code', async () => {
    const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) throw new Error('set SUPABASE_URL and SUPABASE_ANON_KEY');
    const auth = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }).auth;

    const started = Date.now();
    const sent = await auth.signInWithOtp({
      email: RESTORED_TEACHER,
      options: { shouldCreateUser: false },
    });
    expect(sent.error).toBeNull();
    const verified = await auth.verifyOtp({
      email: RESTORED_TEACHER,
      token: await emailedCode(RESTORED_TEACHER, started),
      type: 'email',
    });
    expect(verified.error).toBeNull();
    expect(verified.data.session?.user.email).toBe(RESTORED_TEACHER);
  });
});
