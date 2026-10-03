-- Phase 6 review fixes, round A (supabase/migrations/20261201090500_phase6_review_fixes.sql):
-- plans keep to their school year's classes and the year-end purge keeps to the class's own
-- year and its 60 days of notice; invitations complete only for an inviter who still administers
-- the board, and deleting an account deletes its invitations; the staff sign-in throttle; the
-- first names feedback must not keep.
-- DECISIONS: D-055, D-105, D-107, D-116, D-121.
begin;
\ir _helpers.psql
select plan(43);
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

update public.schools set timezone = 'America/Toronto'
where id in (tests.id('school_a1'), tests.id('school_a2'), tests.id('school_b1'));

-- School a1's own date, so day counts never depend on the server's time zone.
create function tests.local_day(p_offset integer)
returns date
language sql
security definer
set search_path = ''
as $$
  select app.school_local_today(tests.id('school_a1')) + p_offset;
$$;

-- A published absence of teacher_a at a1 on one day, with a released plan covering the classes.
create function tests.plan_for(p_key text, p_day date, p_classes text[])
returns uuid
language plpgsql
as $$
declare
  v_absence uuid := tests.remember('abs_' || p_key, gen_random_uuid());
begin
  insert into public.absences (id, teacher_id, school_id, starts_on, ends_on, status, published_at)
  values (v_absence, tests.id('teacher_a'), tests.id('school_a1'), p_day, p_day, 'published',
    least(p_day, current_date)::timestamptz);
  insert into public.sub_plans (id, absence_id, plan_date, plan, review_deadline, status)
  values (tests.remember(p_key, gen_random_uuid()), v_absence, p_day, tests.plan_json(p_day),
    p_day::timestamptz, 'released');
  insert into public.sub_plan_classes (sub_plan_id, class_id)
  select tests.id(p_key), tests.id(c) from unnest(p_classes) c;
  return tests.id(p_key);
end;
$$;

-- Moves every recorded sign-in attempt one step into the past: one transaction has one now(),
-- and attempts made one after the other must look so.
create function tests.later(p_by interval default interval '1 second')
returns void
language sql
security definer
set search_path = ''
as $$
  update public.sign_in_attempts set attempted_at = attempted_at - p_by;
$$;

-- One attempt, as whoever is signed in (often nobody), then a second passes.
create function tests.attempt(p_kind text, p_email text, p_ip text default '203.0.113.7')
returns text
language plpgsql
as $$
declare
  v_outcome text;
begin
  select a.outcome into v_outcome from public.sign_in_attempt(p_kind, p_email, p_ip) a;
  perform tests.later();
  return v_outcome;
end;
$$;

-- `p_n` attempts; the outcome of the last one.
create function tests.attempts(p_n integer, p_kind text, p_email text,
  p_ip text default '203.0.113.7')
returns text
language plpgsql
as $$
declare
  v_outcome text;
begin
  for i in 1..p_n loop
    v_outcome := tests.attempt(p_kind, p_email, p_ip);
  end loop;
  return v_outcome;
end;
$$;

-- `p_codes` times: a code request, then five wrong codes; the outcomes seen.
create function tests.codes_and_wrong_checks(p_codes integer, p_email text)
returns text
language plpgsql
as $$
declare
  v_outcomes text[] := '{}';
begin
  for i in 1..p_codes loop
    v_outcomes := v_outcomes || tests.attempt('request', p_email)
      || tests.attempts(5, 'verify', p_email);
  end loop;
  return array_to_string(array(select distinct o from unnest(v_outcomes) o), ',');
end;
$$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------
-- 1. A class belongs to its school year (D-055, D-105)
-- ---------------------------------------------------------------------------------------

-- teacher_a keeps last year's class (its year ended 400 days ago), with a student and its
-- timetable. Its year-end notice showed 61 days ago, so tonight's job purges its students.
insert into public.school_years (id, board_id, name, starts_on, ends_on) values
  (tests.remember('year_past', gen_random_uuid()), tests.id('board_a'), '2024-2025',
    tests.local_day(-700), tests.local_day(-400));
insert into public.classes (id, school_id, school_year_id, name, students_purge_notice_on) values
  (tests.remember('class_past', gen_random_uuid()), tests.id('school_a1'), tests.id('year_past'),
    'Past class', tests.local_day(-61));
insert into public.class_grades (class_id, grade_code) values (tests.id('class_past'), '3');
insert into public.class_teachers (class_id, user_id, role)
values (tests.id('class_past'), tests.id('teacher_a'), 'homeroom');
insert into public.students (class_id, first_name) values (tests.id('class_past'), 'Ancien');
insert into public.timetable_blocks (class_id, day_key, start_time, end_time, kind, subject_id)
select tests.id('class_past'), d, '10:00', '10:50', 'subject',
  (select id from public.subjects where code = 'mat' and board_id is null)
from generate_series(1, 5) d;

select tests.authenticate_as('teacher_a');
create temporary table sources on commit drop as
  select public.get_sub_plan_sources(tests.id('school_a1'), tests.local_day(1), tests.local_day(5))
    as s;
select tests.clear_authentication();

select is(
  (select array_agg(c ->> 'id' order by c ->> 'id') from sources, jsonb_array_elements(s -> 'classes') c),
  array[tests.id('class_a')::text],
  'plan sources take only the classes of a school year that overlaps the dates');
select ok(
  (select c ->> 'yearStartsOn' = '2026-09-01' and c ->> 'yearEndsOn' = '2027-06-30'
   from sources, jsonb_array_elements(s -> 'classes') c)
  and not exists (select 1 from sources, jsonb_array_elements(s -> 'blocks') b
                  where b ->> 'classId' = tests.id('class_past')::text),
  'each class carries its year; last year''s timetable is not among the blocks');

-- Plans kept longer than its classes' students (so the class purge, not the plan purge, meets
-- them): a plan of the old class's own year, and next week's plan that still lists the old class
-- (built before this fix) next to this year's.
update public.boards set settings = jsonb_set(settings, '{retention}', '{"subPlanDays": 1000}')
where id = tests.id('board_a');
select tests.plan_for('plan_own', tests.local_day(-450), array['class_past']);
select tests.plan_for('plan_next', tests.local_day(7), array['class_a', 'class_past']);

create temporary table runs (n integer, totals jsonb) on commit drop;
insert into runs select 1, app.retention_maintenance();

select ok(
  not exists (select 1 from public.students where class_id = tests.id('class_past'))
  and (select students_purged_at is not null from public.classes where id = tests.id('class_past')),
  'last year''s class loses its students');
select ok(
  not exists (select 1 from public.sub_plans where id = tests.id('plan_own'))
  and exists (select 1 from public.audit_log where entity_id = tests.id('plan_own')
              and action = 'sub_plan.deleted' and details ->> 'reason' = 'class_retention'),
  'with the plans of its own year');
select results_eq(
  $$select status::text, (select array_agg(spc.class_id) from public.sub_plan_classes spc
                          where spc.sub_plan_id = p.id)
    from public.sub_plans p where p.id = tests.id('plan_next')$$,
  $$values ('released', array[tests.id('class_a')])$$,
  'next week''s plan stays, released, and only loses its link to last year''s class');

insert into runs select 2, app.retention_maintenance();
select ok(
  exists (select 1 from public.sub_plans where id = tests.id('plan_next'))
  and (select count(*) from public.audit_log where action = 'class.students_purged'
       and entity_id = tests.id('class_past')) = 1
  and (select (totals ->> 'classes')::int from runs where n = 2) = 0,
  'the next night deletes nothing and purges the class no second time');

-- A year's dates decide its classes' plans: changing them refreshes its teachers' plans.
update public.absences set sources_changed_at = null where id = tests.id('abs_plan_next');
delete from public.event_outbox;
update public.school_years set ends_on = ends_on + 1 where id = tests.id('year_past');
select ok(
  (select sources_changed_at is not null from public.absences where id = tests.id('abs_plan_next'))
  and exists (select 1 from public.event_outbox where event_type = 'absence.sources_changed'
              and aggregate_id = tests.id('abs_plan_next')),
  'changing a school year''s dates refreshes the plans of its classes'' teachers');

-- ---------------------------------------------------------------------------------------
-- 2. Never purged before 60 days of notice (D-105)
-- ---------------------------------------------------------------------------------------

-- A year edited into the past: its purge date is long gone, and no notice ever showed.
insert into public.school_years (id, board_id, name, starts_on, ends_on) values
  (tests.remember('year_moved', gen_random_uuid()), tests.id('board_a'), '2023-2024',
    tests.local_day(-900), tests.local_day(-500)),
  (tests.remember('year_later', gen_random_uuid()), tests.id('board_a'), '2027-2028',
    tests.local_day(330), tests.local_day(630));
insert into public.classes (id, school_id, school_year_id, name, students_purge_notice_on) values
  (tests.remember('class_moved', gen_random_uuid()), tests.id('school_a1'), tests.id('year_moved'),
    'Moved class', null),
  (tests.remember('class_later', gen_random_uuid()), tests.id('school_a1'), tests.id('year_later'),
    'Later class', tests.local_day(-5));
insert into public.students (class_id, first_name)
values (tests.id('class_moved'), 'Rémi'), (tests.id('class_later'), 'Inès');

insert into runs select 3, app.retention_maintenance();
select ok(
  (select count(*) from public.students where class_id = tests.id('class_moved')) = 1
  and (select students_purged_at is null and students_purge_notice_on = tests.local_day(0)
       from public.classes where id = tests.id('class_moved')),
  'a class whose year was edited into the past is not purged on the first run: its notice starts');
select ok(
  (select students_purge_notice_on is null from public.classes where id = tests.id('class_later'))
  and (select count(*) from public.students where class_id = tests.id('class_later')) = 1,
  'a class whose purge moved beyond the notice window forgets when its notice started');

update public.classes set students_purge_notice_on = tests.local_day(-59)
where id = tests.id('class_moved');
insert into runs select 4, app.retention_maintenance();
select is(
  (select count(*)::int from public.students where class_id = tests.id('class_moved')), 1,
  'still there 59 days after its notice started');
update public.classes set students_purge_notice_on = tests.local_day(-60)
where id = tests.id('class_moved');
insert into runs select 5, app.retention_maintenance();
select ok(
  (select count(*) from public.students where class_id = tests.id('class_moved')) = 0
  and (select students_purged_at is not null from public.classes where id = tests.id('class_moved')),
  'purged 60 days after its notice started');
select ok(
  not has_column_privilege('authenticated', 'public.classes', 'students_purge_notice_on', 'update')
  and not has_column_privilege('authenticated', 'public.classes', 'students_purge_notice_on', 'insert')
  and has_column_privilege('authenticated', 'public.classes', 'students_purge_notice_on', 'select'),
  'when the notice started is the job''s to write; teachers read it');

-- ---------------------------------------------------------------------------------------
-- 3. Invitations (D-107)
-- ---------------------------------------------------------------------------------------

-- An Auth account without a profile, as the worker finds or creates one.
create function tests.auth_account(p_key text, p_email text)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := tests.remember(p_key, gen_random_uuid());
begin
  insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', p_email,
    now(), '{}', '{}', now(), now());
  return v_id;
end;
$$;

select tests.create_user('admin_a2');
insert into public.user_roles (user_id, role, board_id, school_id)
values (tests.id('admin_a2'), 'board_admin', tests.id('board_a'), null);

select tests.authenticate_as('board_admin_a');
select tests.remember('inv_removed', (select invitation_id from public.invite_staff(
  tests.id('board_a'), null, 'nouvel.admin@test.lynx.test', 'Nouvel Admin', null, 'board_admin')));
select tests.authenticate_as('admin_a2');
select tests.remember('inv_revoked', (select invitation_id from public.invite_staff(
  tests.id('board_a'), tests.id('school_a1'), 'nouvel.ens@test.lynx.test', 'Nouvel Ens', null,
  'teacher')));
select tests.clear_authentication();

-- board_admin_a's access is removed; admin_a2 loses the admin role but keeps their access.
update public.users set deactivated_at = now() where id = tests.id('board_admin_a');
delete from public.user_roles where user_id = tests.id('admin_a2') and role = 'board_admin';
insert into public.user_roles (user_id, role, board_id, school_id)
values (tests.id('admin_a2'), 'teacher', tests.id('board_a'), tests.id('school_a1'));

select results_eq(
  format($$select app.complete_staff_invitation(%L, %L), app.complete_staff_invitation(%L, %L)$$,
    tests.id('inv_removed'), tests.auth_account('acct_removed', 'nouvel.admin@test.lynx.test'),
    tests.id('inv_revoked'), tests.auth_account('acct_revoked', 'nouvel.ens@test.lynx.test')),
  $$values ('cancelled', 'cancelled')$$,
  'an invitation left pending by someone no longer administering the board is cancelled, not completed');
select ok(
  not exists (select 1 from public.users where id in (tests.id('acct_removed'), tests.id('acct_revoked')))
  and not exists (select 1 from public.user_roles
                  where user_id in (tests.id('acct_removed'), tests.id('acct_revoked')))
  and (select array_agg(status order by status) from public.staff_invitations
       where id in (tests.id('inv_removed'), tests.id('inv_revoked'))) = array['cancelled', 'cancelled'],
  'no profile and no role was made');
select results_eq(
  $$select actor_type::text, details from public.audit_log
    where action = 'staff.invitation_cancelled' and entity_id = tests.id('inv_removed')$$,
  $$values ('system', '{"role": "board_admin"}'::jsonb)$$,
  'the board''s log says the system cancelled it');
update public.users set deactivated_at = null where id = tests.id('board_admin_a');

-- Deleting an account deletes its invitations, in every board, by account and by address.
select tests.authenticate_as('board_admin_a');
select tests.remember('inv_gone', (select invitation_id from public.invite_staff(
  tests.id('board_a'), tests.id('school_a1'), 'Partie@Test.Lynx.Test', 'Partie Bientôt', 'Mme',
  'teacher')));
select tests.clear_authentication();
select app.complete_staff_invitation(tests.id('inv_gone'),
  tests.auth_account('acct_gone', 'partie@test.lynx.test'));
insert into public.staff_invitations (board_id, email, display_name, role, status, error_code,
  processed_at)
values (tests.id('board_b'), 'partie@test.lynx.test', 'Partie', 'board_admin', 'failed',
  'emailConflict', now());
update public.users set deactivated_at = now() where id = tests.id('acct_gone');
select tests.as_service();
create temporary table deleted_account on commit drop as
  select public.operator_delete_staff_account(tests.id('acct_gone'), true) as result;
select tests.clear_authentication();
select ok(
  (select (result ->> 'invitations')::int from deleted_account) = 2
  and not exists (select 1 from public.staff_invitations
                  where email = 'partie@test.lynx.test' or user_id = tests.id('acct_gone')),
  'deleting an account deletes its invitations: no address or name is left behind');

-- ---------------------------------------------------------------------------------------
-- 4. The staff sign-in throttle (D-121)
-- ---------------------------------------------------------------------------------------

select tests.authenticate_anon();
select is(tests.attempts(5, 'request', 'teacher.a@test.lynx.test'), 'ok',
  'before signing in (anon): five code requests in an hour are fine');
select results_eq(
  $$select outcome, retry_after between 3500 and 3600
    from public.sign_in_attempt('request', ' Teacher.A@test.lynx.test ', '203.0.113.7')$$,
  $$values ('wait', true)$$,
  'the sixth waits until the first is an hour old (the address in any case or spacing)');
select is(tests.attempt('request', 'teacher.a.other@test.lynx.test'), 'ok',
  'another address is not held back');

-- Signing in (with the code or the e-mail's link) makes the address's attempts no longer count.
select tests.authenticate_as('teacher_a');
select public.sign_in_succeeded();
select tests.authenticate_anon();
select is(tests.attempt('request', 'teacher.a@test.lynx.test'), 'ok',
  'once the person signed in, their requests no longer count');

-- Wrong codes: five per code, then only a new code works.
select is(tests.attempt('request', 'principal.a@test.lynx.test'), 'ok', 'a code is requested');
select is(tests.attempts(5, 'verify', 'principal.a@test.lynx.test'), 'ok',
  'five wrong codes are checked');
select results_eq(
  $$select outcome, retry_after from public.sign_in_attempt('verify', 'principal.a@test.lynx.test', '203.0.113.7')$$,
  $$values ('new_code', null::integer)$$,
  'the sixth check, even of the right code, is refused until a new code is requested');
select is(tests.attempt('request', 'principal.a@test.lynx.test'), 'ok', 'a new code is requested');
select is(tests.attempt('verify', 'principal.a@test.lynx.test'), 'ok',
  'and its code can be checked');

-- Twenty wrong codes a day per address, whatever the codes.
select is(tests.codes_and_wrong_checks(4, 'office.a@test.lynx.test'), 'ok',
  'four codes and twenty wrong checks');
select is(tests.attempt('request', 'office.a@test.lynx.test'), 'ok', 'a fifth code within the hour');
select results_eq(
  $$select outcome, retry_after > 80000
    from public.sign_in_attempt('verify', 'office.a@test.lynx.test', '203.0.113.7')$$,
  $$values ('wait', true)$$,
  'the twenty-first wrong code of the day waits about a day');

-- Thirty wrong codes every 15 minutes per network, for any addresses; an unknown network has no
-- shared count.
select is(
  (select string_agg(distinct tests.attempt('verify', 'personne' || g || '@ecole.test', '198.51.100.9'), ',')
   from generate_series(1, 30) g),
  'ok', 'thirty wrong codes from one network, for thirty addresses');
select is(tests.attempt('verify', 'personne31@ecole.test', '198.51.100.9'), 'wait',
  'the thirty-first from that network waits');
select is(tests.attempt('verify', 'personne31@ecole.test', '198.51.100.10'), 'ok',
  'another network does not');
select is(
  (select string_agg(distinct tests.attempt('verify', 'inconnu' || g || '@ecole.test', 'unknown'), ',')
   from generate_series(1, 35) g),
  'ok', 'an unknown network is not one shared bucket');

select is(tests.error_of($$select * from public.sign_in_attempt('guess', 'a@b.ca', '1.2.3.4')$$),
  '22023', 'an unknown kind is refused');
select ok(
  tests.error_of($$select * from public.sign_in_attempt('verify', 'pas-une-adresse', '1.2.3.4')$$) = '22023'
  and tests.error_of($$select * from public.sign_in_attempt('verify', 'a@b.ca', 'x; drop')$$) = '22023',
  'so are an address without @ and a network that is not an address');
select tests.clear_authentication();

select ok(
  not exists (select 1 from public.sign_in_attempts
              where email_key !~ '^[0-9a-f]{64}$' or ip_key !~ '^[0-9a-f]{64}$')
  and not exists (select 1 from public.sign_in_attempts
                  where email_key = encode(extensions.digest('email:teacher.a@test.lynx.test', 'sha256'), 'hex'))
  and exists (select 1 from public.sign_in_attempts where ip_key is null),
  'attempts hold keyed hashes, never an address (an unknown network is left empty)');
select ok(
  not has_table_privilege('anon', 'public.sign_in_attempts', 'select')
  and not has_table_privilege('authenticated', 'public.sign_in_attempts', 'select')
  and not has_table_privilege('authenticated', 'app.install_secrets', 'select')
  and not has_table_privilege('service_role', 'app.install_secrets', 'select'),
  'nobody reads the attempts or the install''s secret through the API');
select ok(
  has_function_privilege('anon', 'public.sign_in_attempt(text,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.sign_in_succeeded()', 'execute')
  and has_function_privilege('authenticated', 'public.sign_in_succeeded()', 'execute')
  and not has_function_privilege('authenticated', 'app.sign_in_key(text)', 'execute'),
  'anon may only ask; only a signed-in person clears their own address');

-- The nightly job keeps them two days.
update public.sign_in_attempts set attempted_at = now() - interval '3 days'
where email_key = app.sign_in_key('email:office.a@test.lynx.test');
insert into runs select 6, app.retention_maintenance();
select ok(
  (select (totals ->> 'signInAttempts')::int from runs where n = 6) = 25
  and not exists (select 1 from public.sign_in_attempts
                  where email_key = app.sign_in_key('email:office.a@test.lynx.test')),
  'the nightly job deletes attempts after two days');

-- ---------------------------------------------------------------------------------------
-- 5. Feedback keeps no student's first name (D-116)
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('office_a');
select results_eq(
  $$select n from public.feedback_student_names('Bonjour, LEA et nathan ont vu Mme Roy.') n order by 1$$,
  $$values ('Léa'), ('Nathan')$$,
  'the office, which cannot read students, gets the names of its school''s students that are in the text');
select is_empty(
  $$select * from public.feedback_student_names('Adam et Zo ont un problème.')$$,
  'never another school''s student, nor a name that is not in the text');
select tests.authenticate_as('teacher_b');
select results_eq(
  $$select * from public.feedback_student_names('Adam et Léa')$$,
  $$values ('Adam')$$, 'each person their own schools');
select tests.authenticate_as('board_admin_a');
select is_empty($$select * from public.feedback_student_names('Léa, Nathan, Zoé')$$,
  'a board admin without a school gets none');
select tests.authenticate_anon();
select is(tests.error_of($$select * from public.feedback_student_names('Léa')$$), '42501',
  'nobody signed out');
select tests.clear_authentication();

select * from finish();
rollback;
