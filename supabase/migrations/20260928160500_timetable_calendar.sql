-- Timetables, the school calendar, and rotation-day anchors.
--
-- A timetable block belongs to a class and a "day key":
--   weekly schools: 1..5 = Monday..Friday
--   cycle schools:  1..N = Jour 1..Jour N (N = schools.cycle_length)
-- Which calendar date maps to which cycle day is computed by the app (packages/domain)
-- from school_cycle_anchors and non-instructional calendar events.

create table public.timetable_blocks (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  day_key smallint not null check (day_key between 1 and 20),
  start_time time not null,
  end_time time not null,
  kind public.block_kind not null default 'subject',
  subject_id uuid references public.subjects (id) on delete restrict,
  -- Optional label, e.g. "Prière du matin et O Canada". Defaults to the subject name in the UI.
  title text check (char_length(title) <= 80),
  -- Who teaches this block. Null means the class's homeroom teacher(s).
  teacher_id uuid references public.users (id) on delete set null,
  room_id uuid references public.rooms (id) on delete set null,
  notes text check (char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time),
  check (kind <> 'subject' or subject_id is not null)
);

create index timetable_blocks_class_day_idx on public.timetable_blocks (class_id, day_key, start_time);
create index timetable_blocks_teacher_id_idx on public.timetable_blocks (teacher_id);
create index timetable_blocks_subject_id_idx on public.timetable_blocks (subject_id);
create index timetable_blocks_room_id_idx on public.timetable_blocks (room_id);

create trigger timetable_blocks_touch before update on public.timetable_blocks
  for each row execute function app.touch_updated_at();

create function app.timetable_blocks_validate()
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
  end if;
  return new;
end;
$$;

create trigger timetable_blocks_validate before insert or update on public.timetable_blocks
  for each row execute function app.timetable_blocks_validate();

alter table public.timetable_blocks enable row level security;

create policy timetable_blocks_select on public.timetable_blocks
  for select to authenticated
  using (class_id in (select app.my_schedule_class_ids()));

create policy timetable_blocks_insert on public.timetable_blocks
  for insert to authenticated
  with check (class_id in (select app.my_class_ids()));

create policy timetable_blocks_update on public.timetable_blocks
  for update to authenticated
  using (class_id in (select app.my_class_ids()))
  with check (class_id in (select app.my_class_ids()));

create policy timetable_blocks_delete on public.timetable_blocks
  for delete to authenticated
  using (class_id in (select app.my_class_ids()));

grant select, delete on public.timetable_blocks to authenticated;
grant insert (class_id, day_key, start_time, end_time, kind, subject_id, title, teacher_id, room_id, notes)
  on public.timetable_blocks to authenticated;
grant update (day_key, start_time, end_time, kind, subject_id, title, teacher_id, room_id, notes)
  on public.timetable_blocks to authenticated;

-- ---------------------------------------------------------------------------------------
-- Calendar events. Three scopes:
--   board-wide  (school_id null)          e.g. PA days, holidays, winter break
--   school-wide (school_id set)           e.g. school mass, assembly, early dismissal
--   one class   (school_id and class_id)  e.g. a field trip
-- A time window narrows the effect; no times means all day.
-- ---------------------------------------------------------------------------------------

create table public.school_calendar_events (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  school_id uuid,
  class_id uuid references public.classes (id) on delete cascade,
  event_type public.calendar_event_type not null,
  title text not null check (char_length(title) between 1 and 120),
  starts_on date not null,
  ends_on date not null,
  start_time time,
  end_time time,
  -- False for informational events (e.g. "Journée pyjama") that don't change the schedule.
  affects_schedule boolean not null default true,
  notes text check (char_length(notes) <= 1000),
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (school_id, board_id) references public.schools (id, board_id) on delete cascade,
  check (ends_on >= starts_on),
  check (start_time is null or end_time is null or end_time > start_time),
  check (class_id is null or school_id is not null)
);

create index school_calendar_events_board_dates_idx
  on public.school_calendar_events (board_id, starts_on, ends_on);
create index school_calendar_events_school_dates_idx
  on public.school_calendar_events (school_id, starts_on, ends_on);
create index school_calendar_events_class_id_idx on public.school_calendar_events (class_id);

create trigger school_calendar_events_touch before update on public.school_calendar_events
  for each row execute function app.touch_updated_at();

create function app.school_calendar_events_validate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.class_id is not null and not exists (
    select 1 from public.classes where id = new.class_id and school_id = new.school_id
  ) then
    raise exception 'class does not belong to this school' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
  end if;
  return new;
end;
$$;

create trigger school_calendar_events_validate before insert or update on public.school_calendar_events
  for each row execute function app.school_calendar_events_validate();

alter table public.school_calendar_events enable row level security;

create policy school_calendar_events_select on public.school_calendar_events
  for select to authenticated
  using (
    (school_id is null and board_id in (select app.my_board_ids()))
    or school_id in (select app.my_staff_school_ids())
    or board_id in (select app.my_admin_board_ids())
  );

-- Who may write depends on the event's scope.
create function app.can_manage_calendar_event(p_board_id uuid, p_school_id uuid, p_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_school_id is null then
      exists (select 1 from app.my_admin_board_ids() b where b = p_board_id)
    when p_class_id is null then
      exists (
        select 1
        from app.my_school_ids(array['principal', 'vice_principal', 'office_admin']::public.app_role[]) s
        where s = p_school_id
      )
      or exists (select 1 from app.my_admin_board_ids() b where b = p_board_id)
    else
      exists (select 1 from app.my_class_ids() c where c = p_class_id)
      or exists (
        select 1
        from app.my_school_ids(array['principal', 'vice_principal', 'office_admin']::public.app_role[]) s
        where s = p_school_id
      )
  end;
$$;

grant execute on function app.can_manage_calendar_event(uuid, uuid, uuid) to authenticated;

create policy school_calendar_events_insert on public.school_calendar_events
  for insert to authenticated
  with check (app.can_manage_calendar_event(board_id, school_id, class_id));

create policy school_calendar_events_update on public.school_calendar_events
  for update to authenticated
  using (app.can_manage_calendar_event(board_id, school_id, class_id))
  with check (app.can_manage_calendar_event(board_id, school_id, class_id));

create policy school_calendar_events_delete on public.school_calendar_events
  for delete to authenticated
  using (app.can_manage_calendar_event(board_id, school_id, class_id));

grant select, delete on public.school_calendar_events to authenticated;
grant insert (board_id, school_id, class_id, event_type, title, starts_on, ends_on, start_time,
  end_time, affects_schedule, notes) on public.school_calendar_events to authenticated;
grant update (event_type, title, starts_on, ends_on, start_time, end_time, affects_schedule, notes)
  on public.school_calendar_events to authenticated;

-- ---------------------------------------------------------------------------------------
-- Rotation anchors: "on this date it is Jour N". The app counts instructional days forward
-- from the latest anchor on or before a date. Adding an anchor resets the rotation.
-- ---------------------------------------------------------------------------------------

create table public.school_cycle_anchors (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  anchor_date date not null,
  cycle_day smallint not null check (cycle_day between 1 and 20),
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (school_id, anchor_date)
);

alter table public.school_cycle_anchors enable row level security;

create policy school_cycle_anchors_select on public.school_cycle_anchors
  for select to authenticated
  using (school_id in (select app.my_staff_school_ids()));

create policy school_cycle_anchors_write on public.school_cycle_anchors
  for all to authenticated
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

grant select, insert, update, delete on public.school_cycle_anchors to authenticated;
