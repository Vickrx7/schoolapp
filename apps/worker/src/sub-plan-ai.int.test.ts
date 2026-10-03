/**
 * Integration test for « Consignes détaillées » (DECISIONS D-052), end to end with the fake
 * provider: the teacher's request built from her published plan, the worker's run with the whole
 * roster, and the database applying the answer to the plan only while no substitute has opened
 * it. Needs a migrated and seeded database (DATABASE_URL). Everything runs in transactions that
 * are rolled back, so the demo data is untouched. Run with `pnpm test:int`, with the worker
 * stopped.
 */
import { randomUUID } from 'node:crypto';
import { createFakeProvider, priceFor, subPlanAiInputSchema } from '@lynx/ai';
import {
  addDays,
  buildAbsencePlans,
  buildSubPlanAiInput,
  composeSubPlan,
  isoWeekday,
  localDateIn,
  subPlanAiLayerSchema,
  subPlanSourcesSchema,
  subPlanV1Schema,
  type LocalDate,
} from '@lynx/domain';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { runAiJob, type AiRuntime } from './ai';
import type { Logger } from './logger';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required for integration tests');

// From supabase/seed.sql: the demo board and school, Isabelle Tremblay, her 3e année and its
// Français unit. Samuel is one of her students.
const BOARD = 'b0000000-0000-4000-8000-000000000001';
const SCHOOL = 'c0000000-0000-4000-8000-000000000001';
const TEACHER = 'd0000000-0000-4000-8000-000000000001';
const FRENCH_UNIT = '30000000-0000-4000-8000-000000000301';
const PHONE = '613-555-0142';

const pool = new pg.Pool({ connectionString });
const ai: AiRuntime = { provider: createFakeProvider(), price: priceFor('fake') };
const silent: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

afterAll(async () => {
  await pool.end();
});

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

async function asTeacher(db: pg.PoolClient) {
  await db.query(
    `select set_config('request.jwt.claims', $1, true),
            set_config('request.jwt.claim.sub', $2, true),
            set_config('role', 'authenticated', true)`,
    [JSON.stringify({ sub: TEACHER, role: 'authenticated' }), TEACHER],
  );
}

/** A Monday to Thursday at least three weeks ahead with no event and no absence of hers. */
async function freeDay(db: pg.PoolClient): Promise<LocalDate> {
  let day = addDays(localDateIn('America/Toronto'), 21);
  for (let i = 0; i < 120; i += 1, day = addDays(day, 1)) {
    if (isoWeekday(day) > 4) continue;
    const { rows } = await db.query<{ busy: boolean }>(
      `select exists (
           select 1 from public.school_calendar_events e
            where e.board_id = $1 and (e.school_id is null or e.school_id = $2)
              and e.starts_on <= $4::date and e.ends_on >= $4::date
         ) or exists (
           select 1 from public.absences a
            where a.teacher_id = $3 and a.status = 'published'
              and a.starts_on <= $4::date and a.ends_on >= $4::date
         ) as busy`,
      [BOARD, SCHOOL, TEACHER, day],
    );
    if (!rows[0]!.busy) return day;
  }
  throw new Error('no free school day in the next months');
}

/**
 * As the teacher: publishes a one-day absence (built from the plan sources, as the web server
 * does), then asks for detailed instructions on its plan. Returns the plan and the job.
 */
async function publishAndAsk(db: pg.PoolClient) {
  const day = await freeDay(db);
  await asTeacher(db);
  const { rows: src } = await db.query<{ sources: unknown }>(
    'select public.get_sub_plan_sources($1, $2::date, $2::date) as sources',
    [SCHOOL, day],
  );
  const built = buildAbsencePlans(
    subPlanSourcesSchema.parse(src[0]!.sources),
    { startsOn: day, endsOn: day, part: 'full_day', catholicConnection: true },
    { now: new Date() },
  );
  const { rows: published } = await db.query<{ id: string }>(
    'select public.publish_absence($1, $2::date, $2::date, $3, null, true, $4, $5::jsonb) as id',
    [SCHOOL, day, 'full_day', randomUUID(), JSON.stringify(built.plans)],
  );
  const { rows: plans } = await db.query<{ id: string; plan: unknown; content_version: number }>(
    'select id, plan, content_version from public.sub_plans where absence_id = $1',
    [published[0]!.id],
  );
  const plan = subPlanV1Schema.parse(plans[0]!.plan);
  const levelIds = plan.groups.map((g) => g.levelId).filter((id): id is string => id !== null);
  const { rows: levels } = await db.query<{
    id: string;
    labelFr: string;
    descriptionFr: string | null;
  }>(
    `select id, label_fr as "labelFr", description_fr as "descriptionFr"
       from public.language_levels where id = any($1::uuid[])`,
    [levelIds],
  );
  const input = subPlanAiInputSchema.parse(
    buildSubPlanAiInput(composeSubPlan(plan, { audience: 'owner' }), levels),
  );
  const { rows: job } = await db.query<{ id: string }>(
    'select public.request_sub_plan_ai($1, $2::jsonb, $3) as id',
    [plans[0]!.id, JSON.stringify(input), plans[0]!.content_version],
  );
  await db.query('reset role');
  return { planId: plans[0]!.id, plan, input, jobId: job[0]!.id };
}

describe('« Consignes détaillées » (sub_plan)', () => {
  it('runs the teacher’s request without names or ids and adds the answer to her plan', async () => {
    await inRollback(async (db) => {
      await db.query('update public.schools set ai_enabled = true where id = $1', [SCHOOL]);
      // Her lessons name a student in a note for the substitute and hold a phone number.
      await db.query(
        `update public.unit_lessons
            set sub_notes = 'Samuel distribue les textes au début de la période.',
                materials = 'Texte « Le huard ». Au besoin, appelez le ${PHONE}.'
          where unit_id = $1`,
        [FRENCH_UNIT],
      );
      const { planId, plan, input, jobId } = await publishAndAsk(db);
      const french = input.blocks.find((b) => b.subjectLabel === 'Français')!;
      expect(french.lesson?.subNotes).toContain('Samuel');

      await runAiJob(jobId, { pool: db, ai, logger: silent });

      const { rows } = await db.query(
        `select j.status, j.sent_text, j.feature, g.status as gen_status, g.estimated_cost_usd,
                p.ai, p.content_version
           from public.ai_jobs j
           join public.sub_plans p on p.ai_job_id = j.id
           left join public.ai_generations g on g.id = j.ai_generation_id
          where j.id = $1`,
        [jobId],
      );
      const row = rows[0];
      expect(row).toMatchObject({
        status: 'succeeded',
        feature: 'sub_plan',
        gen_status: 'succeeded',
      });
      expect(Number(row.estimated_cost_usd)).toBeGreaterThan(0);

      // Sent: markers instead of names, no ids, no phone, nothing of the class or the school.
      const sent: string = row.sent_text;
      expect(sent).toContain('Élève A distribue les textes');
      expect(sent).not.toMatch(/Samuel|Tremblay|Isabelle|Saint-Exemple|3e année – /);
      expect(sent).not.toContain(PHONE);
      expect(sent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/);

      // Applied to the plan: the layer's blocks point at the plan's own blocks and lessons.
      const layer = subPlanAiLayerSchema.parse(row.ai);
      expect(layer.jobId).toBe(jobId);
      expect(layer.refs.map((r) => r.ref)).toEqual(input.blocks.map((b) => b.ref));
      expect(row.content_version).toBe(2);
      const composed = composeSubPlan(plan, { ai: row.ai, audience: 'substitute' });
      const block = composed.blocks.find((b) => b.key === french.ref.blockKey)!;
      expect(block.stepsSource).toBe('ai');
      expect(block.steps[0]!.say).toMatch(/^« .* »$/);
      // Names come back in the answer, on our servers.
      expect(block.steps.map((s) => s.text).join('\n')).toContain('Samuel distribue les textes');
      expect(block.ai?.differentiation.map((d) => d.group)).toEqual(french.groups);
      expect(planId).toBeTruthy();
    });
  });

  it('never changes a plan a substitute has opened', async () => {
    await inRollback(async (db) => {
      await db.query('update public.schools set ai_enabled = true where id = $1', [SCHOOL]);
      const { planId, input, jobId } = await publishAndAsk(db);
      // A substitute signs in before the answer arrives.
      const { rows: code } = await db.query<{ id: string }>(
        `insert into public.sub_access_codes (sub_plan_id, code_hash, valid_on, valid_from, expires_at)
         select id, repeat('a', 64), plan_date, now() - interval '1 hour', now() + interval '2 hours'
           from public.sub_plans where id = $1
         returning id`,
        [planId],
      );
      await db.query(
        `insert into public.sub_sessions (access_code_id, sub_plan_id, session_token_hash,
           expires_at, device_key)
         values ($1, $2, repeat('b', 64), now() + interval '2 hours', repeat('c', 64))`,
        [code[0]!.id, planId],
      );

      await runAiJob(jobId, { pool: db, ai, logger: silent });
      const { rows } = await db.query(
        `select j.status, p.ai, p.content_version
           from public.ai_jobs j join public.sub_plans p on p.ai_job_id = j.id where j.id = $1`,
        [jobId],
      );
      expect(rows[0]).toMatchObject({ status: 'succeeded', ai: null, content_version: 1 });

      // And no new request once a substitute is in.
      await asTeacher(db);
      await db.query('savepoint again');
      await expect(
        db.query('select public.request_sub_plan_ai($1, $2::jsonb, 1)', [
          planId,
          JSON.stringify(input),
        ]),
      ).rejects.toMatchObject({ code: 'LXS12' });
      await db.query('rollback to savepoint again');
    });
  });
});
