/**
 * Integration test for the substitute portal's database login (DECISIONS D-049): the web
 * server's portal connection can run the sub_portal functions and nothing else. Needs a
 * migrated and seeded database. Connects with SUB_PORTAL_DATABASE_URL; when it is unset, with
 * the local and CI login that supabase/seed.sql sets, on the host and port of DATABASE_URL.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL is required for integration tests');

function localPortalUrl(): string {
  const url = new URL(adminUrl!);
  url.username = 'lynx_sub_portal';
  url.password = 'lynx-sub-portal-local-only';
  return url.toString();
}

const portal = new pg.Pool({
  connectionString: process.env.SUB_PORTAL_DATABASE_URL || localPortalUrl(),
  max: 1,
});
const admin = new pg.Pool({ connectionString: adminUrl, max: 1 });

const hex = () => randomBytes(32).toString('hex');
const device = hex();

afterAll(async () => {
  // The failed attempt this test records (throttling rows are kept a day otherwise).
  await admin.query('delete from public.sub_code_attempts where device_key = $1', [device]);
  await Promise.all([portal.end(), admin.end()]);
});

/** The SQLSTATE a statement fails with, or null when it succeeds. */
async function failure(sql: string, params: unknown[] = []): Promise<string | null> {
  try {
    await portal.query(sql, params);
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? 'unknown';
  }
}

describe('the substitute portal connection', () => {
  it('runs as lynx_sub_portal', async () => {
    const { rows } = await portal.query<{ role: string }>('select current_user as role');
    expect(rows[0]?.role).toBe('lynx_sub_portal');
  });

  it('cannot read tables', async () => {
    expect(await failure('select id from public.absences limit 1')).toBe('42501');
    expect(await failure('select id from public.student_alerts limit 1')).toBe('42501');
    expect(await failure('select id from public.sub_access_codes limit 1')).toBe('42501');
  });

  it('cannot call staff functions or app helpers', async () => {
    expect(
      await failure(
        `select public.publish_absence($1, current_date, current_date, 'full_day', null, true,
           gen_random_uuid(), '[]')`,
        ['c0000000-0000-4000-8000-000000000001'],
      ),
    ).toBe('42501');
    expect(await failure("select app.log_audit('x.y', null, null, 'x', null)")).toBe('42501');
  });

  it('runs the portal functions', async () => {
    const { rows } = await portal.query<{ outcome: string; session_token: string | null }>(
      'select outcome, session_token from sub_portal.redeem($1::text[], $2, $3)',
      [['0'.repeat(64)], device, hex()],
    );
    expect(rows).toEqual([{ outcome: 'invalid', session_token: null }]);
    const load = await portal.query<{ day: unknown }>("select sub_portal.load('x') as day");
    expect(load.rows[0]?.day).toEqual({ status: 'expired' });
    const save = await portal.query<{ outcome: string }>(
      `select outcome from sub_portal.save_report('x', '{"schemaVersion": 1}', null, null, true)`,
    );
    expect(save.rows).toEqual([{ outcome: 'expired' }]);
  });
});
