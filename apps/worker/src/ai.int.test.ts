/**
 * Integration test for AI jobs with the fake provider: needs a migrated and seeded database
 * (DATABASE_URL), e.g. the local Supabase stack. Run with `pnpm test:int`.
 */
import { createFakeProvider, priceFor } from '@lynx/ai';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAiJob, type AiRuntime } from './ai';
import { createLogger } from './logger';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required for integration tests');

// From supabase/seed.sql: the demo board, school and a 3e année teacher.
const BOARD = 'b0000000-0000-4000-8000-000000000001';
const SCHOOL = 'c0000000-0000-4000-8000-000000000001';
const TEACHER = 'd0000000-0000-4000-8000-000000000001';

const pool = new pg.Pool({ connectionString });
const ai: AiRuntime = { provider: createFakeProvider(), price: priceFor('fake') };
const deps = { pool, ai, logger: createLogger('test') };
const jobs: string[] = [];
let wasEnabled = false;
let levels: { id: string; label_fr: string }[] = [];
let studentName = '';

async function createJob(text: string): Promise<string> {
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
  const { rows } = await pool.query<{ id: string }>(
    `insert into public.ai_jobs (board_id, school_id, user_id, feature, input)
     values ($1, $2, $3, 'differentiate', $4) returning id`,
    [BOARD, SCHOOL, TEACHER, JSON.stringify(input)],
  );
  jobs.push(rows[0]!.id);
  return rows[0]!.id;
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
