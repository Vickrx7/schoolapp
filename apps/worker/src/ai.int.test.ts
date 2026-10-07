/**
 * Integration test for AI jobs with the fake provider: needs a migrated and seeded database
 * (DATABASE_URL), e.g. the local Supabase stack. Run with `pnpm test:int`.
 *
 * Tests that change shared data (another school, the AI switch, spending) run inside a
 * transaction that is rolled back, so the demo data and other test runs are untouched.
 */
import { randomUUID } from 'node:crypto';
import {
  AiProviderError,
  createFakeProvider,
  priceFor,
  type AiProvider,
  type ProviderRequest,
  type ProviderResult,
} from '@lynx/ai';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadKnownPeople, runAiJob, type AiRuntime } from './ai';
import { createLogger } from './logger';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required for integration tests');

// From supabase/seed.sql: the demo board, school and a 3e année teacher (Isabelle Tremblay).
const BOARD = 'b0000000-0000-4000-8000-000000000001';
const SCHOOL = 'c0000000-0000-4000-8000-000000000001';
const TEACHER = 'd0000000-0000-4000-8000-000000000001';

type Db = Pick<pg.Pool, 'query'>;

const pool = new pg.Pool({ connectionString });
const ai: AiRuntime = { provider: createFakeProvider(), price: priceFor('fake') };
const deps = { pool, ai, logger: createLogger('test') };
const jobs: string[] = [];
let wasEnabled = false;
let levels: { id: string; label_fr: string }[] = [];
let studentName = '';

async function createJob(text: string, db: Db = pool): Promise<string> {
  const input = {
    title: 'Le castor',
    text,
    objective: '',
    itemType: 'reading_passage',
    gradeCode: '3',
    gradeLabel: '3e année',
    subjectId: null,
    subjectLabel: 'Sciences et technologie',
    levels: levels.slice(0, 2).map((l, i) => ({
      key: `L${i + 1}`,
      languageLevelId: l.id,
      label: l.label_fr,
      description: null,
    })),
  };
  const { rows } = await db.query<{ id: string }>(
    `insert into public.ai_jobs (board_id, school_id, user_id, feature, input)
     values ($1, $2, $3, 'differentiate', $4) returning id`,
    [BOARD, SCHOOL, TEACHER, JSON.stringify(input)],
  );
  if (db === pool) jobs.push(rows[0]!.id);
  return rows[0]!.id;
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

async function jobRow(db: Db, id: string) {
  const { rows } = await db.query(
    `select j.status, j.error_code, j.sent_text, j.result, j.ai_generation_id,
            g.status as gen_status, g.error_code as gen_error_code, g.input_tokens,
            g.output_tokens, g.estimated_cost_usd, g.provider_request_id
       from public.ai_jobs j left join public.ai_generations g on g.id = j.ai_generation_id
      where j.id = $1`,
    [id],
  );
  return rows[0];
}

/** A runtime whose provider answers from `answer` and records every request. */
function scripted(answer: (n: number) => ProviderResult<unknown>) {
  const requests: ProviderRequest<unknown>[] = [];
  const provider: AiProvider = {
    name: 'test',
    model: 'fake',
    async generate<T>(request: ProviderRequest<T>) {
      requests.push(request as ProviderRequest<unknown>);
      return answer(requests.length) as ProviderResult<T>;
    },
  };
  return { ai: { provider, price: priceFor('fake') } satisfies AiRuntime, requests };
}

const USAGE = { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 };
const BEAVER = 'Le castor construit un barrage avec des branches et de la boue.';

async function createUser(db: Db, displayName: string): Promise<string> {
  const id = randomUUID();
  const email = `${id}@test.lynx.test`;
  await db.query(
    `insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at)
     values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, now(), now(), now())`,
    [id, email],
  );
  await db.query('insert into public.users (id, email, display_name) values ($1, $2, $3)', [
    id,
    email,
    displayName,
  ]);
  return id;
}

/**
 * The teacher also works at a school of another board (an itinerant teacher): a student of
 * hers there, that school's principal and that board's administrator.
 */
async function addOtherSchool(db: Db) {
  const one = async (sql: string, params: unknown[]) =>
    (await db.query<{ id: string }>(sql, params)).rows[0]!.id;
  const board = await one(
    `insert into public.boards (name, slug) values ('Conseil test', $1) returning id`,
    [`conseil-test-${randomUUID().slice(0, 8)}`],
  );
  const school = await one(
    `insert into public.schools (board_id, name, slug) values ($1, 'École test', 'ecole-test')
     returning id`,
    [board],
  );
  const year = await one(
    `insert into public.school_years (board_id, name, starts_on, ends_on)
     values ($1, '2026-2027', '2026-09-01', '2027-06-30') returning id`,
    [board],
  );
  const cls = await one(
    `insert into public.classes (school_id, school_year_id, name) values ($1, $2, '4e année')
     returning id`,
    [school, year],
  );
  await db.query(
    `insert into public.user_roles (user_id, role, board_id, school_id)
     values ($1, 'teacher', $2, $3)`,
    [TEACHER, board, school],
  );
  await db.query('insert into public.class_teachers (class_id, user_id) values ($1, $2)', [
    cls,
    TEACHER,
  ]);
  await db.query(`insert into public.students (class_id, first_name) values ($1, 'Anatole')`, [
    cls,
  ]);
  const principal = await createUser(db, 'Chantal Boisvert');
  await db.query(
    `insert into public.user_roles (user_id, role, board_id, school_id)
     values ($1, 'principal', $2, $3)`,
    [principal, board, school],
  );
  const admin = await createUser(db, 'Ginette Ouellet');
  await db.query(
    `insert into public.user_roles (user_id, role, board_id) values ($1, 'board_admin', $2)`,
    [admin, board],
  );
}

beforeAll(async () => {
  const school = await pool.query<{ ai_enabled: boolean }>(
    'select ai_enabled from public.schools where id = $1',
    [SCHOOL],
  );
  wasEnabled = school.rows[0]!.ai_enabled;
  await pool.query('update public.schools set ai_enabled = true where id = $1', [SCHOOL]);
  levels = (
    await pool.query<{ id: string; label_fr: string }>(
      'select id, label_fr from public.language_levels where board_id = $1 and owner_user_id is null order by sort_order',
      [BOARD],
    )
  ).rows;
  studentName = (
    await pool.query<{ first_name: string }>(
      `select s.first_name from public.students s join public.classes c on c.id = s.class_id
        where c.school_id = $1 order by s.first_name limit 1`,
      [SCHOOL],
    )
  ).rows[0]!.first_name;
});

afterAll(async () => {
  const gens = await pool.query<{ ai_generation_id: string | null }>(
    'select ai_generation_id from public.ai_jobs where id = any($1)',
    [jobs],
  );
  await pool.query('delete from public.ai_jobs where id = any($1)', [jobs]);
  await pool.query('delete from public.ai_generations where id = any($1)', [
    gens.rows.map((r) => r.ai_generation_id).filter(Boolean),
  ]);
  await pool.query('update public.schools set ai_enabled = $2 where id = $1', [SCHOOL, wasEnabled]);
  await pool.end();
});

describe('AI jobs', () => {
  it('sends de-identified text, records usage and stores the answer with names back', async () => {
    const id = await createJob(
      `${studentName} observe un castor près de la rivière. Le castor construit un barrage avec des branches.`,
    );
    await runAiJob(id, deps);

    const { rows } = await pool.query(
      `select j.status, j.error_code, j.sent_text, j.result, g.estimated_cost_usd, g.provider, g.status as gen_status
         from public.ai_jobs j left join public.ai_generations g on g.id = j.ai_generation_id
        where j.id = $1`,
      [id],
    );
    const job = rows[0];
    expect(job.status).toBe('succeeded');
    expect(job.sent_text).toContain('Élève A observe un castor');
    expect(job.sent_text).not.toContain(studentName);
    expect(JSON.stringify(job.result)).toContain(`${studentName} observe un castor`);
    expect(job.provider).toBe('fake');
    expect(job.gen_status).toBe('succeeded');
    expect(Number(job.estimated_cost_usd)).toBeGreaterThan(0);
  });

  it('refuses a request with a personal detail without sending or charging anything', async () => {
    const id = await createJob(
      'Le castor construit un barrage. Pour les questions, écrivez à parent@example.com ce soir.',
    );
    await runAiJob(id, deps);
    const { rows } = await pool.query(
      'select status, error_code, sent_text, ai_generation_id from public.ai_jobs where id = $1',
      [id],
    );
    expect(rows[0]).toMatchObject({
      status: 'failed',
      error_code: 'personalInfo',
      sent_text: null,
      ai_generation_id: null,
    });
  });

  it('runs a job only once', async () => {
    const id = await createJob('Le castor construit un barrage avec des branches et de la boue.');
    await runAiJob(id, deps);
    await runAiJob(id, deps);
    const { rows } = await pool.query(
      `select count(*)::int as n from public.ai_generations g
        join public.ai_jobs j on j.ai_generation_id = g.id where j.id = $1`,
      [id],
    );
    expect(rows[0].n).toBe(1);
  });

  it('fails cleanly when AI is off for the deployment', async () => {
    const id = await createJob('Le castor construit un barrage avec des branches et de la boue.');
    await runAiJob(id, { ...deps, ai: null });
    const { rows } = await pool.query(
      'select status, error_code from public.ai_jobs where id = $1',
      [id],
    );
    expect(rows[0]).toMatchObject({ status: 'failed', error_code: 'aiUnavailable' });
  });
});

describe('AI jobs: who is de-identified', () => {
  it('replaces board staff and the requester, then restores them as written', async () => {
    await inRollback(async (db) => {
      const id = await createJob(
        `Mme Roy et Isabelle Tremblay écoutent ${studentName} lire. ${BEAVER}`,
        db,
      );
      await runAiJob(id, { ...deps, pool: db });
      const job = await jobRow(db, id);
      expect(job.status).toBe('succeeded');
      expect(job.sent_text).not.toMatch(/Roy|Nathalie|Tremblay|Isabelle/);
      expect(job.sent_text).toContain('Adulte A et Adulte B écoutent Élève A lire.');
      expect(JSON.stringify(job.result)).toContain(
        `Mme Roy et Isabelle Tremblay écoutent ${studentName} lire.`,
      );
    });
    const people = await loadKnownPeople(pool, SCHOOL, TEACHER);
    expect(people).toContainEqual({ name: 'Nathalie Roy', kind: 'staff' });
    expect(people).toContainEqual({ name: 'Isabelle Tremblay', kind: 'staff' });
  });

  it('replaces people from the requester’s other schools and boards before sending', async () => {
    await inRollback(async (db) => {
      await addOtherSchool(db);
      const id = await createJob(
        `Anatole et Mme Boisvert préparent la sortie. Mme Ouellet viendra aussi. ${BEAVER}`,
        db,
      );
      await runAiJob(id, { ...deps, pool: db });
      const job = await jobRow(db, id);
      expect(job.status).toBe('succeeded');
      expect(job.sent_text).not.toMatch(/Anatole|Boisvert|Chantal|Ouellet|Ginette/);
      expect(job.sent_text).toContain(
        'Élève A et Adulte A préparent la sortie. Adulte B viendra aussi.',
      );
      expect(JSON.stringify(job.result)).toContain(
        'Anatole et Mme Boisvert préparent la sortie. Mme Ouellet viendra aussi.',
      );
    });
  });

  it('knows everyone the requester can see, so the preview never promises more', async () => {
    await inRollback(async (db) => {
      await addOtherSchool(db);
      const roster = await loadKnownPeople(db, SCHOOL, TEACHER);
      // The web preview's roster: the same selects, as the teacher under RLS.
      await db.query(
        `select set_config('request.jwt.claims', $1, true),
                set_config('request.jwt.claim.sub', $2, true),
                set_config('role', 'authenticated', true)`,
        [JSON.stringify({ sub: TEACHER, role: 'authenticated' }), TEACHER],
      );
      const students = await db.query<{ first_name: string }>(
        'select first_name from public.students',
      );
      const users = await db.query<{ display_name: string }>(
        'select display_name from public.users',
      );
      await db.query('reset role');

      const known = new Set(roster.map((p) => `${p.kind}:${p.name}`));
      const visible = [
        ...students.rows.map((s) => `student:${s.first_name}`),
        ...users.rows.map((u) => `staff:${u.display_name}`),
      ];
      expect(visible).toContain('student:Anatole');
      expect(visible).toContain('staff:Chantal Boisvert');
      expect(visible.filter((v) => !known.has(v))).toEqual([]);
      // Wider than the preview: the other board's administrator too.
      expect(known.has('staff:Ginette Ouellet')).toBe(true);
    });
  });
});

describe('AI jobs: checks when the job runs', () => {
  it('fails a queued job when the direction turned AI off before it ran', async () => {
    await inRollback(async (db) => {
      const { ai: spy, requests } = scripted(() => {
        throw new Error('the provider must not be called');
      });
      const id = await createJob(BEAVER, db);
      await db.query('update public.schools set ai_enabled = false where id = $1', [SCHOOL]);
      await runAiJob(id, { ...deps, pool: db, ai: spy });
      expect(await jobRow(db, id)).toMatchObject({
        status: 'failed',
        error_code: 'aiDisabled',
        sent_text: null,
        ai_generation_id: null,
      });
      expect(requests).toHaveLength(0);
    });
  });

  it('fails a queued job when the board forbade AI before it ran', async () => {
    await inRollback(async (db) => {
      const { ai: spy, requests } = scripted(() => {
        throw new Error('the provider must not be called');
      });
      const id = await createJob(BEAVER, db);
      await db.query('update public.schools set ai_enabled = true where id = $1', [SCHOOL]);
      await db.query(
        `update public.boards set settings = settings || '{"ai": {"allowed": false}}' where id = $1`,
        [BOARD],
      );
      await runAiJob(id, { ...deps, pool: db, ai: spy });
      expect(await jobRow(db, id)).toMatchObject({
        status: 'failed',
        error_code: 'aiDisabled',
        sent_text: null,
        ai_generation_id: null,
      });
      expect(requests).toHaveLength(0);
    });
  });

  it('fails a queued job when the school’s budget ran out before it ran', async () => {
    await inRollback(async (db) => {
      const { ai: spy, requests } = scripted(() => {
        throw new Error('the provider must not be called');
      });
      const id = await createJob(BEAVER, db);
      // Other jobs spent the whole allowance, and there is nothing left to borrow.
      await db.query(
        `insert into public.ai_budgets (school_id, monthly_allowance_usd, monthly_ceiling_usd)
         values ($1, 0, 0)
         on conflict (school_id) do update set monthly_allowance_usd = 0, monthly_ceiling_usd = 0`,
        [SCHOOL],
      );
      await runAiJob(id, { ...deps, pool: db, ai: spy });
      expect(await jobRow(db, id)).toMatchObject({
        status: 'failed',
        error_code: 'aiBudgetReached',
        sent_text: null,
        ai_generation_id: null,
      });
      expect(requests).toHaveLength(0);
    });
  });
});

describe('AI jobs: failed calls cost money and are counted', () => {
  async function schoolSpent(db: Db): Promise<number> {
    const { rows } = await db.query<{ school_spent_usd: string }>(
      'select school_spent_usd from app.ai_budget_status($1)',
      [SCHOOL],
    );
    return Number(rows[0]!.school_spent_usd);
  }

  it('records three unusable answers against the school', async () => {
    await inRollback(async (db) => {
      const { ai: spy, requests } = scripted((n) => ({
        output: null,
        stopReason: 'invalid_json',
        model: 'fake',
        requestId: `req_${n}`,
        usage: USAGE,
      }));
      const before = await schoolSpent(db);
      const id = await createJob(BEAVER, db);
      await runAiJob(id, { ...deps, pool: db, ai: spy });

      const job = await jobRow(db, id);
      expect(requests).toHaveLength(3);
      expect(job).toMatchObject({
        status: 'failed',
        error_code: 'invalidOutput',
        gen_status: 'invalid_output',
        gen_error_code: 'invalidOutput',
        input_tokens: 300,
        output_tokens: 150,
        provider_request_id: 'req_3',
      });
      expect(job.sent_text).toBe(requests[0]!.user);
      const cost = Number(job.estimated_cost_usd);
      expect(cost).toBeGreaterThan(0);
      expect(await schoolSpent(db)).toBeCloseTo(before + cost, 6);
    });
  });

  it('records a refusal', async () => {
    await inRollback(async (db) => {
      const { ai: spy, requests } = scripted(() => ({
        output: null,
        stopReason: 'refusal',
        model: 'fake',
        requestId: 'req_refused',
        usage: USAGE,
      }));
      const id = await createJob(BEAVER, db);
      await runAiJob(id, { ...deps, pool: db, ai: spy });
      expect(requests).toHaveLength(1);
      expect(await jobRow(db, id)).toMatchObject({
        status: 'failed',
        error_code: 'aiRefused',
        gen_status: 'failed',
        gen_error_code: 'aiRefused',
        input_tokens: 100,
        provider_request_id: 'req_refused',
      });
    });
  });

  it('records a call that timed out after the provider started, without retrying it', async () => {
    await inRollback(async (db) => {
      const { ai: spy, requests } = scripted(() => {
        throw new AiProviderError('timeout', 'too slow', {
          requestId: 'req_slow',
          usage: { ...USAGE, outputTokens: 0 },
        });
      });
      const before = await schoolSpent(db);
      const id = await createJob(BEAVER, db);
      await runAiJob(id, { ...deps, pool: db, ai: spy });

      const job = await jobRow(db, id);
      expect(requests).toHaveLength(1);
      expect(job).toMatchObject({
        status: 'failed',
        error_code: 'timeout',
        gen_status: 'failed',
        gen_error_code: 'timeout',
        input_tokens: 100,
        provider_request_id: 'req_slow',
      });
      expect(job.sent_text).not.toBeNull();
      expect(await schoolSpent(db)).toBeGreaterThan(before);
    });
  });
});
