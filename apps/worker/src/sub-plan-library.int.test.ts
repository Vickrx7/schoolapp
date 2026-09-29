/**
 * Integration test for library resources in substitute plans (DECISIONS D-077). Needs the
 * migrated and seeded database (DATABASE_URL), with the demo library; run with `pnpm test:int`,
 * with the worker stopped. Everything runs in one transaction that is rolled back at the end.
 *
 * Isabelle Tremblay (3e année) publishes a one-day absence as the web server does it (both
 * loaders read as her, merged, then built); the worker rebuilds it the same way. Her next
 * Français lesson shares the attente C1.2 with « Le huard, oiseau des lacs », and her next
 * Mathématiques lesson links « Ordonner des nombres jusqu'à 1 000 » (supabase/seeds).
 */
import { randomUUID } from 'node:crypto';
import {
  addDays,
  buildAbsencePlans,
  composeSubPlan,
  isoWeekday,
  localDateIn,
  subPlanEditsSchema,
  subPlanSourcesSchema,
  subPlanV1Schema,
  type LocalDate,
  type SubPlanV1,
} from '@lynx/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Logger } from './logger';
import { refreshAbsencePlans } from './sub-plans/refresh';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required for integration tests');

// From supabase/seed.sql and the demo library (UUIDv5 of demo/<slug>, @lynx/content).
const BOARD = 'b0000000-0000-4000-8000-000000000001';
const SCHOOL = 'c0000000-0000-4000-8000-000000000001';
const TEACHER = 'd0000000-0000-4000-8000-000000000001';
const CLASS_3E = 'e0000000-0000-4000-8000-000000000003';
const HUARD = '3daed963-c2a5-568d-b23e-b38865b2b551';
const ORDONNER = '191569be-69c6-5fc4-beeb-b9fd92bb45c8';
/** 3e Français C1.2 (supabase/seed.sql). */
const C1_2 = '20000000-0000-4000-8000-000000030c12';

const pool = new pg.Pool({ connectionString });
let db: pg.PoolClient;

const logger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

async function asTeacher() {
  await db.query(
    `select set_config('request.jwt.claims', $1, true),
            set_config('request.jwt.claim.sub', $2, true),
            set_config('role', 'authenticated', true)`,
    [JSON.stringify({ sub: TEACHER, role: 'authenticated' }), TEACHER],
  );
}

/** Back to the database owner (as the worker connects). */
async function asOwner() {
  await db.query(
    `select set_config('role', 'none', true), set_config('request.jwt.claims', '', true),
            set_config('request.jwt.claim.sub', '', true)`,
  );
}

/** A Tuesday to Thursday at least six weeks ahead with no event and no absence of hers. */
async function freeDay(): Promise<LocalDate> {
  let day = addDays(localDateIn('America/Toronto'), 42);
  for (let i = 0; i < 120; i += 1, day = addDays(day, 1)) {
    if (isoWeekday(day) < 2 || isoWeekday(day) > 4) continue;
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

/** The next lesson of one of her 3e units (by subject code): its id and number. */
async function nextLesson(subject: string): Promise<{ id: string; seq: number }> {
  const { rows } = await db.query<{ id: string; seq: number }>(
    `select l.id, l.sequence_number as seq
       from public.units u
       join public.subjects s on s.id = u.subject_id and s.code = $2
       join public.unit_lessons l on l.unit_id = u.id
      where u.class_id = $1 and u.status = 'active'
        and not exists (select 1 from public.lesson_progress lp where lp.lesson_id = l.id)
      order by l.sequence_number limit 1`,
    [CLASS_3E, subject],
  );
  return rows[0]!;
}

let day: LocalDate;
let absenceId: string;
let planId: string;
let french: { id: string; seq: number };
let math: { id: string; seq: number };

async function storedPlan(): Promise<{ plan: SubPlanV1; version: number; editsRevision: number }> {
  const { rows } = await db.query<{ plan: unknown; version: number; edits_revision: number }>(
    'select plan, content_version as version, edits_revision from public.sub_plans where id = $1',
    [planId],
  );
  return {
    plan: subPlanV1Schema.parse(rows[0]!.plan),
    version: rows[0]!.version,
    editsRevision: rows[0]!.edits_revision,
  };
}

const libraryOf = (plan: SubPlanV1, lessonId: string) =>
  plan.blocks.find((b) => b.lesson?.lessonId === lessonId)?.library ?? null;

async function markAndRefresh() {
  await db.query('update public.absences set sources_changed_at = now() where id = $1', [
    absenceId,
  ]);
  expect(await refreshAbsencePlans(absenceId, { pool: db, logger })).toBe('refreshed');
}

beforeAll(async () => {
  db = await pool.connect();
  await db.query('begin');
  day = await freeDay();
  french = await nextLesson('fra');
  math = await nextLesson('mat');
});

afterAll(async () => {
  await db.query('rollback');
  db.release();
  await pool.end();
});

describe('substitute plans with library resources', () => {
  it('publishes as the teacher with the resources of her next lessons', async () => {
    // The seed's next lessons: Français 4 (C1.2) and Mathématiques 5 (linked to the worksheet).
    expect([french.seq, math.seq]).toEqual([4, 5]);
    await asTeacher();
    const { rows } = await db.query<{ sources: Record<string, unknown>; library: unknown }>(
      `select public.get_sub_plan_sources($1, $2::date, $2::date) as sources,
              public.get_sub_plan_library_sources($1) as library`,
      [SCHOOL, day],
    );
    const sources = subPlanSourcesSchema.parse({ ...rows[0]!.sources, library: rows[0]!.library });
    const built = buildAbsencePlans(
      sources,
      { startsOn: day, endsOn: day, part: 'full_day', catholicConnection: true },
      { now: new Date() },
    );
    const { rows: published } = await db.query<{ id: string }>(
      'select public.publish_absence($1, $2::date, $2::date, $3, null, true, $4, $5::jsonb) as id',
      [SCHOOL, day, 'full_day', randomUUID(), JSON.stringify(built.plans)],
    );
    absenceId = published[0]!.id;
    await asOwner();
    const { rows: plans } = await db.query<{ id: string }>(
      'select id from public.sub_plans where absence_id = $1',
      [absenceId],
    );
    planId = plans[0]!.id;

    const { plan } = await storedPlan();
    expect(libraryOf(plan, french.id)).toMatchObject({ itemId: HUARD, reason: 'expectation' });
    expect(libraryOf(plan, math.id)).toMatchObject({ itemId: ORDONNER, reason: 'linked' });
    // Each group of the class gets a version; the key stays out of the plan.
    const huard = libraryOf(plan, french.id)!;
    expect(huard.hasAnswerKey).toBe(true);
    expect(huard.studentDocs.flatMap((d) => d.groupKeys).sort()).toEqual(
      plan.groups.map((g) => g.key).sort(),
    );
    expect(JSON.stringify(plan)).not.toMatch(
      /"(answerKey|answers|sampleAnswer|acceptableAnswers|correctChoiceIds)"/,
    );
  });

  it('keeps the resources when the worker rebuilds the plan', async () => {
    const before = await storedPlan();
    await markAndRefresh();
    const after = await storedPlan();
    expect(after.version).toBe(before.version + 1);
    expect(libraryOf(after.plan, french.id)?.itemId).toBe(HUARD);
    expect(libraryOf(after.plan, math.id)?.itemId).toBe(ORDONNER);
  });

  it('keeps « Ne pas utiliser cette ressource » through a rebuild', async () => {
    const { plan, editsRevision } = await storedPlan();
    const key = plan.blocks.find((b) => b.lesson?.lessonId === french.id)!.key;
    const edits = { blocks: { [key]: { forLessonId: french.id, hideLibrary: true } } };
    await asTeacher();
    await db.query('select public.save_sub_plan_edits($1, $2::jsonb, $3)', [
      planId,
      JSON.stringify(edits),
      editsRevision,
    ]);
    await asOwner();
    await markAndRefresh();

    const rebuilt = await storedPlan();
    const { rows } = await db.query<{ edits: unknown }>(
      'select edits from public.sub_plans where id = $1',
      [planId],
    );
    expect(rows[0]!.edits).toEqual(edits);
    const composed = composeSubPlan(rebuilt.plan, {
      edits: subPlanEditsSchema.parse(rows[0]!.edits),
      audience: 'substitute',
    });
    expect(composed.blocks.find((b) => b.key === key)!.library).toBeNull();
    expect(libraryOf(rebuilt.plan, french.id)?.itemId).toBe(HUARD);
  });

  it('marks the absence when a lesson gets an attente, and the rebuild offers a resource', async () => {
    const following = (
      await db.query<{ id: string }>(
        `select l.id from public.unit_lessons l
          where l.unit_id = (select unit_id from public.unit_lessons where id = $1)
            and l.sequence_number = $2`,
        [french.id, french.seq + 1],
      )
    ).rows[0]!.id;
    const { plan } = await storedPlan();
    // Français 5 is the day's second Français period, without a resource so far.
    expect(plan.blocks.some((b) => b.lesson?.lessonId === following)).toBe(true);
    expect(libraryOf(plan, following)).toBeNull();

    await db.query('update public.absences set sources_changed_at = null where id = $1', [
      absenceId,
    ]);
    await asTeacher();
    await db.query(
      'insert into public.unit_lesson_expectations (lesson_id, expectation_id) values ($1, $2)',
      [following, C1_2],
    );
    await asOwner();
    const { rows } = await db.query<{ marked: boolean }>(
      'select sources_changed_at is not null as marked from public.absences where id = $1',
      [absenceId],
    );
    expect(rows[0]!.marked).toBe(true);

    expect(await refreshAbsencePlans(absenceId, { pool: db, logger })).toBe('refreshed');
    const rebuilt = await storedPlan();
    // The huard is already used by lesson 4: lesson 5 gets the next approved resource for C1.2.
    const second = libraryOf(rebuilt.plan, following);
    expect(second).not.toBeNull();
    expect(second!.itemId).not.toBe(HUARD);
    expect(libraryOf(rebuilt.plan, french.id)?.itemId).toBe(HUARD);
  });
});
