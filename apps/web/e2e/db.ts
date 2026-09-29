/**
 * Direct database access for end-to-end tests: set up state the UI cannot (a PA day, a code
 * window around the real clock) and clean up after each spec. Uses DATABASE_URL (set in CI and
 * in the local lite stack) as the database owner, so RLS does not apply here.
 */
import pg from 'pg';

// Opened on first use and again after closeDb(): spec files share this module in a worker.
let pool: pg.Pool | null = null;
function db(): pg.Pool {
  pool ??= new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    max: 2,
  });
  return pool;
}

/** Seeded demo ids (supabase/seed.sql). */
export const SEED = {
  board: 'b0000000-0000-4000-8000-000000000001',
  school: 'c0000000-0000-4000-8000-000000000001',
  class3: 'e0000000-0000-4000-8000-000000000003',
  class5: 'e0000000-0000-4000-8000-000000000005',
};

export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const { rows } = await db().query<T>(sql, params);
  return rows;
}

/** Closes the connections (afterAll), so the worker can exit. */
export async function closeDb(): Promise<void> {
  const open = pool;
  pool = null;
  await open?.end();
}

/** A board-wide PA day (as the seed's), returning its id. */
export async function insertPaDay(date: string): Promise<string> {
  const [row] = await query<{ id: string }>(
    `insert into public.school_calendar_events (board_id, school_id, event_type, title, starts_on, ends_on)
     values ($1, null, 'pa_day', 'Journée pédagogique', $2, $2) returning id`,
    [SEED.board, date],
  );
  return row!.id;
}

/** A school event on one day (a mass, an assembly...), returning its id. */
export async function insertSchoolEvent(event: {
  type: 'mass' | 'assembly' | 'early_dismissal' | 'other';
  title: string;
  date: string;
  start: string | null;
  end: string | null;
  notes?: string | null;
}): Promise<string> {
  const [row] = await query<{ id: string }>(
    `insert into public.school_calendar_events
       (board_id, school_id, event_type, title, starts_on, ends_on, start_time, end_time, notes)
     values ($1, $2, $3, $4, $5, $5, $6, $7, $8) returning id`,
    [
      SEED.board,
      SEED.school,
      event.type,
      event.title,
      event.date,
      event.start,
      event.end,
      event.notes ?? null,
    ],
  );
  return row!.id;
}

export async function deleteEvent(id: string): Promise<void> {
  await query('delete from public.school_calendar_events where id = $1', [id]);
}

/**
 * Moves the active codes of a plan's window around the real clock (valid now), because CI runs
 * on any day and at any time.
 */
export async function openCodeWindow(planId: string): Promise<void> {
  await query(
    `update public.sub_access_codes set valid_from = now() - interval '1 hour',
       expires_at = now() + interval '2 hours'
     where sub_plan_id = $1 and revoked_at is null`,
    [planId],
  );
}

/** Marks a lesson taught as the teacher would (the source guard applies to the API only). */
export async function setProgress(lessonId: string, date: string): Promise<void> {
  await query(
    `insert into public.lesson_progress (lesson_id, class_id, status, taught_on, source)
     select l.id, u.class_id, 'completed', $2, 'teacher'
     from public.unit_lessons l join public.units u on u.id = l.unit_id where l.id = $1
     on conflict (lesson_id) do update set status = 'completed', taught_on = excluded.taught_on`,
    [lessonId, date],
  );
}

export async function clearProgress(lessonIds: string[]): Promise<void> {
  await query('delete from public.lesson_progress where lesson_id = any($1::uuid[])', [lessonIds]);
}

/**
 * The next lesson of a class's active unit for a subject (the first one with no progress:
 * a lesson pending confirmation counts as done, D-010).
 */
export async function nextLesson(
  classId: string,
  subjectCode: string,
): Promise<{
  id: string;
  title: string;
  subNotes: string | null;
  sequenceNumber: number;
  unitTitle: string;
}> {
  const [row] = await query<{
    id: string;
    title: string;
    sub_notes: string | null;
    sequence_number: number;
    unit_title: string;
  }>(
    `select l.id, l.title, l.sub_notes, l.sequence_number, u.title as unit_title
     from public.units u
     join public.subjects s on s.id = u.subject_id
     join public.unit_lessons l on l.unit_id = u.id
     where u.class_id = $1 and s.code = $2 and u.status = 'active'
       and not exists (select 1 from public.lesson_progress p where p.lesson_id = l.id)
     order by l.sequence_number
     limit 1`,
    [classId, subjectCode],
  );
  if (!row) throw new Error(`no next lesson for ${subjectCode} in ${classId}`);
  return {
    id: row.id,
    title: row.title,
    subNotes: row.sub_notes,
    sequenceNumber: row.sequence_number,
    unitTitle: row.unit_title,
  };
}

/** Audit rows of an action by an actor type since an instant. */
export async function auditCount(
  action: string,
  actorType: 'user' | 'substitute' | 'system',
  sinceIso: string,
): Promise<number> {
  const [row] = await query<{ n: string }>(
    `select count(*) as n from public.audit_log
     where action = $1 and actor_type::text = $2 and occurred_at >= $3`,
    [action, actorType, sinceIso],
  );
  return Number(row?.n ?? 0);
}

/**
 * Deletes every absence of a demo teacher (plans, codes, sessions and reports cascade), after
 * the progress rows her substitutes' reports wrote, which do not cascade.
 */
export async function cleanupAbsences(email: string): Promise<void> {
  await query(
    `delete from public.lesson_progress lp
     using public.sub_reports r, public.sub_plans p, public.absences a, public.users u
     where lp.sub_report_id = r.id and r.sub_plan_id = p.id and p.absence_id = a.id
       and a.teacher_id = u.id and u.email = $1`,
    [email],
  );
  await query(
    `delete from public.absences a using public.users u where a.teacher_id = u.id and u.email = $1`,
    [email],
  );
}

/** The absences of a demo teacher, newest first. */
export async function absencesOf(
  email: string,
): Promise<{ id: string; starts_on: string; ends_on: string; status: string }[]> {
  return query(
    `select a.id, to_char(a.starts_on, 'YYYY-MM-DD') as starts_on,
            to_char(a.ends_on, 'YYYY-MM-DD') as ends_on, a.status::text as status
     from public.absences a join public.users u on u.id = a.teacher_id
     where u.email = $1 order by a.created_at desc`,
    [email],
  );
}

/** Substitute sign-in attempts (throttling) are shared by every spec: start clean. */
export async function clearAttempts(): Promise<void> {
  await query('delete from public.sub_code_attempts');
}

export async function deleteAlertsFor(studentName: string, classId: string): Promise<void> {
  await query(
    `delete from public.student_alerts sa using public.students s
     where sa.student_id = s.id and s.first_name = $1 and s.class_id = $2`,
    [studentName, classId],
  );
}

/** The database's clock, as an ISO instant (audit rows are stamped with it). */
export async function dbNow(): Promise<string> {
  const [row] = await query<{ now: Date }>('select now() as now');
  return row!.now.toISOString();
}

/** Audit rows of an action by one staff account since an instant. */
export async function auditCountBy(
  action: string,
  email: string,
  sinceIso: string,
): Promise<number> {
  const [row] = await query<{ n: string }>(
    `select count(*) as n from public.audit_log a join public.users u on u.id = a.actor_user_id
     where a.action = $1 and u.email = $2 and a.occurred_at >= $3`,
    [action, email, sinceIso],
  );
  return Number(row?.n ?? 0);
}

/** The plan of a published absence on one date. */
export async function planIdOn(absenceId: string, date: string): Promise<string> {
  const [row] = await query<{ id: string }>(
    'select id from public.sub_plans where absence_id = $1 and plan_date = $2',
    [absenceId, date],
  );
  if (!row) throw new Error(`no plan on ${date} for absence ${absenceId}`);
  return row.id;
}
