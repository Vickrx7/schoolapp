/**
 * Integration test for substitute plans after publishing (DECISIONS D-047) and the daily
 * substitute access retention task (D-059). Needs a migrated and seeded database (DATABASE_URL),
 * e.g. the local Supabase stack. Run with `pnpm test:int`, with the worker stopped: a running
 * worker would refresh the test's absence itself.
 *
 * The tests run in order and share one absence of Isabelle Tremblay (3e année), from a Thursday
 * to the next Monday at least two weeks ahead, with a PA day the test adds on the Friday. A
 * substitute signs in on the Thursday and sends her end-of-day report (D-054). Everything they
 * create is removed at the end, including the progress the report wrote.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  addDays,
  buildAbsencePlans,
  isoWeekday,
  reportableLessons,
  subPlanSourcesSchema,
  subPlanV1Schema,
  type LocalDate,
  type SubPlanV1,
} from '@lynx/domain';
import { createMockIntegrations } from '@lynx/integrations';
import type { JobHelpers } from 'graphile-worker';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSubscriptions } from './handlers';
import type { Logger } from './logger';
import { REFRESH_ATTEMPTS, refreshAbsencePlans } from './sub-plans/refresh';
import { buildTaskList } from './tasks';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required for integration tests');

// From supabase/seed.sql: the demo board and school, Isabelle Tremblay and her 3e année.
const BOARD = 'b0000000-0000-4000-8000-000000000001';
const SCHOOL = 'c0000000-0000-4000-8000-000000000001';
const TEACHER = 'd0000000-0000-4000-8000-000000000001';
const CLASS_3E = 'e0000000-0000-4000-8000-000000000003';
const PA_DAY_TITLE = 'Journée pédagogique (test du worker)';

type Db = Pick<pg.Pool, 'query'>;

const pool = new pg.Pool({ connectionString });

interface LogEntry {
  level: 'info' | 'warn' | 'error';
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

// What graphile-worker hands a task, reduced to what the tasks use.
const helpers = {
  withPgClient: async <T>(fn: (client: pg.PoolClient) => Promise<T>) => {
    const client = await pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  },
  logger: { warn: () => undefined },
} as unknown as JobHelpers;

/** The worker's real task list and subscriptions, with the given logger. */
function taskList(logger: Logger) {
  return buildTaskList({
    subscriptions: buildSubscriptions({ logEvents: false }),
    context: { integrations: createMockIntegrations(), logger, pool, ai: null, authAdmin: null },
    batchSize: 10,
    aiJobRetentionDays: 30,
    bulkMaxRunUsd: 100,
  });
}

/** Runs `fn` as the teacher (role authenticated with her JWT claims), then commits. */
async function asTeacher<T>(fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `select set_config('request.jwt.claims', $1, true),
              set_config('request.jwt.claim.sub', $2, true),
              set_config('role', 'authenticated', true)`,
      [JSON.stringify({ sub: TEACHER, role: 'authenticated' }), TEACHER],
    );
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

let today: LocalDate;
let thursday: LocalDate;
let friday: LocalDate;
let monday: LocalDate;
/** The 3e Français unit's lessons: id → sequence number. */
let frenchLessons = new Map<string, number>();
/** The first Français lesson not done yet: the next one a plan assigns. */
let nextFrench = 0;

// Everything the tests create, for the clean-up.
let paDayId: string | null = null;
let absenceId: string | null = null;
let oldAbsenceId: string | null = null;
/** A separate absence the school day after the test's absence. */
let nextAbsenceId: string | null = null;
let completedLessonId: string | null = null;
/** A lesson the last test checks off (Monday's first Français lesson). */
let mondayLessonId: string | null = null;
/** Lessons the substitute's report wrote progress for. */
let reportedLessonIds: string[] = [];
const attemptDeviceKeys: string[] = [];
/** The last outbox row before the tests: only later events are the tests' own. */
let outboxStart = '0';

const hex = () => randomBytes(32).toString('hex');

/**
 * The first Thursday at least two weeks ahead whose Thursday-to-Monday span has no calendar
 * event and no absence of the teacher (the seed and other tests may have some).
 */
async function pickThursday(): Promise<LocalDate> {
  let day = addDays(today, 14);
  while (isoWeekday(day) !== 4) day = addDays(day, 1);
  for (let week = 0; week < 26; week += 1, day = addDays(day, 7)) {
    const { rows } = await pool.query<{ busy: boolean }>(
      `select exists (
           select 1 from public.school_calendar_events e
            where e.board_id = $1 and (e.school_id is null or e.school_id = $2)
              and e.starts_on <= $5::date and e.ends_on >= $4::date
         ) or exists (
           select 1 from public.absences a
            where a.teacher_id = $3 and a.status = 'published'
              and a.starts_on <= $5::date and a.ends_on >= $4::date
         ) as busy`,
      [BOARD, SCHOOL, TEACHER, day, addDays(day, 4)],
    );
    if (!rows[0]!.busy) return day;
  }
  throw new Error('no free Thursday-to-Monday span in the next six months');
}

interface PlanRow {
  id: string;
  date: LocalDate;
  plan: SubPlanV1;
  contentVersion: number;
  generatedAt: string;
  classIds: string[];
}

async function planRows(id: string = absenceId!): Promise<PlanRow[]> {
  const { rows } = await pool.query<PlanRow>(
    `select p.id, to_char(p.plan_date, 'YYYY-MM-DD') as date, p.plan,
            p.content_version as "contentVersion", p.generated_at::text as "generatedAt",
            array(select c.class_id::text from public.sub_plan_classes c
                   where c.sub_plan_id = p.id order by c.class_id) as "classIds"
       from public.sub_plans p where p.absence_id = $1 order by p.plan_date`,
    [id],
  );
  return rows;
}

/** Sequence numbers of the Français lessons a plan assigns, in time order. */
function frenchSequence(plan: SubPlanV1): number[] {
  return plan.blocks.flatMap((b) =>
    b.lesson && frenchLessons.has(b.lesson.lessonId) ? [b.lesson.sequenceNumber] : [],
  );
}

/** The absence's "sources changed" mark, as text (exact to the microsecond), or null. */
async function mark(id: string = absenceId!): Promise<string | null> {
  const { rows } = await pool.query<{ mark: string | null }>(
    'select sources_changed_at::text as mark from public.absences where id = $1',
    [id],
  );
  return rows[0]!.mark;
}

/** Marks the absence as out of date, the way a change to its sources does. */
async function markAbsence(id: string = absenceId!): Promise<string> {
  const { rows } = await pool.query<{ mark: string }>(
    `update public.absences set sources_changed_at = now() where id = $1
     returning sources_changed_at::text as mark`,
    [id],
  );
  return rows[0]!.mark;
}

/** The test's absence built from fresh sources, as the worker builds it. */
async function buildNow() {
  const { rows } = await pool.query<{ sources: unknown }>(
    'select app.sub_plan_sources($1, $2, $3::date, $4::date, $5) as sources',
    [TEACHER, SCHOOL, thursday, monday, absenceId],
  );
  const sources = subPlanSourcesSchema.parse(rows[0]!.sources);
  return buildAbsencePlans(
    sources,
    { startsOn: thursday, endsOn: monday, part: 'full_day', catholicConnection: true },
    { now: new Date() },
  );
}

/** A connection that runs `change` just before each save, as if the teacher edited then. */
function changingBeforeSave(change: (save: number) => Promise<void>) {
  let saves = 0;
  const db = {
    query: async (text: string, values?: unknown[]) => {
      if (text.includes('write_absence_plans')) {
        saves += 1;
        await change(saves);
      }
      return pool.query(text, values);
    },
  } as unknown as Db;
  return { db, saves: () => saves };
}

async function cleanUp() {
  const absences = [absenceId, oldAbsenceId, nextAbsenceId].filter(
    (id): id is string => id !== null,
  );
  const plans = await pool.query<{ id: string }>(
    'select id from public.sub_plans where absence_id = any($1::uuid[])',
    [absences],
  );
  const reports = await pool.query<{ id: string }>(
    `select r.id from public.sub_reports r join public.sub_plans p on p.id = r.sub_plan_id
      where p.absence_id = any($1::uuid[])`,
    [absences],
  );
  // The progress a report wrote does not go with its absence (the link is set to null).
  await pool.query(
    `delete from public.lesson_progress lp using public.sub_reports r, public.sub_plans p
      where lp.sub_report_id = r.id and r.sub_plan_id = p.id and p.absence_id = any($1::uuid[])`,
    [absences],
  );
  // Plans, codes, sessions and reports go with their absence.
  await pool.query('delete from public.absences where id = any($1::uuid[])', [absences]);
  for (const lessonId of [completedLessonId, mondayLessonId]) {
    if (lessonId) {
      await pool.query('delete from public.lesson_progress where lesson_id = $1', [lessonId]);
    }
  }
  if (paDayId) {
    await pool.query('delete from public.school_calendar_events where id = $1', [paDayId]);
  }
  await pool.query('delete from public.sub_code_attempts where device_key = any($1)', [
    attemptDeviceKeys,
  ]);
  // The events the tests caused, so a worker started later has nothing of theirs to run.
  const aggregates = [
    ...absences,
    ...plans.rows.map((p) => p.id),
    ...reports.rows.map((r) => r.id),
    ...reportedLessonIds,
    completedLessonId,
    mondayLessonId,
  ];
  await pool.query(
    'delete from public.event_outbox where id > $1 and aggregate_id = any($2::uuid[])',
    [outboxStart, aggregates.filter((id): id is string => id !== null)],
  );
  absenceId = oldAbsenceId = nextAbsenceId = completedLessonId = mondayLessonId = paDayId = null;
}

beforeAll(async () => {
  const outbox = await pool.query<{ id: string }>(
    'select coalesce(max(id), 0)::text as id from public.event_outbox',
  );
  outboxStart = outbox.rows[0]!.id;
  const { rows } = await pool.query<{ today: LocalDate }>(
    `select to_char(app.school_local_today($1), 'YYYY-MM-DD') as today`,
    [SCHOOL],
  );
  today = rows[0]!.today;
  thursday = await pickThursday();
  friday = addDays(thursday, 1);
  monday = addDays(thursday, 4);

  const lessons = await pool.query<{ id: string; sequence_number: number; done: boolean }>(
    `select l.id, l.sequence_number, lp.id is not null as done
       from public.units u
       join public.subjects s on s.id = u.subject_id and s.code = 'fra'
       join public.unit_lessons l on l.unit_id = u.id
       left join public.lesson_progress lp on lp.lesson_id = l.id
      where u.class_id = $1 and u.status = 'active'
      order by l.sequence_number`,
    [CLASS_3E],
  );
  frenchLessons = new Map(lessons.rows.map((l) => [l.id, l.sequence_number]));
  nextFrench = lessons.rows.find((l) => !l.done)!.sequence_number;
});

afterAll(async () => {
  await cleanUp();
  await pool.end();
});

describe('substitute plans after publishing', () => {
  it('publishes as the teacher with the plans built in the request, school days only', async () => {
    const pa = await pool.query<{ id: string }>(
      `insert into public.school_calendar_events
         (board_id, school_id, event_type, title, starts_on, ends_on, affects_schedule)
       values ($1, $2, 'pa_day', $3, $4::date, $4::date, true) returning id`,
      [BOARD, SCHOOL, PA_DAY_TITLE, friday],
    );
    paDayId = pa.rows[0]!.id;

    absenceId = await asTeacher(async (db) => {
      const loaded = await db.query<{ sources: unknown }>(
        'select public.get_sub_plan_sources($1, $2::date, $3::date) as sources',
        [SCHOOL, thursday, monday],
      );
      const sources = subPlanSourcesSchema.parse(loaded.rows[0]!.sources);
      const built = buildAbsencePlans(
        sources,
        { startsOn: thursday, endsOn: monday, part: 'full_day', catholicConnection: true },
        { now: new Date() },
      );
      expect(built.plans.map((p) => p.date)).toEqual([thursday, monday]);
      expect(built.noSchool).toEqual([
        { date: friday, reason: 'pa_day', eventTitle: PA_DAY_TITLE },
      ]);
      const published = await db.query<{ id: string }>(
        `select public.publish_absence($1, $2::date, $3::date, 'full_day', null, true, $4, $5::jsonb)
           as id`,
        [SCHOOL, thursday, monday, randomUUID(), JSON.stringify(built.plans)],
      );
      return published.rows[0]!.id;
    });

    const plans = await planRows();
    expect(plans.map((p) => p.date)).toEqual([thursday, monday]);
    for (const p of plans) {
      expect(subPlanV1Schema.safeParse(p.plan).success).toBe(true);
      expect(p.classIds).toEqual([CLASS_3E]);
      expect(p.contentVersion).toBe(1);
    }

    // The sequence continues from Thursday to Monday over the PA day.
    const [thu, mon] = plans.map((p) => frenchSequence(p.plan));
    expect(thu).toEqual([nextFrench, nextFrench + 1]);
    expect(mon![0]).toBe(thu!.at(-1)! + 1);

    // Ids, dates and the part of day only.
    const { rows: events } = await pool.query<{
      event_type: string;
      payload: Record<string, unknown>;
    }>(
      `select event_type, payload from public.event_outbox
        where aggregate_id = $1::uuid or payload ->> 'absenceId' = $1::text order by id`,
      [absenceId],
    );
    expect(events.filter((e) => e.event_type === 'absence.published')).toHaveLength(1);
    expect(
      events
        .filter((e) => e.event_type === 'sub_plan.ready')
        .map((e) => e.payload.planDate)
        .sort(),
    ).toEqual([thursday, monday]);
    const allowed = ['absenceId', 'subPlanId', 'planDate', 'startsOn', 'endsOn', 'part'];
    for (const e of events) {
      expect(Object.keys(e.payload).filter((k) => !allowed.includes(k))).toEqual([]);
    }
  });

  it('logs only ids for the door credential placeholder', async () => {
    const { rows } = await pool.query<{ event_id: string }>(
      `select event_id from public.event_outbox
        where event_type = 'absence.published' and aggregate_id = $1`,
      [absenceId],
    );
    const logger = recordingLogger();
    await taskList(logger).handle_event!(
      { eventId: rows[0]!.event_id, handler: 'access_control_substitute_credential' },
      helpers,
    );
    expect(logger.entries).toEqual([
      {
        level: 'info',
        message: 'would issue a day-only door credential',
        data: { eventId: rows[0]!.event_id, aggregateId: absenceId },
      },
    ]);
  });

  it('rebuilds the plans through the worker when the teacher checks off the next lesson', async () => {
    const before = await planRows();
    const thuBefore = frenchSequence(before[0]!.plan);
    const lessonId = [...frenchLessons].find(([, seq]) => seq === thuBefore[0])![0];
    await pool.query(
      `insert into public.lesson_progress (lesson_id, class_id, status, taught_on, completed_by)
       values ($1, $2, 'completed', $3::date, $4)`,
      [lessonId, CLASS_3E, today, TEACHER],
    );
    completedLessonId = lessonId;

    // The absence is marked once and the worker is woken once.
    expect(await mark()).not.toBeNull();
    const { rows: events } = await pool.query<{ event_id: string }>(
      `select event_id from public.event_outbox
        where event_type = 'absence.sources_changed' and aggregate_id = $1`,
      [absenceId],
    );
    expect(events).toHaveLength(1);

    // As the dispatcher runs it: the worker's own subscription for that event.
    const logger = recordingLogger();
    await taskList(logger).handle_event!(
      { eventId: events[0]!.event_id, handler: 'sub_plan_refresh' },
      helpers,
    );

    const after = await planRows();
    expect(after.map((p) => p.date)).toEqual([thursday, monday]);
    expect(after.map((p) => p.contentVersion)).toEqual(before.map((p) => p.contentVersion + 1));
    const [thu, mon] = after.map((p) => frenchSequence(p.plan));
    expect(thu![0]).toBe(thuBefore[0]! + 1);
    expect(mon![0]).toBe(thu!.at(-1)! + 1);
    expect(await mark()).toBeNull();
    expect(logger.entries).toEqual([
      { level: 'info', message: 'sub plans refreshed', data: { absenceId, days: 2, attempt: 1 } },
    ]);
  });

  it('saves nothing when the sources changed after they were read (compare-and-set)', async () => {
    const seen = await markAbsence();
    const before = await planRows();
    const built = await buildNow();

    const { rows } = await pool.query<{ written: boolean }>(
      `select app.write_absence_plans($1, $2::jsonb, $3::timestamptz - interval '1 second', true)
         as written`,
      [absenceId, JSON.stringify(built.plans), seen],
    );
    expect(rows[0]!.written).toBe(false);
    expect(await planRows()).toEqual(before);
    expect(await mark()).toBe(seen);
  });

  it('builds again from fresh sources when a change lands while it builds', async () => {
    await markAbsence();
    const before = await planRows();
    const { db, saves } = changingBeforeSave(async (save) => {
      if (save === 1) await markAbsence();
    });

    const outcome = await refreshAbsencePlans(absenceId!, { pool: db, logger: recordingLogger() });
    expect(outcome).toBe('refreshed');
    expect(saves()).toBe(2);
    expect(await mark()).toBeNull();
    // Only the second build was saved.
    expect((await planRows()).map((p) => p.contentVersion)).toEqual(
      before.map((p) => p.contentVersion + 1),
    );
  });

  it('gives up after repeated changes, keeps the mark and fails so the job is retried', async () => {
    await markAbsence();
    const before = await planRows();
    const { db, saves } = changingBeforeSave(async () => {
      await markAbsence();
    });
    const logger = recordingLogger();

    await expect(refreshAbsencePlans(absenceId!, { pool: db, logger })).rejects.toThrow(
      /kept changing/,
    );
    expect(saves()).toBe(REFRESH_ATTEMPTS);
    expect(await mark()).not.toBeNull();
    expect(await planRows()).toEqual(before);
    expect(logger.entries).toEqual([
      {
        level: 'warn',
        message: 'sub plans kept changing while being rebuilt',
        data: { absenceId },
      },
    ]);

    // Once the edits stop, the retried job goes through.
    expect(await refreshAbsencePlans(absenceId!, { pool, logger: recordingLogger() })).toBe(
      'refreshed',
    );
    expect(await mark()).toBeNull();
  });

  it('does nothing when the plans are up to date or the absence is gone', async () => {
    const before = await planRows();
    expect(await refreshAbsencePlans(absenceId!, { pool, logger: recordingLogger() })).toBe(
      'up_to_date',
    );
    expect(await refreshAbsencePlans(randomUUID(), { pool, logger: recordingLogger() })).toBe(
      'up_to_date',
    );
    expect(await planRows()).toEqual(before);
  });

  it('keeps a day a substitute has opened and continues the later days after it', async () => {
    const before = await planRows();
    const [thuPlan, monPlan] = before;

    // A code and a session for Thursday, as the substitute portal creates them.
    const code = await pool.query<{ id: string; expires_at: Date }>(
      `insert into public.sub_access_codes
         (sub_plan_id, code_hash, valid_on, valid_from, expires_at, created_by)
       select p.id, $2::text, p.plan_date, w.valid_from, w.expires_at, $3::uuid
         from public.sub_plans p
         cross join lateral app.sub_access_window($4, p.plan_date) w
        where p.id = $1
       returning id, expires_at`,
      [thuPlan!.id, hex(), TEACHER, SCHOOL],
    );
    await pool.query(
      `insert into public.sub_sessions
         (access_code_id, sub_plan_id, session_token_hash, expires_at, device_key)
       values ($1, $2, $3, $4, $5)`,
      [code.rows[0]!.id, thuPlan!.id, hex(), code.rows[0]!.expires_at, hex()],
    );

    await markAbsence();
    expect(await refreshAbsencePlans(absenceId!, { pool, logger: recordingLogger() })).toBe(
      'refreshed',
    );

    const [thuAfter, monAfter] = await planRows();
    // Thursday is a fixed snapshot now.
    expect(thuAfter).toEqual(thuPlan);
    // Monday was rebuilt, counting Thursday's lessons as done until its report arrives.
    expect(monAfter!.contentVersion).toBe(monPlan!.contentVersion + 1);
    expect(monAfter!.generatedAt).not.toBe(monPlan!.generatedAt);
    expect(frenchSequence(monAfter!.plan)[0]).toBe(frenchSequence(thuAfter!.plan).at(-1)! + 1);
    expect(await mark()).toBeNull();
  });

  it('continues the later days from what the substitute reported', async () => {
    const [thuPlan, monPlan] = await planRows();
    // Thursday is released and its code's window moved around the real clock, and a device
    // signs in with a token the test knows (as sub_portal.redeem would leave it).
    const token = randomBytes(32).toString('base64url');
    await pool.query(
      `update public.sub_plans set status = 'released', released_at = now() where id = $1`,
      [thuPlan!.id],
    );
    await pool.query(
      `update public.sub_access_codes
          set valid_from = now() - interval '1 hour', expires_at = now() + interval '2 hours'
        where sub_plan_id = $1`,
      [thuPlan!.id],
    );
    await pool.query(
      `insert into public.sub_sessions
         (access_code_id, sub_plan_id, session_token_hash, expires_at, device_key)
       select c.id, c.sub_plan_id, $2, c.expires_at, $3
         from public.sub_access_codes c where c.sub_plan_id = $1
        limit 1`,
      [thuPlan!.id, createHash('sha256').update(token).digest('hex'), hex()],
    );

    // Français was not done; everything else was.
    const lessons = reportableLessons(thuPlan!.plan).map((l) => ({
      blockKey: l.blockKey,
      lessonId: l.lessonId,
      outcome: frenchLessons.has(l.lessonId) ? 'not_done' : 'done',
    }));
    const done = lessons.filter((l) => l.outcome === 'done').map((l) => l.lessonId);
    expect(done.length).toBeGreaterThan(0);
    expect(lessons.length).toBeGreaterThan(done.length);
    reportedLessonIds = done;

    // Sent through the portal role, as the web server does.
    const client = await pool.connect();
    let outcome: string | undefined;
    try {
      await client.query('begin');
      await client.query('set local role lynx_sub_portal');
      const { rows } = await client.query<{ outcome: string }>(
        'select outcome from sub_portal.save_report($1, $2::jsonb, null, null, true)',
        [token, JSON.stringify({ schemaVersion: 1, lessons, absentStudentIds: [] })],
      );
      await client.query('commit');
      outcome = rows[0]?.outcome;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    expect(outcome).toBe('submitted');

    // Done lessons are pending the teacher's confirmation; the absence is marked for a rebuild.
    const { rows: pending } = await pool.query<{ lesson_id: string; taught_on: string }>(
      `select lp.lesson_id, to_char(lp.taught_on, 'YYYY-MM-DD') as taught_on
         from public.lesson_progress lp
         join public.sub_reports r on r.id = lp.sub_report_id
        where r.sub_plan_id = $1 and lp.status = 'pending_confirmation'
          and lp.source = 'substitute_report'`,
      [thuPlan!.id],
    );
    expect(pending.map((p) => p.lesson_id).sort()).toEqual([...done].sort());
    expect(pending.every((p) => p.taught_on === thursday)).toBe(true);
    expect(await mark()).not.toBeNull();

    expect(await refreshAbsencePlans(absenceId!, { pool, logger: recordingLogger() })).toBe(
      'refreshed',
    );
    const [thuAfter, monAfter] = await planRows();
    // Thursday stays as the substitute saw it.
    expect(thuAfter!.plan).toEqual(thuPlan!.plan);
    // Monday starts Français again with Thursday's first lesson, which was not done...
    expect(frenchSequence(monAfter!.plan)[0]).toBe(frenchSequence(thuPlan!.plan)[0]);
    expect(frenchSequence(monAfter!.plan)[0]).toBeLessThan(frenchSequence(monPlan!.plan)[0]!);
    // ...and does not repeat what was done (pending counts as done, D-010).
    const mondayLessons = monAfter!.plan.blocks.flatMap((b) =>
      b.lesson ? [b.lesson.lessonId] : [],
    );
    expect(mondayLessons.filter((id) => done.includes(id))).toEqual([]);
    expect(await mark()).toBeNull();
  });

  it('continues a separate absence the next school day, and rebuilds it with the earlier one', async () => {
    // The first school day after Monday (a day off in between is skipped).
    let next = addDays(monday, 1);
    for (;;) {
      const { rows } = await pool.query<{ off: boolean }>(
        `select extract(isodow from $3::date) > 5 or exists (
             select 1 from public.school_calendar_events e
              where e.board_id = $1 and (e.school_id is null or e.school_id = $2)
                and e.event_type in ('pa_day', 'holiday')
                and e.starts_on <= $3::date and e.ends_on >= $3::date
           ) as off`,
        [BOARD, SCHOOL, next],
      );
      if (!rows[0]!.off) break;
      next = addDays(next, 1);
    }

    // Published as the web server does: the sources, their fingerprint, the plans.
    nextAbsenceId = await asTeacher(async (db) => {
      const loaded = await db.query<{ sources: { fingerprint?: string } }>(
        'select public.get_sub_plan_sources($1, $2::date, $2::date) as sources',
        [SCHOOL, next],
      );
      const raw = loaded.rows[0]!.sources;
      const sources = subPlanSourcesSchema.parse(raw);
      expect(sources.earlierPlans.map((e) => e.planDate)).toContain(monday);
      const built = buildAbsencePlans(
        sources,
        { startsOn: next, endsOn: next, part: 'full_day', catholicConnection: true },
        { now: new Date() },
      );
      const published = await db.query<{ id: string }>(
        `select public.publish_absence($1, $2::date, $2::date, 'full_day', null, true, $3,
                $4::jsonb, $5) as id`,
        [SCHOOL, next, randomUUID(), JSON.stringify(built.plans), raw.fingerprint],
      );
      return published.rows[0]!.id;
    });
    // Built from sources that did not change meanwhile: not marked.
    expect(await mark(nextAbsenceId)).toBeNull();
    const mondayPlan = (await planRows()).at(-1)!;
    const [nextPlan] = await planRows(nextAbsenceId);
    // Monday's lessons (no report yet) count as taught: the next day does not repeat them.
    expect(frenchSequence(nextPlan!.plan)[0]).toBe(frenchSequence(mondayPlan.plan).at(-1)! + 1);

    // Monday's first Français lesson is checked off: both absences are marked. Clear the next
    // one's mark to see that the earlier absence's rebuild wakes it on its own.
    const firstMonday = frenchSequence(mondayPlan.plan)[0]!;
    mondayLessonId = [...frenchLessons].find(([, seq]) => seq === firstMonday)![0];
    await pool.query(
      `insert into public.lesson_progress (lesson_id, class_id, status, taught_on, completed_by)
       values ($1, $2, 'completed', $3::date, $4)`,
      [mondayLessonId, CLASS_3E, today, TEACHER],
    );
    await pool.query('update public.absences set sources_changed_at = null where id = $1', [
      nextAbsenceId,
    ]);
    expect(await refreshAbsencePlans(absenceId!, { pool, logger: recordingLogger() })).toBe(
      'refreshed',
    );
    const { rows: woken } = await pool.query<{ event_id: string }>(
      `select event_id from public.event_outbox
        where id > $1 and event_type = 'absence.sources_changed' and aggregate_id = $2
          and payload ->> 'cause' = 'earlier_absence'`,
      [outboxStart, nextAbsenceId],
    );
    expect(woken.length).toBeGreaterThan(0);

    // A plain run finds no mark; the dispatched event rebuilds it anyway.
    expect(await refreshAbsencePlans(nextAbsenceId, { pool, logger: recordingLogger() })).toBe(
      'up_to_date',
    );
    await taskList(recordingLogger()).handle_event!(
      { eventId: woken.at(-1)!.event_id, handler: 'sub_plan_refresh' },
      helpers,
    );
    const mondayAfter = (await planRows()).at(-1)!;
    const [nextAfter] = await planRows(nextAbsenceId);
    expect(frenchSequence(mondayAfter.plan)[0]).toBe(firstMonday + 1);
    expect(frenchSequence(nextAfter!.plan)[0]).toBe(frenchSequence(mondayAfter.plan).at(-1)! + 1);
    expect(nextAfter!.contentVersion).toBe(nextPlan!.contentVersion + 1);
  });
});

describe('substitute access retention', () => {
  it('removes old codes, sign-in attempts and report notes every day', async () => {
    // A past absence, inserted directly: publishing refuses past dates.
    const old = await pool.query<{ id: string }>(
      `insert into public.absences (teacher_id, school_id, starts_on, ends_on, status, published_at)
       values ($1, $2, $3::date - 70, $3::date - 50, 'published', now() - interval '70 days')
       returning id`,
      [TEACHER, SCHOOL, today],
    );
    oldAbsenceId = old.rows[0]!.id;

    // One plan per report case, by days before today.
    const plan = async (daysAgo: number) => {
      const { rows } = await pool.query<{ id: string }>(
        `insert into public.sub_plans (absence_id, plan_date, plan, status, review_deadline)
         values ($1, $2::date - $3::integer, $4::jsonb, 'released', now() - make_interval(days => $3))
         returning id`,
        [oldAbsenceId, today, daysAgo, JSON.stringify({ schemaVersion: 1 })],
      );
      return rows[0]!.id;
    };
    const plans = {
      confirmedLongAgo: await plan(70),
      confirmedRecently: await plan(65),
      unconfirmedOld: await plan(62),
      unconfirmedRecent: await plan(50),
    };

    // A code that expired 31 days ago with a session, and one that expired 29 days ago.
    const code = async (planId: string, expiredDaysAgo: number) => {
      const { rows } = await pool.query<{ id: string }>(
        `insert into public.sub_access_codes
           (sub_plan_id, code_hash, valid_on, valid_from, expires_at, created_by)
         select p.id, $2::text, p.plan_date,
                now() - make_interval(days => $3, hours => 13), now() - make_interval(days => $3),
                $4::uuid
           from public.sub_plans p where p.id = $1
         returning id`,
        [planId, hex(), expiredDaysAgo, TEACHER],
      );
      return rows[0]!.id;
    };
    const oldCode = await code(plans.confirmedLongAgo, 31);
    const recentCode = await code(plans.confirmedRecently, 29);
    const session = await pool.query<{ id: string }>(
      `insert into public.sub_sessions
         (access_code_id, sub_plan_id, session_token_hash, expires_at, device_key)
       select c.id, c.sub_plan_id, $2::text, c.expires_at, $3::text
         from public.sub_access_codes c where c.id = $1
       returning id`,
      [oldCode, hex(), hex()],
    );
    const oldSession = session.rows[0]!.id;

    // Reports with free text and an absent student.
    const content = JSON.stringify({
      schemaVersion: 1,
      lessons: [],
      absentStudentIds: [randomUUID()],
    });
    const report = async (
      planId: string,
      status: 'draft' | 'submitted' | 'confirmed',
      confirmedDaysAgo: number | null,
      sessionId: string | null = null,
    ) =>
      pool.query(
        `insert into public.sub_reports (sub_plan_id, content, status, submitted_at, confirmed_at,
           confirmed_by, notes_ciphertext, notes_key_version, session_id)
         values ($1, $2::jsonb, $3::public.sub_report_status,
           case when $3::public.sub_report_status = 'draft' then null
             else now() - interval '62 days' end,
           now() - make_interval(days => $4::integer),
           case when $4::integer is null then null else $5::uuid end,
           'v1.bm90ZXM', 1, $6::uuid)`,
        [planId, content, status, confirmedDaysAgo, TEACHER, sessionId],
      );
    await report(plans.confirmedLongAgo, 'confirmed', 61, oldSession);
    await report(plans.confirmedRecently, 'confirmed', 59);
    await report(plans.unconfirmedOld, 'submitted', null);
    await report(plans.unconfirmedRecent, 'draft', null);

    // Sign-in attempts from 25 and 23 hours ago.
    const attempt = async (hoursAgo: number) => {
      const deviceKey = hex();
      attemptDeviceKeys.push(deviceKey);
      await pool.query(
        `insert into public.sub_code_attempts (device_key, ip_key, succeeded, attempted_at)
         values ($1, $2, false, now() - make_interval(hours => $3))`,
        [deviceKey, hex(), hoursAgo],
      );
      return deviceKey;
    };
    const oldAttempt = await attempt(25);
    const recentAttempt = await attempt(23);

    const logger = recordingLogger();
    await taskList(logger).sub_access_maintenance!({}, helpers);

    const exists = async (table: string, column: string, value: string) =>
      (
        await pool.query<{ found: boolean }>(
          `select exists (select 1 from public.${table} where ${column} = $1) as found`,
          [value],
        )
      ).rows[0]!.found;
    expect(await exists('sub_access_codes', 'id', oldCode)).toBe(false);
    expect(await exists('sub_sessions', 'id', oldSession)).toBe(false);
    expect(await exists('sub_access_codes', 'id', recentCode)).toBe(true);
    expect(await exists('sub_code_attempts', 'device_key', oldAttempt)).toBe(false);
    expect(await exists('sub_code_attempts', 'device_key', recentAttempt)).toBe(true);

    const { rows: reports } = await pool.query<{
      sub_plan_id: string;
      notes_ciphertext: string | null;
      notes_key_version: number | null;
      purged: boolean;
      content: Record<string, unknown>;
      session_id: string | null;
    }>(
      `select sub_plan_id, notes_ciphertext, notes_key_version, notes_purged_at is not null as purged,
              content, session_id
         from public.sub_reports where sub_plan_id = any($1::uuid[])`,
      [Object.values(plans)],
    );
    const byPlan = new Map(reports.map((r) => [r.sub_plan_id, r]));
    const purged = { notes_ciphertext: null, notes_key_version: null, purged: true };
    const kept = { notes_ciphertext: 'v1.bm90ZXM', notes_key_version: 1, purged: false };
    // Confirmed more than 60 days ago, or never confirmed and the plan date is that old.
    expect(byPlan.get(plans.confirmedLongAgo)).toMatchObject({ ...purged, session_id: null });
    expect(byPlan.get(plans.unconfirmedOld)).toMatchObject(purged);
    expect(byPlan.get(plans.confirmedRecently)).toMatchObject(kept);
    expect(byPlan.get(plans.unconfirmedRecent)).toMatchObject(kept);
    // The outcomes stay; the absent-student list goes with the notes.
    expect(byPlan.get(plans.confirmedLongAgo)!.content).toEqual({ schemaVersion: 1, lessons: [] });
    expect(byPlan.get(plans.confirmedRecently)!.content).toHaveProperty('absentStudentIds');

    // Counts only in the log (other old rows in the database may be counted too).
    expect(logger.entries).toHaveLength(1);
    const entry = logger.entries[0]!;
    expect(entry.message).toBe('substitute access retention done');
    expect(Object.keys(entry.data!).sort()).toEqual([
      'attemptsDeleted',
      'codesDeleted',
      'reportsPurged',
    ]);
    expect(entry.data!.codesDeleted).toBeGreaterThanOrEqual(1);
    expect(entry.data!.attemptsDeleted).toBeGreaterThanOrEqual(1);
    expect(entry.data!.reportsPurged).toBeGreaterThanOrEqual(2);
  });

  it('cleans up after itself', async () => {
    const ids = { absence: absenceId!, old: oldAbsenceId!, lesson: completedLessonId! };
    const pa = paDayId!;
    const reported = reportedLessonIds;
    await cleanUp();
    const { rows } = await pool.query<{ left: number }>(
      `select (select count(*) from public.absences where id = any($1::uuid[]))
            + (select count(*) from public.sub_plans where absence_id = any($1::uuid[]))
            + (select count(*) from public.lesson_progress where lesson_id = $2)
            + (select count(*) from public.school_calendar_events where id = $3)
            + (select count(*) from public.sub_code_attempts where device_key = any($4))
            + (select count(*) from public.event_outbox
                where id > $5 and aggregate_id = any($1::uuid[] || $2::uuid))
            + (select count(*) from public.lesson_progress where lesson_id = any($6::uuid[]))
            + (select count(*) from public.event_outbox
                where id > $5 and event_type like 'sub_report.%'
                  and payload ->> 'absenceId' = any($1::text[]))
         as left`,
      [[ids.absence, ids.old], ids.lesson, pa, attemptDeviceKeys, outboxStart, reported],
    );
    expect(Number(rows[0]!.left)).toBe(0);
  });
});
