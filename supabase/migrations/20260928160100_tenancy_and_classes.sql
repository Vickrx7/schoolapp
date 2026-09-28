-- Tenancy (boards, schools, years, rooms), people (users, roles), reference data tables,
-- and classes with their students. Policies come in a later migration once the access
-- helper functions exist.

-- ---------------------------------------------------------------------------------------
-- Boards and schools
-- ---------------------------------------------------------------------------------------

create table public.boards (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 160),
  short_name text check (char_length(short_name) <= 40),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  default_timezone text not null default 'America/Toronto',
  -- Board-level configuration, validated by the app (packages/domain/src/settings.ts).
  settings jsonb not null default '{}' check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.boards is 'A school board (conseil scolaire). Top-level tenant.';

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  short_name text check (char_length(short_name) <= 60),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  -- Some northwestern Ontario schools are on Central time, so this is per school.
  timezone text not null default 'America/Toronto',
  -- 'weekly': timetable repeats Monday to Friday. 'cycle': Day 1..N rotation that skips
  -- non-instructional days (see school_cycle_anchors).
  schedule_type public.schedule_type not null default 'weekly',
  cycle_length smallint,
  -- Safety/medical alerts stay off until the board has approved collecting them.
  student_alerts_enabled boolean not null default false,
  settings jsonb not null default '{}' check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (board_id, slug),
  unique (id, board_id),
  check (
    (schedule_type = 'weekly' and cycle_length is null)
    or (schedule_type = 'cycle' and cycle_length between 2 and 20)
  )
);

create index schools_board_id_idx on public.schools (board_id);

create function app.schools_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform app.assert_valid_timezone(new.timezone);
  return new;
end;
$$;

create trigger schools_validate before insert or update of timezone on public.schools
  for each row execute function app.schools_validate();

create table public.school_years (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  starts_on date not null,
  ends_on date not null,
  created_at timestamptz not null default now(),
  unique (board_id, name),
  check (ends_on > starts_on)
);

create index school_years_board_id_idx on public.school_years (board_id);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  notes text check (char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  unique (school_id, name)
);

comment on table public.rooms is
  'Rooms and spaces. Used by substitute plans now; later mapped to PA zones and doors.';

-- ---------------------------------------------------------------------------------------
-- People and roles. Staff only: students are never users (see students below).
-- ---------------------------------------------------------------------------------------

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique check (char_length(email) <= 320),
  display_name text not null check (char_length(display_name) between 1 and 120),
  -- Shown in substitute plans, e.g. "Mme Tremblay". Optional.
  honorific text check (char_length(honorific) <= 20),
  preferred_locale text not null default 'fr-CA' check (preferred_locale in ('fr-CA', 'en-CA')),
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.users is 'Staff accounts. Provisioned by an admin (invite-only).';

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  role public.app_role not null,
  board_id uuid not null references public.boards (id) on delete cascade,
  -- Null only for board-scoped roles (board_admin).
  school_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid references public.users (id) on delete set null,
  foreign key (school_id, board_id) references public.schools (id, board_id) on delete cascade,
  unique nulls not distinct (user_id, role, board_id, school_id),
  check (
    (role = 'board_admin' and school_id is null)
    or (role <> 'board_admin' and school_id is not null)
  )
);

create index user_roles_user_id_idx on public.user_roles (user_id);
create index user_roles_school_id_idx on public.user_roles (school_id);
create index user_roles_board_id_idx on public.user_roles (board_id);

-- ---------------------------------------------------------------------------------------
-- Licensing: which feature modules a school may use.
-- ---------------------------------------------------------------------------------------

create table public.module_entitlements (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  module public.module_key not null,
  enabled boolean not null default true,
  valid_from date not null default current_date,
  valid_until date,
  licence_ref text check (char_length(licence_ref) <= 120),
  notes text check (char_length(notes) <= 500),
  updated_at timestamptz not null default now(),
  unique (school_id, module),
  check (valid_until is null or valid_until >= valid_from)
);

-- ---------------------------------------------------------------------------------------
-- Reference data: grades, subjects, language levels (configurable per board).
-- ---------------------------------------------------------------------------------------

create table public.grades (
  code text primary key check (code ~ '^[A-Z0-9]{1,4}$'),
  -- K1 (Maternelle) = -1, K2 (Jardin d'enfants) = 0, 1re..8e année = 1..8.
  ordinal smallint not null unique check (ordinal between -1 and 8),
  program text not null check (program in ('kindergarten', 'elementary')),
  label_fr text not null,
  short_label_fr text not null,
  label_en text not null
);

comment on table public.grades is 'Maternelle (K1), Jardin d''enfants (K2), 1re to 8e année.';

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  -- Null: standard Ontario subject available to every board. Set: board-specific subject.
  board_id uuid references public.boards (id) on delete cascade,
  code text not null check (code ~ '^[a-z0-9_]{2,32}$'),
  label_fr text not null check (char_length(label_fr) between 1 and 80),
  label_en text check (char_length(label_en) <= 80),
  -- Grade ordinals: K1 (Maternelle) = -1, K2 (Jardin) = 0, 1re..8e = 1..8.
  grade_min smallint not null default -1,
  grade_max smallint not null default 8,
  color text check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order smallint not null default 0,
  active boolean not null default true,
  check (grade_max >= grade_min)
);

create unique index subjects_scope_code_key
  on public.subjects (coalesce(board_id, '00000000-0000-0000-0000-000000000000'::uuid), code);

create table public.language_levels (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  -- Null: board-wide level. Set: a teacher's own extra level.
  owner_user_id uuid references public.users (id) on delete cascade,
  code text not null check (code ~ '^[a-z0-9_]{2,32}$'),
  label_fr text not null check (char_length(label_fr) between 1 and 60),
  label_en text check (char_length(label_en) <= 60),
  description_fr text check (char_length(description_fr) <= 1000),
  sort_order smallint not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.language_levels is
  'French language levels used to differentiate content. Not an official ALF or Ministry scale.';

create unique index language_levels_scope_code_key
  on public.language_levels (
    board_id,
    coalesce(owner_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    code
  );

-- ---------------------------------------------------------------------------------------
-- Classes and students
-- ---------------------------------------------------------------------------------------

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  school_year_id uuid not null references public.school_years (id) on delete restrict,
  name text not null check (char_length(name) between 1 and 80),
  room_id uuid references public.rooms (id) on delete set null,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index classes_school_id_idx on public.classes (school_id);
create index classes_school_year_id_idx on public.classes (school_year_id);

-- A class can span several grades (combined classes such as 3e/4e année).
create table public.class_grades (
  class_id uuid not null references public.classes (id) on delete cascade,
  grade_code text not null references public.grades (code),
  primary key (class_id, grade_code)
);

create table public.class_teachers (
  class_id uuid not null references public.classes (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  role public.class_teacher_role not null default 'homeroom',
  added_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (class_id, user_id)
);

create index class_teachers_user_id_idx on public.class_teachers (user_id);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  -- First name or nickname ONLY. Never last names, OEN, birthdates, addresses, photos or
  -- emails (SPEC section 6).
  first_name text not null check (char_length(btrim(first_name)) between 1 and 40),
  default_language_level_id uuid references public.language_levels (id) on delete set null,
  active boolean not null default true,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index students_class_id_idx on public.students (class_id);
create index students_default_language_level_id_idx on public.students (default_language_level_id);

comment on column public.students.first_name is 'First name or nickname only. No other identifiers.';

-- Safety/medical alerts: the only sensitive student field. Text is encrypted by the app
-- before it reaches the database. No direct table access: only the functions below.
create table public.student_alerts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  class_id uuid not null references public.classes (id) on delete cascade,
  category public.alert_category not null default 'other',
  body_ciphertext text not null check (char_length(body_ciphertext) between 1 and 4000),
  key_version smallint not null default 1,
  created_by uuid references public.users (id) on delete set null,
  updated_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index student_alerts_student_id_idx on public.student_alerts (student_id);
create index student_alerts_class_id_idx on public.student_alerts (class_id);

-- ---------------------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------------------

create trigger boards_touch before update on public.boards
  for each row execute function app.touch_updated_at();
create trigger schools_touch before update on public.schools
  for each row execute function app.touch_updated_at();
create trigger users_touch before update on public.users
  for each row execute function app.touch_updated_at();
create trigger module_entitlements_touch before update on public.module_entitlements
  for each row execute function app.touch_updated_at();
create trigger classes_touch before update on public.classes
  for each row execute function app.touch_updated_at();
create trigger students_touch before update on public.students
  for each row execute function app.touch_updated_at();
create trigger student_alerts_touch before update on public.student_alerts
  for each row execute function app.touch_updated_at();

-- Row Level Security on every table. Policies are added once helpers exist.
alter table public.boards enable row level security;
alter table public.schools enable row level security;
alter table public.school_years enable row level security;
alter table public.rooms enable row level security;
alter table public.users enable row level security;
alter table public.user_roles enable row level security;
alter table public.module_entitlements enable row level security;
alter table public.grades enable row level security;
alter table public.subjects enable row level security;
alter table public.language_levels enable row level security;
alter table public.classes enable row level security;
alter table public.class_grades enable row level security;
alter table public.class_teachers enable row level security;
alter table public.students enable row level security;
alter table public.student_alerts enable row level security;
