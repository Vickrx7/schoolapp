-- « Mon année », slice S1: report periods, planned windows and unit-level attentes
-- (DECISIONS D-123, D-124; amends D-047).
-- Tests: supabase/tests/34_year_plan.test.sql
--
-- 1. `report_periods`: the board's three Ontario report periods per school year (`progress`,
--    `term1`, `term2`), each an evaluation window and two optional dates (« saisie au plus tard
--    le », « remise aux familles »). Read by the board's staff, written by its admins, like
--    `school_years`. Not audited (school years are not either). A window outside its year:
--    LXY03. A year edited later is not blocked; the editor says « Hors de l'année ».
-- 2. `units.planned_start_on` / `planned_end_on`: both or neither, inside the class's school
--    year (LXY01, checked when the window is set or changed). A unit whose subject changes while
--    it has unit-level attentes: LXY02.
-- 3. `units_flag_absences` fired on every update of a unit, so saving a window marked the
--    teacher's upcoming absences as changed and rebuilt their plans for nothing. Plans read only
--    `id`, `class_id`, `subject_id`, `title` and `status` of active units
--    (`app.sub_plan_sources`), so updates now flag only when one of those changes (a `when`
--    clause: `update of` would fire whenever the column is in the SET list, and both
--    `save_unit_plan` and the unit editor send the title again).
-- 4. `unit_expectations`: the attentes a unit aims at, of the unit's subject and of its class's
--    grades (LXY02), for the class team only (as `unit_lesson_expectations`). No flag trigger:
--    plans do not read them.
-- 5. `save_unit_plan` and `start_unit`, security invoker: row level security and the column
--    grants check every row, and planning a unit with its attentes is one transaction.
-- No event, no audit (teachers' planning is private professional activity, D-013, D-103).
-- Retention (D-105): windows and unit attentes stay when a class's students are purged, and go
-- with the unit or class (cascade); report periods go with their school year or board.
--
-- Error codes: LXY01 window outside the class's school year; LXY02 attente not of the unit's
-- subject and the class's grades, or the subject of a unit with attentes changed; LXY03 report
-- period outside its school year.

-- ---------------------------------------------------------------------------------------
-- 1. Report periods (D-124)
-- ---------------------------------------------------------------------------------------

create table public.report_periods (
  id uuid primary key default gen_random_uuid(),
  school_year_id uuid not null references public.school_years (id) on delete cascade,
  kind text not null check (kind in ('progress', 'term1', 'term2')),
  -- The evaluation window.
  starts_on date not null,
  ends_on date not null,
  -- « Saisie au plus tard le »
  due_on date,
  -- « Remise aux familles »
  issued_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Also the index of the foreign key.
  unique (school_year_id, kind),
  check (ends_on >= starts_on),
  check (due_on is null or due_on >= starts_on),
  check (issued_on is null or issued_on >= starts_on)
);

alter table public.report_periods enable row level security;
revoke all on public.report_periods from anon, authenticated;

create policy report_periods_select on public.report_periods
  for select to authenticated
  using (exists (
    select 1 from public.school_years y
    where y.id = school_year_id and y.board_id in (select app.my_board_ids())
  ));

create policy report_periods_write on public.report_periods
  for all to authenticated
  using (exists (
    select 1 from public.school_years y
    where y.id = school_year_id and y.board_id in (select app.my_admin_board_ids())
  ))
  with check (exists (
    select 1 from public.school_years y
    where y.id = school_year_id and y.board_id in (select app.my_admin_board_ids())
  ));

grant select, delete on public.report_periods to authenticated;
grant insert (school_year_id, kind, starts_on, ends_on, due_on, issued_on)
  on public.report_periods to authenticated;
grant update (starts_on, ends_on, due_on, issued_on) on public.report_periods to authenticated;

create trigger report_periods_touch before update on public.report_periods
  for each row execute function app.touch_updated_at();

-- The window lies inside its school year (LXY03).
create function app.report_periods_validate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_starts date;
  v_ends date;
begin
  select y.starts_on, y.ends_on into v_starts, v_ends
  from public.school_years y where y.id = new.school_year_id;
  if v_starts is not null and (new.starts_on < v_starts or new.ends_on > v_ends) then
    raise exception 'the report period must lie inside its school year' using errcode = 'LXY03';
  end if;
  return new;
end;
$$;

create trigger report_periods_validate before insert or update on public.report_periods
  for each row execute function app.report_periods_validate();

-- ---------------------------------------------------------------------------------------
-- 2. A unit's planned window (D-123)
-- ---------------------------------------------------------------------------------------

alter table public.units
  add column planned_start_on date,
  add column planned_end_on date,
  add constraint units_planned_window_check check (
    (planned_start_on is null) = (planned_end_on is null)
    and (planned_end_on is null or planned_end_on >= planned_start_on));

create index units_class_planned_idx on public.units (class_id, planned_start_on)
  where planned_start_on is not null;

grant insert (planned_start_on, planned_end_on), update (planned_start_on, planned_end_on)
  on public.units to authenticated;

create table public.unit_expectations (
  unit_id uuid not null references public.units (id) on delete cascade,
  expectation_id uuid not null references public.curriculum_expectations (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (unit_id, expectation_id)
);

create index unit_expectations_expectation_id_idx on public.unit_expectations (expectation_id);

-- A window set or changed lies inside the class's school year (LXY01); a unit with attentes
-- keeps its subject (LXY02). A signed-in user who cannot see the class learns nothing here: row
-- level security refuses the row (42501).
create function app.units_plan_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_starts date;
  v_ends date;
begin
  if (select auth.uid()) is not null
     and new.class_id not in (select app.my_class_ids()) then
    return new;
  end if;
  if new.planned_start_on is not null and (
    tg_op = 'INSERT'
    or new.planned_start_on is distinct from old.planned_start_on
    or new.planned_end_on is distinct from old.planned_end_on
  ) then
    select y.starts_on, y.ends_on into v_starts, v_ends
    from public.classes c join public.school_years y on y.id = c.school_year_id
    where c.id = new.class_id;
    if v_starts is not null
       and (new.planned_start_on < v_starts or new.planned_end_on > v_ends) then
      raise exception 'the planned window must lie inside the class''s school year'
        using errcode = 'LXY01';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.subject_id is distinct from old.subject_id
     and exists (select 1 from public.unit_expectations ue where ue.unit_id = new.id) then
    raise exception 'a unit with attentes keeps its subject' using errcode = 'LXY02';
  end if;
  return new;
end;
$$;

create trigger units_plan_guard
  before insert or update of planned_start_on, planned_end_on, subject_id on public.units
  for each row execute function app.units_plan_guard();

-- ---------------------------------------------------------------------------------------
-- 3. Plans are rebuilt only for what they read (amends D-047)
-- ---------------------------------------------------------------------------------------

drop trigger units_flag_absences on public.units;
create trigger units_flag_absences after insert or delete on public.units
  for each row execute function app.class_row_flag_absences();
create trigger units_flag_absences_update after update on public.units
  for each row
  when (old.class_id is distinct from new.class_id
    or old.subject_id is distinct from new.subject_id
    or old.title is distinct from new.title
    or old.status is distinct from new.status)
  execute function app.class_row_flag_absences();

-- ---------------------------------------------------------------------------------------
-- 4. Unit-level attentes (D-123): the class team only
-- ---------------------------------------------------------------------------------------

alter table public.unit_expectations enable row level security;
revoke all on public.unit_expectations from anon, authenticated;

create policy unit_expectations_all on public.unit_expectations
  for all to authenticated
  using (unit_id in (select app.my_unit_ids()))
  with check (unit_id in (select app.my_unit_ids()));

grant select, insert, delete on public.unit_expectations to authenticated;

-- An attente of the unit's subject and of one of its class's grades (LXY02; Assumption: no
-- cross-subject unit in v1). Checked for the class team and the database owner; anyone else is
-- refused by row level security without learning about the unit.
create function app.unit_expectations_validate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subject uuid;
  v_class uuid;
begin
  if (select auth.uid()) is not null
     and new.unit_id not in (select app.my_unit_ids()) then
    return new;
  end if;
  select u.subject_id, u.class_id into v_subject, v_class
  from public.units u where u.id = new.unit_id;
  if v_class is null then
    return new;   -- the foreign key refuses it
  end if;
  if not exists (
    select 1 from public.curriculum_expectations e
    where e.id = new.expectation_id
      and e.subject_id = v_subject
      and e.grade_code in (select cg.grade_code from public.class_grades cg where cg.class_id = v_class)
  ) then
    raise exception 'the attente is not of the unit''s subject and grades' using errcode = 'LXY02';
  end if;
  return new;
end;
$$;

create trigger unit_expectations_validate before insert on public.unit_expectations
  for each row execute function app.unit_expectations_validate();

-- ---------------------------------------------------------------------------------------
-- 5. Writes (security invoker)
-- ---------------------------------------------------------------------------------------

-- Creates (`p_unit_id` null: a `planned` unit) or changes a unit's title, description and
-- window, then makes its attentes exactly `p_expectation_ids` (at most 200, distinct). A unit of
-- another class, or one the caller cannot see: P0002. Its subject never changes here (22023).
create function public.save_unit_plan(
  p_unit_id uuid,
  p_class_id uuid,
  p_subject_id uuid,
  p_title text,
  p_description text,
  p_starts_on date,
  p_ends_on date,
  p_expectation_ids uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_subject uuid;
begin
  if p_expectation_ids is null
     or cardinality(p_expectation_ids) > 200
     or array_position(p_expectation_ids, null) is not null
     or cardinality(p_expectation_ids)
        <> (select count(distinct x) from unnest(p_expectation_ids) as x) then
    raise exception 'attentes: at most 200 distinct ids' using errcode = '22023';
  end if;

  if p_unit_id is null then
    insert into public.units (class_id, subject_id, title, description, status,
      planned_start_on, planned_end_on)
    values (p_class_id, p_subject_id, p_title, p_description, 'planned', p_starts_on, p_ends_on)
    returning id into v_id;
  else
    select u.subject_id into v_subject
    from public.units u where u.id = p_unit_id and u.class_id = p_class_id;
    if not found then
      raise exception 'unit not found' using errcode = 'P0002';
    end if;
    if v_subject is distinct from p_subject_id then
      raise exception 'a unit''s subject does not change here' using errcode = '22023';
    end if;
    update public.units
    set title = p_title, description = p_description,
        planned_start_on = p_starts_on, planned_end_on = p_ends_on
    where id = p_unit_id and class_id = p_class_id
    returning id into v_id;
    if v_id is null then
      raise exception 'unit not found' using errcode = 'P0002';
    end if;
  end if;

  delete from public.unit_expectations ue
  where ue.unit_id = v_id and ue.expectation_id <> all (p_expectation_ids);
  insert into public.unit_expectations (unit_id, expectation_id)
  select v_id, x from unnest(p_expectation_ids) as x
  on conflict do nothing;
  return v_id;
end;
$$;

-- Starts a unit (« Commencer l'unité »); with `p_finish_current`, the class and subject's
-- current unit is marked completed first, otherwise it goes back to planned (set_active_unit).
-- Units never start by themselves (Assumption, D-123).
create function public.start_unit(p_unit_id uuid, p_finish_current boolean)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_class uuid;
  v_subject uuid;
begin
  select u.class_id, u.subject_id into v_class, v_subject
  from public.units u where u.id = p_unit_id;
  if v_class is null then
    raise exception 'unit not found' using errcode = 'P0002';
  end if;
  if coalesce(p_finish_current, false) then
    update public.units
    set status = 'completed'
    where class_id = v_class and subject_id = v_subject and status = 'active'
      and id <> p_unit_id;
  end if;
  perform public.set_active_unit(p_unit_id);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 6. Permissions
-- ---------------------------------------------------------------------------------------

revoke execute on function
  public.save_unit_plan(uuid, uuid, uuid, text, text, date, date, uuid[]),
  public.start_unit(uuid, boolean)
from public, anon;
grant execute on function
  public.save_unit_plan(uuid, uuid, uuid, text, text, date, date, uuid[]),
  public.start_unit(uuid, boolean)
to authenticated;

-- Trigger functions: never called directly.
revoke execute on function
  app.report_periods_validate(),
  app.units_plan_guard(),
  app.unit_expectations_validate()
from public, anon, authenticated;
