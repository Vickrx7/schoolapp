-- Phase 3 (substitute hand-off): the end-of-day report (« Suivi de la journée ») and the
-- teacher's confirmation.
--
-- The substitute fills the report in during the day through the portal (sub_portal.save_report).
-- It is saved on the server as she goes and tied to the device session that started it, so a
-- second device cannot overwrite it; the office can cut that session to let another device take
-- over. Outcomes and the ids of absent students stay in `content`; the free text is encrypted by
-- the web server with the alerts key ring (AAD `sub-report:<planId>`) before it gets here.
--
-- Submitting writes a pending progress row for each lesson marked done (pending counts as done
-- for sequencing, D-010), never over the teacher's own record, and marks her upcoming absences
-- for a rebuild so later days continue from what really happened (D-047). « En partie » and
-- « Pas fait » write nothing, so those lessons stay next. The teacher confirms through one
-- function (confirm_sub_report); a report that was never sent becomes readable to her once the
-- day's access has ended, and can be confirmed the same way. Direction reads reports through an
-- audited function; office staff only ever see the report's status (list_school_sub_days).
--
-- DECISIONS: D-051, D-054, D-056, D-060.
-- Tests: supabase/tests/00_schema_invariants.test.sql,
--        supabase/tests/12_substitute_reports.test.sql

-- ---------------------------------------------------------------------------------------
-- 1. What a report may contain. `content` is {schemaVersion: 1, lessons: [{blockKey, lessonId,
--    outcome}], absentStudentIds: [uuid]} (subReportContentSchema in packages/domain). The ids are
--    checked against what the database recorded for the plan, never against its JSON (D-048):
--    lessons of units of the covered classes, active students of those classes.
-- ---------------------------------------------------------------------------------------

create function app.sub_report_check_content(p_plan_id uuid, p_content jsonb)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_id uuid;
  v_seen uuid[] := '{}';
begin
  if p_content is null or jsonb_typeof(p_content) <> 'object'
     or pg_column_size(p_content) > 32768
     or p_content -> 'schemaVersion' is distinct from '1'::jsonb then
    raise exception 'invalid report' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_content) k
    where k not in ('schemaVersion', 'lessons', 'absentStudentIds')
  ) then
    raise exception 'invalid report' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_content -> 'lessons', '[]')) <> 'array'
     or jsonb_array_length(coalesce(p_content -> 'lessons', '[]')) > 40
     or jsonb_typeof(coalesce(p_content -> 'absentStudentIds', '[]')) <> 'array'
     or jsonb_array_length(coalesce(p_content -> 'absentStudentIds', '[]')) > 60 then
    raise exception 'invalid report' using errcode = '22023';
  end if;

  -- Each lesson once, with a known outcome, from a unit of a class the plan covers.
  for v_item in select e.value from jsonb_array_elements(coalesce(p_content -> 'lessons', '[]')) e loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'invalid report lesson' using errcode = '22023';
    end if;
    if exists (
        select 1 from jsonb_object_keys(v_item) k where k not in ('blockKey', 'lessonId', 'outcome')
      )
      or jsonb_typeof(v_item -> 'blockKey') is distinct from 'string'
      or jsonb_typeof(v_item -> 'lessonId') is distinct from 'string'
      or not pg_input_is_valid(v_item ->> 'blockKey', 'uuid')
      or not pg_input_is_valid(v_item ->> 'lessonId', 'uuid')
      or coalesce(v_item ->> 'outcome', '') not in ('done', 'partial', 'not_done')
    then
      raise exception 'invalid report lesson' using errcode = '22023';
    end if;
    v_id := (v_item ->> 'lessonId')::uuid;
    if v_id = any (v_seen) then
      raise exception 'a lesson is reported twice' using errcode = '22023';
    end if;
    v_seen := v_seen || v_id;
    if not exists (
      select 1
      from public.unit_lessons ul
      join public.units u on u.id = ul.unit_id
      join public.sub_plan_classes spc on spc.class_id = u.class_id
      where ul.id = v_id and spc.sub_plan_id = p_plan_id
    ) then
      raise exception 'a report can only name lessons of the classes it covers' using errcode = '22023';
    end if;
  end loop;

  -- Absent students: once each, active students of the covered classes.
  v_seen := '{}';
  for v_item in select e.value from jsonb_array_elements(coalesce(p_content -> 'absentStudentIds', '[]')) e loop
    if jsonb_typeof(v_item) is distinct from 'string' or not pg_input_is_valid(v_item #>> '{}', 'uuid') then
      raise exception 'invalid student id' using errcode = '22023';
    end if;
    v_id := (v_item #>> '{}')::uuid;
    if v_id = any (v_seen) then
      raise exception 'a student is listed twice' using errcode = '22023';
    end if;
    v_seen := v_seen || v_id;
    if not exists (
      select 1
      from public.students st
      join public.sub_plan_classes spc on spc.class_id = st.class_id
      where st.id = v_id and st.active and spc.sub_plan_id = p_plan_id
    ) then
      raise exception 'a report can only name students of the classes it covers' using errcode = '22023';
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 2. The substitute's report (portal role only)
-- ---------------------------------------------------------------------------------------

-- Saves the day's report for a session (p_submit false: a draft, autosaved during the day) or
-- sends it (p_submit true). Outcomes:
--   expired              no valid session (the web server forgets the cookie)
--   not_released         the plan is not released yet: there is nothing to report on
--   confirmed            the teacher already confirmed the report: nothing is written
--   locked_other_device  another device's session, still valid, started the report (a cut or
--                        expired session can be taken over)
--   already_submitted    a draft save of a report that was sent: nothing is written (sending
--                        again replaces it)
--   saved | submitted    written
-- A malformed report raises 22023. Sending replaces this report's pending progress rows with one
-- per lesson marked done (the teacher's own record wins), audits sub_report.submitted as the
-- substitute and emits the event.
create function sub_portal.save_report(
  p_token text,
  p_content jsonb,
  p_notes_ciphertext text,
  p_notes_key_version smallint,
  p_submit boolean
)
returns table (outcome text, status public.sub_report_status, updated_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_s record;
  v_plan public.sub_plans;
  v_abs public.absences;
  v_report public.sub_reports;
  v_submit boolean := coalesce(p_submit, false);
  v_was_submitted boolean;
  v_done integer;
begin
  select * into v_s from app.sub_session(p_token);
  if not found then
    return query select 'expired'::text, null::public.sub_report_status, null::timestamptz;
    return;
  end if;

  -- One writer at a time per plan (two tabs, or a save racing the teacher's confirmation). A
  -- no-key lock: codes and sessions that reference the plan are not held up.
  select * into v_plan from public.sub_plans where id = v_s.sub_plan_id for no key update;
  select * into v_abs from public.absences where id = v_s.absence_id;
  if not app.sub_plan_released(v_plan.status, v_plan.review_deadline) then
    return query select 'not_released'::text, null::public.sub_report_status, null::timestamptz;
    return;
  end if;

  select * into v_report from public.sub_reports r where r.sub_plan_id = v_plan.id for update;
  if v_report.id is not null then
    if v_report.status = 'confirmed' then
      return query select 'confirmed'::text, v_report.status, v_report.updated_at;
      return;
    end if;
    if v_report.session_id is not null and v_report.session_id <> v_s.session_id
      and exists (
        select 1
        from public.sub_sessions o
        join public.sub_access_codes oc on oc.id = o.access_code_id
        where o.id = v_report.session_id
          and o.revoked_at is null
          and oc.revoked_at is null
          and now() < least(o.expires_at, oc.expires_at)
      )
    then
      return query select 'locked_other_device'::text, v_report.status, v_report.updated_at;
      return;
    end if;
    if v_report.status = 'submitted' and not v_submit then
      return query select 'already_submitted'::text, v_report.status, v_report.updated_at;
      return;
    end if;
  end if;

  perform app.sub_report_check_content(v_plan.id, p_content);
  if p_notes_ciphertext is not null and (
    p_notes_ciphertext !~ '^v\d+\.'
    or char_length(p_notes_ciphertext) > 60000
    or p_notes_key_version is null
    or p_notes_key_version < 1
  ) then
    raise exception 'invalid notes' using errcode = '22023';
  end if;

  v_was_submitted := coalesce(v_report.status = 'submitted', false);
  insert into public.sub_reports as r (sub_plan_id, content, status, session_id, notes_ciphertext,
    notes_key_version)
  values (v_plan.id, p_content, 'draft', v_s.session_id, p_notes_ciphertext,
    case when p_notes_ciphertext is null then null else p_notes_key_version end)
  on conflict (sub_plan_id) do update
    set content = excluded.content,
        session_id = excluded.session_id,
        notes_ciphertext = excluded.notes_ciphertext,
        notes_key_version = excluded.notes_key_version
  returning * into v_report;

  -- The office board shows when the device was last active.
  update public.sub_sessions ss set last_seen_at = now()
  where ss.id = v_s.session_id
    and (ss.last_seen_at is null or ss.last_seen_at < now() - interval '1 minute');

  if not v_submit then
    return query select 'saved'::text, v_report.status, v_report.updated_at;
    return;
  end if;

  -- Sending (again): this report's pending rows are replaced by one per lesson marked done.
  delete from public.lesson_progress lp
  where lp.sub_report_id = v_report.id and lp.status = 'pending_confirmation';
  insert into public.lesson_progress (lesson_id, class_id, status, taught_on, source, sub_report_id)
  select ul.id, u.class_id, 'pending_confirmation', v_plan.plan_date, 'substitute_report', v_report.id
  from jsonb_array_elements(coalesce(p_content -> 'lessons', '[]')) l
  join public.unit_lessons ul on ul.id = (l ->> 'lessonId')::uuid
  join public.units u on u.id = ul.unit_id
  where l ->> 'outcome' = 'done'
  on conflict (lesson_id) do nothing;
  get diagnostics v_done = row_count;

  update public.sub_reports r
  set status = 'submitted', submitted_at = now()
  where r.id = v_report.id
  returning * into v_report;

  -- Later days of the teacher's absences are rebuilt from what really happened: a lesson
  -- reported not done comes back (D-047). The progress rows above do this for done lessons;
  -- this also covers a report where nothing was done.
  perform app.flag_absences(array[v_abs.teacher_id], null, null, null);

  perform app.log_audit('sub_report.submitted', v_s.board_id, v_s.school_id, 'sub_report',
    v_report.id,
    jsonb_build_object('sub_plan_id', v_plan.id, 'sub_session_id', v_s.session_id,
      'lessons', jsonb_array_length(coalesce(p_content -> 'lessons', '[]')), 'pending_rows', v_done,
      'resubmitted', v_was_submitted),
    'substitute');
  perform app.emit_event('sub_report.submitted', v_s.board_id, v_s.school_id, 'sub_report',
    v_report.id,
    jsonb_build_object('subReportId', v_report.id, 'subPlanId', v_plan.id,
      'absenceId', v_abs.id, 'planDate', v_plan.plan_date));
  return query select 'submitted'::text, v_report.status, v_report.updated_at;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 3. Reading reports. The owner reads hers through RLS (sub_reports_select: a draft only once
--    the day's access has ended). Direction reads through this function, audited on every view
--    (D-056); office staff see only the status on their board.
-- ---------------------------------------------------------------------------------------

-- Whether the plan date's access window is over, for the owner, direction and office (the
-- report pages: « Aucun suivi reçu » only once nobody can still be writing one). Instants are
-- computed here, in the school's time zone, never in the browser.
create function public.sub_plan_access_ended(p_plan_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if app.active_user_id() is null or app.sub_plan_role(p_plan_id) is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return app.sub_plan_window_ended(p_plan_id);
end;
$$;

-- A day's report for direction, read-only: {planId, absenceId, planDate, part, teacherName,
-- report, lessons, students}. `report` is null while there is none to read (none yet, or a
-- draft before the day's access ends); otherwise {reportId, status, submittedAt, updatedAt,
-- confirmedAt, confirmedByName, content, notesCiphertext, notesKeyVersion, notesPurgedAt}, and
-- the view is audited (sub_report.viewed). The web server decrypts the notes. `lessons` and
-- `students` name what the report refers to, read from tables (the lessons' titles; the absent
-- students' first names).
create function public.get_sub_report_for_staff(p_plan_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_plan public.sub_plans;
  v_abs public.absences;
  v_teacher public.users;
  v_report public.sub_reports;
  v_board_id uuid;
  v_confirmed_by text;
  v_lessons jsonb := '[]';
  v_students jsonb := '[]';
  v_out jsonb := null;
begin
  select * into v_plan from public.sub_plans where id = p_plan_id;
  select * into v_abs from public.absences where id = v_plan.absence_id;
  if app.active_user_id() is null or v_plan.id is null
     or not exists (select 1 from app.my_direction_school_ids() s where s = v_abs.school_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_teacher from public.users where id = v_abs.teacher_id;
  select * into v_report from public.sub_reports where sub_plan_id = p_plan_id;

  if v_report.id is not null
     and (v_report.status <> 'draft' or app.sub_plan_window_ended(p_plan_id)) then
    select app.formal_staff_name(u.display_name, u.honorific) into v_confirmed_by
    from public.users u where u.id = v_report.confirmed_by;

    select coalesce(jsonb_agg(jsonb_build_object('lessonId', ul.id, 'title', ul.title,
        'sequenceNumber', ul.sequence_number, 'unitTitle', u.title, 'classId', u.class_id,
        'className', c.name) order by l.ordinality), '[]'::jsonb)
    into v_lessons
    from jsonb_array_elements(coalesce(v_report.content -> 'lessons', '[]')) with ordinality l
    join public.unit_lessons ul on ul.id::text = l.value ->> 'lessonId'
    join public.units u on u.id = ul.unit_id
    join public.classes c on c.id = u.class_id;

    select coalesce(jsonb_agg(jsonb_build_object('id', st.id, 'classId', st.class_id,
        'firstName', st.first_name) order by st.first_name, st.id), '[]'::jsonb)
    into v_students
    from public.students st
    where st.id::text in (
      select jsonb_array_elements_text(coalesce(v_report.content -> 'absentStudentIds', '[]'))
    );

    v_out := jsonb_build_object(
      'reportId', v_report.id,
      'status', v_report.status,
      'submittedAt', v_report.submitted_at,
      'updatedAt', v_report.updated_at,
      'confirmedAt', v_report.confirmed_at,
      'confirmedByName', v_confirmed_by,
      'content', v_report.content,
      'notesCiphertext', v_report.notes_ciphertext,
      'notesKeyVersion', v_report.notes_key_version,
      'notesPurgedAt', v_report.notes_purged_at
    );
    select s.board_id into v_board_id from public.schools s where s.id = v_abs.school_id;
    perform app.log_audit('sub_report.viewed', v_board_id, v_abs.school_id, 'sub_report',
      v_report.id, jsonb_build_object('role', 'direction', 'sub_plan_id', p_plan_id));
  end if;

  return jsonb_build_object(
    'planId', v_plan.id,
    'absenceId', v_abs.id,
    'planDate', v_plan.plan_date,
    'part', v_abs.part,
    'teacherName', app.formal_staff_name(v_teacher.display_name, v_teacher.honorific),
    'report', v_out,
    'lessons', v_lessons,
    'students', v_students
  );
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 4. The teacher confirms (D-054): the one path from a report to completed lessons. Aujourd'hui
--    links here; it never checks off a lesson that is pending confirmation.
-- ---------------------------------------------------------------------------------------

-- « Confirmer le suivi ». p_decisions = [{lessonId, decision: 'completed' | 'not_completed' |
-- 'skipped'}], each lesson named by the report or pending from it, in a class the teacher
-- teaches. completed and skipped confirm the pending row (the source stays substitute_report,
-- so lesson.completed says where it came from) or add one on the plan date if the substitute
-- did not mark it done (never over another record); not_completed removes the pending row so
-- the lesson is next again. Pending rows not mentioned are confirmed as completed. The report
-- must have been sent, or be a draft whose day is over. Confirming again does nothing.
create function public.confirm_sub_report(p_report_id uuid, p_decisions jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.active_user_id();
  v_report public.sub_reports;
  v_plan public.sub_plans;
  v_abs public.absences;
  v_board_id uuid;
  v_item jsonb;
  v_lesson uuid;
  v_decision public.lesson_progress_status;
  v_class uuid;
  v_seen uuid[] := '{}';
  v_completed integer := 0;
  v_not_completed integer := 0;
  v_skipped integer := 0;
  v_rest integer;
begin
  select * into v_report from public.sub_reports where id = p_report_id for update;
  select * into v_plan from public.sub_plans where id = v_report.sub_plan_id;
  select * into v_abs from public.absences where id = v_plan.absence_id;
  if v_user is null or v_report.id is null or v_abs.teacher_id is distinct from v_user then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_report.status = 'confirmed' then
    return;   -- a retried tap
  end if;
  if v_report.status = 'draft' and not app.sub_plan_window_ended(v_plan.id) then
    raise exception 'the report is still being written' using errcode = '22023';
  end if;
  if p_decisions is null or jsonb_typeof(p_decisions) <> 'array'
     or jsonb_array_length(p_decisions) > 40 then
    raise exception 'invalid decisions' using errcode = '22023';
  end if;

  for v_item in select e.value from jsonb_array_elements(p_decisions) e loop
    if jsonb_typeof(v_item) <> 'object'
       or jsonb_typeof(v_item -> 'lessonId') is distinct from 'string'
       or not pg_input_is_valid(v_item ->> 'lessonId', 'uuid')
       or coalesce(v_item ->> 'decision', '') not in ('completed', 'not_completed', 'skipped') then
      raise exception 'invalid decision' using errcode = '22023';
    end if;
    v_lesson := (v_item ->> 'lessonId')::uuid;
    if v_lesson = any (v_seen) then
      raise exception 'a lesson is decided twice' using errcode = '22023';
    end if;
    v_seen := v_seen || v_lesson;
    if not (
      exists (
        select 1 from jsonb_array_elements(coalesce(v_report.content -> 'lessons', '[]')) l
        where l.value ->> 'lessonId' = v_lesson::text
      )
      or exists (
        select 1 from public.lesson_progress lp
        where lp.lesson_id = v_lesson and lp.sub_report_id = p_report_id
          and lp.status = 'pending_confirmation'
      )
    ) then
      raise exception 'the lesson is not in this report' using errcode = '22023';
    end if;
    select u.class_id into v_class
    from public.unit_lessons ul join public.units u on u.id = ul.unit_id
    where ul.id = v_lesson;
    if v_class is null then
      raise exception 'the lesson no longer exists' using errcode = '22023';
    end if;
    if not app.is_class_teacher(v_class) then
      raise exception 'not allowed' using errcode = '42501';
    end if;

    if v_item ->> 'decision' = 'not_completed' then
      delete from public.lesson_progress lp
      where lp.lesson_id = v_lesson and lp.sub_report_id = p_report_id
        and lp.status = 'pending_confirmation';
      v_not_completed := v_not_completed + 1;
    else
      v_decision := (v_item ->> 'decision')::public.lesson_progress_status;
      update public.lesson_progress lp
      set status = v_decision, completed_by = v_user, completed_at = now()
      where lp.lesson_id = v_lesson and lp.sub_report_id = p_report_id
        and lp.status = 'pending_confirmation';
      if not found then
        insert into public.lesson_progress (lesson_id, class_id, status, taught_on, source,
          sub_report_id, completed_by)
        values (v_lesson, v_class, v_decision, v_plan.plan_date, 'substitute_report', p_report_id,
          v_user)
        on conflict (lesson_id) do nothing;
      end if;
      if v_decision = 'completed' then
        v_completed := v_completed + 1;
      else
        v_skipped := v_skipped + 1;
      end if;
    end if;
  end loop;

  -- What the substitute marked done and the teacher did not mention is confirmed as done.
  update public.lesson_progress lp
  set status = 'completed', completed_by = v_user, completed_at = now()
  where lp.sub_report_id = p_report_id and lp.status = 'pending_confirmation'
    and lp.lesson_id <> all (v_seen);
  get diagnostics v_rest = row_count;
  v_completed := v_completed + v_rest;

  -- A draft confirmed after the day counts as handed in when it was last saved.
  update public.sub_reports
  set status = 'confirmed',
      confirmed_by = v_user,
      confirmed_at = now(),
      submitted_at = coalesce(submitted_at, updated_at)
  where id = p_report_id;

  select s.board_id into v_board_id from public.schools s where s.id = v_abs.school_id;
  perform app.log_audit('sub_report.confirmed', v_board_id, v_abs.school_id, 'sub_report',
    p_report_id,
    jsonb_build_object('sub_plan_id', v_plan.id, 'completed', v_completed,
      'not_completed', v_not_completed, 'skipped', v_skipped,
      'was_draft', v_report.status = 'draft'));
  perform app.emit_event('sub_report.confirmed', v_board_id, v_abs.school_id, 'sub_report',
    p_report_id,
    jsonb_build_object('subReportId', p_report_id, 'subPlanId', v_plan.id, 'absenceId', v_abs.id,
      'planDate', v_plan.plan_date));
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 5. Permissions: the portal role gets its fifth function; staff get reading and confirming.
-- ---------------------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon;
revoke execute on all functions in schema sub_portal from public, anon, authenticated, service_role;

grant execute on function
  sub_portal.save_report(text, jsonb, text, smallint, boolean)
to lynx_sub_portal;

grant execute on function
  public.sub_plan_access_ended(uuid),
  public.get_sub_report_for_staff(uuid),
  public.confirm_sub_report(uuid, jsonb)
to authenticated;
