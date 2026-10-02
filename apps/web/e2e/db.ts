/**
 * Direct database access for end-to-end tests: set up state the UI cannot (a PA day, a code
 * window around the real clock) and clean up after each spec. Uses DATABASE_URL (set in CI and
 * in the local lite stack) as the database owner, so RLS does not apply here.
 */
import {
  TYPE_INFO,
  sampleCanonical,
  sampleSafetyNotes,
  subFriendlyAllowed,
  type LibraryItemType,
} from '@lynx/content';
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
  unitId: string;
  unitTitle: string;
}> {
  const [row] = await query<{
    id: string;
    title: string;
    sub_notes: string | null;
    sequence_number: number;
    unit_id: string;
    unit_title: string;
  }>(
    `select l.id, l.title, l.sub_notes, l.sequence_number, u.id as unit_id, u.title as unit_title
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
    unitId: row.unit_id,
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

/**
 * Puts an account's saved interface language back to the seed's French (language.spec.ts
 * changes the office account's; specs that use French copy must not depend on its outcome).
 */
export async function resetLanguage(email: string): Promise<void> {
  await query(`update public.users set preferred_locale = 'fr-CA' where email = $1`, [email]);
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

/**
 * A day of a demo teacher that is already over, with the plan of another of her days (the
 * database never reads the plan's lessons; publishing refuses past dates, hence the direct
 * insert). Removed by cleanupAbsences.
 */
export async function insertPastPlan(
  email: string,
  fromPlanId: string,
  daysAgo: number,
): Promise<{ absenceId: string; planId: string; date: string }> {
  const [row] = await query<{ absence_id: string; plan_id: string; date: string }>(
    `with a as (
       insert into public.absences (teacher_id, school_id, starts_on, ends_on, status, published_at)
       select u.id, $2, current_date - $3::integer, current_date - $3::integer, 'published', now()
       from public.users u where u.email = $1
       returning id, starts_on
     ), p as (
       insert into public.sub_plans (absence_id, plan_date, plan, status, released_at, review_deadline)
       select a.id, a.starts_on, jsonb_set(src.plan, '{date}', to_jsonb(to_char(a.starts_on, 'YYYY-MM-DD'))),
              'released', now() - make_interval(days => $3::integer),
              now() - make_interval(days => $3::integer)
       from a, public.sub_plans src where src.id = $4
       returning id, absence_id, plan_date
     )
     select p.absence_id, p.id as plan_id, to_char(p.plan_date, 'YYYY-MM-DD') as date from p`,
    [email, SEED.school, daysAgo, fromPlanId],
  );
  return { absenceId: row!.absence_id, planId: row!.plan_id, date: row!.date };
}

/** The lessons of a class that have progress (to remove what a test adds afterwards). */
export async function lessonsWithProgress(classId: string): Promise<string[]> {
  const rows = await query<{ lesson_id: string }>(
    'select lesson_id from public.lesson_progress where class_id = $1',
    [classId],
  );
  return rows.map((r) => r.lesson_id);
}

// ---------------------------------------------------------------------------------------
// Library (Phase 4)
// ---------------------------------------------------------------------------------------

/** 3e MAT B1.2 « Comparer et ordonner des nombres naturels jusqu’à 1 000 » (supabase/seed.sql). */
const SEED_EXPECTATION_3_MAT_B12 = '20000000-0000-4000-8000-000000030b12';

export interface ReadyItemOptions {
  /**
   * A demo account's e-mail, or null for one of the board's own items (`board_created`,
   * `board_owned`: kept by the board's content reviewers, D-091).
   */
  author: string | null;
  type: LibraryItemType;
  /** Start it with « E2E- » so `deleteLibraryItems({ titlePrefix: 'E2E-' })` finds it. */
  title: string;
  status?: 'draft' | 'teacher_reviewed' | 'board_approved';
  /** Private by default; board-wide when approved. */
  scope?: 'private' | 'school' | 'board';
  /** « Contient du contenu de foi » (a faith review then applies, D-064). */
  faith?: boolean;
  /**
   * A version for every active level of the demo board, titled « <title> — version <n> » (n is
   * the number printed on its sheets: 2 for the first level) so a test can tell them apart.
   */
  levels?: boolean;
  subFriendly?: boolean;
}

/**
 * A resource that is ready to be marked reviewed, proposed and approved, written directly as the
 * database owner (like `tests.library_item` in the database tests): 3e année, Mathématiques,
 * B1.2, materials, a keyword, the sample content of its type from `@lynx/content` with its
 * answer key, safety notes for experiments and STEM challenges, and the board's levels when
 * asked. Approved items are approved (and faith-reviewed) by the board's reviewer. Returns the
 * item's id.
 */
export async function insertReadyItem(options: ReadyItemOptions): Promise<string> {
  const status = options.status ?? 'draft';
  const scope = options.scope ?? (status === 'board_approved' ? 'board' : 'private');
  const safetyNotes = TYPE_INFO[options.type].needsSafety ? sampleSafetyNotes() : null;
  const subFriendly = Boolean(options.subFriendly) && subFriendlyAllowed(options.type, safetyNotes);
  const client = await db().connect();
  try {
    await client.query('begin');
    const {
      rows: [item],
    } = await client.query<{ id: string }>(
      `insert into public.library_items (board_id, school_id, type, title, summary, status,
         share_scope, source, author_id, board_owned, subject_id, duration_minutes, materials,
         keywords, sub_friendly, safety_notes, faith_content, approved_at, approved_by,
         faith_reviewed_at, faith_reviewed_by)
       select $1::uuid,
         case when $2::text is not null or $6::public.share_scope = 'school' then $3::uuid end,
         $4::public.library_item_type, $5::text,
         'Une ressource créée pour les tests de bout en bout.', $7::public.library_item_status,
         $6::public.share_scope, $8::public.library_source, author.id, $2::text is null,
         (select id from public.subjects where code = 'mat' and board_id is null), 30,
         'Crayons et feuilles', 'e2e nombres', $9::boolean, $10::jsonb, $11::boolean,
         case when $7::public.library_item_status = 'board_approved' then now() end,
         case when $7::public.library_item_status = 'board_approved' then reviewer.id end,
         case when $7::public.library_item_status = 'board_approved' and $11::boolean then now() end,
         case when $7::public.library_item_status = 'board_approved' and $11::boolean
           then reviewer.id end
       from (select 1) one
       left join public.users author on author.email = $2
       left join public.users reviewer on reviewer.email = 'nathalie.roy@demo.lynx.test'
       returning id`,
      [
        SEED.board,
        options.author,
        SEED.school,
        options.type,
        options.title,
        scope,
        status,
        options.author ? 'teacher_created' : 'board_created',
        subFriendly,
        safetyNotes,
        Boolean(options.faith),
      ],
    );
    const itemId = item!.id;
    await client.query(
      `insert into public.library_item_grades (item_id, grade_code) values ($1, '3')`,
      [itemId],
    );
    await client.query(
      `insert into public.library_item_expectations (item_id, expectation_id) values ($1, $2)`,
      [itemId, SEED_EXPECTATION_3_MAT_B12],
    );
    const levels = options.levels
      ? (
          await client.query<{ id: string }>(
            `select id from public.language_levels
             where board_id = $1 and owner_user_id is null and active order by sort_order, id`,
            [SEED.board],
          )
        ).rows.map((r) => r.id)
      : [];
    const versions = [
      { levelId: null as string | null, ...sampleCanonical(options.type) },
      ...levels.map((levelId, i) => ({
        levelId,
        ...sampleCanonical(options.type, { title: `${options.title} — version ${i + 2}` }),
      })),
    ];
    for (const version of versions) {
      const {
        rows: [row],
      } = await client.query<{ id: string }>(
        `insert into public.library_item_versions (item_id, language_level_id, schema_version, content)
         values ($1, $2, 1, $3) returning id`,
        [itemId, version.levelId, version.content],
      );
      if (version.answerKey) {
        await client.query(
          `insert into public.library_item_answer_keys (version_id, answer_key) values ($1, $2)`,
          [row!.id, version.answerKey],
        );
      }
    }
    await client.query('select app.library_refresh_search($1)', [itemId]);
    await client.query('commit');
    return itemId;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Deletes library items (their versions, keys and links cascade; lessons that linked them keep
 * their place without the link): by id, and/or every item whose title starts with a prefix.
 */
export async function deleteLibraryItems({
  ids = [],
  titlePrefix = null,
}: {
  ids?: string[];
  titlePrefix?: string | null;
}): Promise<void> {
  if (!ids.length && !titlePrefix) return;
  await query(
    `delete from public.library_items
     where id = any($1::uuid[]) or ($2::text is not null and left(title, length($2)) = $2)`,
    [ids, titlePrefix],
  );
}

// ---------------------------------------------------------------------------------------
// Pilot readiness (Phase 6): audit entries, staff accounts, school settings, clean-up
// ---------------------------------------------------------------------------------------

export type StaffRole = 'teacher' | 'principal' | 'vice_principal' | 'office_admin' | 'board_admin';

/**
 * An audit entry written as the app writes them (`app.log_audit`, DECISIONS D-103): by a demo
 * account when `actorEmail` is given (as if signed in), else by the system. Returns its id.
 */
export async function insertAudit(row: {
  action: string;
  boardId?: string | null;
  schoolId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  /** Ids, codes and counts only, as every audit row (no names, no free text). */
  details?: Record<string, unknown>;
  actorType?: 'user' | 'substitute' | 'system' | 'service';
  actorEmail?: string | null;
}): Promise<number> {
  const client = await db().connect();
  try {
    await client.query('begin');
    if (row.actorEmail) {
      const { rows } = await client.query<{ id: string }>(
        'select id from public.users where email = $1',
        [row.actorEmail],
      );
      if (!rows[0]) throw new Error(`no account ${row.actorEmail}`);
      // auth.uid() for this transaction only, as the pgTAP helpers do.
      await client.query(
        `select set_config('request.jwt.claims',
                  json_build_object('sub', $1::text, 'role', 'authenticated')::text, true),
                set_config('request.jwt.claim.sub', $1::text, true)`,
        [rows[0].id],
      );
    }
    await client.query(
      `select app.log_audit($1, $2, $3, $4, $5, $6::jsonb, $7::public.audit_actor_type)`,
      [
        row.action,
        row.boardId ?? null,
        row.schoolId ?? null,
        row.entityType ?? null,
        row.entityId ?? null,
        JSON.stringify(row.details ?? {}),
        row.actorType ?? 'user',
      ],
    );
    const {
      rows: [inserted],
    } = await client.query<{ id: string }>(
      `select currval(pg_get_serial_sequence('public.audit_log', 'id')) as id`,
    );
    await client.query('commit');
    return Number(inserted!.id);
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * A staff account as `pnpm admin invite` makes them: the Auth user (the seed's columns, so the
 * e-mail code works), the profile and one role, at a school of the demo board (or the board for
 * `board_admin`). It has never signed in and has not accepted the pilot terms, so its first
 * sign-in opens « Bienvenue » (D-109). Remove it with `deleteStaff`. Returns its id.
 */
export async function createStaffUser(user: {
  email: string;
  name: string;
  role: StaffRole;
  /** The school for every role but `board_admin`; the demo school by default. */
  schoolId?: string | null;
  boardId?: string;
  honorific?: string | null;
}): Promise<string> {
  const schoolId = user.role === 'board_admin' ? null : (user.schoolId ?? SEED.school);
  const [row] = await query<{ user_id: string }>(
    `with a as (
       insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
         raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token,
         recovery_token, email_change_token_new, email_change)
       values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated',
         'authenticated', $1, now(), '{"provider": "email", "providers": ["email"]}', '{}',
         now(), now(), '', '', '', '')
       returning id, email
     ), i as (
       insert into auth.identities (id, user_id, provider_id, identity_data, provider,
         created_at, updated_at)
       select gen_random_uuid(), a.id, a.id::text,
         jsonb_build_object('sub', a.id::text, 'email', a.email, 'email_verified', true),
         'email', now(), now()
       from a
       returning user_id
     ), u as (
       insert into public.users (id, email, display_name, honorific)
       select i.user_id, $1, $2, $3 from i
       returning id
     )
     insert into public.user_roles (user_id, role, board_id, school_id)
     select u.id, $4::public.app_role, $5, $6 from u
     returning user_id`,
    [
      user.email,
      user.name,
      user.honorific ?? null,
      user.role,
      user.boardId ?? SEED.board,
      schoolId,
    ],
  );
  return row!.user_id;
}

/** Deletes an account entirely (Auth, profile, roles, classes' teams…), as the operator would. */
export async function deleteStaff(email: string): Promise<void> {
  await query('delete from auth.users where email = $1', [email]);
}

/** A school's settings (`schools.settings`), to put them back after a test changes them. */
export async function schoolSettings(schoolId: string): Promise<Record<string, unknown>> {
  const [row] = await query<{ settings: Record<string, unknown> }>(
    'select settings from public.schools where id = $1',
    [schoolId],
  );
  if (!row) throw new Error(`no school ${schoolId}`);
  return row.settings;
}

export async function restoreSchoolSettings(
  schoolId: string,
  settings: Record<string, unknown>,
): Promise<void> {
  await query('update public.schools set settings = $2::jsonb where id = $1', [
    schoolId,
    JSON.stringify(settings),
  ]);
}

/** Deletes every calendar event with this title (school, board or class). */
export async function deleteEventsTitled(title: string): Promise<void> {
  await query('delete from public.school_calendar_events where title = $1', [title]);
}

/** Deletes the sample classes of an account (D-109), with everything in them. */
export async function deleteSampleClasses(email: string): Promise<void> {
  await query(
    `delete from public.classes c using public.users u
     where c.sample_owner_id = u.id and u.email = $1`,
    [email],
  );
}
