/**
 * Integration test for the nightly retention task (DECISIONS D-105): the worker's
 * `retention_maintenance` runs `app.retention_maintenance()`, logs its totals (counts only) and
 * the `retention` heartbeat is updated. Needs a migrated and seeded database (DATABASE_URL). Runs
 * in a transaction that is rolled back. Run with `pnpm test:int`, with the worker stopped.
 */
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import type { Logger } from './logger';
import { RETENTION_COUNT_KEYS, retentionMaintenance } from './retention';
import { refreshAbsencePlans } from './sub-plans/refresh';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required for integration tests');

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

describe('retention_maintenance (D-105)', () => {
  it('purges, logs totals only and records the retention heartbeat', async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      // An event dispatched 91 days ago and one still pending.
      await client.query(
        `insert into public.event_outbox (event_type, occurred_at, dispatched_at, payload) values
           ('test.retention_int', now() - interval '100 days', now() - interval '91 days', '{}'),
           ('test.retention_int', now() - interval '100 days', null, '{}')`,
      );
      const logger = recordingLogger();
      const totals = await retentionMaintenance({ db: client, logger });

      expect(totals.outbox).toBeGreaterThanOrEqual(1);
      const { rows: left } = await client.query<{ n: number }>(
        `select count(*)::int as n from public.event_outbox where event_type = 'test.retention_int'`,
      );
      expect(left[0]!.n).toBe(1);

      expect(logger.entries).toHaveLength(1);
      const [entry] = logger.entries;
      expect(entry!.message).toBe('retention done');
      expect(Object.keys(entry!.data ?? {}).sort()).toEqual(
        [...RETENTION_COUNT_KEYS, 'authLogs'].sort(),
      );
      for (const value of Object.values(entry!.data ?? {})) {
        expect(typeof value === 'number' || value === 'not_permitted').toBe(true);
      }

      const { rows: beat } = await client.query<{ fresh: boolean; outbox: number }>(
        `select beat_at = now() as fresh, (details ->> 'outbox')::int as outbox
         from public.system_heartbeats where component = 'retention'`,
      );
      expect(beat[0]).toEqual({ fresh: true, outbox: totals.outbox });

      // A second run on the same connection works (no leftover temporary state).
      const again = await retentionMaintenance({ db: client, logger });
      expect(again.outbox).toBe(0);
    } finally {
      await client.query('rollback').catch(() => undefined);
      client.release();
    }
  });
});

describe('the class purge and next week’s plans (D-055, D-105, D-138; Phase 6 review)', () => {
  const ISABELLE = 'd0000000-0000-4000-8000-000000000001';
  const SCHOOL = 'c0000000-0000-4000-8000-000000000001';
  const BOARD = 'b0000000-0000-4000-8000-000000000001';
  const quiet: Logger = { info() {}, warn() {}, error() {} };

  it('never deletes a current plan of a teacher who kept last year’s class', async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const q = async <T extends pg.QueryResultRow>(sql: string, args: unknown[] = []) =>
        (await client.query<T>(sql, args)).rows;
      // Isabelle keeps last year's class (its year ended 400 days ago) with its timetable; its
      // year-end notice showed 61 days ago, so tonight's job purges its students.
      const [year] = await q<{ id: string }>(
        `insert into public.school_years (board_id, name, starts_on, ends_on)
         values ($1, 'int-old', current_date - 700, current_date - 400) returning id`,
        [BOARD],
      );
      const [old] = await q<{ id: string }>(
        `insert into public.classes (school_id, school_year_id, name, created_by,
           students_purge_notice_on)
         values ($1, $2, '3e année (année passée)', $3, current_date - 61) returning id`,
        [SCHOOL, year!.id, ISABELLE],
      );
      await q(`insert into public.class_grades (class_id, grade_code) values ($1, '3')`, [old!.id]);
      await q(
        `insert into public.class_teachers (class_id, user_id, role) values ($1, $2, 'homeroom')`,
        [old!.id, ISABELLE],
      );
      await q(`insert into public.students (class_id, first_name) values ($1, 'Ancien')`, [
        old!.id,
      ]);
      // Its « Info-parents » message of that year names a student (D-138).
      await q(
        `insert into public.class_newsletters (class_id, week_of, content)
         values ($1, date_trunc('week', current_date - 450)::date,
           '{"v": 1, "signature": "", "sections": []}'::jsonb)`,
        [old!.id],
      );
      await q(
        `insert into public.timetable_blocks (class_id, day_key, start_time, end_time, kind, subject_id)
         select $1, d, '08:55', '09:45', 'subject',
           (select id from public.subjects where code = 'fra' and board_id is null)
         from generate_series(1, 5) d`,
        [old!.id],
      );
      // An absence on the next school day, built as the worker builds it.
      const [day] = await q<{ d: string }>(
        `select to_char(d, 'YYYY-MM-DD') as d
         from generate_series(current_date + 7, current_date + 20, interval '1 day') d
         where extract(isodow from d) < 6
           and not exists (select 1 from public.school_calendar_events e
                           where e.board_id = $1 and e.affects_schedule
                             and d::date between e.starts_on and e.ends_on)
         limit 1`,
        [BOARD],
      );
      const [absence] = await q<{ id: string }>(
        `insert into public.absences (teacher_id, school_id, starts_on, ends_on, status,
           published_at, sources_changed_at)
         values ($1, $2, $3, $3, 'published', now(), now()) returning id`,
        [ISABELLE, SCHOOL, day!.d],
      );
      await refreshAbsencePlans(absence!.id, { pool: client, logger: quiet });
      const covered = async () =>
        q<{ name: string }>(
          `select c.name from public.sub_plans p
           join public.sub_plan_classes spc on spc.sub_plan_id = p.id
           join public.classes c on c.id = spc.class_id
           where p.absence_id = $1 order by c.name`,
          [absence!.id],
        );
      // The plan covers this year's class only, never the one kept from last year.
      expect((await covered()).map((r) => r.name)).toEqual(['3e année – Mme Tremblay']);

      // A plan built before this fix still listed last year's class: the office released it.
      await q(
        `insert into public.sub_plan_classes (sub_plan_id, class_id)
         select p.id, $2 from public.sub_plans p where p.absence_id = $1`,
        [absence!.id, old!.id],
      );
      await q(
        `update public.sub_plans set status = 'released', released_at = now() where absence_id = $1`,
        [absence!.id],
      );
      for (let night = 1; night <= 2; night++) {
        await retentionMaintenance({ db: client, logger: quiet });
        const plans = await q<{ status: string }>(
          `select status::text from public.sub_plans where absence_id = $1`,
          [absence!.id],
        );
        expect(plans).toEqual([{ status: 'released' }]);
        expect((await covered()).map((r) => r.name)).toEqual(['3e année – Mme Tremblay']);
      }
      // Last year's class lost its students the first night only.
      expect(
        await q(`select count(*)::int as n from public.students where class_id = $1`, [old!.id]),
      ).toEqual([{ n: 0 }]);
      expect(
        await q(
          `select count(*)::int as n from public.audit_log
           where action = 'class.students_purged' and entity_id = $1`,
          [old!.id],
        ),
      ).toEqual([{ n: 1 }]);
      // Its message went with the first names, counted in the audit entry (D-138).
      expect(
        await q(`select count(*)::int as n from public.class_newsletters where class_id = $1`, [
          old!.id,
        ]),
      ).toEqual([{ n: 0 }]);
      expect(
        await q(
          `select details from public.audit_log
           where action = 'class.students_purged' and entity_id = $1`,
          [old!.id],
        ),
      ).toEqual([{ details: { students: 1, newsletters: 1 } }]);
    } finally {
      await client.query('rollback').catch(() => undefined);
      client.release();
    }
  });
});
