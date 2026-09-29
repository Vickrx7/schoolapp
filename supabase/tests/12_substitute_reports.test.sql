-- The substitute's end-of-day report and the teacher's confirmation: drafts tied to one device,
-- what a report may name, sending (pending progress), who reads a report, confirming, and the
-- paths that must keep working (DECISIONS D-010, D-051, D-054, D-056, D-059, D-060).
-- Sessions are created as superuser with their code's window around the real clock (the plan
-- dates are weeks ahead); tokens and keys are fixed hex strings.
begin;
\ir _helpers.psql
select plan(61);
select tests.build_fixture();

create function tests.hex(p_text text)
returns text
language sql
as $$
  select encode(extensions.digest(p_text, 'sha256'), 'hex');
$$;

create table tests.tokens (device text primary key, token text not null);

-- A device signed in on a plan, as sub_portal.redeem leaves it; the session id is remembered as
-- 'session:<device>'.
create function tests.open_session(p_plan_key text, p_device text)
returns void
language plpgsql
as $$
declare
  v_plan uuid := tests.id(p_plan_key);
  v_code uuid;
  v_token text := substr(tests.hex('token:' || p_device), 1, 43);
begin
  select id into v_code from public.sub_access_codes where code_hash = tests.hex('code:' || p_plan_key);
  if v_code is null then
    insert into public.sub_access_codes (sub_plan_id, code_hash, valid_on, valid_from, expires_at)
    select v_plan, tests.hex('code:' || p_plan_key), p.plan_date, now() - interval '1 hour',
      now() + interval '2 hours'
    from public.sub_plans p where p.id = v_plan
    returning id into v_code;
  end if;
  insert into public.sub_sessions (id, access_code_id, sub_plan_id, session_token_hash, expires_at,
    device_key)
  values (tests.remember('session:' || p_device, gen_random_uuid()), v_code, v_plan,
    tests.hex(v_token), now() + interval '2 hours', tests.hex('dev:' || p_device));
  insert into tests.tokens (device, token) values (p_device, v_token);
end;
$$;

-- sub_portal.save_report as the portal role, for a device's session.
create function tests.portal_save(p_device text, p_content jsonb, p_submit boolean default false,
  p_cipher text default 'v1.bm90ZXM', p_version smallint default 1)
returns jsonb
language plpgsql
as $$
declare
  v_token text := (select token from tests.tokens where device = p_device);
  v jsonb;
begin
  perform tests.as_portal();
  select to_jsonb(r) into v from sub_portal.save_report(v_token, p_content, p_cipher, p_version, p_submit) r;
  perform set_config('role', 'none', true);
  return v;
end;
$$;

create function tests.portal_load(p_device text)
returns jsonb
language plpgsql
as $$
declare
  v_token text := (select token from tests.tokens where device = p_device);
  v jsonb;
begin
  perform tests.as_portal();
  v := sub_portal.load(v_token, null, 'poll');
  perform set_config('role', 'none', true);
  return v;
end;
$$;

-- A report's content: lessons by test key with their outcome, absent students by test key.
create function tests.report(p_lessons jsonb, p_absent text[] default '{}')
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'lessons', coalesce((
      select jsonb_agg(jsonb_build_object('blockKey', '00000000-0000-4000-8000-0000000000b1',
        'lessonId', tests.id(e.key), 'outcome', e.value #>> '{}') order by e.key)
      from jsonb_each(p_lessons) e), '[]'::jsonb),
    'absentStudentIds', coalesce((select jsonb_agg(tests.id(k)) from unnest(p_absent) k), '[]'::jsonb)
  );
$$;

create function tests.report_id(p_plan_key text)
returns uuid
language sql
as $$
  select id from public.sub_reports where sub_plan_id = tests.id(p_plan_key);
$$;

-- This report's progress rows: lesson key, status and source.
create function tests.progress_of(p_plan_key text)
returns table (lesson text, status text, source text)
language sql
as $$
  select i.key, lp.status::text, lp.source::text
  from public.lesson_progress lp
  join tests.ids i on i.id = lp.lesson_id
  where lp.sub_report_id = tests.report_id(p_plan_key)
  order by i.key;
$$;

grant execute on all functions in schema tests to authenticated;

-- More lessons in unit_a (Class A), and one the teacher already checked off herself.
insert into public.unit_lessons (id, unit_id, sequence_number, title) values
  (tests.remember('lesson_a4', gen_random_uuid()), tests.id('unit_a'), 4, 'Lesson A4'),
  (tests.remember('lesson_a5', gen_random_uuid()), tests.id('unit_a'), 5, 'Lesson A5'),
  (tests.remember('lesson_a6', gen_random_uuid()), tests.id('unit_a'), 6, 'Lesson A6'),
  (tests.remember('lesson_a7', gen_random_uuid()), tests.id('unit_a'), 7, 'Lesson A7');
insert into public.lesson_progress (lesson_id, status, taught_on, source, completed_by)
values (tests.id('lesson_a3'), 'completed', current_date - 1, 'teacher', tests.id('teacher_a'));
insert into public.students (id, class_id, first_name, active)
values (tests.remember('student_gone', gen_random_uuid()), tests.id('class_a'), 'Parti', false);

-- Three days of teacher_a's (Class A): plan_a for the report and its confirmation, plan_c for a
-- report never sent, plan_d for a report where nothing was done.
select tests.authenticate_as('teacher_a');
select tests.remember('abs_a', public.publish_absence(tests.id('school_a1'), tests.school_day(14),
  tests.school_day(14), 'full_day', null, true, gen_random_uuid(),
  tests.plan_items(array[tests.school_day(14)], array[tests.id('class_a')])));
select tests.remember('abs_c', public.publish_absence(tests.id('school_a1'), tests.school_day(21),
  tests.school_day(21), 'full_day', null, true, gen_random_uuid(),
  tests.plan_items(array[tests.school_day(21)], array[tests.id('class_a')])));
select tests.remember('abs_d', public.publish_absence(tests.id('school_a1'), tests.school_day(28),
  tests.school_day(28), 'full_day', null, true, gen_random_uuid(),
  tests.plan_items(array[tests.school_day(28)], array[tests.id('class_a')])));
select tests.clear_authentication();
select tests.remember('plan_a', (select id from public.sub_plans where absence_id = tests.id('abs_a')));
select tests.remember('plan_c', (select id from public.sub_plans where absence_id = tests.id('abs_c')));
select tests.remember('plan_d', (select id from public.sub_plans where absence_id = tests.id('abs_d')));
select tests.open_session('plan_a', 'd1');
select tests.open_session('plan_a', 'd2');
select tests.open_session('plan_c', 'd3');
select tests.open_session('plan_d', 'd4');

-- ---------------------------------------------------------------------------------------
-- Drafts: saved during the day, tied to the device that started them
-- ---------------------------------------------------------------------------------------

select is(
  tests.portal_save('d1', tests.report('{"lesson_a1": "done"}')) ->> 'outcome', 'not_released',
  'there is nothing to report on before the plan is released'
);
update public.sub_plans set status = 'released', released_at = now()
where id in (tests.id('plan_a'), tests.id('plan_c'), tests.id('plan_d'));

select results_eq(
  $$select v ->> 'outcome', v ->> 'status', (v ->> 'updated_at') is not null
    from (select tests.portal_save('d1', tests.report('{"lesson_a1": "done"}', array['student_a2'])) v) r$$,
  $$values ('saved', 'draft', true)$$,
  'a draft is saved to the server during the day'
);
select results_eq(
  $$select status::text, session_id, submitted_at, notes_ciphertext, notes_key_version::int
    from public.sub_reports where sub_plan_id = tests.id('plan_a')$$,
  $$values ('draft', tests.id('session:d1'), null::timestamptz, 'v1.bm90ZXM', 1)$$,
  'as a draft of the session that started it, with the notes as the web server encrypted them'
);
select tests.authenticate_as('teacher_a');
select is_empty(
  $$select 1 from public.sub_reports where sub_plan_id = tests.id('plan_a')$$,
  'the teacher does not see a draft while the day''s access is open'
);
select is(public.sub_plan_access_ended(tests.id('plan_a')), false, 'and the page knows the day is not over');
select tests.clear_authentication();
select tests.authenticate_as('principal_a');
select is(
  public.get_sub_report_for_staff(tests.id('plan_a')) -> 'report', 'null'::jsonb,
  'nor does the direction'
);
select tests.clear_authentication();

select is(
  tests.portal_save('d2', tests.report('{"lesson_a2": "done"}')) ->> 'outcome', 'locked_other_device',
  'a second device cannot overwrite the report while the first one''s session is valid'
);
select results_eq(
  $$select v -> 'report' ->> 'lockedToOtherDevice', v -> 'report' -> 'content'
    from (select tests.portal_load('d2') v) r$$,
  $$values ('true', 'null'::jsonb)$$,
  'and does not see what the other device wrote'
);
update public.sub_sessions set revoked_at = now(), revoked_by = tests.id('office_a')
where id = tests.id('session:d1');
select is(
  tests.portal_save('d2', tests.report('{"lesson_a1": "done"}')) ->> 'outcome', 'saved',
  'once the office cuts the first device, the second takes the report over'
);
select is(
  (select session_id from public.sub_reports where sub_plan_id = tests.id('plan_a')),
  tests.id('session:d2'), 'the report now belongs to the second device'
);

-- ---------------------------------------------------------------------------------------
-- What a report may contain (checked against the plan's classes, never its JSON)
-- ---------------------------------------------------------------------------------------

select throws_ok(
  $$select tests.portal_save('d2', tests.report('{"lesson_b1": "done"}'))$$,
  '22023', null, 'a lesson of another class is refused'
);
select throws_ok(
  $$select tests.portal_save('d2', tests.report('{}', array['student_a_other']))$$,
  '22023', null, 'a student outside the covered classes is refused'
);
select throws_ok(
  $$select tests.portal_save('d2', tests.report('{}', array['student_gone']))$$,
  '22023', null, 'so is a student who left the class'
);
select throws_ok(
  $$select tests.portal_save('d2', tests.report('{}') || '{"schemaVersion": 2}')$$,
  '22023', null, 'another schema version is refused'
);
select throws_ok(
  $$select tests.portal_save('d2', tests.report('{}') || '{"notes": "texte en clair"}')$$,
  '22023', null, 'so is anything else in the content (free text is encrypted apart)'
);
select throws_ok(
  $$select tests.portal_save('d2', jsonb_build_object('schemaVersion', 1, 'lessons', jsonb_build_array(
      jsonb_build_object('blockKey', gen_random_uuid(), 'lessonId', tests.id('lesson_a1'), 'outcome', 'done'),
      jsonb_build_object('blockKey', gen_random_uuid(), 'lessonId', tests.id('lesson_a1'), 'outcome', 'partial'))))$$,
  '22023', null, 'and a lesson reported twice'
);
select throws_ok(
  $$select tests.portal_save('d2', tests.report('{"lesson_a1": "maybe"}'))$$,
  '22023', null, 'and an unknown outcome'
);
select throws_ok(
  $$select tests.portal_save('d2', tests.report('{}'), false, 'Élève malade')$$,
  '22023', null, 'notes must be ciphertext'
);

-- ---------------------------------------------------------------------------------------
-- Sending: pending progress for the lessons marked done
-- ---------------------------------------------------------------------------------------

update public.absences set sources_changed_at = null where id = tests.id('abs_a');
delete from public.event_outbox;
select results_eq(
  $$select v ->> 'outcome', v ->> 'status'
    from (select tests.portal_save('d2',
      tests.report('{"lesson_a1": "done", "lesson_a2": "partial", "lesson_a3": "done"}',
        array['student_a2']), true) v) r$$,
  $$values ('submitted', 'submitted')$$,
  '« Envoyer le suivi » sends the report'
);
select tests.remember('report_a', tests.report_id('plan_a'));
select results_eq(
  $$select lp.lesson_id, lp.status::text, lp.source::text, lp.taught_on, lp.completed_by
    from public.lesson_progress lp where lp.sub_report_id = tests.report_id('plan_a')$$,
  $$values (tests.id('lesson_a1'), 'pending_confirmation', 'substitute_report', tests.school_day(14),
      null::uuid)$$,
  'only lessons marked done get a pending row, on the plan date, from the report'
);
select results_eq(
  $$select status::text, source::text, sub_report_id, completed_by from public.lesson_progress
    where lesson_id = tests.id('lesson_a3')$$,
  $$values ('completed', 'teacher', null::uuid, tests.id('teacher_a'))$$,
  'a lesson the teacher already checked off keeps her record'
);
select is_empty(
  $$select 1 from public.event_outbox where event_type = 'lesson.completed'$$,
  'nothing is completed until the teacher confirms'
);
select results_eq(
  $$select (select sources_changed_at is not null from public.absences where id = tests.id('abs_a')),
      (select count(*)::int from public.event_outbox
       where event_type = 'absence.sources_changed' and aggregate_id = tests.id('abs_a'))$$,
  $$values (true, 1)$$,
  'but the teacher''s upcoming plans are rebuilt from it'
);
select results_eq(
  $$select actor_type::text, actor_user_id, board_id, school_id, entity_id,
      details ->> 'sub_plan_id', details::text ~ '(Léa|Nathan|bm90ZXM)'
    from public.audit_log where action = 'sub_report.submitted' and board_id = tests.id('board_a')$$,
  $$values ('substitute', null::uuid, tests.id('board_a'), tests.id('school_a1'),
      tests.report_id('plan_a'), tests.id('plan_a')::text, false)$$,
  'sending is audited as the substitute, with ids only'
);
select results_eq(
  $$select aggregate_id, (select array_agg(k order by k) from jsonb_object_keys(payload) k)
    from public.event_outbox where event_type = 'sub_report.submitted'$$,
  $$values (tests.report_id('plan_a'), array['absenceId', 'planDate', 'subPlanId', 'subReportId'])$$,
  'sub_report.submitted carries ids and the date only'
);
select tests.authenticate_as('teacher_a');
select results_eq(
  $$select status::text, content -> 'absentStudentIds' ->> 0 from public.sub_reports
    where sub_plan_id = tests.id('plan_a')$$,
  $$values ('submitted', tests.id('student_a2')::text)$$,
  'the teacher sees the report once it is sent'
);
select tests.clear_authentication();

select results_eq(
  $$select v ->> 'outcome', (select content from public.sub_reports where sub_plan_id = tests.id('plan_a'))
      -> 'lessons' -> 0 ->> 'outcome'
    from (select tests.portal_save('d2', tests.report('{"lesson_a1": "not_done"}')) v) r$$,
  $$values ('already_submitted', 'done')$$,
  'a late autosave does not turn a sent report back into a draft'
);
select lives_ok(
  $$select tests.portal_save('d2', tests.report(
      '{"lesson_a1": "not_done", "lesson_a2": "done", "lesson_a3": "done", "lesson_a4": "done",
        "lesson_a5": "done", "lesson_a6": "done"}', array['student_a1', 'student_a2']), true)$$,
  'the substitute can send the report again'
);
select results_eq(
  $$select lesson, status from tests.progress_of('plan_a')$$,
  $$values ('lesson_a2', 'pending_confirmation'), ('lesson_a4', 'pending_confirmation'),
           ('lesson_a5', 'pending_confirmation'), ('lesson_a6', 'pending_confirmation')$$,
  'sending again replaces the report''s pending rows'
);

-- ---------------------------------------------------------------------------------------
-- Reading a report: the direction, audited; office staff never
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('principal_a');
select results_eq(
  $$select r -> 'report' ->> 'status', r -> 'report' ->> 'notesCiphertext',
      jsonb_array_length(r -> 'lessons'),
      (select array_agg(s ->> 'firstName' order by s ->> 'firstName') from jsonb_array_elements(r -> 'students') s)
    from (select public.get_sub_report_for_staff(tests.id('plan_a')) r) x$$,
  $$values ('submitted', 'v1.bm90ZXM', 6, array['Léa', 'Nathan'])$$,
  'the direction reads the report: ciphertext for the web server, lesson titles, first names'
);
select tests.clear_authentication();
select is(
  (select count(*)::int from public.audit_log where action = 'sub_report.viewed'
   and entity_id = tests.report_id('plan_a') and details ->> 'role' = 'direction'),
  1, 'every view by the direction is audited'
);
select tests.authenticate_as('office_a');
select throws_ok(
  $$select public.get_sub_report_for_staff(tests.id('plan_a'))$$,
  '42501', null, 'office staff never read a report'
);
select is_empty($$select 1 from public.sub_reports$$, 'not even directly');
select tests.clear_authentication();
select tests.authenticate_as('teacher_a_other');
select throws_ok(
  $$select public.sub_plan_access_ended(tests.id('plan_a'))$$,
  '42501', null, 'a colleague learns nothing about the plan'
);
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- Confirming: one path from the report to completed lessons
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a_other');
select throws_ok(
  format($$select public.confirm_sub_report(%L, '[]')$$, tests.id('report_a')),
  '42501', null, 'a colleague cannot confirm the report'
);
select tests.clear_authentication();
select tests.authenticate_as('principal_a');
select throws_ok(
  format($$select public.confirm_sub_report(%L, '[]')$$, tests.id('report_a')),
  '42501', null, 'nor can the direction'
);
select tests.clear_authentication();
select tests.authenticate_as('teacher_a');
select throws_ok(
  format($$select public.confirm_sub_report(%L, %L)$$, tests.id('report_a'),
    jsonb_build_array(jsonb_build_object('lessonId', tests.id('lesson_b1'), 'decision', 'completed'))),
  '22023', null, 'a lesson outside the report is refused'
);
select throws_ok(
  format($$select public.confirm_sub_report(%L, %L)$$, tests.id('report_a'),
    jsonb_build_array(jsonb_build_object('lessonId', tests.id('lesson_a2'), 'decision', 'done'))),
  '22023', null, 'so is an unknown decision'
);
select tests.clear_authentication();

delete from public.event_outbox;
select tests.authenticate_as('teacher_a');
select lives_ok(
  format($$select public.confirm_sub_report(%L, %L)$$, tests.id('report_a'),
    jsonb_build_array(
      jsonb_build_object('lessonId', tests.id('lesson_a1'), 'decision', 'completed'),
      jsonb_build_object('lessonId', tests.id('lesson_a2'), 'decision', 'completed'),
      jsonb_build_object('lessonId', tests.id('lesson_a4'), 'decision', 'not_completed'),
      jsonb_build_object('lessonId', tests.id('lesson_a5'), 'decision', 'skipped'))),
  '« Confirmer le suivi »'
);
select tests.clear_authentication();
select results_eq(
  $$select lesson, status, source from tests.progress_of('plan_a')$$,
  $$values ('lesson_a1', 'completed', 'substitute_report'), ('lesson_a2', 'completed', 'substitute_report'),
           ('lesson_a5', 'skipped', 'substitute_report'), ('lesson_a6', 'completed', 'substitute_report')$$,
  'confirmed lessons are completed (even one the substitute did not finish), « Sautée » is skipped, '
  '« Pas terminée » is next again, and lessons not mentioned are confirmed as reported'
);
select results_eq(
  $$select bool_and(completed_by = tests.id('teacher_a')), bool_and(taught_on = tests.school_day(14))
    from public.lesson_progress where sub_report_id = tests.report_id('plan_a')$$,
  $$values (true, true)$$,
  'the teacher confirmed them, as taught on the day of the absence'
);
select set_eq(
  $$select aggregate_id, payload ->> 'source' from public.event_outbox where event_type = 'lesson.completed'$$,
  $$values (tests.id('lesson_a1'), 'substitute_report'), (tests.id('lesson_a2'), 'substitute_report'),
           (tests.id('lesson_a6'), 'substitute_report')$$,
  'lesson.completed says the lesson came from a substitute''s report'
);
select results_eq(
  $$select r.status::text, r.confirmed_by, r.confirmed_at is not null,
      (select count(*)::int from public.audit_log a where a.action = 'sub_report.confirmed'
       and a.entity_id = r.id and a.actor_user_id = tests.id('teacher_a')),
      (select count(*)::int from public.event_outbox e where e.event_type = 'sub_report.confirmed'
       and e.aggregate_id = r.id)
    from public.sub_reports r where r.sub_plan_id = tests.id('plan_a')$$,
  $$values ('confirmed', tests.id('teacher_a'), true, 1, 1)$$,
  'the report is confirmed, audited and announced'
);
select tests.authenticate_as('teacher_a');
select lives_ok(
  format($$select public.confirm_sub_report(%L, '[]')$$, tests.id('report_a')),
  'confirming again (a retried tap) does nothing'
);
select tests.clear_authentication();
select is(
  (select count(*)::int from public.audit_log where action = 'sub_report.confirmed'
   and entity_id = tests.report_id('plan_a')),
  1, 'and writes nothing'
);
select tests.open_session('plan_a', 'd5');
select is(
  tests.portal_save('d5', tests.report('{"lesson_a4": "done"}'), true) ->> 'outcome', 'confirmed',
  'after confirmation the portal writes nothing'
);

-- ---------------------------------------------------------------------------------------
-- A report never sent: readable and confirmable once the day's access has ended
-- ---------------------------------------------------------------------------------------

select is(
  tests.portal_save('d3', tests.report('{"lesson_a4": "partial"}', array['student_a1'])) ->> 'outcome',
  'saved', 'the substitute leaves a draft and never sends it'
);
select tests.remember('report_c', tests.report_id('plan_c'));
select tests.authenticate_as('teacher_a');
select throws_ok(
  format($$select public.confirm_sub_report(%L, '[]')$$, tests.id('report_c')),
  '22023', null, 'a draft cannot be confirmed while the day''s access is open'
);
select tests.clear_authentication();
-- The day is over: the plan date moves into the past.
update public.sub_plans set plan_date = current_date - 1 where id = tests.id('plan_c');
select tests.authenticate_as('teacher_a');
select results_eq(
  $$select status::text, public.sub_plan_access_ended(sub_plan_id) from public.sub_reports
    where sub_plan_id = tests.id('plan_c')$$,
  $$values ('draft', true)$$,
  'once the day''s access has ended, the teacher sees the draft'
);
select lives_ok(
  format($$select public.confirm_sub_report(%L, %L)$$, tests.id('report_c'),
    jsonb_build_array(jsonb_build_object('lessonId', tests.id('lesson_a4'), 'decision', 'completed'))),
  'and confirms it the same way'
);
select tests.clear_authentication();
select results_eq(
  $$select r.status::text, r.submitted_at is not null,
      (select lp.status::text from public.lesson_progress lp where lp.lesson_id = tests.id('lesson_a4')
       and lp.sub_report_id = r.id)
    from public.sub_reports r where r.sub_plan_id = tests.id('plan_c')$$,
  $$values ('confirmed', true, 'completed')$$,
  'the draft is confirmed and its lesson recorded'
);

-- ---------------------------------------------------------------------------------------
-- A report where nothing was done still moves the later days along
-- ---------------------------------------------------------------------------------------

update public.absences set sources_changed_at = null where teacher_id = tests.id('teacher_a');
select is(
  tests.portal_save('d4', tests.report('{"lesson_a7": "not_done"}'), true) ->> 'outcome', 'submitted',
  'a report with nothing done is sent'
);
select is(
  (select sources_changed_at is not null from public.absences where id = tests.id('abs_d')),
  true, 'and the teacher''s upcoming plans are rebuilt all the same'
);

-- ---------------------------------------------------------------------------------------
-- Other paths keep working
-- ---------------------------------------------------------------------------------------

select lives_ok(
  $$select tests.portal_save('d4', tests.report('{"lesson_a7": "done"}'), true)$$,
  'the substitute corrects the report'
);
select tests.authenticate_as('teacher_a');
select throws_ok(
  $$insert into public.lesson_progress (lesson_id, status, source)
    values (tests.id('lesson_a3'), 'pending_confirmation', 'substitute_report')$$,
  '42501', null, 'a teacher still cannot write substitute progress directly'
);
select lives_ok(
  $$select public.unmark_lesson(tests.id('lesson_a7'))$$,
  'the teacher can clear a pending lesson herself'
);
select tests.clear_authentication();
select is_empty(
  $$select 1 from public.lesson_progress where lesson_id = tests.id('lesson_a7')$$,
  'and it is gone'
);

-- ---------------------------------------------------------------------------------------
-- Retention (D-059): notes and absent students 60 days after confirmation; old codes take
-- their sessions with them, and the report stays.
-- ---------------------------------------------------------------------------------------

update public.sub_reports set confirmed_at = now() - interval '61 days' where sub_plan_id = tests.id('plan_a');
update public.sub_access_codes set valid_from = now() - interval '31 days 5 hours',
  expires_at = now() - interval '31 days'
where sub_plan_id = tests.id('plan_a');
select app.sub_access_maintenance();
select results_eq(
  $$select notes_ciphertext, content ? 'absentStudentIds', jsonb_array_length(content -> 'lessons'),
      session_id, notes_purged_at is not null,
      (select count(*)::int from public.sub_sessions where sub_plan_id = tests.id('plan_a'))
    from public.sub_reports where sub_plan_id = tests.id('plan_a')$$,
  $$values (null::text, false, 6, null::uuid, true, 0)$$,
  'the daily task purges the notes and absent students, keeps the outcomes, and drops old sessions'
);

-- ---------------------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select throws_ok(
  $$select * from sub_portal.save_report(repeat('a', 43), '{}', null, null, false)$$,
  '42501', null, 'signed-in staff cannot write through the portal'
);
select tests.clear_authentication();
select tests.authenticate_anon();
select throws_ok(
  $$select * from sub_portal.save_report(repeat('a', 43), '{}', null, null, false)$$,
  '42501', null, 'anon cannot either'
);
select tests.clear_authentication();
select is(
  tests.portal_save('nobody', tests.report('{}')) ->> 'outcome', 'expired',
  'without a valid session the portal writes nothing'
);

select * from finish();
rollback;
