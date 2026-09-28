-- Curriculum reference data and the teaching planner (units, lessons, progress).

-- ---------------------------------------------------------------------------------------
-- Curriculum: subject -> strand (domaine) -> expectation (attente / contenu d'apprentissage).
-- Loaded by an import tool; read-only for users. Licensing of official Ministry text must be
-- confirmed before loading full documents (see DECISIONS.md, D-030).
-- ---------------------------------------------------------------------------------------

create table public.strands (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects (id) on delete cascade,
  code text not null check (char_length(code) between 1 and 20),
  label_fr text not null check (char_length(label_fr) between 1 and 200),
  label_en text check (char_length(label_en) <= 200),
  curriculum_version text not null check (char_length(curriculum_version) between 1 and 40),
  sort_order smallint not null default 0,
  unique (subject_id, curriculum_version, code)
);

create table public.curriculum_expectations (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects (id) on delete cascade,
  grade_code text not null references public.grades (code),
  strand_id uuid references public.strands (id) on delete cascade,
  parent_id uuid references public.curriculum_expectations (id) on delete cascade,
  kind public.expectation_kind not null,
  code text not null check (char_length(code) between 1 and 20),
  text_fr text not null check (char_length(text_fr) between 1 and 2000),
  text_en text check (char_length(text_en) <= 2000),
  curriculum_version text not null check (char_length(curriculum_version) between 1 and 40),
  -- False until someone checks the text against the official document.
  is_verified boolean not null default false,
  source_note text check (char_length(source_note) <= 500),
  sort_order integer not null default 0,
  unique (subject_id, grade_code, curriculum_version, code)
);

create index curriculum_expectations_lookup_idx
  on public.curriculum_expectations (grade_code, subject_id, strand_id);
create index curriculum_expectations_strand_id_idx on public.curriculum_expectations (strand_id);
create index curriculum_expectations_parent_id_idx on public.curriculum_expectations (parent_id);

alter table public.strands enable row level security;
alter table public.curriculum_expectations enable row level security;

create policy strands_select on public.strands for select to authenticated using (true);
create policy curriculum_expectations_select on public.curriculum_expectations
  for select to authenticated using (true);

grant select on public.strands, public.curriculum_expectations to authenticated;

-- ---------------------------------------------------------------------------------------
-- Units and lessons. Visible to the class's teaching team only (not to direction):
-- planning is the teacher's professional space (DECISIONS.md, D-013).
-- ---------------------------------------------------------------------------------------

create table public.units (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  subject_id uuid not null references public.subjects (id) on delete restrict,
  title text not null check (char_length(title) between 1 and 120),
  description text check (char_length(description) <= 2000),
  status public.unit_status not null default 'planned',
  sort_order integer not null default 0,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index units_class_subject_idx on public.units (class_id, subject_id, sort_order);
create index units_subject_id_idx on public.units (subject_id);

-- One active unit per class and subject: that's where "what's next" comes from.
create unique index units_one_active_per_subject
  on public.units (class_id, subject_id) where status = 'active';

create table public.unit_lessons (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units (id) on delete cascade,
  sequence_number integer not null check (sequence_number > 0),
  title text not null check (char_length(title) between 1 and 160),
  objectives text check (char_length(objectives) <= 4000),
  materials text check (char_length(materials) <= 4000),
  content text check (char_length(content) <= 20000),
  -- Extra guidance for whoever replaces the teacher (used by substitute plans).
  sub_notes text check (char_length(sub_notes) <= 4000),
  duration_minutes smallint check (duration_minutes between 1 and 600),
  -- Filled when a lesson comes from the library; FK added with the library tables.
  library_item_id uuid,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unit_lessons_sequence_key unique (unit_id, sequence_number) deferrable initially immediate
);

create index unit_lessons_library_item_id_idx on public.unit_lessons (library_item_id);

create table public.unit_lesson_expectations (
  lesson_id uuid not null references public.unit_lessons (id) on delete cascade,
  expectation_id uuid not null references public.curriculum_expectations (id) on delete cascade,
  primary key (lesson_id, expectation_id)
);

create index unit_lesson_expectations_expectation_id_idx
  on public.unit_lesson_expectations (expectation_id);

create table public.lesson_progress (
  id uuid primary key default gen_random_uuid(),
  -- Denormalized from the lesson for fast RLS checks; always set by trigger.
  class_id uuid not null references public.classes (id) on delete cascade,
  lesson_id uuid not null unique references public.unit_lessons (id) on delete cascade,
  status public.lesson_progress_status not null default 'completed',
  -- The school day the lesson was taught (local date), when known.
  taught_on date,
  completed_at timestamptz not null default now(),
  completed_by uuid references public.users (id) on delete set null,
  source public.progress_source not null default 'teacher',
  note text check (char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index lesson_progress_class_id_idx on public.lesson_progress (class_id);
create index lesson_progress_completed_by_idx on public.lesson_progress (completed_by);

create trigger units_touch before update on public.units
  for each row execute function app.touch_updated_at();
create trigger unit_lessons_touch before update on public.unit_lessons
  for each row execute function app.touch_updated_at();

create function app.units_before_write()
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
  return new;
end;
$$;

create trigger units_before_write before insert or update on public.units
  for each row execute function app.units_before_write();

create function app.unit_lessons_before_write()
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
  return new;
end;
$$;

create trigger unit_lessons_before_write before insert or update on public.unit_lessons
  for each row execute function app.unit_lessons_before_write();

create function app.lesson_progress_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select u.class_id into new.class_id
  from public.unit_lessons l join public.units u on u.id = l.unit_id
  where l.id = new.lesson_id;

  new.updated_at := now();
  if new.source = 'teacher' then
    new.completed_by := coalesce((select auth.uid()), new.completed_by);
    if tg_op = 'INSERT' or new.status is distinct from old.status then
      new.completed_at := now();
    end if;
  end if;
  return new;
end;
$$;

create trigger lesson_progress_before_write before insert or update on public.lesson_progress
  for each row execute function app.lesson_progress_before_write();

create function app.lesson_progress_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.lesson_progress := case when tg_op = 'DELETE' then old else new end;
  v_school_id uuid;
  v_board_id uuid;
  v_unit_id uuid;
begin
  select c.school_id, s.board_id into v_school_id, v_board_id
  from public.classes c join public.schools s on s.id = c.school_id
  where c.id = v_row.class_id;
  select unit_id into v_unit_id from public.unit_lessons where id = v_row.lesson_id;

  if v_school_id is null then
    return v_row; -- class is being deleted
  end if;

  if tg_op = 'DELETE' then
    perform app.emit_event('lesson.progress_cleared', v_board_id, v_school_id, 'lesson',
      v_row.lesson_id, jsonb_build_object('class_id', v_row.class_id, 'unit_id', v_unit_id));
  elsif v_row.status = 'completed'
    and (tg_op = 'INSERT' or old.status is distinct from 'completed')
  then
    perform app.emit_event('lesson.completed', v_board_id, v_school_id, 'lesson',
      v_row.lesson_id, jsonb_build_object(
        'class_id', v_row.class_id, 'unit_id', v_unit_id, 'taught_on', v_row.taught_on,
        'source', v_row.source
      ));
  end if;
  return v_row;
end;
$$;

create trigger lesson_progress_events after insert or update or delete on public.lesson_progress
  for each row execute function app.lesson_progress_events();

-- Units owned by classes the current user teaches.
create function app.my_unit_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id from public.units u where u.class_id in (select app.my_class_ids());
$$;

create function app.my_lesson_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select l.id from public.unit_lessons l where l.unit_id in (select app.my_unit_ids());
$$;

grant execute on function app.my_unit_ids(), app.my_lesson_ids() to authenticated;

alter table public.units enable row level security;
alter table public.unit_lessons enable row level security;
alter table public.unit_lesson_expectations enable row level security;
alter table public.lesson_progress enable row level security;

create policy units_all on public.units
  for all to authenticated
  using (class_id in (select app.my_class_ids()))
  with check (class_id in (select app.my_class_ids()));

create policy unit_lessons_all on public.unit_lessons
  for all to authenticated
  using (unit_id in (select app.my_unit_ids()))
  with check (unit_id in (select app.my_unit_ids()));

create policy unit_lesson_expectations_all on public.unit_lesson_expectations
  for all to authenticated
  using (lesson_id in (select app.my_lesson_ids()))
  with check (lesson_id in (select app.my_lesson_ids()));

create policy lesson_progress_all on public.lesson_progress
  for all to authenticated
  using (class_id in (select app.my_class_ids()))
  with check (class_id in (select app.my_class_ids()));

grant select, delete on public.units to authenticated;
grant insert (class_id, subject_id, title, description, status, sort_order) on public.units to authenticated;
grant update (subject_id, title, description, status, sort_order) on public.units to authenticated;

grant select, delete on public.unit_lessons to authenticated;
grant insert (unit_id, sequence_number, title, objectives, materials, content, sub_notes,
  duration_minutes, library_item_id) on public.unit_lessons to authenticated;
grant update (sequence_number, title, objectives, materials, content, sub_notes, duration_minutes,
  library_item_id) on public.unit_lessons to authenticated;

grant select, insert, delete on public.unit_lesson_expectations to authenticated;

grant select, delete on public.lesson_progress to authenticated;
grant insert (lesson_id, status, taught_on, source, note) on public.lesson_progress to authenticated;
grant update (status, taught_on, source, note) on public.lesson_progress to authenticated;

-- Teachers can only record their own progress; substitute reports come through Phase 3 code.
create function app.lesson_progress_source_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' and new.source <> 'teacher' then
    raise exception 'only teacher progress can be recorded directly' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger lesson_progress_source_guard before insert or update on public.lesson_progress
  for each row execute function app.lesson_progress_source_guard();

-- ---------------------------------------------------------------------------------------
-- Planner RPCs (security invoker: RLS applies as usual)
-- ---------------------------------------------------------------------------------------

-- Renumbers a unit's lessons to match the given order (all lesson ids must be listed).
create function public.reorder_unit_lessons(p_unit_id uuid, p_lesson_ids uuid[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_existing integer;
begin
  select count(*) into v_existing from public.unit_lessons where unit_id = p_unit_id;
  if v_existing <> coalesce(cardinality(p_lesson_ids), 0)
    or v_existing <> (select count(distinct x) from unnest(p_lesson_ids) as x)
    or exists (
      select 1 from unnest(p_lesson_ids) as x
      where not exists (select 1 from public.unit_lessons l where l.id = x and l.unit_id = p_unit_id)
    )
  then
    raise exception 'lesson list does not match the unit' using errcode = '22023';
  end if;

  set constraints public.unit_lessons_sequence_key deferred;
  update public.unit_lessons l
  set sequence_number = o.position
  from unnest(p_lesson_ids) with ordinality as o (lesson_id, position)
  where l.id = o.lesson_id and l.sequence_number <> o.position;
end;
$$;

-- Makes a unit the active one for its class and subject.
create function public.set_active_unit(p_unit_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_unit public.units;
begin
  select * into v_unit from public.units where id = p_unit_id;
  if v_unit.id is null then
    raise exception 'unit not found' using errcode = 'P0002';
  end if;

  update public.units
  set status = 'planned'
  where class_id = v_unit.class_id and subject_id = v_unit.subject_id
    and status = 'active' and id <> p_unit_id;

  update public.units set status = 'active' where id = p_unit_id;
end;
$$;

-- One-tap check-off and undo. Security invoker: RLS decides whose lessons these are.
create function public.mark_lesson_taught(p_lesson_id uuid, p_taught_on date)
returns void
language sql
set search_path = ''
as $$
  insert into public.lesson_progress (lesson_id, status, taught_on, source)
  values (p_lesson_id, 'completed', p_taught_on, 'teacher')
  on conflict (lesson_id) do update
    set status = 'completed', taught_on = excluded.taught_on, source = 'teacher';
$$;

create function public.unmark_lesson(p_lesson_id uuid)
returns void
language sql
set search_path = ''
as $$
  delete from public.lesson_progress where lesson_id = p_lesson_id;
$$;

grant execute on function public.mark_lesson_taught(uuid, date) to authenticated;
grant execute on function public.unmark_lesson(uuid) to authenticated;
grant execute on function public.reorder_unit_lessons(uuid, uuid[]) to authenticated;
grant execute on function public.set_active_unit(uuid) to authenticated;
