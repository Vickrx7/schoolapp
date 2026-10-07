-- Phase 3 hardening: who issued a code (and what that shows in the audit), the owner losing her
-- teacher role or a class, « Couper » closing a code to new devices, codes typed before their
-- day, the cap on failed attempts, the end of the day's access, back-to-back absences, plans
-- built from sources that changed meanwhile, request ids reused for other dates, and confirming
-- a report that changed (DECISIONS D-047, D-050, D-051, D-054, D-055, D-056).
begin;
\ir _helpers.psql
select plan(40);
select tests.build_fixture();

create function tests.hex(p_text text)
returns text
language sql
as $$
  select encode(extensions.digest(p_text, 'sha256'), 'hex');
$$;

create function tests.portal_redeem(p_code text, p_device text, p_ip text)
returns jsonb
language plpgsql
as $$
declare
  v_macs text[] := array[tests.hex('mac:' || p_code)];
  v_device text := tests.hex('dev:' || p_device);
  v_ip text := tests.hex('ip:' || p_ip);
  v jsonb;
begin
  -- The keys are computed first: the portal role cannot use this schema.
  perform tests.as_portal();
  select to_jsonb(r) into v from sub_portal.redeem(v_macs, v_device, v_ip) r;
  perform set_config('role', 'none', true);
  return v;
end;
$$;

create function tests.portal_load(p_token text)
returns jsonb
language plpgsql
as $$
declare
  v jsonb;
begin
  perform tests.as_portal();
  v := sub_portal.load(p_token, null, 'view');
  perform set_config('role', 'none', true);
  return v;
end;
$$;

create function tests.portal_alerts(p_token text)
returns integer
language plpgsql
as $$
declare
  v integer;
begin
  perform tests.as_portal();
  select count(*)::integer into v from sub_portal.alerts(p_token);
  perform set_config('role', 'none', true);
  return v;
end;
$$;

create function tests.portal_save(p_token text, p_content jsonb, p_submit boolean)
returns text
language plpgsql
as $$
declare
  v text;
begin
  perform tests.as_portal();
  select r.outcome into v from sub_portal.save_report(p_token, p_content, null, null, p_submit) r;
  perform set_config('role', 'none', true);
  return v;
end;
$$;

create function tests.code_id(p_code text)
returns uuid
language sql
as $$
  select id from public.sub_access_codes where code_hash = tests.hex(tests.hex('mac:' || p_code));
$$;

-- Opens a code's window around the real clock (the plan dates are weeks ahead).
create function tests.open_window(p_code text)
returns void
language sql
as $$
  update public.sub_access_codes
  set valid_from = now() - interval '1 hour', expires_at = now() + interval '2 hours'
  where code_hash = tests.hex(tests.hex('mac:' || p_code));
$$;

-- A plan whose only block assigns the given lessons.
create function tests.plan_with(p_date date, p_lessons uuid[])
returns jsonb
language sql
as $$
  select jsonb_set(tests.plan_json(p_date), '{blocks}', coalesce((
    select jsonb_agg(jsonb_build_object('lesson',
      jsonb_build_object('lessonId', l, 'assignment', 'assigned')))
    from unnest(p_lessons) l), '[]'::jsonb));
$$;

create function tests.items_with(p_date date, p_lessons uuid[])
returns jsonb
language sql
as $$
  select jsonb_build_array(jsonb_build_object('date', p_date,
    'classIds', jsonb_build_array(tests.id('class_a')), 'plan', tests.plan_with(p_date, p_lessons)));
$$;

create function tests.audit_details(p_action text)
returns setof jsonb
language sql
as $$
  select details from public.audit_log
  where action = p_action and board_id = tests.id('board_a')
  order by occurred_at, id;
$$;

-- Values computed as superuser for assertions made as a teacher (and the reverse).
create table tests.vals (key text primary key, val text);
create table tests.tokens (key text primary key, token text);
grant select, insert on tests.vals to authenticated;

grant execute on all functions in schema tests to authenticated;

select tests.authenticate_as('teacher_a');
select tests.remember('abs_a', public.publish_absence(tests.id('school_a1'), tests.school_day(14),
  tests.school_day(14), 'full_day', null, true, tests.remember('req_a', gen_random_uuid()),
  tests.plan_items(array[tests.school_day(14)], array[tests.id('class_a')])));
select tests.clear_authentication();
select tests.remember('plan_a', (select id from public.sub_plans where absence_id = tests.id('abs_a')));
update public.sub_plans set status = 'released', released_at = now() where id = tests.id('plan_a');
insert into public.student_alerts (student_id, class_id, category, body_ciphertext)
values (tests.id('student_a1'), tests.id('class_a'), 'allergy', 'v1.a1');

-- ---------------------------------------------------------------------------------------
-- A code the office issued: whoever redeems it, the audit says who issued it
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('office_a');
select public.issue_sub_access_code(tests.id('plan_a'), tests.hex('mac:office'));
select tests.clear_authentication();
select tests.authenticate_as('teacher_a');
select public.issue_sub_access_code(tests.id('plan_a'), tests.hex('mac:owner'));
select tests.clear_authentication();
select results_eq(
  $$select issued_by_role, created_by from public.sub_access_codes
    where id in (tests.code_id('office'), tests.code_id('owner')) order by issued_by_role$$,
  $$values ('office', tests.id('office_a')), ('owner', tests.id('teacher_a'))$$,
  'a code records who issued it and in what role'
);

select tests.open_window('office');
insert into tests.tokens values ('office', tests.portal_redeem('office', 'd1', 'i1') ->> 'session_token');
select ok((select token from tests.tokens where key = 'office') is not null, 'the office''s code opens a session');
select is(
  (select d from tests.audit_details('sub_code.redeemed') d order by d ->> 'code_id' limit 1)
    - 'code_id' - 'sub_session_id',
  jsonb_build_object('issued_by', tests.id('office_a'), 'issued_by_role', 'office'),
  'sub_code.redeemed names the issuer and the issuer''s role'
);
select tests.portal_load((select token from tests.tokens where key = 'office'));
select is(
  (select d ->> 'issued_by_role' from tests.audit_details('sub_plan.viewed') d limit 1),
  'office', 'so does sub_plan.viewed'
);
select is(
  tests.portal_alerts((select token from tests.tokens where key = 'office')), 1,
  'the session reveals the class''s alert'
);
select is(
  (select d ->> 'issued_by' from tests.audit_details('student_alert.viewed') d limit 1),
  tests.id('office_a')::text, 'and student_alert.viewed names the office as the code''s issuer'
);

-- ---------------------------------------------------------------------------------------
-- « Couper » one device closes the code to new devices
-- ---------------------------------------------------------------------------------------

select tests.open_window('owner');
insert into tests.tokens values ('o1', tests.portal_redeem('owner', 'o1', 'i1') ->> 'session_token');
insert into tests.tokens values ('o2', tests.portal_redeem('owner', 'o2', 'i1') ->> 'session_token');
select tests.remember('session_o1', (select id from public.sub_sessions
  where device_key = tests.hex('dev:o1') and revoked_at is null));
select tests.authenticate_as('office_a');
select public.revoke_sub_session(tests.id('session_o1'));
select tests.clear_authentication();
select is(tests.portal_redeem('owner', 'o1', 'i1') ->> 'outcome', 'revoked',
  'the cut device stays out');
select is(tests.portal_redeem('owner', 'o3', 'i1') ->> 'outcome', 'closed',
  'a new device (a private window, cleared cookies) cannot take the free slot');
insert into tests.tokens values ('o2b', tests.portal_redeem('owner', 'o2', 'i1') ->> 'session_token');
select ok((select token from tests.tokens where key = 'o2b') is not null,
  'the device that was not cut may still sign in again');

-- ---------------------------------------------------------------------------------------
-- A code typed before its day, and the cap on failed attempts
-- ---------------------------------------------------------------------------------------

insert into public.sub_access_codes (sub_plan_id, code_hash, valid_on, valid_from, expires_at)
values (tests.id('plan_a'), tests.hex(tests.hex('mac:early')), tests.school_day(14),
  (tests.school_day(14) + time '05:00') at time zone 'America/Toronto',
  (tests.school_day(14) + time '18:00') at time zone 'America/Toronto');
select results_eq(
  $$select r ->> 'outcome', (r ->> 'valid_on')::date, r ->> 'valid_from_time'
    from (select tests.portal_redeem('early', 'e1', 'ie') r) x$$,
  $$values ('not_yet', tests.school_day(14), '05:00')$$,
  'a code typed before its day says when it opens, in the school''s local time'
);
select is(
  (select count(*)::int from public.sub_code_attempts where device_key = tests.hex('dev:e1')),
  0, 'and is not counted as a wrong guess'
);

insert into public.sub_code_attempts (device_key, ip_key, succeeded, attempted_at)
select tests.hex('dev:flood' || i), tests.hex('ip:flood' || i), false, now() - interval '10 seconds'
from generate_series(1, 300) i;
select results_eq(
  $$select r ->> 'outcome', (r ->> 'retry_after')::int
    from (select tests.portal_redeem('owner', 'fresh', 'fresh-ip') r) x$$,
  $$values ('wait', 60)$$,
  'past 300 failed attempts a minute across all devices, everyone waits, whatever their keys'
);
select is(
  (select count(*)::int from public.sub_code_attempts where device_key = tests.hex('dev:fresh')),
  0, 'and nothing is recorded while waiting'
);
delete from public.sub_code_attempts
where ip_key in (select tests.hex('ip:flood' || i) from generate_series(1, 300) i);

-- ---------------------------------------------------------------------------------------
-- The end of the day's access follows the codes that were issued
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select tests.remember('abs_w', public.publish_absence(tests.id('school_a1'), tests.school_day(35),
  tests.school_day(35), 'full_day', null, true, gen_random_uuid(),
  tests.plan_items(array[tests.school_day(35)], array[tests.id('class_a')])));
select tests.clear_authentication();
select tests.remember('plan_w', (select id from public.sub_plans where absence_id = tests.id('abs_w')));
update public.sub_plans set plan_date = current_date - 1 where id = tests.id('plan_w');
select is(app.sub_plan_window_ended(tests.id('plan_w')), true,
  'with no code, the day''s access ends with the school''s access hours');
insert into public.sub_access_codes (sub_plan_id, code_hash, valid_on, valid_from, expires_at)
values (tests.id('plan_w'), tests.hex('code:w'), current_date - 1, now() - interval '3 hours',
  now() + interval '1 hour');
select is(app.sub_plan_window_ended(tests.id('plan_w')), false,
  'a code still valid keeps it open (the hours changed after it was issued)');

-- ---------------------------------------------------------------------------------------
-- The owner is the absent teacher while she teaches at the school and the class
-- ---------------------------------------------------------------------------------------

update public.absences set sources_changed_at = null where teacher_id = tests.id('teacher_a');
delete from public.event_outbox;
-- A transfer: a colleague takes the class over.
insert into public.class_teachers (class_id, user_id, role)
values (tests.id('class_a'), tests.id('teacher_a_other'), 'homeroom');
delete from public.class_teachers
where class_id = tests.id('class_a') and user_id = tests.id('teacher_a');
select tests.authenticate_as('teacher_a');
select throws_ok(
  format($$select public.issue_sub_access_code(%L, %L)$$, tests.id('plan_w'), tests.hex('mac:x1')),
  '42501', null, 'a teacher no longer in the class cannot issue a code for a plan covering it'
);
select tests.clear_authentication();
insert into public.class_teachers (class_id, user_id, role)
values (tests.id('class_a'), tests.id('teacher_a'), 'homeroom');
delete from public.class_teachers
where class_id = tests.id('class_a') and user_id = tests.id('teacher_a_other');

update public.absences set sources_changed_at = null where teacher_id = tests.id('teacher_a');
delete from public.event_outbox;
delete from public.user_roles
where user_id = tests.id('teacher_a') and school_id = tests.id('school_a1') and role = 'teacher';
select is(
  (select count(*)::int from public.absences
   where teacher_id = tests.id('teacher_a') and sources_changed_at is not null),
  2, 'removing her teacher role marks her upcoming absences for a rebuild'
);
select tests.authenticate_as('teacher_a');
select throws_ok(
  format($$select public.list_sub_plan_access(%L)$$, tests.id('plan_a')),
  '42501', null, 'and she is no longer the plan''s owner'
);
select throws_ok(
  format($$select public.issue_sub_access_code(%L, %L)$$, tests.id('plan_a'), tests.hex('mac:x2')),
  '42501', null, 'so she cannot issue a code any more'
);
select tests.clear_authentication();
insert into public.user_roles (user_id, role, board_id, school_id)
values (tests.id('teacher_a'), 'teacher', tests.id('board_a'), tests.id('school_a1'));
select tests.authenticate_as('teacher_a');
select lives_ok(
  format($$select public.list_sub_plan_access(%L)$$, tests.id('plan_a')),
  'with the role back, she is the owner again'
);
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- Sources: a fingerprint, and the days of the absence just before
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
insert into tests.vals values ('read', public.get_sub_plan_sources(tests.id('school_a1'),
  tests.school_day(14) + 1, tests.school_day(14) + 1) ->> 'fingerprint');
select tests.clear_authentication();
select is(
  (select val from tests.vals where key = 'read'),
  app.sub_plan_sources_fingerprint(tests.id('teacher_a'), tests.id('school_a1'),
    tests.school_day(14) + 1, tests.school_day(14) + 1, null),
  'the sources come with their fingerprint'
);
select tests.authenticate_as('teacher_a');
select results_eq(
  $$select e ->> 'planDate', e ->> 'part', e ->> 'reportStatus'
    from jsonb_array_elements(public.get_sub_plan_sources(tests.id('school_a1'),
      tests.school_day(14) + 1, tests.school_day(14) + 1) -> 'earlierPlans') e$$,
  $$values (tests.school_day(14)::text, 'full_day', 'none')$$,
  'the day before, from another absence, is among the sources of a new absence'
);
select tests.clear_authentication();

-- Publishing with sources that changed since they were read: saved, and left marked.
delete from public.event_outbox;
select tests.authenticate_as('teacher_a');
select tests.remember('abs_b', public.publish_absence(tests.id('school_a1'),
  tests.school_day(14) + 1, tests.school_day(14) + 1, 'full_day', null, true,
  tests.remember('req_b', gen_random_uuid()),
  tests.plan_items(array[tests.school_day(14) + 1], array[tests.id('class_a')]), 'stale'));
select tests.clear_authentication();
select results_eq(
  $$select a.sources_changed_at is not null, (select count(*)::int from public.sub_plans p
      where p.absence_id = a.id)
    from public.absences a where a.id = tests.id('abs_b')$$,
  $$values (true, 1)$$,
  'plans built from stale sources are saved, and the absence stays marked for the worker'
);
select is(
  (select count(*)::int from public.event_outbox
   where event_type = 'absence.sources_changed' and aggregate_id = tests.id('abs_b')),
  1, 'which is woken'
);

insert into tests.vals values ('b', app.sub_plan_sources_fingerprint(tests.id('teacher_a'),
  tests.id('school_a1'), tests.school_day(14) + 1, tests.school_day(14) + 1, tests.id('abs_b')));
select tests.authenticate_as('teacher_a');
select lives_ok(
  format($$select public.refresh_sub_plans(%L, %L, %L)$$, tests.id('abs_b'),
    tests.plan_items(array[tests.school_day(14) + 1], array[tests.id('class_a')]),
    (select val from tests.vals where key = 'b')),
  'a rebuild from the current sources'
);
select tests.clear_authentication();
select is(
  (select sources_changed_at from public.absences where id = tests.id('abs_b')), null,
  'clears the mark'
);

-- Back-to-back absences: when the first day's lessons change, the next absence is rebuilt.
select tests.authenticate_as('teacher_a');
select tests.remember('abs_e1', public.publish_absence(tests.id('school_a1'), tests.school_day(49),
  tests.school_day(49), 'full_day', null, true, gen_random_uuid(),
  tests.plan_items(array[tests.school_day(49)], array[tests.id('class_a')])));
select tests.remember('abs_e2', public.publish_absence(tests.id('school_a1'),
  tests.school_day(49) + 1, tests.school_day(49) + 1, 'full_day', null, true, gen_random_uuid(),
  tests.plan_items(array[tests.school_day(49) + 1], array[tests.id('class_a')])));
select tests.clear_authentication();
delete from public.event_outbox;
select tests.authenticate_as('teacher_a');
select public.refresh_sub_plans(tests.id('abs_e1'),
  tests.items_with(tests.school_day(49), array[tests.id('lesson_a1')]));
select tests.clear_authentication();
select results_eq(
  $$select aggregate_id, payload ->> 'cause' from public.event_outbox
    where event_type = 'absence.sources_changed' order by aggregate_id$$,
  $$values (tests.id('abs_e2'), 'earlier_absence')$$,
  'when a day''s lessons change, the absence that starts next is rebuilt too'
);
delete from public.event_outbox;
select tests.authenticate_as('teacher_a');
select public.refresh_sub_plans(tests.id('abs_e1'),
  tests.items_with(tests.school_day(49), array[tests.id('lesson_a1')]));
select tests.clear_authentication();
select is_empty(
  $$select 1 from public.event_outbox where event_type = 'absence.sources_changed'$$,
  'a rebuild that assigns the same lessons wakes nobody'
);
select results_eq(
  $$select e -> 'assignedLessonIds' from jsonb_array_elements(app.sub_plan_sources(
      tests.id('teacher_a'), tests.id('school_a1'), tests.school_day(49) + 1, tests.school_day(49) + 1,
      tests.id('abs_e2')) -> 'earlierPlans') e$$,
  $$values (jsonb_build_array(tests.id('lesson_a1')))$$,
  'and the next absence''s sources carry what the earlier day assigned'
);
select is(
  jsonb_array_length(app.sub_plan_sources(tests.id('teacher_a'), tests.id('school_a1'),
    tests.school_day(49), tests.school_day(49), tests.id('abs_e1')) -> 'earlierPlans'),
  0, 'an absence never counts itself, nor a later one'
);

-- ---------------------------------------------------------------------------------------
-- A request id is one absence
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select is(
  public.publish_absence(tests.id('school_a1'), tests.school_day(14), tests.school_day(14),
    'full_day', null, true, tests.id('req_a'), '[]'),
  tests.id('abs_a'), 'a retried tap returns the absence it published'
);
select throws_ok(
  format($$select public.publish_absence(%L, %L, %L, 'full_day', null, true, %L, '[]')$$,
    tests.id('school_a1'), tests.school_day(42), tests.school_day(42), tests.id('req_a')),
  'LXS23', null, 'the same request id with other dates is refused, not answered with the old absence'
);
select public.cancel_absence(tests.id('abs_b'));
select throws_ok(
  format($$select public.publish_absence(%L, %L, %L, 'full_day', null, true, %L, '[]')$$,
    tests.id('school_a1'), tests.school_day(14) + 1, tests.school_day(14) + 1, tests.id('req_b')),
  'LXS23', null, 'and so is the id of an absence that was cancelled since'
);
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- Confirming a report
-- ---------------------------------------------------------------------------------------

insert into public.unit_lessons (id, unit_id, sequence_number, title) values
  (tests.remember('lesson_a4', gen_random_uuid()), tests.id('unit_a'), 4, 'Lesson A4'),
  (tests.remember('lesson_a5', gen_random_uuid()), tests.id('unit_a'), 5, 'Lesson A5');

create function tests.report(p_done uuid[])
returns jsonb
language sql
as $$
  select jsonb_build_object('schemaVersion', 1, 'absentStudentIds', '[]'::jsonb,
    'lessons', coalesce((select jsonb_agg(jsonb_build_object(
      'blockKey', '00000000-0000-4000-8000-0000000000b1', 'lessonId', l, 'outcome', 'done'))
      from unnest(p_done) l), '[]'::jsonb));
$$;

select is(
  tests.portal_save((select token from tests.tokens where key = 'o2b'),
    tests.report(array[tests.id('lesson_a4')]), true),
  'submitted', 'the substitute sends a report with one lesson done'
);
select tests.remember('report_a', (select id from public.sub_reports where sub_plan_id = tests.id('plan_a')));
create table tests.shown as
  select updated_at from public.sub_reports where id = tests.id('report_a');
grant select on tests.shown to authenticated;
-- The substitute sends it again, with a second lesson, while the teacher has the page open.
update public.sub_reports set updated_at = updated_at - interval '1 second'
where id = tests.id('report_a');
update tests.shown set updated_at = updated_at - interval '1 second';
select is(
  tests.portal_save((select token from tests.tokens where key = 'o2b'),
    tests.report(array[tests.id('lesson_a4'), tests.id('lesson_a5')]), true),
  'submitted', 'and sends it again with a second lesson'
);
select tests.authenticate_as('teacher_a');
select throws_ok(
  format($$select public.confirm_sub_report(%L, %L, %L)$$, tests.id('report_a'),
    jsonb_build_array(jsonb_build_object('lessonId', tests.id('lesson_a4'), 'decision', 'completed')),
    (select updated_at from tests.shown)),
  'LXS16', null, 'confirming the version the page showed is refused once the report changed'
);
select tests.clear_authentication();
select is(
  (select count(*)::int from public.lesson_progress
   where sub_report_id = tests.id('report_a') and status = 'pending_confirmation'),
  2, 'and nothing was confirmed unseen'
);

-- A lesson checked off from Planification while pending, then « Pas terminée ».
update public.lesson_progress set status = 'completed', source = 'teacher',
  completed_by = tests.id('teacher_a')
where lesson_id = tests.id('lesson_a5') and sub_report_id = tests.id('report_a');
update public.absences set sources_changed_at = null where teacher_id = tests.id('teacher_a');
select tests.authenticate_as('teacher_a');
select lives_ok(
  format($$select public.confirm_sub_report(%L, %L, %L)$$, tests.id('report_a'),
    jsonb_build_array(
      jsonb_build_object('lessonId', tests.id('lesson_a4'), 'decision', 'completed'),
      jsonb_build_object('lessonId', tests.id('lesson_a5'), 'decision', 'not_completed')),
    (select updated_at from public.sub_reports where id = tests.id('report_a'))),
  'the teacher confirms the version she sees'
);
select tests.clear_authentication();
select results_eq(
  $$select i.key, lp.status::text from public.lesson_progress lp
    join tests.ids i on i.id = lp.lesson_id
    where lp.lesson_id in (tests.id('lesson_a4'), tests.id('lesson_a5')) order by i.key$$,
  $$values ('lesson_a4', 'completed')$$,
  '« Pas terminée » removes the report''s record of the lesson, even one checked off meanwhile'
);
select is(
  (select sources_changed_at is not null from public.absences where id = tests.id('abs_w')),
  true, 'and her upcoming absences are rebuilt from what she confirmed'
);

select * from finish();
rollback;
