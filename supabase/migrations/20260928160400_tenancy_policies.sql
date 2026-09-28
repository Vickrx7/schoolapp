-- RLS policies, grants, functions and triggers for tenancy, people and classes.
--
-- Visibility summary (see DECISIONS.md, D-013):
--   teacher        -> own classes (roster, schedule, planning, progress)
--   principal/VP   -> their school's classes, rosters and schedules; NOT teachers' planning
--   office_admin   -> their school's classes and schedules; no rosters
--   board_admin    -> board configuration; no student data
--   anon           -> nothing

-- ---------------------------------------------------------------------------------------
-- boards, schools, school_years, rooms
-- ---------------------------------------------------------------------------------------

create policy boards_select on public.boards
  for select to authenticated
  using (id in (select app.my_board_ids()));

create policy boards_update on public.boards
  for update to authenticated
  using (id in (select app.my_admin_board_ids()))
  with check (id in (select app.my_admin_board_ids()));

grant select on public.boards to authenticated;
grant update (name, short_name, default_timezone, settings) on public.boards to authenticated;

create policy schools_select on public.schools
  for select to authenticated
  using (
    id in (select app.my_staff_school_ids())
    or board_id in (select app.my_admin_board_ids())
  );

create policy schools_update on public.schools
  for update to authenticated
  using (
    id in (select app.my_direction_school_ids())
    or board_id in (select app.my_admin_board_ids())
  )
  with check (
    id in (select app.my_direction_school_ids())
    or board_id in (select app.my_admin_board_ids())
  );

grant select on public.schools to authenticated;
grant update (name, short_name, timezone, schedule_type, cycle_length, student_alerts_enabled, settings)
  on public.schools to authenticated;

-- Turning alerts on or off is a privacy decision: audit it.
create function app.schools_audit_alert_toggle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.student_alerts_enabled is distinct from old.student_alerts_enabled then
    perform app.log_audit(
      case when new.student_alerts_enabled then 'school.student_alerts_enabled'
           else 'school.student_alerts_disabled' end,
      new.board_id, new.id, 'school', new.id
    );
  end if;
  return new;
end;
$$;

create trigger schools_audit_alert_toggle after update of student_alerts_enabled on public.schools
  for each row execute function app.schools_audit_alert_toggle();

create policy school_years_select on public.school_years
  for select to authenticated
  using (board_id in (select app.my_board_ids()));

create policy school_years_write on public.school_years
  for all to authenticated
  using (board_id in (select app.my_admin_board_ids()))
  with check (board_id in (select app.my_admin_board_ids()));

grant select, insert, update, delete on public.school_years to authenticated;

create policy rooms_select on public.rooms
  for select to authenticated
  using (school_id in (select app.my_staff_school_ids()));

-- Any staff member can add a missing room; direction and office manage the list.
create policy rooms_insert on public.rooms
  for insert to authenticated
  with check (school_id in (select app.my_staff_school_ids()));

create policy rooms_update on public.rooms
  for update to authenticated
  using (
    school_id in (
      select app.my_school_ids(array['principal', 'vice_principal', 'office_admin']::public.app_role[])
    )
  )
  with check (
    school_id in (
      select app.my_school_ids(array['principal', 'vice_principal', 'office_admin']::public.app_role[])
    )
  );

create policy rooms_delete on public.rooms
  for delete to authenticated
  using (
    school_id in (
      select app.my_school_ids(array['principal', 'vice_principal', 'office_admin']::public.app_role[])
    )
  );

grant select, insert, update, delete on public.rooms to authenticated;

-- ---------------------------------------------------------------------------------------
-- users, user_roles, module_entitlements
-- ---------------------------------------------------------------------------------------

create policy users_select on public.users
  for select to authenticated
  using (id = (select auth.uid()) or id in (select app.my_colleague_ids()));

create policy users_update_self on public.users
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

grant select on public.users to authenticated;
grant update (display_name, honorific, preferred_locale) on public.users to authenticated;

-- Roles are granted by an admin (service role) in Phase 1; readable for context.
create policy user_roles_select on public.user_roles
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or school_id in (select app.my_staff_school_ids())
    or board_id in (select app.my_admin_board_ids())
  );

grant select on public.user_roles to authenticated;

create function app.user_roles_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.log_audit('user_role.granted', new.board_id, new.school_id, 'user', new.user_id,
      jsonb_build_object('role', new.role));
    return new;
  else
    perform app.log_audit('user_role.revoked', old.board_id, old.school_id, 'user', old.user_id,
      jsonb_build_object('role', old.role));
    return old;
  end if;
end;
$$;

create trigger user_roles_audit after insert or delete on public.user_roles
  for each row execute function app.user_roles_audit();

create policy module_entitlements_select on public.module_entitlements
  for select to authenticated
  using (
    school_id in (select app.my_staff_school_ids())
    or school_id in (
      select s.id from public.schools s where s.board_id in (select app.my_admin_board_ids())
    )
  );

grant select on public.module_entitlements to authenticated;

-- ---------------------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------------------

create policy grades_select on public.grades
  for select to authenticated
  using (true);

grant select on public.grades to authenticated;

create policy subjects_select on public.subjects
  for select to authenticated
  using (board_id is null or board_id in (select app.my_board_ids()));

create policy subjects_write on public.subjects
  for all to authenticated
  using (board_id in (select app.my_admin_board_ids()))
  with check (board_id in (select app.my_admin_board_ids()));

grant select, insert, update, delete on public.subjects to authenticated;

create policy language_levels_select on public.language_levels
  for select to authenticated
  using (
    board_id in (select app.my_board_ids())
    and (owner_user_id is null or owner_user_id = (select auth.uid()))
  );

create policy language_levels_write on public.language_levels
  for all to authenticated
  using (
    (owner_user_id is null and board_id in (select app.my_admin_board_ids()))
    or (owner_user_id = (select auth.uid()) and board_id in (select app.my_board_ids()))
  )
  with check (
    (owner_user_id is null and board_id in (select app.my_admin_board_ids()))
    or (owner_user_id = (select auth.uid()) and board_id in (select app.my_board_ids()))
  );

grant select, insert, update, delete on public.language_levels to authenticated;

-- ---------------------------------------------------------------------------------------
-- classes
-- ---------------------------------------------------------------------------------------

create policy classes_select on public.classes
  for select to authenticated
  using (id in (select app.my_schedule_class_ids()));

create policy classes_update on public.classes
  for update to authenticated
  using (id in (select app.my_class_ids()))
  with check (id in (select app.my_class_ids()));

create policy classes_delete on public.classes
  for delete to authenticated
  using (id in (select app.my_homeroom_class_ids()));

-- Inserts go through public.create_class() so the creator becomes homeroom teacher atomically.
grant select, delete on public.classes to authenticated;
grant update (name, room_id) on public.classes to authenticated;

create function app.classes_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_board_id uuid;
begin
  select board_id into v_board_id from public.schools where id = new.school_id;
  perform app.emit_event('class.created', v_board_id, new.school_id, 'class', new.id);
  return new;
end;
$$;

create trigger classes_after_insert after insert on public.classes
  for each row execute function app.classes_after_insert();

create function app.classes_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_board_id uuid;
begin
  select board_id into v_board_id from public.schools where id = old.school_id;
  perform app.log_audit('class.deleted', v_board_id, old.school_id, 'class', old.id,
    jsonb_build_object('name', old.name));
  perform app.emit_event('class.deleted', v_board_id, old.school_id, 'class', old.id);
  return old;
end;
$$;

create trigger classes_after_delete after delete on public.classes
  for each row execute function app.classes_after_delete();

create function public.create_class(
  p_school_id uuid,
  p_school_year_id uuid,
  p_name text,
  p_grade_codes text[],
  p_room_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class_id uuid;
  v_board_id uuid;
begin
  if not exists (
    select 1 from app.my_school_ids(array['teacher']::public.app_role[]) s where s = p_school_id
  ) then
    raise exception 'not allowed to create a class in this school' using errcode = '42501';
  end if;

  select board_id into v_board_id from public.schools where id = p_school_id;

  if not exists (
    select 1 from public.school_years where id = p_school_year_id and board_id = v_board_id
  ) then
    raise exception 'school year does not belong to this board' using errcode = '22023';
  end if;

  if p_room_id is not null
    and not exists (select 1 from public.rooms where id = p_room_id and school_id = p_school_id)
  then
    raise exception 'room does not belong to this school' using errcode = '22023';
  end if;

  if coalesce(cardinality(p_grade_codes), 0) = 0 then
    raise exception 'a class needs at least one grade' using errcode = '22023';
  end if;

  insert into public.classes (school_id, school_year_id, name, room_id, created_by)
  values (p_school_id, p_school_year_id, btrim(p_name), p_room_id, (select auth.uid()))
  returning id into v_class_id;

  insert into public.class_grades (class_id, grade_code)
  select distinct v_class_id, g from unnest(p_grade_codes) as g;

  insert into public.class_teachers (class_id, user_id, role, added_by)
  values (v_class_id, (select auth.uid()), 'homeroom', (select auth.uid()));

  return v_class_id;
end;
$$;

grant execute on function public.create_class(uuid, uuid, text, text[], uuid) to authenticated;

-- ---------------------------------------------------------------------------------------
-- class_grades, class_teachers
-- ---------------------------------------------------------------------------------------

create policy class_grades_select on public.class_grades
  for select to authenticated
  using (class_id in (select app.my_schedule_class_ids()));

create policy class_grades_insert on public.class_grades
  for insert to authenticated
  with check (class_id in (select app.my_class_ids()));

create policy class_grades_delete on public.class_grades
  for delete to authenticated
  using (class_id in (select app.my_class_ids()));

grant select, insert, delete on public.class_grades to authenticated;

create policy class_teachers_select on public.class_teachers
  for select to authenticated
  using (class_id in (select app.my_schedule_class_ids()));

-- A homeroom teacher can add a colleague who teaches at the same school.
create policy class_teachers_insert on public.class_teachers
  for insert to authenticated
  with check (
    class_id in (select app.my_homeroom_class_ids())
    and app.is_teacher_at_class_school(user_id, class_id)
  );

create policy class_teachers_update on public.class_teachers
  for update to authenticated
  using (class_id in (select app.my_homeroom_class_ids()))
  with check (class_id in (select app.my_homeroom_class_ids()));

-- A homeroom teacher can remove team members; anyone can remove themselves.
create policy class_teachers_delete on public.class_teachers
  for delete to authenticated
  using (
    class_id in (select app.my_homeroom_class_ids())
    or user_id = (select auth.uid())
  );

grant select, insert, delete on public.class_teachers to authenticated;
grant update (role) on public.class_teachers to authenticated;

create function app.class_teachers_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.class_teachers := case when tg_op = 'DELETE' then old else new end;
  v_school_id uuid;
  v_board_id uuid;
begin
  select c.school_id, s.board_id into v_school_id, v_board_id
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

  if v_school_id is not null and tg_op in ('INSERT', 'DELETE') then
    perform app.log_audit(
      case when tg_op = 'INSERT' then 'class_teacher.added' else 'class_teacher.removed' end,
      v_board_id, v_school_id, 'class', v_row.class_id,
      jsonb_build_object('user_id', v_row.user_id, 'role', v_row.role)
    );
  end if;

  return v_row;
end;
$$;

create trigger class_teachers_guard_insert after insert on public.class_teachers
  for each row execute function app.class_teachers_guard();
create trigger class_teachers_guard_change before update or delete on public.class_teachers
  for each row execute function app.class_teachers_guard();

-- ---------------------------------------------------------------------------------------
-- students
-- ---------------------------------------------------------------------------------------

create policy students_select on public.students
  for select to authenticated
  using (
    class_id in (select app.my_class_ids())
    or class_id in (select app.my_direction_class_ids())
  );

create policy students_insert on public.students
  for insert to authenticated
  with check (class_id in (select app.my_class_ids()));

create policy students_update on public.students
  for update to authenticated
  using (class_id in (select app.my_class_ids()))
  with check (class_id in (select app.my_class_ids()));

create policy students_delete on public.students
  for delete to authenticated
  using (class_id in (select app.my_class_ids()));

grant select, delete on public.students to authenticated;
grant insert (class_id, first_name, default_language_level_id, active) on public.students to authenticated;
grant update (first_name, default_language_level_id, active) on public.students to authenticated;

create function app.students_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.first_name := btrim(regexp_replace(new.first_name, '\s+', ' ', 'g'));
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
  end if;

  -- A default language level must come from the class's board and be visible to the teacher.
  if new.default_language_level_id is not null and not exists (
    select 1
    from public.language_levels ll
    join public.schools s on s.board_id = ll.board_id
    join public.classes c on c.school_id = s.id
    where ll.id = new.default_language_level_id
      and c.id = new.class_id
      and (ll.owner_user_id is null or ll.owner_user_id = (select auth.uid()))
  ) then
    raise exception 'language level not available for this class' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger students_before_write before insert or update on public.students
  for each row execute function app.students_before_write();

-- ---------------------------------------------------------------------------------------
-- student_alerts: no direct access. Every read is logged.
-- ---------------------------------------------------------------------------------------

create function app.alerts_enabled_for_class(p_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.student_alerts_enabled
     from public.classes c join public.schools s on s.id = c.school_id
     where c.id = p_class_id),
    false
  );
$$;

create function public.get_class_alerts(p_class_id uuid)
returns table (
  alert_id uuid,
  student_id uuid,
  category public.alert_category,
  body_ciphertext text,
  key_version smallint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school_id uuid;
  v_board_id uuid;
  v_count integer;
begin
  if not (
    exists (select 1 from app.my_class_ids() c where c = p_class_id)
    or exists (select 1 from app.my_direction_class_ids() c where c = p_class_id)
  ) then
    raise exception 'not allowed to view alerts for this class' using errcode = '42501';
  end if;

  if not app.alerts_enabled_for_class(p_class_id) then
    return;
  end if;

  select c.school_id, s.board_id into v_school_id, v_board_id
  from public.classes c join public.schools s on s.id = c.school_id
  where c.id = p_class_id;

  select count(*) into v_count from public.student_alerts a where a.class_id = p_class_id;

  perform app.log_audit('student_alert.viewed', v_board_id, v_school_id, 'class', p_class_id,
    jsonb_build_object('alert_count', v_count));

  return query
    select a.id, a.student_id, a.category, a.body_ciphertext, a.key_version, a.updated_at
    from public.student_alerts a
    where a.class_id = p_class_id
    order by a.created_at;
end;
$$;

create function public.save_student_alert(
  p_student_id uuid,
  p_category public.alert_category,
  p_body_ciphertext text,
  p_key_version smallint,
  p_alert_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class_id uuid;
  v_school_id uuid;
  v_board_id uuid;
  v_alert_id uuid;
begin
  select st.class_id, c.school_id, s.board_id into v_class_id, v_school_id, v_board_id
  from public.students st
  join public.classes c on c.id = st.class_id
  join public.schools s on s.id = c.school_id
  where st.id = p_student_id;

  if v_class_id is null or not exists (select 1 from app.my_class_ids() c where c = v_class_id) then
    raise exception 'not allowed to edit alerts for this student' using errcode = '42501';
  end if;

  if not app.alerts_enabled_for_class(v_class_id) then
    raise exception 'student alerts are not enabled for this school' using errcode = '55000';
  end if;

  if p_alert_id is null then
    insert into public.student_alerts (
      student_id, class_id, category, body_ciphertext, key_version, created_by, updated_by
    ) values (
      p_student_id, v_class_id, p_category, p_body_ciphertext, p_key_version,
      (select auth.uid()), (select auth.uid())
    )
    returning id into v_alert_id;
    perform app.log_audit('student_alert.created', v_board_id, v_school_id, 'student', p_student_id,
      jsonb_build_object('alert_id', v_alert_id, 'category', p_category));
  else
    update public.student_alerts
    set category = p_category,
        body_ciphertext = p_body_ciphertext,
        key_version = p_key_version,
        updated_by = (select auth.uid())
    where id = p_alert_id and student_id = p_student_id
    returning id into v_alert_id;

    if v_alert_id is null then
      raise exception 'alert not found' using errcode = 'P0002';
    end if;
    perform app.log_audit('student_alert.updated', v_board_id, v_school_id, 'student', p_student_id,
      jsonb_build_object('alert_id', v_alert_id, 'category', p_category));
  end if;

  return v_alert_id;
end;
$$;

create function public.delete_student_alert(p_alert_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert public.student_alerts;
  v_school_id uuid;
  v_board_id uuid;
begin
  select * into v_alert from public.student_alerts where id = p_alert_id;
  if v_alert.id is null
    or not exists (select 1 from app.my_class_ids() c where c = v_alert.class_id)
  then
    raise exception 'not allowed to delete this alert' using errcode = '42501';
  end if;

  select c.school_id, s.board_id into v_school_id, v_board_id
  from public.classes c join public.schools s on s.id = c.school_id
  where c.id = v_alert.class_id;

  delete from public.student_alerts where id = p_alert_id;
  perform app.log_audit('student_alert.deleted', v_board_id, v_school_id, 'student',
    v_alert.student_id, jsonb_build_object('alert_id', p_alert_id));
end;
$$;

grant execute on function public.get_class_alerts(uuid) to authenticated;
grant execute on function
  public.save_student_alert(uuid, public.alert_category, text, smallint, uuid)
  to authenticated;
grant execute on function public.delete_student_alert(uuid) to authenticated;
