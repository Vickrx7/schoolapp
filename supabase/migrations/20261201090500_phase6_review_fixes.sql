-- Phase 6 review fixes, round A: what the correctness and security reviews found in the database.
-- DECISIONS D-055, D-105, D-107, D-116, D-121. Tests: supabase/tests/32_phase6_review_fixes.test.sql
--
-- 1. A class belongs to its school year (D-055, D-105): plan sources take only the teacher's
--    classes whose year overlaps the plan's dates, and each class carries its year so a plan day
--    covers only classes of that day's year. A class a teacher keeps from an earlier year (its
--    timetable stays after its students are purged) is never part of a later plan. Changing a
--    year's dates refreshes the plans of its classes' teachers.
-- 2. The year-end purge (D-105): it deletes only the plans of the class's own school year; a
--    later plan that still lists the class (built before 1.) only loses that link. Teachers see
--    the notice for 60 days whatever happens to the dates: the first night a class is within 60
--    days of its purge date is recorded (`classes.students_purge_notice_on`), and its students go
--    no earlier than 60 days after it. A year moved into the past, or a shorter setting, delays
--    the purge instead of making it happen that night without notice.
-- 3. Staff accounts (D-107): an invitation completes only while the person who made it still
--    administers its board (else it is cancelled, by the system); deleting an account also
--    deletes its invitations (they hold the address and the name).
-- 4. Staff sign-in is throttled by the app (D-121): code requests and code checks per address and
--    per network, recorded under keyed hashes (never an address), kept two days.
-- 5. Pilot feedback stores no student's first name (D-116): the web server replaces the names of
--    the sender's schools' students with a marker; this function gives it the names to look for.

-- ---------------------------------------------------------------------------------------
-- 1. Plan sources: the classes of the plan's school year (D-055 as amended)
-- ---------------------------------------------------------------------------------------

-- The loader, as before (20261003100000_substitute_hardening.sql), with two changes: only the
-- classes whose school year overlaps [p_from, p_to], and each class's `yearStartsOn` and
-- `yearEndsOn` (the builder skips a class on a day outside its year).
create or replace function app.sub_plan_sources(
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
  -- Only the classes of a school year that overlaps the dates: a class kept from an earlier year
  -- is never part of a later plan.
  v_class_ids := array(
    select c.id
    from app.teacher_class_ids(p_teacher_id, p_school_id) t (class_id)
    join public.classes c on c.id = t.class_id
    join public.school_years y on y.id = c.school_year_id
    where y.starts_on <= p_to and y.ends_on >= p_from
  );
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
          'yearStartsOn', y.starts_on, 'yearEndsOn', y.ends_on,
          'grades', coalesce((
            select jsonb_agg(jsonb_build_object('code', g.code, 'ordinal', g.ordinal, 'labelFr', g.label_fr)
              order by g.ordinal)
            from public.class_grades cg join public.grades g on g.code = cg.grade_code
            where cg.class_id = c.id
          ), '[]'::jsonb)
        ) order by c.name, c.id)
      from public.classes c
      join public.school_years y on y.id = c.school_year_id
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
    ), '[]'::jsonb) end,
    -- The days of the teacher's other absences just before this one.
    'earlierPlans', coalesce((
      select jsonb_agg(jsonb_build_object(
          'planDate', p.plan_date,
          'part', oa.part,
          'reportStatus', coalesce(
            (select sr.status::text from public.sub_reports sr where sr.sub_plan_id = p.id), 'none'),
          'assignedLessonIds', jsonb_path_query_array(
            p.plan, '$.blocks[*].lesson ? (@.assignment == "assigned").lessonId'))
        order by p.plan_date, oa.part, p.id)
      from public.absences oa
      join public.sub_plans p on p.absence_id = oa.id
      where oa.teacher_id = p_teacher_id
        and oa.school_id = p_school_id
        and oa.status = 'published'
        and oa.id is distinct from p_absence_id
        and p.plan_date between p_from - 7 and p_from - 1
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

-- A year's dates decide which of its classes plans cover: changing them refreshes the upcoming
-- plans of every teacher of its classes (as any change to a plan's sources does, D-047).
create function app.school_years_flag_absences()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.starts_on is distinct from old.starts_on or new.ends_on is distinct from old.ends_on then
    perform app.flag_absences(
      array(select distinct ct.user_id
            from public.class_teachers ct
            join public.classes c on c.id = ct.class_id
            where c.school_year_id = new.id),
      null, null, null);
  end if;
  return null;
end;
$$;

create trigger school_years_flag_absences after update of starts_on, ends_on on public.school_years
  for each row execute function app.school_years_flag_absences();

-- ---------------------------------------------------------------------------------------
-- 2. The year-end purge (D-105 as amended)
-- ---------------------------------------------------------------------------------------

alter table public.classes
  -- The school-local day the nightly job first found the class 60 days or less from its students'
  -- purge date (the notice shows from then on). Its students go no earlier than 60 days after
  -- it. Cleared if the year's dates move the purge further away again. Written by the job only.
  add column students_purge_notice_on date;

-- As before, but only the plans of the class's own school year are deleted with its students. A
-- later plan that lists the class (built before plan sources kept to the plan's year) loses
-- only that link: a teacher's plans for next week never go with last year's class.
create or replace function app.purge_class_students(p_class_id uuid, out students_deleted integer,
  out plans_deleted integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class public.classes;
  v_board uuid;
  v_year_ends date;
  r record;
begin
  students_deleted := 0;
  plans_deleted := 0;
  select * into v_class from public.classes c where c.id = p_class_id for update;
  if not found then
    return;
  end if;
  select s.board_id into v_board from public.schools s where s.id = v_class.school_id;
  select y.ends_on into v_year_ends from public.school_years y where y.id = v_class.school_year_id;
  for r in
    select distinct spc.sub_plan_id
    from public.sub_plan_classes spc
    join public.sub_plans p on p.id = spc.sub_plan_id
    where spc.class_id = p_class_id and p.plan_date <= v_year_ends
  loop
    if app.purge_sub_plan(r.sub_plan_id, 'class_retention') then
      plans_deleted := plans_deleted + 1;
    end if;
  end loop;
  delete from public.sub_plan_classes spc where spc.class_id = p_class_id;
  delete from public.class_mode_links l where l.class_id = p_class_id;
  delete from public.students st where st.class_id = p_class_id;
  get diagnostics students_deleted = row_count;
  update public.classes c set students_purged_at = now() where c.id = p_class_id;
  perform app.log_audit('class.students_purged', v_board, v_class.school_id, 'class', p_class_id,
    jsonb_build_object('students', students_deleted));
end;
$$;

-- The nightly job, as before (20261201090200_audit_retention.sql) with the class purge's notice
-- rule (step 3) and the sign-in attempts (step 9, D-121): the run also returns `signInAttempts`.
create or replace function app.retention_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b record;
  r record;
  v_purged record;
  v_n integer;
  v_plans_left integer := 2000;
  v_classes_left integer := 200;
  v_sub_days integer;
  v_class_days integer;
  -- one board
  v_plans integer;
  v_absences integer;
  v_classes integer;
  v_students integer;
  v_samples integer;
  v_ai integer;
  v_feedback integer;
  v_expired integer;
  v_invitations integer;
  v_audit integer;
  -- totals
  t_boards integer := 0;
  t_plans integer := 0;
  t_absences integer := 0;
  t_classes integer := 0;
  t_students integer := 0;
  t_samples integer := 0;
  t_ai integer := 0;
  t_feedback integer := 0;
  t_expired integer := 0;
  t_invitations integer := 0;
  t_audit integer := 0;
  t_outbox integer := 0;
  t_sign_ins integer := 0;
  v_auth integer;
  v_totals jsonb;
begin
  -- One run at a time (the cron's job key already ensures it; a manual call waits).
  perform pg_advisory_xact_lock(hashtext('app.retention_maintenance'));

  for b in select bd.id, bd.settings from public.boards bd order by bd.created_at, bd.id loop
    v_sub_days := app.retention_days(b.settings, 'subPlanDays');
    v_class_days := app.retention_days(b.settings, 'classDaysAfterYearEnd');

    -- 1. Substitute plans, a year (subPlanDays) after their date.
    v_plans := 0;
    for r in
      select p.id
      from public.sub_plans p
      join public.absences a on a.id = p.absence_id
      join public.schools s on s.id = a.school_id
      where s.board_id = b.id
        and p.plan_date < (now() at time zone s.timezone)::date - v_sub_days
      order by p.plan_date, p.id
      limit v_plans_left
    loop
      if app.purge_sub_plan(r.id, 'retention') then
        v_plans := v_plans + 1;
      end if;
    end loop;
    v_plans_left := v_plans_left - v_plans;

    -- 2. Absences ended before the same cutoff, once no plan is left.
    delete from public.absences a
    using public.schools s
    where s.id = a.school_id and s.board_id = b.id
      and a.ends_on < (now() at time zone s.timezone)::date - v_sub_days
      and not exists (select 1 from public.sub_plans p where p.absence_id = a.id);
    get diagnostics v_absences = row_count;

    -- 3. Classes' students. A class's purge date is the day after its school year's end plus
    --    classDaysAfterYearEnd (studentPurgeDate). The first night it is 60 days away or less,
    --    that night is recorded (`students_purge_notice_on`; cleared if the year moves later
    --    again), and the students go once both the purge date and 60 days after that night have
    --    come (classPurgeDate in packages/domain): teachers always get their 60 days of notice.
    --    Again at once if students, a link or a plan of the class's year came back after a purge.
    update public.classes c
    set students_purge_notice_on = case
      when y.ends_on + v_class_days + 1 - 60 <= (now() at time zone s.timezone)::date
        then coalesce(c.students_purge_notice_on, (now() at time zone s.timezone)::date)
      end
    from public.schools s, public.school_years y
    where s.id = c.school_id and y.id = c.school_year_id and s.board_id = b.id
      and c.sample_owner_id is null and c.students_purged_at is null
      and c.students_purge_notice_on is distinct from case
        when y.ends_on + v_class_days + 1 - 60 <= (now() at time zone s.timezone)::date
          then coalesce(c.students_purge_notice_on, (now() at time zone s.timezone)::date)
        end;

    v_classes := 0;
    v_students := 0;
    for r in
      select c.id
      from public.classes c
      join public.schools s on s.id = c.school_id
      join public.school_years y on y.id = c.school_year_id
      where s.board_id = b.id and c.sample_owner_id is null
        and y.ends_on + v_class_days < (now() at time zone s.timezone)::date
        and (
          (c.students_purged_at is null
            and c.students_purge_notice_on + 60 <= (now() at time zone s.timezone)::date)
          or (c.students_purged_at is not null and (
            exists (select 1 from public.students st where st.class_id = c.id)
            or exists (select 1 from public.class_mode_links l where l.class_id = c.id)
            or exists (select 1 from public.sub_plan_classes spc
                       join public.sub_plans p on p.id = spc.sub_plan_id
                       where spc.class_id = c.id and p.plan_date <= y.ends_on))))
      order by y.ends_on, c.id
      limit v_classes_left
    loop
      select * into v_purged from app.purge_class_students(r.id);
      v_classes := v_classes + 1;
      v_students := v_students + v_purged.students_deleted;
      v_plans := v_plans + v_purged.plans_deleted;
    end loop;
    v_classes_left := v_classes_left - v_classes;

    -- 4. Sample classes, whole, 60 days after they were created (`class.deleted`).
    delete from public.classes c
    using public.schools s
    where s.id = c.school_id and s.board_id = b.id and c.sample_owner_id is not null
      and (c.created_at at time zone s.timezone)::date + 60 <= (now() at time zone s.timezone)::date;
    get diagnostics v_samples = row_count;

    -- 5. The AI usage ledger.
    delete from public.ai_generations g
    where g.board_id = b.id
      and g.created_at < now() - make_interval(days => app.retention_days(b.settings, 'aiUsageDays'));
    get diagnostics v_ai = row_count;

    -- 6. Pilot feedback.
    delete from public.feedback f
    where f.board_id = b.id
      and f.created_at < now() - make_interval(days => app.retention_days(b.settings, 'feedbackDays'));
    get diagnostics v_feedback = row_count;

    -- 7. Invitations: pending ones expire after 14 days; processed ones go after 90.
    v_expired := 0;
    for r in
      select i.id from public.staff_invitations i
      where i.board_id = b.id and i.status = 'pending' and i.created_at < now() - interval '14 days'
    loop
      if app.fail_staff_invitation(r.id, 'expired') = 'failed' then
        v_expired := v_expired + 1;
      end if;
    end loop;
    delete from public.staff_invitations i
    where i.board_id = b.id and i.status <> 'pending'
      and coalesce(i.processed_at, i.created_at) < now() - interval '90 days';
    get diagnostics v_invitations = row_count;

    -- 8. The audit log, last (the entries above are new).
    perform set_config('app.audit_retention_purge', 'on', true);
    delete from public.audit_log a
    where a.board_id = b.id
      and a.occurred_at < now() - make_interval(days => app.retention_days(b.settings, 'auditDays'));
    get diagnostics v_audit = row_count;
    perform set_config('app.audit_retention_purge', 'off', true);

    if v_plans + v_absences + v_classes + v_samples + v_ai + v_feedback + v_expired
       + v_invitations + v_audit > 0 then
      perform app.log_audit('retention.purged', b.id, null, 'board', b.id, jsonb_build_object(
        'sub_plans', v_plans, 'absences', v_absences, 'classes', v_classes,
        'students', v_students, 'sample_classes', v_samples, 'ai_usage', v_ai,
        'feedback', v_feedback, 'invitations_expired', v_expired,
        'invitations_deleted', v_invitations, 'audit_rows', v_audit));
      t_boards := t_boards + 1;
    end if;
    t_plans := t_plans + v_plans;
    t_absences := t_absences + v_absences;
    t_classes := t_classes + v_classes;
    t_students := t_students + v_students;
    t_samples := t_samples + v_samples;
    t_ai := t_ai + v_ai;
    t_feedback := t_feedback + v_feedback;
    t_expired := t_expired + v_expired;
    t_invitations := t_invitations + v_invitations;
    t_audit := t_audit + v_audit;
  end loop;

  -- 9. Everyone: dispatched outbox events after 90 days (D-018), sign-in attempts after two
  --    days (D-121).
  delete from public.event_outbox o where o.dispatched_at < now() - interval '90 days';
  get diagnostics t_outbox = row_count;
  delete from public.sign_in_attempts t where t.attempted_at < now() - interval '2 days';
  get diagnostics t_sign_ins = row_count;

  -- 10. Usage rows without a board (it was deleted) after the default.
  delete from public.ai_generations g
  where g.board_id is null
    and g.created_at < now() - make_interval(days => app.retention_days('{}', 'aiUsageDays'));
  get diagnostics v_n = row_count;
  t_ai := t_ai + v_n;

  -- 11. Supabase Auth's audit entries after 90 days.
  v_auth := app.auth_log_maintenance(90);

  -- 12. Audit rows without a board, or of a deleted board, after the default.
  perform set_config('app.audit_retention_purge', 'on', true);
  delete from public.audit_log a
  where a.occurred_at < now() - make_interval(days => app.retention_days('{}', 'auditDays'))
    and (a.board_id is null
      or not exists (select 1 from public.boards bd where bd.id = a.board_id));
  get diagnostics v_n = row_count;
  perform set_config('app.audit_retention_purge', 'off', true);
  t_audit := t_audit + v_n;

  v_totals := jsonb_build_object(
    'boards', t_boards, 'subPlans', t_plans, 'absences', t_absences, 'classes', t_classes,
    'students', t_students, 'sampleClasses', t_samples, 'aiUsage', t_ai,
    'feedback', t_feedback, 'invitationsExpired', t_expired,
    'invitationsDeleted', t_invitations, 'auditRows', t_audit, 'outbox', t_outbox,
    'signInAttempts', t_sign_ins,
    'authLogs', case when v_auth < 0 then to_jsonb('not_permitted'::text) else to_jsonb(v_auth) end);
  perform app.record_heartbeat('retention', null, v_totals);
  return v_totals;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 3. Staff accounts (D-107 as amended)
-- ---------------------------------------------------------------------------------------

-- The worker's second step, as before (20261201090100_pilot_accounts.sql), except that the
-- inviter's admin boards are read from their active roles only: an invitation left pending by
-- someone who no longer administers its board is cancelled instead of completed. Returns
-- 'cancelled' then (the worker deletes an Auth account it created in this run).
create or replace function app.complete_staff_invitation(p_invitation_id uuid, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.staff_invitations;
  v_by_id public.users;
  v_by_email public.users;
  v_boards uuid[];
begin
  if p_user_id is null then
    raise exception 'user id required' using errcode = '22023';
  end if;
  select * into v_inv from public.staff_invitations i where i.id = p_invitation_id for update;
  if v_inv.id is null then
    return 'gone';
  end if;
  if v_inv.status <> 'pending' then
    return v_inv.status;
  end if;

  -- The person who invited must still administer the invitation's board: removing their access
  -- or their role cancels what they left pending (by the system, which the board's log shows).
  v_boards := array(select ur.board_id from public.user_roles ur
                    join public.users u on u.id = ur.user_id
                    where ur.user_id = v_inv.invited_by and ur.role = 'board_admin'
                      and u.deactivated_at is null);
  if not (v_inv.board_id = any (v_boards)) then
    update public.staff_invitations
    set status = 'cancelled', processed_at = now()
    where id = v_inv.id;
    perform app.log_audit('staff.invitation_cancelled', v_inv.board_id, v_inv.school_id,
      'staff_invitation', v_inv.id, jsonb_build_object('role', v_inv.role), 'system');
    return 'cancelled';
  end if;
  select * into v_by_id from public.users u where u.id = p_user_id;
  select * into v_by_email from public.users u where lower(u.email) = v_inv.email;
  if (v_by_email.id is not null and v_by_email.id <> p_user_id)
     or (v_by_id.id is not null
         and (lower(v_by_id.email) <> v_inv.email or app.staff_beyond_boards(p_user_id, v_boards))) then
    update public.staff_invitations
    set status = 'failed', error_code = 'emailConflict', processed_at = now()
    where id = v_inv.id;
    return 'conflict';
  end if;

  insert into public.users (id, email, display_name, honorific)
  values (p_user_id, v_inv.email, v_inv.display_name, v_inv.honorific)
  on conflict (id) do update set deactivated_at = null;
  insert into public.user_roles (user_id, role, board_id, school_id, created_by)
  values (p_user_id, v_inv.role, v_inv.board_id, v_inv.school_id, v_inv.invited_by)
  on conflict do nothing;

  if v_by_id.deactivated_at is not null then
    -- Access removed by this board, restored by its invitation: once per board and school of the
    -- person's roles, as « Rétablir l'accès » does. The worker unbans the Auth account itself.
    perform app.log_audit('staff.access_restored', r.board_id, r.school_id, 'user', p_user_id,
      jsonb_build_object('via', 'invitation'))
    from (select distinct ur.board_id, ur.school_id from public.user_roles ur
          where ur.user_id = p_user_id) r;
    perform app.flag_absences(array[p_user_id], null, null, null);
  end if;

  update public.staff_invitations
  set status = 'ready', error_code = null, user_id = p_user_id, processed_at = now()
  where id = v_inv.id;
  return 'ready';
end;
$$;

-- `pnpm admin delete-user`, as before, plus the person's invitations (by account and by address,
-- in every board): they hold the address and the name the inviter typed. Returns `invitations`.
create or replace function public.operator_delete_staff_account(p_user_id uuid, p_all_boards boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.users;
  v_boards uuid[];
  v_roles integer;
  v_classes integer;
  v_plans integer := 0;
  v_items integer;
  v_feedback integer;
  v_invitations integer;
  r record;
begin
  select * into v_user from public.users u where u.id = p_user_id for update;
  if v_user.id is null then
    return jsonb_build_object('profile', false);
  end if;
  if v_user.deactivated_at is null then
    raise exception 'remove the person''s access first' using errcode = 'LXU06';
  end if;
  v_boards := app.staff_board_ids(p_user_id);
  if cardinality(v_boards) > 1 and not coalesce(p_all_boards, false) then
    raise exception 'this person works in several boards' using errcode = 'LXU02';
  end if;

  select count(*) into v_roles from public.user_roles ur where ur.user_id = p_user_id;
  if v_roles > 0 then
    perform app.log_audit('staff.deleted', x.board_id, x.school_id, 'user', p_user_id, '{}',
      'service')
    from (select distinct ur.board_id, ur.school_id from public.user_roles ur
          where ur.user_id = p_user_id) x;
  else
    perform app.log_audit('staff.deleted', b, null, 'user', p_user_id, '{}', 'service')
    from unnest(v_boards) b;
  end if;

  delete from public.classes c
  where c.sample_owner_id = p_user_id
     or c.id in (
       select ct.class_id from public.class_teachers ct
       where ct.user_id = p_user_id and ct.role = 'homeroom'
         and not exists (
           select 1 from public.class_teachers o
           where o.class_id = ct.class_id and o.role = 'homeroom' and o.user_id <> p_user_id));
  get diagnostics v_classes = row_count;

  for r in
    select p.id, p.absence_id, p.plan_date, a.school_id, s.board_id
    from public.sub_plans p
    join public.absences a on a.id = p.absence_id
    join public.schools s on s.id = a.school_id
    where a.teacher_id = p_user_id
  loop
    delete from public.lesson_progress lp
    using public.sub_reports sr
    where sr.sub_plan_id = r.id and lp.sub_report_id = sr.id
      and lp.status = 'pending_confirmation';
    perform app.log_audit('sub_plan.deleted', r.board_id, r.school_id, 'sub_plan', r.id,
      jsonb_build_object('reason', 'account_deleted', 'absence_id', r.absence_id,
        'plan_date', r.plan_date), 'service');
    delete from public.sub_plans where id = r.id;   -- codes, sessions and report too
    v_plans := v_plans + 1;
  end loop;

  delete from public.library_items i where i.author_id = p_user_id and i.share_scope = 'private';
  get diagnostics v_items = row_count;
  delete from public.feedback f where f.user_id = p_user_id;
  get diagnostics v_feedback = row_count;
  -- Invitations hold the address and the name: none is kept, in any board.
  delete from public.staff_invitations i
  where i.user_id = p_user_id or i.email = lower(btrim(v_user.email));
  get diagnostics v_invitations = row_count;
  delete from public.users u where u.id = p_user_id;

  return jsonb_build_object('profile', true, 'boards', cardinality(v_boards), 'roles', v_roles,
    'classes', v_classes, 'plans', v_plans, 'libraryItems', v_items, 'feedback', v_feedback,
    'invitations', v_invitations);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 4. Staff sign-in throttle (D-121)
-- ---------------------------------------------------------------------------------------

-- This install's own random keys, for keyed hashes that must not be reversible from a copy of
-- the public tables (backups hold `public` and `auth` only, never this schema). Owner only.
create table app.install_secrets (
  name text primary key check (name ~ '^[a-z_]{1,40}$'),
  secret bytea not null check (octet_length(secret) >= 32),
  created_at timestamptz not null default now()
);
alter table app.install_secrets enable row level security;
revoke all on app.install_secrets from public, anon, authenticated, service_role;

-- Sign-in code requests and code checks, for throttling. The address and the client network
-- are stored as HMACs with the install's `sign_in` secret, never in clear; the network is null
-- when the web server could not tell it (CLIENT_IP_HEADER / TRUSTED_PROXY_HOPS). An attempt is
-- recorded as failed and turned `succeeded` when the person signs in. Kept two days.
create table public.sign_in_attempts (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('request', 'verify')),
  email_key text not null check (email_key ~ '^[0-9a-f]{64}$'),
  ip_key text check (ip_key ~ '^[0-9a-f]{64}$'),
  succeeded boolean not null default false,
  attempted_at timestamptz not null default now()
);

create index sign_in_attempts_email_idx on public.sign_in_attempts (email_key, attempted_at desc);
create index sign_in_attempts_ip_idx on public.sign_in_attempts (ip_key, attempted_at desc)
  where ip_key is not null;

alter table public.sign_in_attempts enable row level security;
revoke all on public.sign_in_attempts from anon, authenticated;

-- The keyed hash of one value (`email:<address>` or `ip:<address>`), hex.
create function app.sign_in_key(p_value text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret bytea;
begin
  select s.secret into v_secret from app.install_secrets s where s.name = 'sign_in';
  if v_secret is null then
    insert into app.install_secrets (name, secret)
    values ('sign_in', extensions.gen_random_bytes(32))
    on conflict (name) do nothing;
    select s.secret into v_secret from app.install_secrets s where s.name = 'sign_in';
  end if;
  return encode(extensions.hmac(convert_to(p_value, 'UTF8'), v_secret, 'sha256'), 'hex');
end;
$$;

-- When a limit of `p_limit` failed attempts of one kind within `p_window` ends for one address
-- (`p_email_key`) or one network (`p_ip_key`): the time the oldest of the last `p_limit` leaves
-- the window; null when fewer were made (or the network is unknown).
create function app.sign_in_limit_ends(p_email_key text, p_ip_key text, p_kind text,
  p_limit integer, p_window interval)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select t.attempted_at + p_window
  from public.sign_in_attempts t
  where t.kind = p_kind and not t.succeeded and t.attempted_at > now() - p_window
    and coalesce(p_email_key, p_ip_key) is not null
    and case when p_email_key is not null then t.email_key = p_email_key
             else t.ip_key = p_ip_key end
  order by t.attempted_at desc
  offset greatest(p_limit, 1) - 1
  limit 1;
$$;

-- The web server asks before every code request and every code check, as whoever is calling
-- (often nobody yet, hence `anon`: the only public function anon may run). Answers:
--   ok        go ahead (the attempt is recorded, as failed until the person signs in);
--   new_code  5 wrong codes since this address's last code request: only a new code (or the
--             e-mail's link) works now;
--   wait      a limit is reached, for `retry_after` seconds:
--             code requests: 5 an hour per address, 30 every 15 minutes per network;
--             code checks: 20 wrong codes a day per address, 30 every 15 minutes per network.
-- Requests followed by a sign-in never count (sign_in_succeeded). Nothing here says whether an
-- address has an account. Invalid input: 22023.
create function public.sign_in_attempt(p_kind text, p_email text, p_ip text)
returns table (outcome text, retry_after integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_ip text := lower(btrim(p_ip));
  v_email_key text;
  v_ip_key text;
  v_since timestamptz;
  v_until timestamptz;
begin
  if p_kind is null or p_kind not in ('request', 'verify')
     or v_email is null or char_length(v_email) not between 3 and 320
     or position('@' in v_email) = 0
     or v_ip is null or v_ip !~ '^(unknown|[0-9a-f.:]{2,45})$' then
    raise exception 'invalid sign-in attempt' using errcode = '22023';
  end if;
  v_email_key := app.sign_in_key('email:' || v_email);
  v_ip_key := case when v_ip = 'unknown' then null else app.sign_in_key('ip:' || v_ip) end;
  -- One check-and-record at a time per address.
  perform pg_advisory_xact_lock(hashtextextended('lynx.sign_in:' || v_email_key, 0));

  if p_kind = 'request' then
    v_until := greatest(
      app.sign_in_limit_ends(v_email_key, null, 'request', 5, interval '1 hour'),
      app.sign_in_limit_ends(null, v_ip_key, 'request', 30, interval '15 minutes'));
  else
    -- Wrong codes since the latest code request (a code is valid an hour).
    select max(t.attempted_at) into v_since
    from public.sign_in_attempts t
    where t.email_key = v_email_key and t.kind = 'request'
      and t.attempted_at > now() - interval '1 hour';
    if (select count(*) from public.sign_in_attempts t
        where t.email_key = v_email_key and t.kind = 'verify' and not t.succeeded
          and t.attempted_at > coalesce(v_since, now() - interval '1 hour')) >= 5 then
      return query select 'new_code'::text, null::integer;
      return;
    end if;
    v_until := greatest(
      app.sign_in_limit_ends(v_email_key, null, 'verify', 20, interval '24 hours'),
      app.sign_in_limit_ends(null, v_ip_key, 'verify', 30, interval '15 minutes'));
  end if;
  if v_until is not null and v_until > now() then
    return query select 'wait'::text,
      greatest(1, ceil(extract(epoch from v_until - now())))::integer;
    return;
  end if;

  insert into public.sign_in_attempts (kind, email_key, ip_key)
  values (p_kind, v_email_key, v_ip_key);
  return query select 'ok'::text, null::integer;
end;
$$;

-- The person who just signed in (with a code or the e-mail's link): their address's attempts of
-- the last day no longer count.
create function public.sign_in_succeeded()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  select lower(btrim(u.email)) into v_email from auth.users u where u.id = (select auth.uid());
  if v_email is null then
    return;
  end if;
  update public.sign_in_attempts t
  set succeeded = true
  where t.email_key = app.sign_in_key('email:' || v_email) and not t.succeeded
    and t.attempted_at > now() - interval '1 day';
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 5. Pilot feedback without students' first names (D-116 as amended)
-- ---------------------------------------------------------------------------------------

-- Letters and digits only, lowercased, common accents removed: « Marie-Ève » and « marie eve »
-- are both « marieeve ».
create function app.fold_letters(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(
    translate(lower(p_text),
      'àâäáãåāçćčéèêëēęíìîïīñńóòôöõøōúùûüūýÿ',
      'aaaaaaaccceeeeeeiiiiinnooooooouuuuuyy'),
    '[^[:alnum:]]', '', 'g');
$$;

-- The first names of the students of the caller's schools (any staff role: the office too,
-- which cannot read students) that may appear in `p_text`, for the web server to replace before
-- feedback is stored. Only names whose letters are in the text come back, so it says nothing
-- about names the caller did not type. Board admins without a school get none.
create function public.feedback_student_names(p_text text)
returns setof text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_text text := app.fold_letters(coalesce(p_text, ''));
begin
  if app.active_user_id() is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if char_length(p_text) > 4000 then
    raise exception 'text too long' using errcode = '22023';
  end if;
  return query
    select distinct st.first_name
    from public.students st
    join public.classes c on c.id = st.class_id
    where c.school_id in (select app.my_staff_school_ids())
      and char_length(app.fold_letters(st.first_name)) >= 2
      and position(app.fold_letters(st.first_name) in v_text) > 0;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 6. Permissions
-- ---------------------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon;

-- Before anyone has signed in: the throttle only (D-121).
grant execute on function public.sign_in_attempt(text, text, text) to anon, authenticated;
grant execute on function
  public.sign_in_succeeded(),
  public.feedback_student_names(text)
to authenticated;

revoke execute on function
  app.school_years_flag_absences(),
  app.sign_in_key(text),
  app.sign_in_limit_ends(text, text, text, integer, interval),
  app.fold_letters(text)
from authenticated, service_role;
