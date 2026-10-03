-- Phase 6, slice S6: what onboarding and feedback need beyond slice S1's functions.
-- DECISIONS D-103, D-109, D-111, D-116. Tests: supabase/tests/30_onboarding_feedback.test.sql
--
-- 1. A sample class (« classe exemple ») is a teacher's sandbox: it never shows in the direction's
--    « Journal d'audit ». Its deletion (by the teacher, or 60 days later by the nightly purge) is
--    `sample_class.deleted`, for the operator only, never « Classe supprimée »; its class team
--    (the teacher added at creation, a colleague added later) is not logged.
-- 2. Feedback keeps the error reference as the page showed it: a Next digest can end with `@E…`.


-- ---------------------------------------------------------------------------------------
-- 1. Sample classes and the audit log (D-103, D-109)
-- ---------------------------------------------------------------------------------------

insert into public.audit_action_catalog (action, category, audience) values
  ('sample_class.deleted', 'classes', 'operator');

-- As in 20260928160400_tenancy_policies.sql, with sample classes logged for the operator only.
create or replace function app.classes_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_board_id uuid;
begin
  select board_id into v_board_id from public.schools where id = old.school_id;
  if old.sample_owner_id is null then
    perform app.log_audit('class.deleted', v_board_id, old.school_id, 'class', old.id,
      jsonb_build_object('name', old.name));
  else
    perform app.log_audit('sample_class.deleted', v_board_id, old.school_id, 'class', old.id);
  end if;
  perform app.emit_event('class.deleted', v_board_id, old.school_id, 'class', old.id);
  return old;
end;
$$;

-- As in 20260928170000_security_review_fixes.sql, without audit rows for a sample class's team:
-- the class is marked as a sample right after `create_class` adds its teacher, so
-- `create_sample_class` names the teacher being added in `app.sample_class_setup` for that call.
create or replace function app.class_teachers_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.class_teachers := case when tg_op = 'DELETE' then old else new end;
  v_school_id uuid;
  v_board_id uuid;
  v_sample boolean;
begin
  select c.school_id, s.board_id, c.sample_owner_id is not null
  into v_school_id, v_board_id, v_sample
  from public.classes c join public.schools s on s.id = c.school_id
  where c.id = v_row.class_id;

  -- Class still exists (not a cascade from deleting it): keep at least one homeroom teacher.
  if v_school_id is not null and tg_op in ('DELETE', 'UPDATE')
    and old.role = 'homeroom'
    and not exists (
      select 1 from public.class_teachers
      where class_id = old.class_id and role = 'homeroom' and user_id <> old.user_id
    )
    and (tg_op = 'DELETE' or new.role <> 'homeroom')
  then
    raise exception 'a class must keep at least one homeroom teacher' using errcode = '23514';
  end if;

  if v_school_id is not null and not v_sample
    and not (tg_op = 'INSERT'
             and coalesce(current_setting('app.sample_class_setup', true), '') = v_row.user_id::text)
  then
    if tg_op in ('INSERT', 'DELETE') then
      perform app.log_audit(
        case when tg_op = 'INSERT' then 'class_teacher.added' else 'class_teacher.removed' end,
        v_board_id, v_school_id, 'class', v_row.class_id,
        jsonb_build_object('user_id', v_row.user_id, 'role', v_row.role)
      );
    elsif new.role is distinct from old.role then
      perform app.log_audit('class_teacher.role_changed', v_board_id, v_school_id, 'class', v_row.class_id,
        jsonb_build_object('user_id', v_row.user_id, 'from', old.role, 'to', new.role));
    end if;
  end if;

  return v_row;
end;
$$;

-- As in 20261201090100_pilot_accounts.sql, with `app.sample_class_setup` set around
-- `create_class` (transaction-local, cleared right after; the class is then marked as a sample
-- or the whole call fails).
create or replace function public.create_sample_class(p_school_id uuid, p_sample jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_board uuid;
  v_year uuid;
  v_class uuid;
  v_unit jsonb;
  v_unit_id uuid;
  v_levels uuid[];
begin
  if not exists (
    select 1 from app.my_school_ids(array['teacher']::public.app_role[]) s where s = p_school_id
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_sample) is distinct from 'object'
     or jsonb_typeof(p_sample -> 'students') is distinct from 'array'
     or jsonb_array_length(p_sample -> 'students') not between 1 and 30
     or jsonb_typeof(p_sample -> 'gradeCodes') is distinct from 'array'
     or jsonb_typeof(coalesce(p_sample -> 'blocks', '[]')) <> 'array'
     or jsonb_array_length(coalesce(p_sample -> 'blocks', '[]')) > 80
     or jsonb_typeof(coalesce(p_sample -> 'units', '[]')) <> 'array'
     or jsonb_array_length(coalesce(p_sample -> 'units', '[]')) > 3
     or pg_column_size(p_sample) > 262144 then
    raise exception 'invalid sample class' using errcode = '22023';
  end if;
  select s.board_id into v_board from public.schools s where s.id = p_school_id;
  select y.id into v_year from public.school_years y
  where y.board_id = v_board
  order by (current_date between y.starts_on and y.ends_on) desc, y.starts_on desc
  limit 1;
  if v_year is null then
    raise exception 'no school year' using errcode = 'LXO01';
  end if;

  perform set_config('app.sample_class_setup', app.active_user_id()::text, true);
  v_class := public.create_class(p_school_id, v_year, p_sample ->> 'name',
    array(select jsonb_array_elements_text(p_sample -> 'gradeCodes')), null);
  perform set_config('app.sample_class_setup', '', true);
  perform app.mark_sample_class(v_class);

  v_levels := array(select ll.id from public.language_levels ll
                    where ll.board_id = v_board and ll.owner_user_id is null and ll.active
                    order by ll.sort_order, ll.id);
  insert into public.students (class_id, first_name, default_language_level_id)
  select v_class, s ->> 'firstName', v_levels[(s ->> 'levelRank')::int]
  from jsonb_array_elements(p_sample -> 'students') s;

  insert into public.timetable_blocks (class_id, day_key, start_time, end_time, kind, subject_id,
    title)
  select v_class, (b ->> 'dayKey')::smallint, (b ->> 'start')::time, (b ->> 'end')::time,
    (b ->> 'kind')::public.block_kind, subj.id, nullif(b ->> 'title', '')
  from jsonb_array_elements(coalesce(p_sample -> 'blocks', '[]')) b
  left join lateral (
    select sj.id from public.subjects sj
    where sj.code = b ->> 'subjectCode' and (sj.board_id is null or sj.board_id = v_board)
    order by sj.board_id nulls last limit 1
  ) subj on true;

  for v_unit in select u.value from jsonb_array_elements(coalesce(p_sample -> 'units', '[]')) u loop
    insert into public.units (class_id, subject_id, title, description, status, sort_order)
    values (v_class,
      (select sj.id from public.subjects sj
       where sj.code = v_unit ->> 'subjectCode' and (sj.board_id is null or sj.board_id = v_board)
       order by sj.board_id nulls last limit 1),
      v_unit ->> 'title', v_unit ->> 'description', 'active', 0)
    returning id into v_unit_id;
    insert into public.unit_lessons (unit_id, sequence_number, title, objectives, materials,
      content, sub_notes, duration_minutes)
    select v_unit_id, l.ord::int, l.value ->> 'title', l.value ->> 'objectives',
      l.value ->> 'materials', l.value ->> 'content', l.value ->> 'subNotes',
      (l.value ->> 'durationMinutes')::smallint
    from jsonb_array_elements(coalesce(v_unit -> 'lessons', '[]')) with ordinality l (value, ord);
    insert into public.lesson_progress (lesson_id, status, taught_on, source)
    select ul.id, 'completed', (d.value #>> '{}')::date, 'teacher'
    from jsonb_array_elements(coalesce(v_unit -> 'taughtOn', '[]')) with ordinality d (value, ord)
    join public.unit_lessons ul on ul.unit_id = v_unit_id and ul.sequence_number = d.ord;
  end loop;
  return v_class;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 2. Feedback: the error reference as shown (D-111, D-116)
-- ---------------------------------------------------------------------------------------

-- A Next digest can be `2338492845@E394`: the « Référence » must be kept as the page showed it.
alter table public.feedback drop constraint feedback_error_ref_check;
alter table public.feedback add constraint feedback_error_ref_check
  check (char_length(error_ref) <= 40 and error_ref ~ '^[A-Za-z0-9@-]+$');

-- ---------------------------------------------------------------------------------------
-- 3. Permissions, as everywhere else (the replaced functions keep their grants).
-- ---------------------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon;
