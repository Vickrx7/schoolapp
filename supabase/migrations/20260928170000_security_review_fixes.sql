-- Fixes from the Phase 1 security review:
--   1. Deactivated users could still write their own rows (library items, profile, absences...).
--   2. The parent role counted as a board member (board-shared library, answer keys, tags).
--   3. Audit gaps: alerts deleted by cascade, class-team role changes, role updates.
--   4. Co-teachers could not edit a student holding another teacher's personal level.
--   5. Ids from other scopes were accepted (rooms, subjects, library items).
--   6. "Created by" columns could be forged through the API.
-- Tests: supabase/tests/07_security_review.test.sql

-- ---------------------------------------------------------------------------------------
-- 1. Active-user identity for ownership checks
-- ---------------------------------------------------------------------------------------

-- auth.uid() for an active (not deactivated) user, otherwise null.
create function app.active_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id from public.users u
  where u.id = (select auth.uid()) and u.deactivated_at is null;
$$;

grant execute on function app.active_user_id() to authenticated, service_role;

create or replace function app.can_read_library_item(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.library_items i
    where i.id = p_item_id
      and (
        i.author_id = (select app.active_user_id())
        or i.board_id in (select app.my_admin_board_ids())
        or (
          i.status in ('teacher_reviewed', 'board_approved')
          and (
            (i.share_scope = 'school' and i.school_id in (select app.my_staff_school_ids()))
            or (i.share_scope = 'board' and i.board_id in (select app.my_board_ids()))
          )
        )
      )
  );
$$;

create or replace function app.can_edit_library_item(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.library_items i
    where i.id = p_item_id
      and (
        (i.author_id = (select app.active_user_id()) and i.status <> 'board_approved')
        or i.board_id in (select app.my_admin_board_ids())
      )
  );
$$;

drop policy library_items_insert on public.library_items;
create policy library_items_insert on public.library_items
  for insert to authenticated
  with check (
    author_id = (select app.active_user_id())
    and board_id in (select app.my_board_ids())
    and (school_id is null or school_id in (select app.my_staff_school_ids()))
    and status = 'draft'
    and source = 'teacher_created'
  );

drop policy library_items_update on public.library_items;
create policy library_items_update on public.library_items
  for update to authenticated
  using (app.can_edit_library_item(id))
  with check (
    board_id in (select app.my_admin_board_ids())
    or (
      author_id = (select app.active_user_id())
      and (school_id is null or school_id in (select app.my_staff_school_ids()))
      and status in ('draft', 'teacher_reviewed', 'archived')
    )
  );

drop policy library_items_delete on public.library_items;
create policy library_items_delete on public.library_items
  for delete to authenticated
  using (author_id = (select app.active_user_id()) and status in ('draft', 'rejected', 'archived'));

drop policy library_item_ratings_own on public.library_item_ratings;
create policy library_item_ratings_own on public.library_item_ratings
  for all to authenticated
  using (rater_id = (select app.active_user_id()))
  with check (rater_id = (select app.active_user_id()) and app.can_read_library_item(item_id));

drop policy collections_select on public.collections;
create policy collections_select on public.collections
  for select to authenticated
  using (
    owner_id = (select app.active_user_id())
    or (share_scope = 'school' and school_id in (select app.my_staff_school_ids()))
    or (share_scope = 'board' and board_id in (select app.my_board_ids()))
  );

drop policy collections_write on public.collections;
create policy collections_write on public.collections
  for all to authenticated
  using (owner_id = (select app.active_user_id()))
  with check (
    owner_id = (select app.active_user_id())
    and board_id in (select app.my_board_ids())
    and (school_id is null or school_id in (select app.my_staff_school_ids()))
  );

drop policy collection_items_write on public.collection_items;
create policy collection_items_write on public.collection_items
  for all to authenticated
  using (
    collection_id in (select c.id from public.collections c where c.owner_id = (select app.active_user_id()))
  )
  with check (
    collection_id in (select c.id from public.collections c where c.owner_id = (select app.active_user_id()))
    and app.can_read_library_item(item_id)
  );

drop policy users_update_self on public.users;
create policy users_update_self on public.users
  for update to authenticated
  using (id = (select app.active_user_id()))
  with check (id = (select app.active_user_id()));

drop policy language_levels_select on public.language_levels;
create policy language_levels_select on public.language_levels
  for select to authenticated
  using (
    board_id in (select app.my_board_ids())
    and (owner_user_id is null or owner_user_id = (select app.active_user_id()))
  );

drop policy language_levels_write on public.language_levels;
create policy language_levels_write on public.language_levels
  for all to authenticated
  using (
    (owner_user_id is null and board_id in (select app.my_admin_board_ids()))
    or (owner_user_id = (select app.active_user_id()) and board_id in (select app.my_board_ids()))
  )
  with check (
    (owner_user_id is null and board_id in (select app.my_admin_board_ids()))
    or (owner_user_id = (select app.active_user_id()) and board_id in (select app.my_board_ids()))
  );

drop policy class_teachers_delete on public.class_teachers;
create policy class_teachers_delete on public.class_teachers
  for delete to authenticated
  using (
    class_id in (select app.my_homeroom_class_ids())
    or user_id = (select app.active_user_id())
  );

drop policy absences_select on public.absences;
create policy absences_select on public.absences
  for select to authenticated
  using (
    teacher_id = (select app.active_user_id())
    or school_id in (
      select app.my_school_ids(array['principal', 'vice_principal', 'office_admin']::public.app_role[])
    )
  );

drop policy absences_insert on public.absences;
create policy absences_insert on public.absences
  for insert to authenticated
  with check (
    teacher_id = (select app.active_user_id())
    and school_id in (select app.my_school_ids(array['teacher']::public.app_role[]))
  );

drop policy absences_update on public.absences;
create policy absences_update on public.absences
  for update to authenticated
  using (teacher_id = (select app.active_user_id()))
  with check (teacher_id = (select app.active_user_id()));

drop policy ai_generations_select on public.ai_generations;
create policy ai_generations_select on public.ai_generations
  for select to authenticated
  using (
    user_id = (select app.active_user_id())
    or school_id in (select app.my_direction_school_ids())
    or board_id in (select app.my_admin_board_ids())
  );

-- ---------------------------------------------------------------------------------------
-- 2. Board membership means staff: parents are not board members for library and config.
-- ---------------------------------------------------------------------------------------

create or replace function app.my_board_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct ur.board_id
  from public.user_roles ur
  join public.users u on u.id = ur.user_id
  where ur.user_id = (select auth.uid())
    and u.deactivated_at is null
    and ur.role <> 'parent';
$$;

-- ---------------------------------------------------------------------------------------
-- 3. Audit gaps
-- ---------------------------------------------------------------------------------------

-- Log every alert deletion, including cascades from deleting a student. (When the whole
-- class is deleted, the class.deleted entry covers its alerts.)
create function app.student_alerts_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school_id uuid;
  v_board_id uuid;
begin
  select c.school_id, s.board_id into v_school_id, v_board_id
  from public.classes c join public.schools s on s.id = c.school_id
  where c.id = old.class_id;
  if v_school_id is not null then
    perform app.log_audit('student_alert.deleted', v_board_id, v_school_id, 'student', old.student_id,
      jsonb_build_object('alert_id', old.id, 'category', old.category));
  end if;
  return old;
end;
$$;

create trigger student_alerts_after_delete after delete on public.student_alerts
  for each row execute function app.student_alerts_after_delete();

-- The trigger now logs deletions; the function no longer does it twice.
create or replace function public.delete_student_alert(p_alert_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class_id uuid;
begin
  select class_id into v_class_id from public.student_alerts where id = p_alert_id;
  if v_class_id is null or not exists (select 1 from app.my_class_ids() c where c = v_class_id) then
    raise exception 'not allowed to delete this alert' using errcode = '42501';
  end if;
  delete from public.student_alerts where id = p_alert_id;
end;
$$;

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

  if v_school_id is not null then
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

create or replace function app.user_roles_audit()
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
  elsif tg_op = 'UPDATE' then
    perform app.log_audit('user_role.changed', new.board_id, new.school_id, 'user', new.user_id,
      jsonb_build_object(
        'from', jsonb_build_object('role', old.role, 'board_id', old.board_id, 'school_id', old.school_id),
        'to', jsonb_build_object('role', new.role, 'board_id', new.board_id, 'school_id', new.school_id)
      ));
    return new;
  else
    perform app.log_audit('user_role.revoked', old.board_id, old.school_id, 'user', old.user_id,
      jsonb_build_object('role', old.role));
    return old;
  end if;
end;
$$;

drop trigger user_roles_audit on public.user_roles;
create trigger user_roles_audit after insert or update or delete on public.user_roles
  for each row execute function app.user_roles_audit();

-- ---------------------------------------------------------------------------------------
-- 4. Only check a student's language level when it is set or changed
-- ---------------------------------------------------------------------------------------

create or replace function app.students_before_write()
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

  if new.default_language_level_id is not null
    and (tg_op = 'INSERT' or new.default_language_level_id is distinct from old.default_language_level_id)
    and not exists (
      select 1
      from public.language_levels ll
      join public.schools s on s.board_id = ll.board_id
      join public.classes c on c.school_id = s.id
      where ll.id = new.default_language_level_id
        and c.id = new.class_id
        and (ll.owner_user_id is null or ll.owner_user_id = (select auth.uid()))
    )
  then
    raise exception 'language level not available for this class' using errcode = '22023';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 5. References must stay within scope
-- ---------------------------------------------------------------------------------------

-- A subject is usable by a class if it is a standard subject or belongs to the class's board.
create function app.subject_allowed_for_class(p_subject_id uuid, p_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.subjects sub, public.classes c
    join public.schools s on s.id = c.school_id
    where sub.id = p_subject_id and c.id = p_class_id
      and (sub.board_id is null or sub.board_id = s.board_id)
  );
$$;

-- Library references from users must point at items they can read.
create function app.assert_library_item_readable(p_item_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_item_id is not null and (select auth.uid()) is not null and not app.can_read_library_item(p_item_id) then
    raise exception 'library item not available' using errcode = '42501';
  end if;
end;
$$;

create function app.classes_validate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.room_id is not null
    and (tg_op = 'INSERT' or new.room_id is distinct from old.room_id)
    and not exists (select 1 from public.rooms where id = new.room_id and school_id = new.school_id)
  then
    raise exception 'room does not belong to this school' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger classes_validate before insert or update on public.classes
  for each row execute function app.classes_validate();

create or replace function app.units_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
  elsif new.class_id <> old.class_id then
    raise exception 'a unit cannot move to another class' using errcode = '22023';
  end if;
  if (tg_op = 'INSERT' or new.subject_id is distinct from old.subject_id)
    and not app.subject_allowed_for_class(new.subject_id, new.class_id)
  then
    raise exception 'subject not available for this class' using errcode = '22023';
  end if;
  return new;
end;
$$;

create or replace function app.unit_lessons_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
  elsif new.unit_id <> old.unit_id then
    raise exception 'a lesson cannot move to another unit' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' or new.library_item_id is distinct from old.library_item_id then
    perform app.assert_library_item_readable(new.library_item_id);
  end if;
  return new;
end;
$$;

create or replace function app.timetable_blocks_validate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schedule public.schedule_type;
  v_cycle_length smallint;
  v_school_id uuid;
begin
  select s.schedule_type, s.cycle_length, s.id into v_schedule, v_cycle_length, v_school_id
  from public.classes c join public.schools s on s.id = c.school_id
  where c.id = new.class_id;

  if new.day_key > (case when v_schedule = 'cycle' then v_cycle_length else 5 end) then
    raise exception 'day_key % is outside this school''s schedule', new.day_key using errcode = '22023';
  end if;

  if new.teacher_id is not null and not exists (
    select 1 from public.class_teachers where class_id = new.class_id and user_id = new.teacher_id
  ) then
    raise exception 'the block''s teacher must be on the class team' using errcode = '22023';
  end if;

  if new.room_id is not null
    and not exists (select 1 from public.rooms where id = new.room_id and school_id = v_school_id)
  then
    raise exception 'room does not belong to this school' using errcode = '22023';
  end if;

  if new.kind <> 'subject' then
    new.subject_id := null;
  elsif new.subject_id is not null and not app.subject_allowed_for_class(new.subject_id, new.class_id) then
    raise exception 'subject not available for this class' using errcode = '22023';
  end if;
  return new;
end;
$$;

create function app.library_items_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.parent_item_id is distinct from old.parent_item_id then
    perform app.assert_library_item_readable(new.parent_item_id);
  end if;
  return new;
end;
$$;

create trigger library_items_before_write before insert or update on public.library_items
  for each row execute function app.library_items_before_write();

-- ---------------------------------------------------------------------------------------
-- 6. "Created by" columns are set by the database, not the caller
-- ---------------------------------------------------------------------------------------

create function app.stamp_created_by()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce((select auth.uid()), new.created_by);
  else
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

create trigger school_cycle_anchors_stamp before insert or update on public.school_cycle_anchors
  for each row execute function app.stamp_created_by();
create trigger catholic_references_stamp before insert or update on public.catholic_references
  for each row execute function app.stamp_created_by();

create function app.class_sessions_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce((select auth.uid()), new.created_by);
  else
    new.created_by := old.created_by;
  end if;
  if tg_op = 'INSERT' or new.library_item_id is distinct from old.library_item_id then
    perform app.assert_library_item_readable(new.library_item_id);
  end if;
  return new;
end;
$$;

create trigger class_sessions_before_write before insert or update on public.class_sessions
  for each row execute function app.class_sessions_before_write();

create function app.class_teachers_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.added_by := coalesce((select auth.uid()), new.added_by);
  return new;
end;
$$;

create trigger class_teachers_stamp before insert on public.class_teachers
  for each row execute function app.class_teachers_stamp();

-- Class sessions: ownership columns are not editable through the API.
revoke insert, update on public.class_sessions from authenticated;
grant insert (id, class_id, library_item_id, join_code, status, expires_at, keep_aggregate_results)
  on public.class_sessions to authenticated;
grant update (library_item_id, status, expires_at, ended_at, keep_aggregate_results)
  on public.class_sessions to authenticated;

-- Keep function privileges closed (see the hardening migration).
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon;
grant execute on function public.delete_student_alert(uuid) to authenticated;
grant execute on function app.assert_valid_timezone(text) to authenticated, service_role;
grant execute on function app.touch_updated_at() to authenticated, service_role;
