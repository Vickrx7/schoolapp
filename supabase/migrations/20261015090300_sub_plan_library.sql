-- Phase 4: substitute plans use library resources (« Plan de suppléance » meets « Banque de
-- ressources »). The plan builder gets, for each open lesson of the absent teacher's classes, the
-- resources a substitute could run: the lesson's own reviewed resource first, then board-approved
-- ones for the same attentes. Phase 3's loader (app.sub_plan_sources) does not change: the web
-- server and the worker call this one next to it and merge the result.
--
--  1. The loader: candidates for the open lessons, and the resources' content without answer keys.
--  2. The teacher's own call (the web server builds plans as the signed-in teacher).
--  3. A lesson's attentes decide its candidates: changing them rebuilds upcoming plans.
--  4. Permissions.
--
-- DECISIONS: D-077 (amends D-048 and D-052), D-062 (keys never leave the key table's readers).
-- Tests: supabase/tests/19_sub_plan_library.test.sql

-- ---------------------------------------------------------------------------------------
-- 1. The loader (D-077). For the teacher's classes at the school (app.teacher_class_ids):
--
--    - Open lessons: lessons of active units with no progress row (done, skipped or waiting for
--      the teacher's confirmation all count as done), the first 20 per unit.
--    - « linked »: the lesson's own resource, when it is reviewed or approved, sub-friendly, of a
--      type a substitute may run, and usable by the teacher.
--    - « expectation »: approved, sub-friendly resources of the school's board for the unit's
--      subject that share a grade with the class and at least one attente with the lesson, and
--      that the teacher can use. Best first: a student sheet, more attentes in common, fitting
--      the lesson (at most 10 minutes over), the closest duration, the most used, then the id.
--      The top 3 per lesson are kept.
--    - At most 40 resources in all, the ones for the earliest lessons first.
--
--    Each resource comes with its base version and the versions for the levels the classes'
--    active students work at, never with an answer key: `hasAnswerKey` only says one exists.
--    `overlap` (attentes in common) and `usageCount` let the builder rank again against the real
--    length of the period. A school without the Library module gets no candidates (D-078).
-- ---------------------------------------------------------------------------------------

create function app.sub_plan_library_sources(p_teacher_id uuid, p_school_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_board_id uuid;
  v_class_ids uuid[];
  v_level_ids uuid[];
  v_result jsonb;
begin
  select s.board_id into v_board_id from public.schools s where s.id = p_school_id;
  v_class_ids := array(select app.teacher_class_ids(p_teacher_id, p_school_id));
  if v_board_id is null or cardinality(v_class_ids) = 0
     or not app.school_has_module(p_school_id, 'library') then
    return jsonb_build_object('lessonCandidates', '[]'::jsonb, 'items', '[]'::jsonb);
  end if;
  -- Each group of the plan gets the version of its level: the levels of the active students.
  v_level_ids := array(
    select distinct st.default_language_level_id
    from public.students st
    where st.class_id = any (v_class_ids) and st.active
      and st.default_language_level_id is not null
  );

  with open_lessons as (
    select l.id as lesson_id, l.library_item_id, u.class_id, u.subject_id,
      coalesce(l.duration_minutes, 50) as minutes,
      row_number() over (partition by l.unit_id order by l.sequence_number, l.id) as position
    from public.units u
    join public.unit_lessons l on l.unit_id = u.id
    where u.class_id = any (v_class_ids)
      and u.status = 'active'
      and not exists (select 1 from public.lesson_progress lp where lp.lesson_id = l.id)
  ),
  lessons as (
    select * from open_lessons where position <= 20
  ),
  linked as (
    select o.lesson_id, o.position, i.id as item_id,
      (select count(*)::integer
         from public.library_item_expectations le
         join public.unit_lesson_expectations ue
           on ue.expectation_id = le.expectation_id and ue.lesson_id = o.lesson_id
        where le.item_id = i.id) as overlap
    from lessons o
    join public.library_items i on i.id = o.library_item_id
    where i.status in ('teacher_reviewed', 'board_approved')
      and i.sub_friendly
      and i.type not in ('unit_test', 'diagnostic', 'rubric', 'parent_guide', 'teacher_guide', 'project')
      and app.library_item_usable_by(p_teacher_id, i.id)
  ),
  matched as (
    select o.lesson_id, o.position, o.minutes, i.id as item_id, i.type, i.duration_minutes,
      i.usage_count, count(*)::integer as overlap
    from lessons o
    join public.unit_lesson_expectations ue on ue.lesson_id = o.lesson_id
    join public.library_item_expectations le on le.expectation_id = ue.expectation_id
    join public.library_items i on i.id = le.item_id
    where i.board_id = v_board_id
      and i.status = 'board_approved'
      and i.sub_friendly
      and i.subject_id = o.subject_id
      and i.id is distinct from o.library_item_id
      and i.type not in ('unit_test', 'diagnostic', 'rubric', 'parent_guide', 'teacher_guide', 'project')
      and exists (
        select 1
        from public.library_item_grades ig
        join public.class_grades cg on cg.grade_code = ig.grade_code and cg.class_id = o.class_id
        where ig.item_id = i.id
      )
    group by o.lesson_id, o.position, o.minutes, i.id, i.type, i.duration_minutes, i.usage_count
  ),
  ranked as (
    select m.lesson_id, m.position, m.item_id, m.overlap,
      row_number() over (
        partition by m.lesson_id
        order by (m.type not in ('lesson_plan', 'teacher_guide')) desc,
          m.overlap desc,
          coalesce(m.duration_minutes <= m.minutes + 10, false) desc,
          abs(m.duration_minutes - m.minutes) nulls last,
          m.usage_count desc,
          m.item_id
      ) as rank
    from matched m
    where app.library_item_usable_by(p_teacher_id, m.item_id)
  ),
  candidates as (
    select lesson_id, position, item_id, 'linked'::text as reason, overlap, 0::bigint as rank
    from linked
    union all
    select lesson_id, position, item_id, 'expectation', overlap, rank
    from ranked
    where rank <= 3
  ),
  kept_items as (
    select c.item_id
    from candidates c
    group by c.item_id
    order by min(c.position), min(c.rank), c.item_id
    limit 40
  ),
  kept as (
    select c.* from candidates c where c.item_id in (select k.item_id from kept_items k)
  )
  select jsonb_build_object(
    'lessonCandidates', coalesce((
      select jsonb_agg(jsonb_build_object('lessonId', per.lesson_id, 'candidates', per.candidates)
        order by per.lesson_id)
      from (
        select k.lesson_id,
          jsonb_agg(jsonb_build_object('itemId', k.item_id, 'reason', k.reason, 'overlap', k.overlap)
            order by k.rank, k.item_id) as candidates
        from kept k
        group by k.lesson_id
      ) per
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', i.id,
          'type', i.type,
          'title', i.title,
          'status', i.status,
          'subFriendly', i.sub_friendly,
          'durationMinutes', i.duration_minutes,
          'materials', i.materials,
          'safetyNotes', i.safety_notes,
          'catholicConnection', i.catholic_connection,
          'catholicReferenceTitle', cr.title,
          'faithOnStudentSheet', i.faith_on_student_sheet,
          'subjectCode', sub.code,
          'usageCount', i.usage_count,
          -- Whether a key has an answer or a solution; the key itself never leaves its table.
          'hasAnswerKey', exists (
            select 1
            from public.library_item_versions kv
            join public.library_item_answer_keys k on k.version_id = kv.id
            where kv.item_id = i.id
              and (
                case when jsonb_typeof(k.answer_key -> 'answers') = 'array'
                  then jsonb_array_length(k.answer_key -> 'answers') > 0 else false end
                or nullif(btrim(k.answer_key ->> 'solution'), '') is not null
              )
          ),
          'versions', coalesce((
            select jsonb_agg(jsonb_build_object('levelId', v.language_level_id,
                'schemaVersion', v.schema_version, 'content', v.content)
              order by v.language_level_id nulls first)
            from public.library_item_versions v
            where v.item_id = i.id
              and (v.language_level_id is null or v.language_level_id = any (v_level_ids))
          ), '[]'::jsonb))
        order by i.id)
      from public.library_items i
      left join public.subjects sub on sub.id = i.subject_id
      left join public.catholic_references cr on cr.id = i.catholic_reference_id
      where i.id in (select k.item_id from kept_items k)
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 2. The teacher's call: the same rule as get_sub_plan_sources (a teacher at the school, which
--    has the Teaching module), for the signed-in teacher only.
-- ---------------------------------------------------------------------------------------

create function public.get_sub_plan_library_sources(p_school_id uuid)
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
     or not exists (
       select 1 from app.my_school_ids(array['teacher']::public.app_role[]) s where s = p_school_id)
     or not app.school_has_module(p_school_id, 'teaching') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return app.sub_plan_library_sources(v_user, p_school_id);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 3. A lesson's attentes decide which resources it gets, so adding or removing one rebuilds the
--    upcoming plans of the class's teachers (Phase 3's triggers did not watch this table).
--    Nothing to do when the lesson or its unit is already gone (a cascade from their deletion,
--    which their own triggers report).
-- ---------------------------------------------------------------------------------------

create function app.unit_lesson_expectations_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class_id uuid;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    select u.class_id into v_class_id
    from public.unit_lessons l join public.units u on u.id = l.unit_id
    where l.id = new.lesson_id;
    if v_class_id is not null then
      perform app.flag_class_absences(v_class_id);
    end if;
  end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.lesson_id is distinct from new.lesson_id) then
    select u.class_id into v_class_id
    from public.unit_lessons l join public.units u on u.id = l.unit_id
    where l.id = old.lesson_id;
    if v_class_id is not null then
      perform app.flag_class_absences(v_class_id);
    end if;
  end if;
  return null;
end;
$$;

create trigger unit_lesson_expectations_flag_absences
  after insert or update or delete on public.unit_lesson_expectations
  for each row execute function app.unit_lesson_expectations_flag();

-- ---------------------------------------------------------------------------------------
-- 4. Permissions: functions are opt-in, as everywhere else. The loader takes a user: the worker
--    only (service role).
-- ---------------------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon;

grant execute on function public.get_sub_plan_library_sources(uuid) to authenticated;
grant execute on function app.sub_plan_library_sources(uuid, uuid) to service_role;
