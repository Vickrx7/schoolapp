-- Phase 6, slice S2 (supabase/migrations/20261201090200_audit_retention.sql): retention settings
-- and the nightly purge (D-105, implementing D-018 and D-059), and the system's status (D-112).
-- The class purge removes students and keeps the teacher's planning.
-- DECISIONS: D-018, D-059, D-105, D-109, D-112.
begin;
\ir _helpers.psql
select plan(46);
select tests.build_fixture();

grant usage on schema tests to service_role;
grant select on tests.ids to service_role;

create function tests.as_service()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'service_role', true);
end;
$$;

-- School a1's own date, so day counts never depend on the server's time zone.
create function tests.local_day(p_offset integer)
returns date
language sql
as $$
  select app.school_local_today(tests.id('school_a1')) + p_offset;
$$;

-- A published absence of teacher_a at a1 on one day, with a plan covering the given class.
create function tests.past_plan(p_key text, p_day date, p_class text)
returns uuid
language plpgsql
as $$
declare
  v_absence uuid := tests.remember('abs_' || p_key, gen_random_uuid());
begin
  insert into public.absences (id, teacher_id, school_id, starts_on, ends_on, status, published_at)
  values (v_absence, tests.id('teacher_a'), tests.id('school_a1'), p_day, p_day, 'published',
    p_day::timestamptz);
  insert into public.sub_plans (id, absence_id, plan_date, plan, review_deadline, status)
  values (tests.remember(p_key, gen_random_uuid()), v_absence, p_day, tests.plan_json(p_day),
    p_day::timestamptz, 'released');
  insert into public.sub_plan_classes (sub_plan_id, class_id) values (tests.id(p_key), tests.id(p_class));
  return tests.id(p_key);
end;
$$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

update public.schools set timezone = 'America/Toronto'
where id in (tests.id('school_a1'), tests.id('school_a2'), tests.id('school_b1'));

-- ---------------------------------------------------------------------------------------
-- 1. Settings: read as the app reads them (RETENTION_LIMITS in packages/domain)
-- ---------------------------------------------------------------------------------------

select results_eq(
  $$select app.retention_days('{}', 'auditDays'), app.retention_days('{}', 'subPlanDays'),
      app.retention_days('{}', 'classDaysAfterYearEnd'), app.retention_days('{}', 'aiUsageDays'),
      app.retention_days('{}', 'feedbackDays')$$,
  $$values (730, 365, 365, 730, 365)$$,
  'the defaults: audit and AI usage two years, the rest one year');
select results_eq(
  $$select app.retention_days('{"retention": {"auditDays": 1095}}', 'auditDays'),
      app.retention_days('{"retention": {"auditDays": 30}}', 'auditDays'),
      app.retention_days('{"retention": {"auditDays": 9999}}', 'auditDays'),
      app.retention_days('{"retention": {"auditDays": "1095"}}', 'auditDays'),
      app.retention_days('{"retention": {"feedbackDays": 400.6}}', 'feedbackDays'),
      app.retention_days('{"retention": 12}', 'auditDays')$$,
  $$values (1095, 730, 730, 730, 401, 730)$$,
  'a number within the bounds counts (rounded); below a year, above the bound or not a number reads as the default');
select is(app.retention_days('{}', 'unknownDays'), null, 'an unknown setting has no value');

-- The guard: the operator only, and only values within the bounds.
select tests.authenticate_as('board_admin_a');
select throws_ok(
  $$update public.boards set settings = jsonb_set(settings, '{retention}', '{"auditDays": 3650}')
    where id = tests.id('board_a')$$,
  '42501', null, 'a board admin cannot change the retention settings');
select lives_ok(
  $$update public.boards set settings = settings || '{"classModeResultsRetentionDays": 400}'
    where id = tests.id('board_a')$$,
  'but still changes the board''s other settings');
select tests.clear_authentication();
select tests.as_service();
select is(tests.error_of($$update public.boards
    set settings = jsonb_set(settings, '{retention}', '{"auditDays": 30}') where id = tests.id('board_b')$$),
  '22023', 'the operator cannot go below a year');
select ok(
  tests.error_of($$update public.boards set settings = jsonb_set(settings, '{retention}', '{"auditDays": 3651}') where id = tests.id('board_b')$$) = '22023'
  and tests.error_of($$update public.boards set settings = jsonb_set(settings, '{retention}', '{"auditDayz": 800}') where id = tests.id('board_b')$$) = '22023'
  and tests.error_of($$update public.boards set settings = jsonb_set(settings, '{retention}', '{"auditDays": 800.5}') where id = tests.id('board_b')$$) = '22023'
  and tests.error_of($$update public.boards set settings = jsonb_set(settings, '{retention}', '{"auditDays": "800"}') where id = tests.id('board_b')$$) = '22023'
  and tests.error_of($$update public.boards set settings = jsonb_set(settings, '{retention}', '[]') where id = tests.id('board_b')$$) = '22023',
  'nor above the bound, with an unknown key, a fraction, a string or a non-object');
select lives_ok(
  $$update public.boards set settings = jsonb_set(settings, '{retention}', '{"auditDays": 1095}')
    where id = tests.id('board_b')$$,
  'the operator keeps board B''s audit log three years');
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- 2. Fixtures, backdated (superuser)
-- ---------------------------------------------------------------------------------------

-- Audit entries of board A (default two years), board B (three years) and no board.
insert into public.audit_log (occurred_at, action, board_id, school_id, details) values
  (now() - interval '731 days', 'user_role.granted', tests.id('board_a'), tests.id('school_a1'), '{"role": "old_a"}'),
  (now() - interval '729 days', 'user_role.granted', tests.id('board_a'), tests.id('school_a1'), '{"role": "keep_a"}'),
  (now() - interval '731 days', 'user_role.granted', tests.id('board_b'), tests.id('school_b1'), '{"role": "keep_b"}'),
  (now() - interval '731 days', 'user.terms_accepted', null, null, '{"role": "old_none"}');

-- The outbox.
insert into public.event_outbox (event_type, occurred_at, dispatched_at, payload) values
  ('test.retention', now() - interval '100 days', now() - interval '91 days', '{"k": "old"}'),
  ('test.retention', now() - interval '100 days', now() - interval '89 days', '{"k": "recent"}'),
  ('test.retention', now() - interval '100 days', null, '{"k": "pending"}');

-- AI usage.
insert into public.ai_generations (board_id, school_id, user_id, feature, prompt_version, provider,
  model, status, created_at, error_code)
values
  (tests.id('board_a'), tests.id('school_a1'), tests.id('teacher_a'), 'differentiate', 'v1', 'fake',
    'fake', 'succeeded', now() - interval '731 days', 'ret_old'),
  (tests.id('board_a'), tests.id('school_a1'), tests.id('teacher_a'), 'differentiate', 'v1', 'fake',
    'fake', 'succeeded', now() - interval '729 days', 'ret_keep'),
  (null, null, null, 'differentiate', 'v1', 'fake', 'fake', 'succeeded', now() - interval '731 days',
    'ret_none');

-- Feedback.
insert into public.feedback (board_id, user_id, kind, message, created_at) values
  (tests.id('board_a'), tests.id('teacher_a'), 'idea', 'ret_old', now() - interval '366 days'),
  (tests.id('board_a'), tests.id('teacher_a'), 'idea', 'ret_keep', now() - interval '364 days');

-- Invitations.
insert into public.staff_invitations (board_id, email, display_name, role, status, created_at,
  processed_at)
values
  (tests.id('board_a'), 'expire@test.lynx.test', 'Expire', 'board_admin', 'pending',
    now() - interval '15 days', null),
  (tests.id('board_a'), 'wait@test.lynx.test', 'Wait', 'board_admin', 'pending',
    now() - interval '13 days', null),
  (tests.id('board_a'), 'gone@test.lynx.test', 'Gone', 'board_admin', 'cancelled',
    now() - interval '120 days', now() - interval '91 days'),
  (tests.id('board_a'), 'keep@test.lynx.test', 'Keep', 'board_admin', 'cancelled',
    now() - interval '120 days', now() - interval '89 days');

-- Supabase Auth's audit entries (where this role may write them: hosted-like stacks may refuse).
create temporary table auth_fixture (inserted boolean) on commit drop;
do $$
begin
  insert into auth.audit_log_entries (instance_id, id, payload, created_at, ip_address) values
    ('00000000-0000-0000-0000-000000000000', tests.remember('auth_old', gen_random_uuid()), '{}',
      now() - interval '91 days', '127.0.0.1'),
    ('00000000-0000-0000-0000-000000000000', tests.remember('auth_keep', gen_random_uuid()), '{}',
      now() - interval '89 days', '127.0.0.1');
  insert into auth_fixture values (true);
exception when insufficient_privilege then
  insert into auth_fixture values (false);
end
$$;

-- Substitute plans: 366 days ago (goes, with its code, session and report), 365 days ago (stays).
select tests.past_plan('plan_old', tests.local_day(-366), 'class_a');
select tests.past_plan('plan_keep', tests.local_day(-365), 'class_a');
insert into public.sub_access_codes (sub_plan_id, code_hash, valid_on, valid_from, expires_at)
values (tests.id('plan_old'), repeat('a', 64), tests.local_day(-366), now() - interval '367 days',
  now() - interval '366 days');
insert into public.sub_reports (id, sub_plan_id, content, status, confirmed_at, submitted_at)
values (tests.remember('report_old', gen_random_uuid()), tests.id('plan_old'), '{"schemaVersion": 1}',
  'submitted', null, now() - interval '366 days');
-- The report's lessons: one confirmed long ago, one still awaiting confirmation.
insert into public.lesson_progress (class_id, lesson_id, status, taught_on, source, sub_report_id)
values
  (tests.id('class_a'), tests.id('lesson_a1'), 'completed', tests.local_day(-366), 'substitute_report',
    tests.id('report_old')),
  (tests.id('class_a'), tests.id('lesson_a2'), 'pending_confirmation', tests.local_day(-366),
    'substitute_report', tests.id('report_old'));
-- An absence long over that never had a plan.
insert into public.absences (id, teacher_id, school_id, starts_on, ends_on, status)
values (tests.remember('abs_noplan', gen_random_uuid()), tests.id('teacher_a'), tests.id('school_a1'),
  tests.local_day(-400), tests.local_day(-399), 'published');

-- Classes of past school years: one ended 366 days ago (its students go), one 364 days ago.
insert into public.school_years (id, board_id, name, starts_on, ends_on) values
  (tests.remember('year_old', gen_random_uuid()), tests.id('board_a'), '2024-2025',
    tests.local_day(-700), tests.local_day(-366)),
  (tests.remember('year_recent', gen_random_uuid()), tests.id('board_a'), '2025-2026',
    tests.local_day(-650), tests.local_day(-364));
insert into public.classes (id, school_id, school_year_id, name) values
  (tests.remember('class_old', gen_random_uuid()), tests.id('school_a1'), tests.id('year_old'), 'Old class'),
  (tests.remember('class_recent', gen_random_uuid()), tests.id('school_a1'), tests.id('year_recent'), 'Recent class');
insert into public.class_grades (class_id, grade_code) values
  (tests.id('class_old'), '3'), (tests.id('class_recent'), '4');
insert into public.class_teachers (class_id, user_id, role) values
  (tests.id('class_old'), tests.id('teacher_a'), 'homeroom'),
  (tests.id('class_recent'), tests.id('teacher_a'), 'homeroom');
insert into public.students (id, class_id, first_name) values
  (tests.remember('student_old1', gen_random_uuid()), tests.id('class_old'), 'Inès'),
  (tests.remember('student_old2', gen_random_uuid()), tests.id('class_old'), 'Théo'),
  (tests.remember('student_recent', gen_random_uuid()), tests.id('class_recent'), 'Noé');
insert into public.student_alerts (student_id, class_id, category, body_ciphertext)
values (tests.id('student_old1'), tests.id('class_old'), 'medical', 'v1.cipher');
insert into public.class_mode_links (class_id, token)
values (tests.id('class_old'), rpad('retentiontestlinktoken', 43, '0'));
insert into public.timetable_blocks (class_id, day_key, start_time, end_time, kind, subject_id)
values (tests.id('class_old'), 1, '08:55', '09:45', 'subject',
  (select id from public.subjects where code = 'fra' and board_id is null));
insert into public.units (id, class_id, subject_id, title, status)
values (tests.remember('unit_old', gen_random_uuid()), tests.id('class_old'),
  (select id from public.subjects where code = 'fra' and board_id is null), 'Old unit', 'active');
insert into public.unit_lessons (id, unit_id, sequence_number, title)
values (tests.remember('lesson_old', gen_random_uuid()), tests.id('unit_old'), 1, 'Old lesson');
insert into public.lesson_progress (class_id, lesson_id, status, taught_on)
values (tests.id('class_old'), tests.id('lesson_old'), 'completed', tests.local_day(-400));
-- A plan covering the old class, ten days ago (its plan date alone would keep it).
select tests.past_plan('plan_cover', tests.local_day(-10), 'class_old');

-- Sample classes: created 61 days ago (deleted) and 59 days ago (kept).
insert into public.classes (id, school_id, school_year_id, name, sample_owner_id, created_at) values
  (tests.remember('sample_old', gen_random_uuid()), tests.id('school_a1'), tests.id('year_a'),
    'Classe exemple (3e année)', tests.id('teacher_a'), now() - interval '61 days'),
  (tests.remember('sample_keep', gen_random_uuid()), tests.id('school_a1'), tests.id('year_a'),
    'Classe exemple (3e année)', tests.id('teacher_a_other'), now() - interval '59 days');

-- ---------------------------------------------------------------------------------------
-- 3. The nightly purge
-- ---------------------------------------------------------------------------------------

create temporary table run_marker on commit drop as
  select coalesce(max(id), 0) as audit_id from public.audit_log;
create temporary table first_run on commit drop as select app.retention_maintenance() as totals;

-- Audit log.
select results_eq(
  $$select details ->> 'role' from public.audit_log
    where details ->> 'role' in ('old_a', 'keep_a', 'keep_b', 'old_none') order by 1$$,
  $$values ('keep_a'), ('keep_b')$$,
  'audit entries go after two years, after three where the board keeps them longer, and without a board after two');

-- Outbox.
select results_eq(
  $$select payload ->> 'k' from public.event_outbox where event_type = 'test.retention' order by 1$$,
  $$values ('pending'), ('recent')$$,
  'dispatched events go after 90 days; undispatched ones stay');

-- AI usage and feedback.
select results_eq(
  $$select error_code from public.ai_generations where error_code like 'ret_%' order by 1$$,
  $$values ('ret_keep')$$, 'AI usage rows go after two years, with or without a board');
select results_eq(
  $$select message from public.feedback where message like 'ret_%'$$,
  $$values ('ret_keep')$$, 'feedback goes after a year');

-- Invitations.
select results_eq(
  $$select email, status, error_code from public.staff_invitations
    where email like '%@test.lynx.test' order by email$$,
  $$values ('expire@test.lynx.test', 'failed', 'expired'), ('keep@test.lynx.test', 'cancelled', null),
      ('wait@test.lynx.test', 'pending', null)$$,
  'pending invitations expire after 14 days; processed ones go after 90');

-- Plans.
select ok(
  not exists (select 1 from public.sub_plans where id = tests.id('plan_old'))
  and not exists (select 1 from public.sub_access_codes where sub_plan_id = tests.id('plan_old'))
  and not exists (select 1 from public.sub_reports where id = tests.id('report_old'))
  and exists (select 1 from public.sub_plans where id = tests.id('plan_keep')),
  'a plan goes a year after its date, with its codes and report; one a day younger stays');
select results_eq(
  $$select lesson_id, status::text, sub_report_id from public.lesson_progress
    where class_id = tests.id('class_a') and lesson_id in (tests.id('lesson_a1'), tests.id('lesson_a2'))$$,
  $$values (tests.id('lesson_a1'), 'completed', null::uuid)$$,
  'its confirmed progress stays without the report; its unconfirmed lesson goes');
select results_eq(
  $$select actor_type::text, details ->> 'reason', details ->> 'plan_date' from public.audit_log
    where action = 'sub_plan.deleted' and entity_id = tests.id('plan_old')$$,
  $$values ('system', 'retention', tests.local_day(-366)::text)$$,
  'the deletion is audited, by the system');

-- Absences.
select results_eq(
  $$select id from public.absences
    where id in (tests.id('abs_plan_old'), tests.id('abs_plan_keep'), tests.id('abs_noplan'),
      tests.id('abs_plan_cover'))
    order by starts_on$$,
  $$values (tests.id('abs_plan_keep')), (tests.id('abs_plan_cover'))$$,
  'absences over for a year go once no plan is left');

-- Classes.
select ok(
  not exists (select 1 from public.students where class_id = tests.id('class_old'))
  and not exists (select 1 from public.student_alerts where class_id = tests.id('class_old'))
  and not exists (select 1 from public.class_mode_links where class_id = tests.id('class_old'))
  and not exists (select 1 from public.sub_plans where id = tests.id('plan_cover')),
  'a class whose year ended over a year ago loses its students, alerts, class link and plans');
select ok(
  exists (select 1 from public.classes where id = tests.id('class_old') and students_purged_at = now())
  and exists (select 1 from public.units where id = tests.id('unit_old'))
  and exists (select 1 from public.unit_lessons where id = tests.id('lesson_old'))
  and exists (select 1 from public.timetable_blocks where class_id = tests.id('class_old'))
  and exists (select 1 from public.lesson_progress where lesson_id = tests.id('lesson_old'))
  and exists (select 1 from public.class_teachers where class_id = tests.id('class_old')),
  'and keeps the class, its team, units, lessons, timetable and progress, marked as purged');
select results_eq(
  $$select action, actor_type::text, details from public.audit_log
    where id > (select audit_id from run_marker)
      and action in ('student_alert.deleted', 'class.students_purged')
    order by id$$,
  $$values ('student_alert.deleted', 'system', jsonb_build_object('alert_id',
        (select (details ->> 'alert_id') from public.audit_log
         where action = 'student_alert.deleted' and id > (select audit_id from run_marker)),
        'category', 'medical')),
      ('class.students_purged', 'system', '{"students": 2}'::jsonb)$$,
  'each alert''s deletion and the purge are audited by the system, without a name');
select ok(
  (select count(*) from public.students where class_id = tests.id('class_recent')) = 1
  and (select students_purged_at is null from public.classes where id = tests.id('class_recent'))
  and (select count(*) from public.students where class_id = tests.id('class_a')) = 2,
  'a class whose year ended 364 days ago, and this year''s, are untouched');

-- Sample classes.
select results_eq(
  $$select id from public.classes where id in (tests.id('sample_old'), tests.id('sample_keep'))$$,
  $$values (tests.id('sample_keep'))$$,
  'a sample class goes 60 days after it was created (D-109)');
select results_eq(
  $$select action, actor_type::text, details from public.audit_log
    where entity_id = tests.id('sample_old') and action like '%class%deleted'$$,
  $$values ('sample_class.deleted', 'system', '{}'::jsonb)$$,
  'its deletion is logged for the operator only, never « Classe supprimée » (D-103, D-109)');

-- Supabase Auth's log.
select ok(
  case
    when (select totals ->> 'authLogs' from first_run) = 'not_permitted' then true
    when not (select inserted from auth_fixture)
      then (select jsonb_typeof(totals -> 'authLogs') = 'number' from first_run)
    else not exists (select 1 from auth.audit_log_entries where id = tests.id('auth_old'))
      and exists (select 1 from auth.audit_log_entries where id = tests.id('auth_keep'))
      and (select (totals ->> 'authLogs')::int from first_run) >= 1
  end,
  'Supabase Auth''s entries go after 90 days, or the run says it may not delete them');

-- Reporting.
select results_eq(
  $$select actor_type::text, entity_type, details from public.audit_log
    where action = 'retention.purged' and board_id = tests.id('board_a')$$,
  $$values ('system', 'board', '{"sub_plans": 2, "absences": 2, "classes": 1, "students": 2,
      "sample_classes": 1, "ai_usage": 1, "feedback": 1, "invitations_expired": 1,
      "invitations_deleted": 1, "audit_rows": 1}'::jsonb)$$,
  'one entry per board says what was removed');
select is(
  (select count(*)::int from public.audit_log
   where action = 'retention.purged' and board_id = tests.id('board_b')),
  0, 'a board with nothing removed gets none');
select ok(
  (select beat_at = now() and release is null
     and details ->> 'subPlans' = (select totals ->> 'subPlans' from first_run)
     and (details ->> 'subPlans')::int >= 2 and (details ->> 'outbox')::int >= 1
   from public.system_heartbeats where component = 'retention'),
  'the retention heartbeat records the totals');
select ok(
  (select array(select jsonb_object_keys(totals) order by 1) from first_run)
  = array['absences', 'aiUsage', 'auditRows', 'authLogs', 'boards', 'classes', 'feedback',
    'invitationsDeleted', 'invitationsExpired', 'outbox', 'sampleClasses', 'students', 'subPlans'],
  'the run returns counts only');

-- A second run (the same connection) finds nothing more of board A's.
select lives_ok($$select app.retention_maintenance()$$, 'a second run in the same session works');
select is(
  (select count(*)::int from public.audit_log
   where action = 'retention.purged' and board_id = tests.id('board_a')),
  1, 'and finds nothing more to remove');

-- The class purge itself, again on a class that got a student back.
insert into public.students (class_id, first_name) values (tests.id('class_old'), 'Lou');
select is(
  (select (app.purge_class_students(tests.id('class_old'))).students_deleted), 1,
  'app.purge_class_students removes whatever students came back');
select is(app.purge_sub_plan(gen_random_uuid(), 'retention'), false,
  'app.purge_sub_plan reports a plan that is already gone');

-- ---------------------------------------------------------------------------------------
-- 4. Grants: the purges are the database owner's only (the worker's connection)
-- ---------------------------------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated', 'app.retention_maintenance()', 'execute')
  and not has_function_privilege('anon', 'app.retention_maintenance()', 'execute')
  and not has_function_privilege('service_role', 'app.retention_maintenance()', 'execute'),
  'nobody but the owner runs the nightly purge');
select ok(
  not has_function_privilege('authenticated', 'app.purge_class_students(uuid)', 'execute')
  and not has_function_privilege('service_role', 'app.purge_class_students(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'app.purge_sub_plan(uuid,text,public.audit_actor_type)', 'execute')
  and not has_function_privilege('service_role', 'app.purge_sub_plan(uuid,text,public.audit_actor_type)', 'execute'),
  'nor the class and plan purges');
select ok(
  not has_function_privilege('authenticated', 'app.auth_log_maintenance(integer)', 'execute')
  and not has_function_privilege('service_role', 'app.auth_log_maintenance(integer)', 'execute')
  and not has_function_privilege('authenticated', 'app.retention_days(jsonb,text)', 'execute'),
  'nor the Auth log purge and the settings reader');
select ok(
  has_function_privilege('service_role', 'app.retention_limits()', 'execute')
  and not has_function_privilege('authenticated', 'app.retention_limits()', 'execute')
  and not has_function_privilege('anon', 'app.retention_limits()', 'execute'),
  'the bounds are readable by the operator''s writes (the guard runs as its caller)');

-- ---------------------------------------------------------------------------------------
-- 5. « État du système » (board admins: a state and three times, no counts)
-- ---------------------------------------------------------------------------------------

insert into public.system_heartbeats (component, beat_at, release, details) values
  ('worker', now() - interval '1 minute', 'test', '{"lastDispatchAt": null}'),
  ('backup', now() - interval '6 hours', 'test', '{"bytes": 123}')
on conflict (component) do update
  set beat_at = excluded.beat_at, release = excluded.release, details = excluded.details;

select tests.authenticate_as('board_admin_a');
select results_eq(
  $$select s ->> 'state', s -> 'worker' ->> 'ok', s -> 'backup' ->> 'ok', s -> 'retention' ->> 'ok',
      (s -> 'retention' ->> 'at')::timestamptz = now()
    from public.system_status() s$$,
  $$values ('ok', 'true', 'true', 'true', true)$$,
  'everything recent: « Tout fonctionne normalement »');
select ok(
  (select array(select jsonb_object_keys(s) order by 1) = array['backup', 'retention', 'state', 'worker']
     and array(select jsonb_object_keys(s -> 'worker') order by 1) = array['at', 'ok']
     and array(select jsonb_object_keys(s -> 'retention') order by 1) = array['at', 'ok']
   from public.system_status() s),
  'a state and times, never counts or details');
select tests.clear_authentication();

update public.system_heartbeats set beat_at = now() - interval '6 minutes' where component = 'worker';
select tests.authenticate_as('board_admin_a');
select results_eq(
  $$select s ->> 'state', s -> 'worker' ->> 'ok' from public.system_status() s$$,
  $$values ('problem', 'false')$$,
  'a worker silent for 6 minutes is a problem');
select tests.clear_authentication();

update public.system_heartbeats set beat_at = now() where component = 'worker';
update public.system_heartbeats set beat_at = now() - interval '27 hours' where component = 'backup';
select tests.authenticate_as('board_admin_a');
select results_eq(
  $$select s ->> 'state', s -> 'backup' ->> 'ok' from public.system_status() s$$,
  $$values ('problem', 'false')$$, 'so is a backup older than 26 hours');
select tests.clear_authentication();

-- No backup ever: fine on a new install, a problem once it is more than 26 hours old.
delete from public.system_heartbeats where component = 'backup';
update public.boards set created_at = now();
select tests.authenticate_as('board_admin_a');
select results_eq(
  $$select s ->> 'state', s -> 'backup' ->> 'ok', s -> 'backup' ->> 'at' from public.system_status() s$$,
  $$values ('ok', 'true', null::text)$$, 'no backup yet on a new install is not a problem');
select tests.clear_authentication();
update public.boards set created_at = now() - interval '2 days';
select tests.authenticate_as('board_admin_a');
select results_eq(
  $$select s ->> 'state', s -> 'backup' ->> 'ok' from public.system_status() s$$,
  $$values ('problem', 'false')$$, 'no backup after a day is');
select tests.clear_authentication();

select tests.authenticate_as('principal_a');
select throws_ok($$select public.system_status()$$, '42501', null, 'the status is the board admins''');
select tests.clear_authentication();
select tests.authenticate_as('teacher_a');
select throws_ok($$select public.system_status()$$, '42501', null, 'not a teacher''s');
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- 6. The operator's status (service role: counts)
-- ---------------------------------------------------------------------------------------

select tests.as_service();
select ok(
  (select s ? 'heartbeats' and s ? 'outbox' and s ? 'aiJobs' and s ? 'invitations'
     and (s -> 'outbox' ->> 'pending')::int >= 1 and (s -> 'invitations' ->> 'pending')::int >= 1
     and jsonb_array_length(s -> 'heartbeats') >= 2
   from public.operator_status() s),
  'the operator reads heartbeats with details, the outbox, AI jobs and pending invitations');
select tests.clear_authentication();
select tests.authenticate_as('board_admin_a');
select throws_ok($$select public.operator_status()$$, '42501', null, 'board admins do not');
select tests.clear_authentication();

select * from finish();
rollback;
