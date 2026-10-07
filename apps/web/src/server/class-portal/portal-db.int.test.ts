/**
 * Integration test for class devices' database connection (DECISIONS D-083, D-086): the web
 * server's portal pool, with exactly its settings (`pool-options.ts`), can run the class_portal
 * functions and nothing else, its statement timeout holds whichever way it logs in, and a whole
 * device round trip parses with the web server's schemas without ever carrying a key. Needs a
 * migrated and seeded database. Connects with CLASS_PORTAL_DATABASE_URL; when it is unset, with the
 * local and CI login that supabase/seed.sql sets, on the host and port of DATABASE_URL.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { CLASS_PORTAL_POOL_OPTIONS } from './pool-options';
import { answerResultSchema, deviceStateSchema, joinRowSchema, liveStateSchema } from './schemas';

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL is required for integration tests');

function localPortalUrl(): string {
  const url = new URL(adminUrl!);
  url.username = 'lynx_class_portal';
  url.password = 'lynx-class-portal-local-only';
  return url.toString();
}

/** The CI fallback: the owner connection acting as the portal role (role settings do not apply). */
function fallbackUrl(): string {
  const url = new URL(adminUrl!);
  url.searchParams.set('options', '-c role=lynx_class_portal');
  return url.toString();
}

const portal = new pg.Pool({
  connectionString: process.env.CLASS_PORTAL_DATABASE_URL || localPortalUrl(),
  ...CLASS_PORTAL_POOL_OPTIONS,
});
const fallback = new pg.Pool({ connectionString: fallbackUrl(), ...CLASS_PORTAL_POOL_OPTIONS });
const admin = new pg.Pool({ connectionString: adminUrl, max: 1 });

const hex = () => randomBytes(32).toString('hex');
const device = hex();
const network = hex();

// Seeded: Marc Gagnon's 5e année, and a board-approved quiz of the demo pack.
const MARC = 'd0000000-0000-4000-8000-000000000002';
const CLASS_5 = 'e0000000-0000-4000-8000-000000000005';
const QUIZ = 'd91d5a99-ba73-5040-97fd-1d144d81cb15';

afterAll(async () => {
  await admin.query('delete from public.class_join_failures where device_key = $1', [device]);
  await Promise.all([portal.end(), fallback.end(), admin.end()]);
});

/** The SQLSTATE a statement fails with, or null when it succeeds. */
async function failure(pool: pg.Pool, sql: string, params: unknown[] = []): Promise<string | null> {
  try {
    await pool.query(sql, params);
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? 'unknown';
  }
}

/** Runs teacher functions as Marc (his claims, as PostgREST would set them), committed. */
async function asMarc<T>(sql: string, params: unknown[]): Promise<T> {
  const client = await admin.connect();
  try {
    await client.query('begin');
    await client.query(
      `select set_config('role', 'authenticated', true),
              set_config('request.jwt.claims', $1, true),
              set_config('request.jwt.claim.sub', $2, true)`,
      [JSON.stringify({ sub: MARC, role: 'authenticated' }), MARC],
    );
    const { rows } = await client.query(sql, params);
    await client.query('commit');
    return rows[0] as T;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

describe('the class portal connection', () => {
  it('runs as lynx_class_portal with a 3 s statement timeout, however it logs in', async () => {
    for (const pool of [portal, fallback]) {
      const { rows } = await pool.query<{ role: string; timeout: string }>(
        `select current_user as role, current_setting('statement_timeout') as timeout`,
      );
      expect(rows[0]).toEqual({ role: 'lynx_class_portal', timeout: '3s' });
    }
    expect((await portal.query('show statement_timeout')).rows[0]?.statement_timeout).toBe('3s');
  });

  it('cannot read tables or call staff and AI functions', async () => {
    for (const pool of [portal, fallback]) {
      expect(await failure(pool, 'select 1 from public.class_sessions')).toBe('42501');
      expect(await failure(pool, 'select 1 from public.class_session_keys')).toBe('42501');
      expect(await failure(pool, 'select 1 from public.library_item_answer_keys')).toBe('42501');
      expect(
        await failure(pool, `select * from public.start_class_session($1, $2, null, 'solo')`, [
          CLASS_5,
          QUIZ,
        ]),
      ).toBe('42501');
      expect(
        await failure(pool, "select app.class_grade('{}'::jsonb, '{}'::jsonb, '{}'::jsonb)"),
      ).toBe('42501');
    }
  });

  it('answers an unknown device token as gone', async () => {
    const { rows } = await portal.query<{ state: unknown }>(
      "select class_portal.state('x', null) as state",
    );
    expect(deviceStateSchema.parse(rows[0]?.state)).toEqual({ status: 'gone' });
  });

  it('plays a question from a device without a key reaching it, and deletes it at the end', async () => {
    const started = await asMarc<{ session_id: string; join_code: string }>(
      `select * from public.start_class_session($1, $2, null, 'solo', 4::smallint, 'random',
         null, true, false, true)`,
      [CLASS_5, QUIZ],
    );
    const outputs: unknown[] = [];
    try {
      const join = await portal.query(
        'select outcome, token, expires_at, retry_after from class_portal.join($1, null, $2, $3)',
        [started.join_code, device, network],
      );
      const row = joinRowSchema.parse(join.rows[0]);
      expect(row.outcome).toBe('ok');
      const token = row.token!;

      const lobby = liveStateSchema.parse(
        (
          await asMarc<{ s: unknown }>('select public.class_session_live($1) as s', [
            started.session_id,
          ])
        ).s,
      );
      const moved = liveStateSchema.parse(
        (
          await asMarc<{ s: unknown }>(`select public.class_session_control($1, 'next', $2) as s`, [
            started.session_id,
            lobby.version,
          ])
        ).s,
      );
      expect(moved.phase).toBe('question');
      // No key reaches the projector before the reveal either.
      expect(moved.reveal).toBeNull();
      const state = await portal.query<{ s: unknown }>('select class_portal.state($1, null) as s', [
        token,
      ]);
      outputs.push(state.rows[0]?.s);
      const view = deviceStateSchema.parse(state.rows[0]?.s);
      if (view.status !== 'ok' || !view.question) throw new Error('no question on the device');

      const q = view.question;
      const response =
        q.kind === 'multiple_choice'
          ? { choiceIds: [q.choices![0]!.id] }
          : q.kind === 'true_false'
            ? { value: true }
            : q.kind === 'matching'
              ? { pairs: Object.fromEntries(q.left!.map((l) => [l.id, q.right![0]!.id])) }
              : q.kind === 'ordering'
                ? { orderedIds: q.items!.map((i) => i.id) }
                : { text: 'mille' };
      const answer = await portal.query<{ s: unknown }>(
        'select class_portal.answer($1, $2::smallint, $3::jsonb) as s',
        [token, view.session.index, JSON.stringify(response)],
      );
      outputs.push(answer.rows[0]?.s);
      const result = answerResultSchema.parse(answer.rows[0]?.s);
      expect(result).toMatchObject({ status: 'ok', outcome: 'recorded' });

      // Nothing a device received holds a key's field or the question's explanation.
      const text = JSON.stringify(outputs);
      for (const word of [
        'correctChoiceIds',
        'orderedIds',
        'accepted',
        'acceptable',
        'explanation',
        'sampleAnswer',
        'answers',
      ]) {
        expect(text).not.toContain(word);
      }
    } finally {
      const ended = await asMarc<{ s: { responsesDeleted?: number } }>(
        'select public.end_class_session($1, false) as s',
        [started.session_id],
      );
      expect(ended.s.responsesDeleted).toBe(1);
      const left = await admin.query<{ n: string }>(
        `select (select count(*) from public.session_responses where session_id = $1)
              + (select count(*) from public.session_participants where session_id = $1)
              + (select count(*) from public.class_session_keys where session_id = $1) as n`,
        [started.session_id],
      );
      expect(Number(left.rows[0]?.n)).toBe(0);
      await admin.query('delete from public.class_sessions where id = $1', [started.session_id]);
    }
  });
});
