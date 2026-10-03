-- Phase 3 (substitute hand-off): helpers, plan sources, writing plans, absences, staff functions.
--
-- Plans are built by the web server (as the teacher, in the publish request) and by the worker
-- (when their sources change), with the same pure builder (packages/domain) and the same loader
-- (app.sub_plan_sources). Everything that grants access is derived here, never read from plan
-- JSON: the covered classes, the roster, the school details and the teacher's name (D-048).
-- A plan counts as released when it was released by hand or its review deadline has passed; no
-- job runs at 07:30 (D-047).
--
-- Error codes the app translates: LXS10 plan edited elsewhere, LXS12 plan in use (a substitute
-- session or report exists), LXS14 the day is over, LXS20 absence in the past, LXS21 absence too
-- long, LXS22 overlapping absence.
-- DECISIONS: D-047, D-048, D-051, D-054, D-055, D-056, D-057, D-059, D-060.
-- Tests: supabase/tests/10_substitute_plans.test.sql

-- ---------------------------------------------------------------------------------------
-- 1. Helpers
-- ---------------------------------------------------------------------------------------

-- The school's local date (D-009).
create function app.school_local_today(p_school_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone s.timezone)::date from public.schools s where s.id = p_school_id;
$$;

-- A school-local 'HH:MM' setting, or the default when it is missing or invalid (the app's
-- settings schemas fall back the same way).
create function app.setting_time(p_value text, p_default time)
returns time
language sql
immutable
set search_path = ''
as $$
  select case when p_value ~ '^([01]\d|2[0-3]):[0-5]\d$' then p_value::time else p_default end;
$$;

-- A substitute code's window on a plan date, from schools.settings.substitute (default
-- 05:00-18:00 local time). Instants are computed in the school's time zone, so they are right
-- across DST changes. An inverted setting falls back to the defaults (D-050).
create function app.sub_access_window(
  p_school_id uuid,
  p_date date,
  out valid_from timestamptz,
  out expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with t as (
    select
      s.timezone,
      app.setting_time(s.settings #>> '{substitute,accessFrom}', '05:00') as f,
      app.setting_time(s.settings #>> '{substitute,accessUntil}', '18:00') as u
    from public.schools s
    where s.id = p_school_id
  )
  select
    (p_date + case when u > f then f else '05:00'::time end) at time zone timezone,
    (p_date + case when u > f then u else '18:00'::time end) at time zone timezone
  from t;
$$;

-- When an unreviewed plan is released: the board's subPlanAutoReleaseTime (default 07:30) on the
-- plan date, in the school's time zone, or now if that time has passed.
create function app.sub_plan_review_deadline(p_school_id uuid, p_date date)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    now(),
    (p_date + app.setting_time(b.settings ->> 'subPlanAutoReleaseTime', '07:30')) at time zone s.timezone
  )
  from public.schools s
  join public.boards b on b.id = s.board_id
  where s.id = p_school_id;
$$;

-- Released by hand, or ready and past its review deadline. Nothing is written at release time.
create function app.sub_plan_released(p_status public.sub_plan_status, p_review_deadline timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_status = 'released' or (p_status = 'ready' and p_review_deadline <= now());
$$;

-- Whether a plan may still be rebuilt: the absence is published, no substitute has signed in,
-- and the plan date is in the future, or it is today and the plan is not released yet. After
-- that the plan is a fixed snapshot (D-047).
create function app.sub_plan_refreshable(p_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select a.status = 'published'
      and not exists (select 1 from public.sub_sessions ss where ss.sub_plan_id = p.id)
      and (
        p.plan_date > t.today
        or (p.plan_date = t.today and p.status = 'ready' and p.review_deadline > now())
      )
    from public.sub_plans p
    join public.absences a on a.id = p.absence_id
    cross join lateral (select app.school_local_today(a.school_id) as today) t
    where p.id = p_plan_id
  ), false);
$$;

-- Whether the plan date's code window is over. Used by the report policy: the teacher sees a
-- report the substitute never sent once the day's access has ended (D-054).
create function app.sub_plan_window_ended(p_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select now() >= w.expires_at
    from public.sub_plans p
    join public.absences a on a.id = p.absence_id
    cross join lateral app.sub_access_window(a.school_id, p.plan_date) w
    where p.id = p_plan_id
  ), false);
$$;

-- The current user's relation to a plan: 'owner' (the absent teacher), 'direction', 'office',
-- or null.
create function app.sub_plan_role(p_plan_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when a.teacher_id = (select app.active_user_id()) then 'owner'
    when a.school_id in (select app.my_direction_school_ids()) then 'direction'
    when a.school_id in (select app.my_school_ids(array['office_admin']::public.app_role[])) then 'office'
  end
  from public.sub_plans p
  join public.absences a on a.id = p.absence_id
  where p.id = p_plan_id;
$$;

-- app.my_class_ids() for a given user: the classes she teaches at a school where she holds a
-- teacher role and is not deactivated.
create function app.teacher_class_ids(p_user_id uuid, p_school_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select ct.class_id
  from public.class_teachers ct
  join public.classes c on c.id = ct.class_id
  join public.users u on u.id = ct.user_id
  where ct.user_id = p_user_id
    and c.school_id = p_school_id
    and u.deactivated_at is null
    and exists (
      select 1 from public.user_roles ur
      where ur.user_id = p_user_id and ur.school_id = p_school_id and ur.role = 'teacher'
    );
$$;

-- Licensing check for functions without a web page in front of them (the substitute portal,
-- publishing). Same rule as the web session: enabled and valid on the school's local date (D-060).
create function app.school_has_module(p_school_id uuid, p_module public.module_key)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.module_entitlements m
    join public.schools s on s.id = m.school_id
    cross join lateral (select (now() at time zone s.timezone)::date as today) t
    where m.school_id = p_school_id
      and m.module = p_module
      and m.enabled
      and m.valid_from <= t.today
      and (m.valid_until is null or m.valid_until >= t.today)
  );
$$;

-- app.is_teacher_at_class_school() that also refuses deactivated users. (The original is left as
-- it is: the class-team policy uses it.)
create function app.is_active_teacher_at_class_school(p_user_id uuid, p_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.classes c
    join public.user_roles ur on ur.school_id = c.school_id and ur.role = 'teacher'
    join public.users u on u.id = ur.user_id
    where c.id = p_class_id and ur.user_id = p_user_id and u.deactivated_at is null
  );
$$;

-- « Mme Tremblay »: the honorific and the last word of the display name, else the display name.
-- Same rule as formalStaffName() in packages/domain.
create function app.formal_staff_name(p_display_name text, p_honorific text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when nullif(btrim(p_honorific), '') is null then p_display_name
    else btrim(p_honorific) || ' ' || split_part(btrim(p_display_name), ' ', -1)
  end;
$$;

-- ---------------------------------------------------------------------------------------
-- 2. Reports: the owner only, and a draft only once the day's access has ended (D-054).
--    Direction reads reports through an audited function (next migrations); office never.
-- ---------------------------------------------------------------------------------------

create policy sub_reports_select on public.sub_reports
  for select to authenticated
  using (
    sub_plan_id in (select p.id from public.sub_plans p)   -- owner only (sub_plans_select)
    and (status <> 'draft' or app.sub_plan_window_ended(sub_plan_id))
  );

-- ---------------------------------------------------------------------------------------
-- 3. « Fiche de suppléance »: stamp the editor; the neighbouring colleague must be an active
--    teacher at the class's school (D-057).
-- ---------------------------------------------------------------------------------------

create function app.class_sub_profiles_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_by := coalesce(app.active_user_id(), new.updated_by);
  if new.neighbour_teacher_id is not null
    and (tg_op = 'INSERT' or new.neighbour_teacher_id is distinct from old.neighbour_teacher_id)
    and not app.is_active_teacher_at_class_school(new.neighbour_teacher_id, new.class_id)
  then
    raise exception 'the neighbouring colleague must be an active teacher at this school'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger class_sub_profiles_before_write before insert or update on public.class_sub_profiles
  for each row execute function app.class_sub_profiles_before_write();

-- ---------------------------------------------------------------------------------------
-- 4. Deleting a class deletes every plan that covers it, with its codes, sessions and report,
--    and the report's pending progress in the plan's other classes (D-059). A BEFORE trigger:
--    sub_plan_classes rows are gone once the class is.
-- ---------------------------------------------------------------------------------------

create function app.classes_before_delete_sub_plans()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select p.id, p.absence_id, p.plan_date, a.school_id, s.board_id
    from public.sub_plan_classes spc
    join public.sub_plans p on p.id = spc.sub_plan_id
    join public.absences a on a.id = p.absence_id
    join public.schools s on s.id = a.school_id
    where spc.class_id = old.id
  loop
    delete from public.lesson_progress lp
    using public.sub_reports sr
    where sr.sub_plan_id = r.id
      and lp.sub_report_id = sr.id
      and lp.status = 'pending_confirmation';
    perform app.log_audit('sub_plan.deleted', r.board_id, r.school_id, 'sub_plan', r.id,
      jsonb_build_object('reason', 'class_deleted', 'class_id', old.id,
        'absence_id', r.absence_id, 'plan_date', r.plan_date));
    delete from public.sub_plans where id = r.id;   -- cascades to codes, sessions, report
  end loop;
  return old;
end;
$$;

create trigger classes_before_delete_sub_plans before delete on public.classes
  for each row execute function app.classes_before_delete_sub_plans();

-- ---------------------------------------------------------------------------------------
-- 5. Keeping plans fresh (D-047). A change to anything a plan is built from marks the upcoming
--    published absences it may affect (absences.sources_changed_at) and wakes the worker
--    (absence.sources_changed) the first time. A later change while the mark is set moves it
--    without a new event, so the worker's compare-and-set (app.write_absence_plans) notices that
--    its sources were read too early and builds again.
-- ---------------------------------------------------------------------------------------

create function app.flag_absences(p_teacher_ids uuid[], p_school_ids uuid[], p_from date, p_to date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select a.id, a.school_id, s.board_id, a.sources_changed_at is null as was_clear
    from public.absences a
    join public.schools s on s.id = a.school_id
    where a.status = 'published'
      -- Once per transaction: a bulk change (roster import) touches the row once.
      and a.sources_changed_at is distinct from now()
      and a.ends_on >= (now() at time zone s.timezone)::date
      and (p_from is null or a.ends_on >= p_from)
      -- In a rotating-day school a day off before the absence shifts its « Jour » numbers.
      and (p_to is null or a.starts_on <= p_to or s.schedule_type = 'cycle')
      and (
        a.teacher_id = any (coalesce(p_teacher_ids, '{}'))
        or a.school_id = any (coalesce(p_school_ids, '{}'))
      )
    order by a.id   -- a fixed lock order
    for update of a
  loop
    update public.absences set sources_changed_at = now() where id = r.id;
    if r.was_clear then
      perform app.emit_event('absence.sources_changed', r.board_id, r.school_id, 'absence', r.id,
        jsonb_build_object('absenceId', r.id));
    end if;
  end loop;
end;
$$;

-- Absences of the teachers of a class.
create function app.flag_class_absences(p_class_id uuid, p_from date default null, p_to date default null)
returns void
language sql
security definer
set search_path = ''
as $$
  select app.flag_absences(
    array(select ct.user_id from public.class_teachers ct where ct.class_id = p_class_id),
    null, p_from, p_to
  );
$$;

-- Rows that belong to a class: lesson_progress, units, timetable_blocks, students,
-- class_sub_profiles.
create function app.class_row_flag_absences()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform app.flag_class_absences(new.class_id);
  end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.class_id is distinct from new.class_id) then
    perform app.flag_class_absences(old.class_id);
  end if;
  return null;
end;
$$;

create trigger lesson_progress_flag_absences after insert or update or delete on public.lesson_progress
  for each row execute function app.class_row_flag_absences();
create trigger units_flag_absences after insert or update or delete on public.units
  for each row execute function app.class_row_flag_absences();
create trigger timetable_blocks_flag_absences after insert or update or delete on public.timetable_blocks
  for each row execute function app.class_row_flag_absences();
-- Plans never contain names, so renaming a student changes nothing.
create trigger students_flag_absences
  after insert or delete or update of class_id, default_language_level_id, active on public.students
  for each row execute function app.class_row_flag_absences();
create trigger class_sub_profiles_flag_absences after insert or update or delete on public.class_sub_profiles
  for each row execute function app.class_row_flag_absences();

create function app.unit_lessons_flag_absences()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.unit_lessons := case when tg_op = 'DELETE' then old else new end;
  v_class_id uuid;
begin
  select u.class_id into v_class_id from public.units u where u.id = v_row.unit_id;
  if v_class_id is not null then   -- null: the unit is being deleted
    perform app.flag_class_absences(v_class_id);
  end if;
  return null;
end;
$$;

create trigger unit_lessons_flag_absences after insert or update or delete on public.unit_lessons
  for each row execute function app.unit_lessons_flag_absences();

-- Who teaches a class decides which classes and blocks a plan covers.
create function app.class_teachers_flag_absences()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.class_teachers := case when tg_op = 'DELETE' then old else new end;
begin
  perform app.flag_absences(
    array(select ct.user_id from public.class_teachers ct where ct.class_id = v_row.class_id)
      || v_row.user_id,
    null, null, null
  );
  return null;
end;
$$;

create trigger class_teachers_flag_absences after insert or update or delete on public.class_teachers
  for each row execute function app.class_teachers_flag_absences();

-- The class name and room are copied into plans.
create function app.classes_flag_absences()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.flag_class_absences(new.id);
  return null;
end;
$$;

create trigger classes_flag_absences after update of name, room_id on public.classes
  for each row
  when (old.name is distinct from new.name or old.room_id is distinct from new.room_id)
  execute function app.classes_flag_absences();

-- Calendar events: a class's event flags its teachers, a school's event that school, a board's
-- event every school of the board, for the dates it covers (old and new dates on update).
create function app.flag_event_absences(
  p_board_id uuid, p_school_id uuid, p_class_id uuid, p_from date, p_to date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_class_id is not null then
    perform app.flag_class_absences(p_class_id, p_from, p_to);
  elsif p_school_id is not null then
    perform app.flag_absences(null, array[p_school_id], p_from, p_to);
  else
    perform app.flag_absences(
      null, array(select s.id from public.schools s where s.board_id = p_board_id), p_from, p_to);
  end if;
end;
$$;

create function app.school_calendar_events_flag_absences()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform app.flag_event_absences(old.board_id, old.school_id, old.class_id, old.starts_on, old.ends_on);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform app.flag_event_absences(new.board_id, new.school_id, new.class_id, new.starts_on, new.ends_on);
  end if;
  return null;
end;
$$;

create trigger school_calendar_events_flag_absences
  after insert or update or delete on public.school_calendar_events
  for each row execute function app.school_calendar_events_flag_absences();

create function app.school_cycle_anchors_flag_absences()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.school_cycle_anchors := case when tg_op = 'DELETE' then old else new end;
begin
  perform app.flag_absences(null, array[v_row.school_id], null, null);
  return null;
end;
$$;

create trigger school_cycle_anchors_flag_absences
  after insert or update or delete on public.school_cycle_anchors
  for each row execute function app.school_cycle_anchors_flag_absences();

create function app.schools_flag_absences()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.flag_absences(null, array[new.id], null, null);
  return null;
end;
$$;

create trigger schools_flag_absences
  after update of settings, timezone, schedule_type, cycle_length on public.schools
  for each row
  when (
    old.settings is distinct from new.settings
    or old.timezone is distinct from new.timezone
    or old.schedule_type is distinct from new.schedule_type
    or old.cycle_length is distinct from new.cycle_length
  )
  execute function app.schools_flag_absences();

-- ---------------------------------------------------------------------------------------
-- 6. Plan sources: everything the builder needs, for one teacher at one school, as JSON with
--    camelCase keys and 'HH:MM' times. The only loader: the web server calls it through
--    get_sub_plan_sources (as the teacher), the worker directly. It returns only what the
--    teacher can already read, and never a student's name.
-- ---------------------------------------------------------------------------------------

create function app.sub_plan_sources(
  p_teacher_id uuid,
  p_school_id uuid,
  p_from date,
  p_to date,
  p_absence_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_board_id uuid;
  v_class_ids uuid[];
  v_events_from date;
  v_student_level_ids uuid[];
  v_result jsonb;
begin
  select s.board_id into v_board_id from public.schools s where s.id = p_school_id;
  v_class_ids := array(select app.teacher_class_ids(p_teacher_id, p_school_id));
  -- A rotating-day school counts school days from its latest anchor.
  select coalesce(max(an.anchor_date), p_from) into v_events_from
  from public.school_cycle_anchors an
  where an.school_id = p_school_id and an.anchor_date <= p_from;
  v_student_level_ids := array(
    select distinct st.default_language_level_id from public.students st
    where st.class_id = any (v_class_ids) and st.default_language_level_id is not null
  );

  select jsonb_build_object(
    'today', app.school_local_today(p_school_id),
    'teacher', (
      select jsonb_build_object('id', u.id, 'displayName', u.display_name, 'honorific', u.honorific)
      from public.users u where u.id = p_teacher_id
    ),
    'school', (
      select jsonb_build_object('id', s.id, 'boardId', s.board_id, 'timezone', s.timezone,
        'scheduleType', s.schedule_type, 'cycleLength', s.cycle_length, 'settings', s.settings)
      from public.schools s where s.id = p_school_id
    ),
    'classes', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', c.id, 'name', c.name, 'roomId', c.room_id, 'role', ct.role,
          'grades', coalesce((
            select jsonb_agg(jsonb_build_object('code', g.code, 'ordinal', g.ordinal, 'labelFr', g.label_fr)
              order by g.ordinal)
            from public.class_grades cg join public.grades g on g.code = cg.grade_code
            where cg.class_id = c.id
          ), '[]'::jsonb)
        ) order by c.name, c.id)
      from public.classes c
      join public.class_teachers ct on ct.class_id = c.id and ct.user_id = p_teacher_id
      where c.id = any (v_class_ids)
    ), '[]'::jsonb),
    'team', coalesce((
      select jsonb_agg(jsonb_build_object('classId', ct.class_id, 'userId', u.id,
          'displayName', u.display_name, 'honorific', u.honorific, 'role', ct.role)
        order by ct.class_id, ct.role, u.display_name)
      from public.class_teachers ct
      join public.users u on u.id = ct.user_id
      where ct.class_id = any (v_class_ids) and u.deactivated_at is null
    ), '[]'::jsonb),
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'classId', b.class_id, 'dayKey', b.day_key,
          'startTime', to_char(b.start_time, 'HH24:MI'), 'endTime', to_char(b.end_time, 'HH24:MI'),
          'kind', b.kind, 'subjectId', b.subject_id, 'title', b.title, 'teacherId', b.teacher_id,
          'roomId', b.room_id, 'notes', b.notes)
        order by b.class_id, b.day_key, b.start_time, b.id)
      from public.timetable_blocks b
      where b.class_id = any (v_class_ids)
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'eventType', e.event_type, 'title', e.title,
          'notes', e.notes, 'startsOn', e.starts_on, 'endsOn', e.ends_on,
          'startTime', to_char(e.start_time, 'HH24:MI'), 'endTime', to_char(e.end_time, 'HH24:MI'),
          'affectsSchedule', e.affects_schedule, 'classId', e.class_id)
        order by e.starts_on, e.start_time nulls first, e.id)
      from public.school_calendar_events e
      where (
          (e.school_id is null and e.board_id = v_board_id)
          or (e.school_id = p_school_id and (e.class_id is null or e.class_id = any (v_class_ids)))
        )
        and e.starts_on <= p_to
        and e.ends_on >= v_events_from
    ), '[]'::jsonb),
    'anchors', coalesce((
      select jsonb_agg(jsonb_build_object('anchorDate', an.anchor_date, 'cycleDay', an.cycle_day)
        order by an.anchor_date)
      from public.school_cycle_anchors an
      where an.school_id = p_school_id
    ), '[]'::jsonb),
    'rooms', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name) order by r.name)
      from public.rooms r where r.school_id = p_school_id
    ), '[]'::jsonb),
    'subjects', coalesce((
      select jsonb_agg(jsonb_build_object('id', sub.id, 'labelFr', sub.label_fr)
        order by sub.sort_order, sub.label_fr)
      from public.subjects sub
      where sub.board_id is null or sub.board_id = v_board_id
    ), '[]'::jsonb),
    'units', coalesce((
      select jsonb_agg(jsonb_build_object('id', un.id, 'classId', un.class_id,
          'subjectId', un.subject_id, 'title', un.title,
          'lessons', coalesce((
            select jsonb_agg(jsonb_build_object('id', l.id, 'sequenceNumber', l.sequence_number,
                'title', l.title, 'objectives', l.objectives, 'materials', l.materials,
                'content', l.content, 'subNotes', l.sub_notes, 'durationMinutes', l.duration_minutes)
              order by l.sequence_number)
            from public.unit_lessons l where l.unit_id = un.id
          ), '[]'::jsonb))
        order by un.class_id, un.subject_id, un.id)
      from public.units un
      where un.class_id = any (v_class_ids) and un.status = 'active'
    ), '[]'::jsonb),
    'progress', coalesce((
      select jsonb_agg(jsonb_build_object('lessonId', lp.lesson_id, 'status', lp.status,
          'taughtOn', lp.taught_on)
        order by lp.lesson_id)
      from public.lesson_progress lp
      where lp.class_id = any (v_class_ids)
    ), '[]'::jsonb),
    -- No names: the builder works with ids; names are added when a plan is displayed.
    'students', coalesce((
      select jsonb_agg(jsonb_build_object('id', st.id, 'classId', st.class_id,
          'levelId', st.default_language_level_id, 'active', st.active)
        order by st.class_id, st.id)
      from public.students st
      where st.class_id = any (v_class_ids)
    ), '[]'::jsonb),
    'levels', coalesce((
      select jsonb_agg(jsonb_build_object('id', ll.id, 'labelFr', ll.label_fr, 'labelEn', ll.label_en,
          'descriptionFr', ll.description_fr, 'sortOrder', ll.sort_order)
        order by ll.sort_order, ll.label_fr, ll.id)
      from public.language_levels ll
      where (
          ll.board_id = v_board_id and ll.active
          and (ll.owner_user_id is null or ll.owner_user_id = p_teacher_id)
        )
        or ll.id = any (v_student_level_ids)
    ), '[]'::jsonb),
    'profiles', coalesce((
      select jsonb_agg(jsonb_build_object('classId', sp.class_id,
          'arrivalNotes', sp.arrival_notes, 'routinesNotes', sp.routines_notes,
          'classroomManagementNotes', sp.classroom_management_notes,
          'dismissalNotes', sp.dismissal_notes, 'fallbackActivities', sp.fallback_activities,
          'neighbourNote', sp.neighbour_note,
          'neighbour', (
            select jsonb_build_object('displayName', nu.display_name, 'honorific', nu.honorific)
            from public.users nu
            where nu.id = sp.neighbour_teacher_id
              and app.is_active_teacher_at_class_school(nu.id, sp.class_id)
          ))
        order by sp.class_id)
      from public.class_sub_profiles sp
      where sp.class_id = any (v_class_ids)
    ), '[]'::jsonb),
    'catholicReferences', coalesce((
      select jsonb_agg(jsonb_build_object('id', cr.id, 'boardId', cr.board_id, 'type', cr.type,
          'title', cr.title, 'textFr', cr.text_fr, 'gradeMin', cr.grade_min, 'gradeMax', cr.grade_max,
          'liturgicalSeason', cr.liturgical_season, 'tags', to_jsonb(cr.tags))
        order by cr.id)
      from public.catholic_references cr
      where cr.active and (cr.board_id is null or cr.board_id = v_board_id)
    ), '[]'::jsonb),
    -- The absence's other days, so a rebuild continues from days that are already fixed.
    'siblings', case when p_absence_id is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
          'planDate', p.plan_date,
          'refreshable', app.sub_plan_refreshable(p.id),
          'hasSession', exists (select 1 from public.sub_sessions ss where ss.sub_plan_id = p.id),
          'reportStatus', coalesce(
            (select sr.status::text from public.sub_reports sr where sr.sub_plan_id = p.id), 'none'),
          'assignedLessonIds', jsonb_path_query_array(
            p.plan, '$.blocks[*].lesson ? (@.assignment == "assigned").lessonId'))
        order by p.plan_date)
      from public.sub_plans p
      where p.absence_id = p_absence_id
    ), '[]'::jsonb) end
  ) into v_result;
  return v_result;
end;
$$;

-- The plan sources for the signed-in teacher, for a preview or a publish (at most 14 days).
create function public.get_sub_plan_sources(
  p_school_id uuid,
  p_from date,
  p_to date,
  p_absence_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.active_user_id();
begin
  if v_user is null or p_school_id is null
     or not exists (select 1 from app.my_school_ids(array['teacher']::public.app_role[]) s where s = p_school_id)
     or not app.school_has_module(p_school_id, 'teaching') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_absence_id is not null and not exists (
    select 1 from public.absences a
    where a.id = p_absence_id and a.teacher_id = v_user and a.school_id = p_school_id
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 13 then
    raise exception 'invalid date range' using errcode = '22023';
  end if;
  return app.sub_plan_sources(v_user, p_school_id, p_from, p_to, p_absence_id);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 7. Writing plans: the one writer used by publish, update, refresh and the worker.
--    `p_plans` is [{"date": "YYYY-MM-DD", "classIds": [uuid], "plan": {...}}] as built by
--    buildAbsencePlans(). The plan JSON is display text; the covered classes are checked against
--    the teacher's own classes and stored in sub_plan_classes (D-048). Dates outside the absence
--    or in the past are skipped; plans that can no longer change are left as they are.
--    With p_check_flag, nothing is written unless sources_changed_at still equals p_seen_flag
--    (the worker then reads its sources again). The comparison is exact to the microsecond, so
--    the caller reads the mark as text (a JS Date drops microseconds). Returns whether it wrote.
-- ---------------------------------------------------------------------------------------

create function app.write_absence_plans(
  p_absence_id uuid,
  p_plans jsonb,
  p_seen_flag timestamptz default null,
  p_check_flag boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_abs public.absences;
  v_board_id uuid;
  v_today date;
  v_allowed uuid[];
  v_item jsonb;
  v_date date;
  v_dates date[] := '{}';
  v_class_ids uuid[];
  v_plan_id uuid;
begin
  select * into v_abs from public.absences where id = p_absence_id for update;
  if v_abs.id is null then
    raise exception 'absence not found' using errcode = 'P0002';
  end if;
  if v_abs.status <> 'published'
     or (p_check_flag and v_abs.sources_changed_at is distinct from p_seen_flag) then
    return false;
  end if;

  -- Check every item first: anything malformed refuses the whole call.
  if p_plans is null or jsonb_typeof(p_plans) <> 'array' or jsonb_array_length(p_plans) > 14 then
    raise exception 'invalid plans' using errcode = '22023';
  end if;
  v_allowed := array(select app.teacher_class_ids(v_abs.teacher_id, v_abs.school_id));
  for v_item in select e.value from jsonb_array_elements(p_plans) e loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or jsonb_typeof(v_item -> 'date') is distinct from 'string'
       or jsonb_typeof(v_item -> 'plan') is distinct from 'object'
       or jsonb_typeof(v_item -> 'classIds') is distinct from 'array' then
      raise exception 'invalid plan' using errcode = '22023';
    end if;
    if (v_item ->> 'date') !~ '^\d{4}-\d{2}-\d{2}$'
       or not pg_input_is_valid(v_item ->> 'date', 'date')
       or (v_item -> 'plan' ->> 'schemaVersion') is distinct from '1'
       or (v_item -> 'plan' ->> 'date') is distinct from (v_item ->> 'date')
       or pg_column_size(v_item -> 'plan') > 262144
       or jsonb_array_length(v_item -> 'classIds') > 12 then
      raise exception 'invalid plan' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_item -> 'classIds') c
      where jsonb_typeof(c) <> 'string' or not pg_input_is_valid(c #>> '{}', 'uuid')
    ) then
      raise exception 'invalid class id' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements_text(v_item -> 'classIds') c
      where c::uuid <> all (v_allowed)
    ) then
      raise exception 'a plan can only cover the teacher''s own classes' using errcode = '22023';
    end if;
  end loop;

  select s.board_id into v_board_id from public.schools s where s.id = v_abs.school_id;
  v_today := app.school_local_today(v_abs.school_id);

  for v_item in select e.value from jsonb_array_elements(p_plans) e loop
    v_date := (v_item ->> 'date')::date;
    if v_date < v_abs.starts_on or v_date > v_abs.ends_on or v_date < v_today
       or v_date = any (v_dates) then
      continue;
    end if;
    v_dates := v_dates || v_date;
    v_class_ids := array(select distinct c::uuid from jsonb_array_elements_text(v_item -> 'classIds') c);

    -- Locking the row also waits for a substitute signing in at this moment (the session's
    -- foreign key), so a plan in use is never rewritten.
    select p.id into v_plan_id from public.sub_plans p
    where p.absence_id = p_absence_id and p.plan_date = v_date
    for update;

    if v_plan_id is null then
      insert into public.sub_plans (absence_id, plan_date, plan, status, review_deadline)
      values (p_absence_id, v_date, v_item -> 'plan', 'ready',
        app.sub_plan_review_deadline(v_abs.school_id, v_date))
      returning id into v_plan_id;
      insert into public.sub_plan_classes (sub_plan_id, class_id)
      select v_plan_id, c from unnest(v_class_ids) c;
      perform app.emit_event('sub_plan.ready', v_board_id, v_abs.school_id, 'sub_plan', v_plan_id,
        jsonb_build_object('subPlanId', v_plan_id, 'absenceId', p_absence_id, 'planDate', v_date));
    elsif app.sub_plan_refreshable(v_plan_id) then
      update public.sub_plans p
      set plan = v_item -> 'plan',
          generated_at = now(),
          content_version = p.content_version + 1,
          review_deadline = case when p.status = 'ready'
            then app.sub_plan_review_deadline(v_abs.school_id, v_date) else p.review_deadline end
      where p.id = v_plan_id;
      delete from public.sub_plan_classes
      where sub_plan_id = v_plan_id and class_id <> all (v_class_ids);
      insert into public.sub_plan_classes (sub_plan_id, class_id)
      select v_plan_id, c from unnest(v_class_ids) c
      on conflict do nothing;
    end if;
  end loop;

  -- Days no longer in the list (no longer a school day, or outside a shortened absence) go,
  -- unless they can no longer change: a plan in use or already fixed stays.
  delete from public.sub_plans p
  where p.absence_id = p_absence_id
    and p.plan_date >= v_today
    and p.plan_date <> all (v_dates)
    and app.sub_plan_refreshable(p.id)
    and not exists (select 1 from public.sub_reports sr where sr.sub_plan_id = p.id);

  update public.absences set sources_changed_at = null where id = p_absence_id;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 8. Absences (owner). Publishing writes the absence and all its plans in one transaction, so
--    6 a.m. never depends on the worker (D-047). One call at a time per teacher, so the retry
--    check and the overlap check cannot race.
-- ---------------------------------------------------------------------------------------

create function public.publish_absence(
  p_school_id uuid,
  p_starts_on date,
  p_ends_on date,
  p_part public.absence_part,
  p_note text,
  p_catholic_connection boolean,
  p_client_request_id uuid,
  p_plans jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.active_user_id();
  v_board_id uuid;
  v_part public.absence_part := coalesce(p_part, 'full_day');
  v_id uuid;
begin
  if v_user is null or p_school_id is null
     or not exists (select 1 from app.my_school_ids(array['teacher']::public.app_role[]) s where s = p_school_id)
     or not app.school_has_module(p_school_id, 'teaching') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_client_request_id is null then
    raise exception 'client request id required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('absence:' || v_user::text, 0));
  select a.id into v_id from public.absences a
  where a.teacher_id = v_user and a.client_request_id = p_client_request_id;
  if v_id is not null then
    return v_id;   -- a retried tap
  end if;

  if p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on
     or (v_part <> 'full_day' and p_ends_on <> p_starts_on)
     or char_length(p_note) > 1000 then
    raise exception 'invalid absence' using errcode = '22023';
  end if;
  if p_starts_on < app.school_local_today(p_school_id) then
    raise exception 'absence in the past' using errcode = 'LXS20';
  end if;
  if p_ends_on - p_starts_on > 13 then
    raise exception 'absence too long' using errcode = 'LXS21';
  end if;
  -- A morning and an afternoon absence on the same day may coexist.
  if exists (
    select 1 from public.absences a
    where a.teacher_id = v_user and a.status = 'published'
      and daterange(a.starts_on, a.ends_on, '[]') && daterange(p_starts_on, p_ends_on, '[]')
      and not (a.starts_on = a.ends_on and p_starts_on = p_ends_on
               and a.part <> 'full_day' and v_part <> 'full_day' and a.part <> v_part)
  ) then
    raise exception 'overlapping absence' using errcode = 'LXS22';
  end if;

  select s.board_id into v_board_id from public.schools s where s.id = p_school_id;
  insert into public.absences (teacher_id, school_id, starts_on, ends_on, part, note, status,
    published_at, catholic_connection, client_request_id)
  values (v_user, p_school_id, p_starts_on, p_ends_on, v_part, nullif(btrim(p_note), ''),
    'published', now(), coalesce(p_catholic_connection, true), p_client_request_id)
  returning id into v_id;

  perform app.log_audit('absence.published', v_board_id, p_school_id, 'absence', v_id,
    jsonb_build_object('starts_on', p_starts_on, 'ends_on', p_ends_on, 'part', v_part));
  perform app.emit_event('absence.published', v_board_id, p_school_id, 'absence', v_id,
    jsonb_build_object('absenceId', v_id, 'startsOn', p_starts_on, 'endsOn', p_ends_on, 'part', v_part));
  perform app.write_absence_plans(v_id, p_plans);
  return v_id;
end;
$$;

-- « Modifier / Je reviens plus tôt »: a new end date, a new part of day for a single day, the
-- note and the faith toggle. The start date never changes (cancel and publish again instead).
-- Days that are removed must be unused, and a new part must still be able to change that day's
-- plan. Days that are removed lose their plan and codes.
create function public.update_absence(
  p_absence_id uuid,
  p_ends_on date,
  p_part public.absence_part,
  p_note text,
  p_catholic_connection boolean,
  p_plans jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.active_user_id();
  v_abs public.absences;
  v_board_id uuid;
  v_part public.absence_part;
begin
  if v_user is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('absence:' || v_user::text, 0));
  select * into v_abs from public.absences where id = p_absence_id for update;
  if v_abs.id is null or v_abs.teacher_id <> v_user then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_abs.status <> 'published' then
    raise exception 'absence is not published' using errcode = '22023';
  end if;

  v_part := coalesce(p_part, v_abs.part);
  if p_ends_on is null or p_ends_on < v_abs.starts_on
     or (v_part <> 'full_day' and p_ends_on <> v_abs.starts_on)
     or char_length(p_note) > 1000 then
    raise exception 'invalid absence' using errcode = '22023';
  end if;
  if p_ends_on < app.school_local_today(v_abs.school_id) then
    raise exception 'absence in the past' using errcode = 'LXS20';
  end if;
  if p_ends_on - v_abs.starts_on > 13 then
    raise exception 'absence too long' using errcode = 'LXS21';
  end if;
  if exists (
    select 1 from public.absences a
    where a.teacher_id = v_user and a.status = 'published' and a.id <> p_absence_id
      and daterange(a.starts_on, a.ends_on, '[]') && daterange(v_abs.starts_on, p_ends_on, '[]')
      and not (a.starts_on = a.ends_on and v_abs.starts_on = p_ends_on
               and a.part <> 'full_day' and v_part <> 'full_day' and a.part <> v_part)
  ) then
    raise exception 'overlapping absence' using errcode = 'LXS22';
  end if;
  if exists (
    select 1 from public.sub_plans p
    where p.absence_id = p_absence_id and p.plan_date > p_ends_on
      and (
        exists (select 1 from public.sub_sessions ss where ss.sub_plan_id = p.id)
        or exists (select 1 from public.sub_reports sr where sr.sub_plan_id = p.id)
      )
  ) then
    raise exception 'a day that would be removed is in use' using errcode = 'LXS12';
  end if;
  if v_part <> v_abs.part and exists (
    select 1 from public.sub_plans p
    where p.absence_id = p_absence_id and p.plan_date = v_abs.starts_on
      and not app.sub_plan_refreshable(p.id)
  ) then
    raise exception 'the plan for that day can no longer change' using errcode = 'LXS12';
  end if;

  update public.absences
  set ends_on = p_ends_on,
      part = v_part,
      note = nullif(btrim(p_note), ''),
      catholic_connection = coalesce(p_catholic_connection, catholic_connection)
  where id = p_absence_id;

  select s.board_id into v_board_id from public.schools s where s.id = v_abs.school_id;
  perform app.log_audit('absence.updated', v_board_id, v_abs.school_id, 'absence', p_absence_id,
    jsonb_build_object('starts_on', v_abs.starts_on, 'ends_on', p_ends_on, 'part', v_part,
      'previous_ends_on', v_abs.ends_on, 'previous_part', v_abs.part));
  perform app.emit_event('absence.updated', v_board_id, v_abs.school_id, 'absence', p_absence_id,
    jsonb_build_object('absenceId', p_absence_id));
  perform app.write_absence_plans(p_absence_id, p_plans);
end;
$$;

-- « Mettre à jour le plan »: the owner rebuilds now (no compare-and-set).
create function public.refresh_sub_plans(p_absence_id uuid, p_plans jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.active_user_id();
  v_abs public.absences;
begin
  select * into v_abs from public.absences where id = p_absence_id;
  if v_user is null or v_abs.id is null or v_abs.teacher_id <> v_user then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_abs.status <> 'published' then
    raise exception 'absence is not published' using errcode = '22023';
  end if;
  perform app.write_absence_plans(p_absence_id, p_plans);
end;
$$;

-- « Annuler l'absence »: refused once a substitute has used a plan; deletes the plans (and so
-- every code).
create function public.cancel_absence(p_absence_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.active_user_id();
  v_abs public.absences;
  v_board_id uuid;
begin
  select * into v_abs from public.absences where id = p_absence_id for update;
  if v_user is null or v_abs.id is null or v_abs.teacher_id <> v_user then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_abs.status = 'cancelled' then
    return;
  end if;
  if exists (
    select 1 from public.sub_plans p
    where p.absence_id = p_absence_id
      and (
        exists (select 1 from public.sub_sessions ss where ss.sub_plan_id = p.id)
        or exists (select 1 from public.sub_reports sr where sr.sub_plan_id = p.id)
      )
  ) then
    raise exception 'a plan is in use' using errcode = 'LXS12';
  end if;

  update public.absences
  set status = 'cancelled', cancelled_at = now(), sources_changed_at = null
  where id = p_absence_id;
  delete from public.sub_plans where absence_id = p_absence_id;

  select s.board_id into v_board_id from public.schools s where s.id = v_abs.school_id;
  perform app.log_audit('absence.cancelled', v_board_id, v_abs.school_id, 'absence', p_absence_id,
    jsonb_build_object('starts_on', v_abs.starts_on, 'ends_on', v_abs.ends_on, 'part', v_abs.part));
  perform app.emit_event('absence.cancelled', v_board_id, v_abs.school_id, 'absence', p_absence_id,
    jsonb_build_object('absenceId', p_absence_id));
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 9. Plans: the owner's edits (an overlay, D-048) and release.
-- ---------------------------------------------------------------------------------------

-- Saves the owner's overlay and returns the new revision. Editing stays open during the day,
-- even while a substitute is signed in (the portal shows « Mis à jour »).
create function public.save_sub_plan_edits(p_plan_id uuid, p_edits jsonb, p_expected_revision integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.active_user_id();
  v_plan public.sub_plans;
  v_abs public.absences;
begin
  select * into v_plan from public.sub_plans where id = p_plan_id for update;
  select * into v_abs from public.absences where id = v_plan.absence_id;
  if v_user is null or v_plan.id is null or v_abs.teacher_id <> v_user then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_abs.status <> 'published' then
    raise exception 'absence is not published' using errcode = '22023';
  end if;
  if v_plan.plan_date < app.school_local_today(v_abs.school_id) then
    raise exception 'the day is over' using errcode = 'LXS14';
  end if;
  if p_expected_revision is distinct from v_plan.edits_revision then
    raise exception 'the plan was edited elsewhere' using errcode = 'LXS10';
  end if;

  if p_edits is not null then
    if jsonb_typeof(p_edits) <> 'object' or pg_column_size(p_edits) > 65536 then
      raise exception 'invalid edits' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_object_keys(p_edits) k
      where k not in ('overview', 'endOfDayChecklist', 'faith', 'blocks')
    ) then
      raise exception 'invalid edits' using errcode = '22023';
    end if;
    if p_edits ? 'blocks' then
      if jsonb_typeof(p_edits -> 'blocks') <> 'object' then
        raise exception 'invalid edits' using errcode = '22023';
      end if;
      if exists (
        select 1 from jsonb_object_keys(p_edits -> 'blocks') k
        where k !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      ) then
        raise exception 'invalid edits' using errcode = '22023';
      end if;
    end if;
  end if;

  update public.sub_plans
  set edits = p_edits,
      edits_revision = edits_revision + 1,
      content_version = content_version + 1,
      edited_by = v_user,
      edited_at = now()
  where id = p_plan_id;
  return v_plan.edits_revision + 1;
end;
$$;

-- « Publier maintenant »: the owner, direction or office. A no-op once released (by hand or
-- because the review deadline passed).
create function public.release_sub_plan(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.active_user_id();
  v_role text := app.sub_plan_role(p_plan_id);
  v_plan public.sub_plans;
  v_abs public.absences;
  v_board_id uuid;
begin
  if v_user is null or v_role is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_plan from public.sub_plans where id = p_plan_id for update;
  select * into v_abs from public.absences where id = v_plan.absence_id;
  if v_abs.status <> 'published' then
    raise exception 'absence is not published' using errcode = '22023';
  end if;
  if app.sub_plan_released(v_plan.status, v_plan.review_deadline) then
    return;
  end if;

  update public.sub_plans
  set status = 'released',
      released_at = now(),
      released_by = v_user,
      reviewed_by = case when v_role = 'owner' then v_user else reviewed_by end,
      reviewed_at = case when v_role = 'owner' then now() else reviewed_at end
  where id = p_plan_id;

  select s.board_id into v_board_id from public.schools s where s.id = v_abs.school_id;
  perform app.log_audit('sub_plan.released', v_board_id, v_abs.school_id, 'sub_plan', p_plan_id,
    jsonb_build_object('role', v_role, 'absence_id', v_abs.id, 'plan_date', v_plan.plan_date));
  perform app.emit_event('sub_plan.released', v_board_id, v_abs.school_id, 'sub_plan', p_plan_id,
    jsonb_build_object('subPlanId', p_plan_id, 'absenceId', v_abs.id, 'planDate', v_plan.plan_date));
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 10. Direction and office (D-056): the day's board (metadata only, never report contents) and
--     a released plan, with first names, audited on every view.
-- ---------------------------------------------------------------------------------------

create function public.list_school_sub_days(p_school_id uuid, p_from date, p_to date)
returns table (
  absence_id uuid,
  plan_id uuid,
  plan_date date,
  part public.absence_part,
  note text,
  teacher_name text,
  class_names text[],
  room_names text[],
  released boolean,
  release_at timestamptz,
  released_by_name text,
  refreshing boolean,
  active_codes integer,
  devices integer,
  first_session_at timestamptz,
  last_seen_at timestamptz,
  report_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_school_id is null or not (
    exists (select 1 from app.my_direction_school_ids() s where s = p_school_id)
    or exists (select 1 from app.my_school_ids(array['office_admin']::public.app_role[]) s where s = p_school_id)
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 13 then
    raise exception 'invalid date range' using errcode = '22023';
  end if;

  return query
  select
    a.id,
    p.id,
    p.plan_date,
    a.part,
    a.note,
    app.formal_staff_name(u.display_name, u.honorific),
    array(
      select c.name from public.sub_plan_classes spc
      join public.classes c on c.id = spc.class_id
      where spc.sub_plan_id = p.id
      order by c.name
    ),
    array(
      select distinct rm.name from public.sub_plan_classes spc
      join public.classes c on c.id = spc.class_id
      join public.rooms rm on rm.id = c.room_id
      where spc.sub_plan_id = p.id
      order by rm.name
    ),
    app.sub_plan_released(p.status, p.review_deadline),
    case when p.status = 'released' then p.released_at else p.review_deadline end,
    case when rb.id is not null then app.formal_staff_name(rb.display_name, rb.honorific) end,
    a.sources_changed_at is not null,
    (
      select count(*)::integer from public.sub_access_codes sc
      where sc.sub_plan_id = p.id and sc.revoked_at is null and sc.expires_at > now()
    ),
    (
      select count(distinct ss.device_key)::integer from public.sub_sessions ss
      join public.sub_access_codes sc on sc.id = ss.access_code_id
      where ss.sub_plan_id = p.id and ss.revoked_at is null and sc.revoked_at is null
    ),
    (select min(ss.created_at) from public.sub_sessions ss where ss.sub_plan_id = p.id),
    (select max(ss.last_seen_at) from public.sub_sessions ss where ss.sub_plan_id = p.id),
    coalesce((
      select case sr.status when 'draft' then 'in_progress' else sr.status::text end
      from public.sub_reports sr where sr.sub_plan_id = p.id
    ), 'none')
  from public.sub_plans p
  join public.absences a on a.id = p.absence_id
  join public.users u on u.id = a.teacher_id
  left join public.users rb on rb.id = p.released_by
  where a.school_id = p_school_id
    and a.status = 'published'
    and p.plan_date between p_from and p_to
  order by p.plan_date, u.display_name, p.id;
end;
$$;

-- A released plan for direction ('view' on screen, 'pdf' for printing). Office staff never get
-- « Gestion de classe ». Until release it returns only when the plan will be released.
create function public.get_sub_plan_for_staff(p_plan_id uuid, p_purpose text default 'view')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.sub_plans;
  v_abs public.absences;
  v_school public.schools;
  v_teacher public.users;
  v_role text;
  v_content jsonb;
  v_roster jsonb;
  v_levels jsonb;
begin
  select * into v_plan from public.sub_plans where id = p_plan_id;
  select * into v_abs from public.absences where id = v_plan.absence_id;
  if app.active_user_id() is null or v_plan.id is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if exists (select 1 from app.my_direction_school_ids() s where s = v_abs.school_id) then
    v_role := 'direction';
  elsif exists (
    select 1 from app.my_school_ids(array['office_admin']::public.app_role[]) s where s = v_abs.school_id
  ) then
    v_role := 'office';
  else
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_purpose is null or p_purpose not in ('view', 'pdf') then
    raise exception 'invalid purpose' using errcode = '22023';
  end if;

  if v_abs.status <> 'published' or not app.sub_plan_released(v_plan.status, v_plan.review_deadline) then
    return jsonb_build_object('released', false, 'releaseAt', v_plan.review_deadline);
  end if;

  select * into v_school from public.schools where id = v_abs.school_id;
  select * into v_teacher from public.users where id = v_abs.teacher_id;

  v_content := v_plan.plan;
  if v_role = 'office' and jsonb_typeof(v_content -> 'classNotes') = 'array' then
    v_content := jsonb_set(v_content, '{classNotes}', coalesce((
      select jsonb_agg(case when jsonb_typeof(n.value) = 'object' then n.value - 'classManagement'
                            else n.value end order by n.ordinality)
      from jsonb_array_elements(v_content -> 'classNotes') with ordinality n
    ), '[]'::jsonb));
  end if;

  -- The roster comes from the classes the database recorded for the plan, never from its JSON.
  select coalesce(jsonb_agg(jsonb_build_object('id', st.id, 'classId', st.class_id,
      'firstName', st.first_name) order by st.first_name, st.id), '[]'::jsonb)
  into v_roster
  from public.students st
  join public.sub_plan_classes spc on spc.class_id = st.class_id
  where spc.sub_plan_id = p_plan_id and st.active;

  select coalesce(jsonb_agg(jsonb_build_object('id', ll.id, 'labelFr', ll.label_fr,
      'labelEn', ll.label_en, 'descriptionFr', ll.description_fr, 'sortOrder', ll.sort_order)
      order by ll.sort_order, ll.label_fr, ll.id), '[]'::jsonb)
  into v_levels
  from public.language_levels ll
  where ll.id in (
    select st.default_language_level_id
    from public.students st
    join public.sub_plan_classes spc on spc.class_id = st.class_id
    where spc.sub_plan_id = p_plan_id and st.active
  );

  perform app.log_audit(
    case when p_purpose = 'pdf' then 'sub_plan.printed' else 'sub_plan.viewed' end,
    v_school.board_id, v_school.id, 'sub_plan', p_plan_id, jsonb_build_object('role', v_role));

  return jsonb_build_object(
    'released', true,
    'planId', v_plan.id,
    'absenceId', v_abs.id,
    'planDate', v_plan.plan_date,
    'part', v_abs.part,
    'note', v_abs.note,
    'contentVersion', v_plan.content_version,
    'generatedAt', v_plan.generated_at,
    'plan', v_content,
    'edits', v_plan.edits,
    'school', jsonb_build_object(
      'name', v_school.name,
      'officePhone', v_school.settings #>> '{contact,officePhone}',
      'arrivalInstructions', v_school.settings #>> '{substitute,arrivalInstructions}',
      'emergencyInfo', v_school.settings #>> '{substitute,emergencyInfo}',
      'timezone', v_school.timezone
    ),
    'teacherName', app.formal_staff_name(v_teacher.display_name, v_teacher.honorific),
    'roster', v_roster,
    'levels', v_levels,
    'role', v_role
  );
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 11. Retention (D-059), run daily by the worker: codes (and so sessions) 30 days after they
--     expire, throttle attempts after a day, and a report's free text and absent-student list
--     60 days after confirmation (or after the plan date if never confirmed).
-- ---------------------------------------------------------------------------------------

create function app.sub_access_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_codes integer;
  v_attempts integer;
  v_reports integer;
begin
  delete from public.sub_access_codes where expires_at < now() - interval '30 days';
  get diagnostics v_codes = row_count;

  delete from public.sub_code_attempts where attempted_at < now() - interval '1 day';
  get diagnostics v_attempts = row_count;

  update public.sub_reports sr
  set notes_ciphertext = null,
      notes_key_version = null,
      notes_purged_at = now(),
      content = sr.content - 'absentStudentIds'
  from public.sub_plans p
  where p.id = sr.sub_plan_id
    and sr.notes_purged_at is null
    and (
      (sr.status = 'confirmed' and coalesce(sr.confirmed_at, sr.updated_at) < now() - interval '60 days')
      or (sr.status <> 'confirmed' and p.plan_date < current_date - 60)
    );
  get diagnostics v_reports = row_count;

  return jsonb_build_object(
    'codesDeleted', v_codes, 'attemptsDeleted', v_attempts, 'reportsPurged', v_reports);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 12. Permissions: functions are opt-in, as everywhere else.
-- ---------------------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon;

grant execute on function
  public.get_sub_plan_sources(uuid, date, date, uuid),
  public.publish_absence(uuid, date, date, public.absence_part, text, boolean, uuid, jsonb),
  public.update_absence(uuid, date, public.absence_part, text, boolean, jsonb),
  public.refresh_sub_plans(uuid, jsonb),
  public.cancel_absence(uuid),
  public.save_sub_plan_edits(uuid, jsonb, integer),
  public.release_sub_plan(uuid),
  public.list_school_sub_days(uuid, date, date),
  public.get_sub_plan_for_staff(uuid, text)
to authenticated;

-- Used by the sub_reports policy.
grant execute on function app.sub_plan_window_ended(uuid) to authenticated;

-- The worker: its loader and writer (D-047) and the daily retention task (D-059).
grant execute on function
  app.sub_plan_sources(uuid, uuid, date, date, uuid),
  app.write_absence_plans(uuid, jsonb, timestamptz, boolean),
  app.sub_access_maintenance()
to service_role;
