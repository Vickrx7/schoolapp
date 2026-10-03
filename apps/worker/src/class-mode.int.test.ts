/**
 * Integration test for the class-mode sweep (DECISIONS D-089, D-101): the worker's
 * `class_mode_maintenance` task closes an expired quiz session, deletes its answers and devices,
 * audits the end as the system and logs counts only. Also checks the class-mode demo seed
 * (supabase/seeds/45_class_mode_demo.sql). Needs a migrated and seeded database (DATABASE_URL).
 * The session test runs in a transaction that is rolled back. Run with `pnpm test:int`, with the
 * worker stopped (a running worker could sweep the session first).
 */
import { createHash } from 'node:crypto';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { classModeMaintenance } from './class-mode';
import type { Logger } from './logger';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required for integration tests');

// From supabase/seed.sql and the demo library: Isabelle Tremblay, her 3e année, and the
// board-approved « Quiz : les nombres jusqu’à 1 000 » (demo/quiz-nombres-1000).
const TEACHER = 'd0000000-0000-4000-8000-000000000001';
const CLASS_3E = 'e0000000-0000-4000-8000-000000000003';
const QUIZ = '7bdc7066-9b8a-5125-8351-bf234b0b11d3';

const pool = new pg.Pool({ connectionString });

afterAll(async () => {
  await pool.end();
});

interface LogEntry {
  message: string;
  data?: Record<string, unknown>;
}

function recordingLogger(): Logger & { entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  return {
    entries,
    info: (message, data) => void entries.push({ message, data }),
    warn: (message, data) => void entries.push({ message, data }),
    error: (message, data) => void entries.push({ message, data }),
  };
}

/** Runs `fn` in a transaction that is always rolled back. */
async function inRollback(fn: (db: pg.PoolClient) => Promise<void>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await fn(client);
  } finally {
    await client.query('rollback').catch(() => undefined);
    client.release();
  }
}

/** Runs `sql` as Isabelle (the API role and her claims), then goes back to the worker's role. */
async function asTeacher<T extends pg.QueryResultRow>(
  db: pg.PoolClient,
  sql: string,
  params: unknown[],
): Promise<T[]> {
  await db.query(
    `select set_config('request.jwt.claims', $1, true),
            set_config('request.jwt.claim.sub', $2, true),
            set_config('role', 'authenticated', true)`,
    [JSON.stringify({ sub: TEACHER, role: 'authenticated' }), TEACHER],
  );
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.query(
      `select set_config('role', 'none', true), set_config('request.jwt.claims', '', true),
              set_config('request.jwt.claim.sub', '', true)`,
    );
  }
}

/** Runs `sql` as the class portal's role, as the web server's pool would. */
async function asPortal<T extends pg.QueryResultRow>(
  db: pg.PoolClient,
  sql: string,
  params: unknown[],
): Promise<T[]> {
  await db.query(`select set_config('role', 'lynx_class_portal', true)`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.query(`select set_config('role', 'none', true)`);
  }
}

const hex = (text: string) => createHash('sha256').update(text).digest('hex');

async function control(db: pg.PoolClient, sessionId: string, action: string): Promise<void> {
  await asTeacher(
    db,
    `select public.class_session_control($1, $2,
       (select state_version from public.class_sessions where id = $1))`,
    [sessionId, action],
  );
}

describe('class mode maintenance (class_mode_maintenance)', () => {
  it('closes an expired session, deletes its answers and devices, and logs counts only', async () => {
    await inRollback(async (db) => {
      const [started] = await asTeacher<{ session_id: string; join_code: string }>(
        db,
        `select session_id, join_code from public.start_class_session($1, $2, null, 'solo',
           p_replace_open => true)`,
        [CLASS_3E, QUIZ],
      );
      const sessionId = started!.session_id;

      const tokens: string[] = [];
      for (const n of [1, 2, 3]) {
        const [joined] = await asPortal<{ outcome: string; token: string }>(
          db,
          'select outcome, token from class_portal.join($1, null, $2, $3)',
          [started!.join_code, hex(`int-test-device-${n}`), hex('int-test-network')],
        );
        expect(joined!.outcome).toBe('ok');
        tokens.push(joined!.token);
      }
      await control(db, sessionId, 'next');
      const answers = [{ choiceIds: ['b'] }, { choiceIds: ['a'] }, { choiceIds: ['b'] }];
      for (const [i, token] of tokens.entries()) {
        const [result] = await asPortal<{ result: { outcome: string } }>(
          db,
          'select class_portal.answer($1, 0::smallint, $2::jsonb) as result',
          [token, JSON.stringify(answers[i])],
        );
        expect(result!.result.outcome).toBe('recorded');
      }

      // The session expires. Answers of other expired sessions (none in a fresh seed) are
      // swept too, so they are counted first.
      await db.query(
        `update public.class_sessions set expires_at = now() - interval '1 second' where id = $1`,
        [sessionId],
      );
      const { rows: others } = await db.query<{ n: number }>(
        `select count(*)::integer as n from public.session_responses r
           join public.class_sessions s on s.id = r.session_id
          where s.status = 'open' and s.expires_at <= now() and s.id <> $1`,
        [sessionId],
      );

      const logger = recordingLogger();
      const counts = await classModeMaintenance({ db, logger });

      expect(counts.responsesDeleted).toBe(others[0]!.n + 3);
      expect(counts.sessionsClosed).toBeGreaterThanOrEqual(1);
      expect(logger.entries).toHaveLength(1);
      expect(logger.entries[0]!.message).toBe('class mode maintenance done');
      expect(logger.entries[0]!.data?.responsesDeleted).toBe(others[0]!.n + 3);
      // Counts only: no id, title or code in the log.
      expect(Object.values(logger.entries[0]!.data ?? {}).every((v) => typeof v === 'number')).toBe(
        true,
      );
      const line = JSON.stringify(logger.entries[0]);
      expect(line).not.toContain(sessionId);
      expect(line).not.toContain(started!.join_code);

      const { rows: after } = await db.query<{
        status: string;
        questions: unknown[];
        responses: number;
        participants: number;
        keys: number;
      }>(
        `select s.status, s.questions,
           (select count(*)::integer from public.session_responses r where r.session_id = s.id) as responses,
           (select count(*)::integer from public.session_participants p where p.session_id = s.id) as participants,
           (select count(*)::integer from public.class_session_keys k where k.session_id = s.id) as keys
         from public.class_sessions s where s.id = $1`,
        [sessionId],
      );
      expect(after[0]).toEqual({
        status: 'closed',
        questions: [],
        responses: 0,
        participants: 0,
        keys: 0,
      });

      const { rows: audit } = await db.query<{ actor_type: string; details: unknown }>(
        `select actor_type, details from public.audit_log
          where action = 'class_session.ended' and entity_id = $1`,
        [sessionId],
      );
      expect(audit).toEqual([
        {
          actor_type: 'system',
          details: { responses_deleted: 3, participants_deleted: 3, results_kept: false },
        },
      ]);

      // Nothing left to do: the next run is silent.
      const quiet = recordingLogger();
      const again = await classModeMaintenance({ db, logger: quiet });
      expect(again.sessionsClosed).toBe(0);
      expect(again.responsesDeleted).toBe(0);
    });
  });
});

describe('the class-mode demo (45_class_mode_demo.sql)', () => {
  it('gives the 3e année kept class results and a class link', async () => {
    const { rows: results } = await pool.query<{ aggregate: Record<string, unknown> }>(
      `select r.aggregate from public.class_session_results r
         join public.class_sessions s on s.id = r.session_id
        where s.class_id = $1 and s.library_item_id = $2 and s.status = 'closed'`,
      [CLASS_3E, QUIZ],
    );
    expect(results.length).toBeGreaterThanOrEqual(1);
    const aggregate = results[0]!.aggregate;
    expect(aggregate).toMatchObject({
      schemaVersion: 1,
      mode: 'teams',
      deviceCount: 12,
      questionsPlayed: 9,
    });
    expect(aggregate.teams).toHaveLength(4);
    expect(aggregate.questions).toHaveLength(9);
    // Class counts only.
    expect(JSON.stringify(aggregate)).not.toMatch(/"device"|token|Appareil/);

    const { rows: links } = await pool.query<{ token: string }>(
      'select token from public.class_mode_links where class_id = $1',
      [CLASS_3E],
    );
    expect(links).toHaveLength(1);
    expect(links[0]!.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const { rows: leftovers } = await pool.query<{ n: number }>(
      `select count(*)::integer as n from public.session_responses r
         join public.class_sessions s on s.id = r.session_id
        where s.class_id = $1 and s.status = 'closed'`,
      [CLASS_3E],
    );
    expect(leftovers[0]!.n).toBe(0);
  });
});
