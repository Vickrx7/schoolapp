/**
 * Integration test for the reads past PostgREST's cap (post-MVP review): against the local
 * stack's PostgREST, which caps an answer at 1,000 rows (`max_rows`, as hosted Supabase does), a
 * class with 1,200 lessons given reads them all with `fetchAllRows`, and a single request (even
 * with a higher `.limit()`) does not. Needs DATABASE_URL, and SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY (the local stack's, from .env.example, by default). Its unit, lessons
 * and progress are deleted at the end, with the 2,400 outbox events they emitted (a lesson given,
 * then its progress cleared): left pending, they would fill the next dispatch batch of the
 * outbox's own test, which runs after this file.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchAllRows, ROW_PAGE } from './fetch-all';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required for integration tests');

function exampleSetting(name: string): string {
  const example = readFileSync(new URL('../../../../../.env.example', import.meta.url), 'utf8');
  return new RegExp(`^${name}=(.+)$`, 'm').exec(example)?.[1]?.trim() ?? '';
}

const pool = new pg.Pool({ connectionString, max: 2 });
const supabase = createClient(
  process.env.SUPABASE_URL || exampleSetting('SUPABASE_URL'),
  process.env.SUPABASE_SERVICE_ROLE_KEY || exampleSetting('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const CLASS = 'e0000000-0000-4000-8000-000000000003';
const LESSONS = 1_200;
const TITLE = `fetch-all-int-${Date.now().toString(36)}`;
let unitId = '';

beforeAll(async () => {
  const { rows } = await pool.query<{ id: string }>(
    `insert into public.units (class_id, subject_id, title, status, sort_order)
     values ($1, (select id from public.subjects where code = 'mat' and board_id is null), $2,
             'archived', 99)
     returning id`,
    [CLASS, TITLE],
  );
  unitId = rows[0]!.id;
  await pool.query(
    `insert into public.unit_lessons (unit_id, sequence_number, title)
     select $1, n, 'Leçon ' || n from generate_series(1, $2::int) n`,
    [unitId, LESSONS],
  );
  await pool.query(
    `insert into public.lesson_progress (class_id, lesson_id, status, taught_on)
     select $1, l.id, 'completed', date '2026-10-01' from public.unit_lessons l where l.unit_id = $2`,
    [CLASS, unitId],
  );
});

afterAll(async () => {
  if (unitId) {
    const { rows } = await pool.query<{ id: string }>(
      `select id from public.unit_lessons where unit_id = $1`,
      [unitId],
    );
    await pool.query(`delete from public.units where id = $1`, [unitId]);
    await pool.query(
      `delete from public.event_outbox
       where aggregate_type = 'lesson' and aggregate_id = any($1::uuid[])`,
      [rows.map((r) => r.id)],
    );
  }
  await pool.end();
});

describe('a class’s progress past PostgREST’s 1,000-row cap', () => {
  it('is cut by one request, whatever its limit, and read whole page by page', async () => {
    const { rows } = await pool.query<{ n: number }>(
      `select count(*)::int as n from public.lesson_progress where class_id = $1`,
      [CLASS],
    );
    const total = rows[0]!.n;
    expect(total).toBeGreaterThanOrEqual(LESSONS);

    const one = await supabase
      .from('lesson_progress')
      .select('lesson_id')
      .eq('class_id', CLASS)
      .limit(5 * ROW_PAGE);
    expect(one.error).toBeNull();
    expect(one.data).toHaveLength(ROW_PAGE);

    const all = await fetchAllRows((from, to) =>
      supabase
        .from('lesson_progress')
        .select('lesson_id')
        .eq('class_id', CLASS)
        .order('lesson_id')
        .range(from, to),
    );
    expect(all.error).toBeNull();
    expect(all.data).toHaveLength(total);
    expect(new Set(all.data!.map((r) => r.lesson_id)).size).toBe(total);
  });
});
