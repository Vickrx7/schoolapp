-- Access helper functions used by RLS policies.
--
-- They are SECURITY DEFINER so policies can look up roles without recursive RLS checks,
-- STABLE so Postgres can evaluate them once per statement when used as
-- `x in (select app.fn())`, and they pin search_path to '' to avoid hijacking.
-- They only ever answer questions about the current user (auth.uid()).

create function app.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.users u
    where u.id = (select auth.uid()) and u.deactivated_at is null
  );
$$;

-- Schools where the current user holds any of the given roles (all school roles if null).
create function app.my_school_ids(p_roles public.app_role[] default null)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct ur.school_id
  from public.user_roles ur
  join public.users u on u.id = ur.user_id
  where ur.user_id = (select auth.uid())
    and u.deactivated_at is null
    and ur.school_id is not null
    and (p_roles is null or ur.role = any (p_roles));
$$;

-- Schools where the current user works as staff (any role except parent).
create function app.my_staff_school_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select app.my_school_ids(
    array['teacher', 'principal', 'vice_principal', 'office_admin', 'facilities']::public.app_role[]
  );
$$;

-- Schools where the current user is principal or vice-principal ("direction").
create function app.my_direction_school_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select app.my_school_ids(array['principal', 'vice_principal']::public.app_role[]);
$$;

-- Boards the current user administers.
create function app.my_admin_board_ids()
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
    and ur.role = 'board_admin';
$$;

-- Boards the current user belongs to through any role.
create function app.my_board_ids()
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
    and u.deactivated_at is null;
$$;

-- Classes the current user teaches. Requires a current teacher role at the class's school,
-- so removing someone's teacher role removes their class access too.
create function app.my_class_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select ct.class_id
  from public.class_teachers ct
  join public.classes c on c.id = ct.class_id
  where ct.user_id = (select auth.uid())
    and c.school_id in (select app.my_school_ids(array['teacher']::public.app_role[]));
$$;

-- Classes where the current user is a homeroom teacher (can manage the class team).
create function app.my_homeroom_class_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select ct.class_id
  from public.class_teachers ct
  join public.classes c on c.id = ct.class_id
  where ct.user_id = (select auth.uid())
    and ct.role = 'homeroom'
    and c.school_id in (select app.my_school_ids(array['teacher']::public.app_role[]));
$$;

-- Classes in schools the current user oversees as principal or vice-principal.
create function app.my_direction_class_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id from public.classes c
  where c.school_id in (select app.my_direction_school_ids());
$$;

-- Classes whose schedule the current user may see: teachers of the class, direction, office.
create function app.my_schedule_class_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select app.my_class_ids()
  union
  select c.id from public.classes c
  where c.school_id in (
    select app.my_school_ids(array['principal', 'vice_principal', 'office_admin']::public.app_role[])
  );
$$;

create function app.is_class_teacher(p_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from app.my_class_ids() c where c = p_class_id);
$$;

-- Users who share a school with the current user, plus everyone in boards they administer.
create function app.my_colleague_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select ur.user_id from public.user_roles ur
  where ur.school_id in (select app.my_staff_school_ids())
  union
  select ur.user_id from public.user_roles ur
  where ur.board_id in (select app.my_admin_board_ids());
$$;

-- Whether a given user holds a teacher role at the given class's school.
create function app.is_teacher_at_class_school(p_user_id uuid, p_class_id uuid)
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
    where c.id = p_class_id and ur.user_id = p_user_id
  );
$$;

grant execute on function
  app.is_active_user(),
  app.my_school_ids(public.app_role[]),
  app.my_staff_school_ids(),
  app.my_direction_school_ids(),
  app.my_admin_board_ids(),
  app.my_board_ids(),
  app.my_class_ids(),
  app.my_homeroom_class_ids(),
  app.my_direction_class_ids(),
  app.my_schedule_class_ids(),
  app.is_class_teacher(uuid),
  app.my_colleague_ids(),
  app.is_teacher_at_class_school(uuid, uuid)
to authenticated, service_role;
