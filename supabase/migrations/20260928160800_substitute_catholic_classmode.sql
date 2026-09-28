-- Substitute hand-off (Phase 3), Catholic references (Phase 4) and class mode (Phase 5):
-- tables and baseline access now so later phases don't need to rework the schema.

-- ---------------------------------------------------------------------------------------
-- Substitute hand-off
-- ---------------------------------------------------------------------------------------

create type public.absence_part as enum ('full_day', 'am', 'pm');
create type public.absence_status as enum ('draft', 'published', 'cancelled');
create type public.sub_plan_status as enum ('pending', 'generating', 'ready', 'released', 'failed');
create type public.sub_report_status as enum ('submitted', 'confirmed');

create table public.absences (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.users (id) on delete cascade,
  school_id uuid not null references public.schools (id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  part public.absence_part not null default 'full_day',
  note text check (char_length(note) <= 1000),
  status public.absence_status not null default 'draft',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  -- Half days only make sense for a single day.
  check (part = 'full_day' or starts_on = ends_on)
);

create index absences_teacher_dates_idx on public.absences (teacher_id, starts_on);
create index absences_school_dates_idx on public.absences (school_id, starts_on);

create trigger absences_touch before update on public.absences
  for each row execute function app.touch_updated_at();

create table public.sub_plans (
  id uuid primary key default gen_random_uuid(),
  absence_id uuid not null references public.absences (id) on delete cascade,
  plan_date date not null,
  plan jsonb check (plan is null or jsonb_typeof(plan) = 'object'),
  pdf_path text check (char_length(pdf_path) <= 500),
  status public.sub_plan_status not null default 'pending',
  -- If not reviewed by then, the plan is released as generated.
  review_deadline timestamptz,
  reviewed_by uuid references public.users (id) on delete set null,
  reviewed_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (absence_id, plan_date)
);

create index sub_plans_reviewed_by_idx on public.sub_plans (reviewed_by);

create trigger sub_plans_touch before update on public.sub_plans
  for each row execute function app.touch_updated_at();

-- Codes are single-day, hashed (keyed HMAC, never plain text), rate-limited and revocable.
create table public.sub_access_codes (
  id uuid primary key default gen_random_uuid(),
  sub_plan_id uuid not null references public.sub_plans (id) on delete cascade,
  code_hash text not null unique,
  valid_on date not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  last_used_at timestamptz,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index sub_access_codes_sub_plan_id_idx on public.sub_access_codes (sub_plan_id);

-- A substitute's browser session, bound to one code (and so one plan, one day).
create table public.sub_sessions (
  id uuid primary key default gen_random_uuid(),
  access_code_id uuid not null references public.sub_access_codes (id) on delete cascade,
  session_token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create index sub_sessions_access_code_id_idx on public.sub_sessions (access_code_id);

create table public.sub_reports (
  id uuid primary key default gen_random_uuid(),
  sub_plan_id uuid not null unique references public.sub_plans (id) on delete cascade,
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  status public.sub_report_status not null default 'submitted',
  submitted_at timestamptz not null default now(),
  confirmed_by uuid references public.users (id) on delete set null,
  confirmed_at timestamptz
);

create index sub_reports_confirmed_by_idx on public.sub_reports (confirmed_by);

alter table public.absences enable row level security;
alter table public.sub_plans enable row level security;
alter table public.sub_access_codes enable row level security;
alter table public.sub_sessions enable row level security;
alter table public.sub_reports enable row level security;

-- Teachers manage their own absences; direction and office see their school's.
create policy absences_select on public.absences
  for select to authenticated
  using (
    teacher_id = (select auth.uid())
    or school_id in (
      select app.my_school_ids(array['principal', 'vice_principal', 'office_admin']::public.app_role[])
    )
  );

create policy absences_insert on public.absences
  for insert to authenticated
  with check (
    teacher_id = (select auth.uid())
    and school_id in (select app.my_school_ids(array['teacher']::public.app_role[]))
  );

create policy absences_update on public.absences
  for update to authenticated
  using (teacher_id = (select auth.uid()))
  with check (teacher_id = (select auth.uid()));

grant select on public.absences to authenticated;
grant insert (teacher_id, school_id, starts_on, ends_on, part, note) on public.absences to authenticated;
grant update (starts_on, ends_on, part, note) on public.absences to authenticated;

create policy sub_plans_select on public.sub_plans
  for select to authenticated
  using (absence_id in (select a.id from public.absences a));

grant select on public.sub_plans to authenticated;

create policy sub_reports_select on public.sub_reports
  for select to authenticated
  using (sub_plan_id in (select p.id from public.sub_plans p));

grant select on public.sub_reports to authenticated;

-- sub_access_codes and sub_sessions: no API access (server-side functions only, Phase 3).

-- ---------------------------------------------------------------------------------------
-- Catholic references (board-editable)
-- ---------------------------------------------------------------------------------------

create type public.catholic_reference_type as enum (
  'virtue', 'graduate_expectation', 'reflection', 'prayer', 'scripture'
);

create type public.liturgical_season as enum (
  'avent', 'noel', 'careme', 'paques', 'temps_ordinaire'
);

create table public.catholic_references (
  id uuid primary key default gen_random_uuid(),
  -- Null: platform default visible to every board (read-only). Set: the board's own.
  board_id uuid references public.boards (id) on delete cascade,
  type public.catholic_reference_type not null,
  title text not null check (char_length(title) between 1 and 160),
  text_fr text not null check (char_length(text_fr) between 1 and 4000),
  text_en text check (char_length(text_en) <= 4000),
  grade_min smallint not null default -1,
  grade_max smallint not null default 8,
  liturgical_season public.liturgical_season,
  tags text[] not null default '{}',
  source_note text check (char_length(source_note) <= 500),
  active boolean not null default true,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (grade_max >= grade_min)
);

create index catholic_references_board_id_idx on public.catholic_references (board_id);

create trigger catholic_references_touch before update on public.catholic_references
  for each row execute function app.touch_updated_at();

alter table public.catholic_references enable row level security;

create policy catholic_references_select on public.catholic_references
  for select to authenticated
  using (board_id is null or board_id in (select app.my_board_ids()));

create policy catholic_references_write on public.catholic_references
  for all to authenticated
  using (board_id in (select app.my_admin_board_ids()))
  with check (board_id in (select app.my_admin_board_ids()));

grant select, insert, update, delete on public.catholic_references to authenticated;

-- ---------------------------------------------------------------------------------------
-- Class mode: projector player with optional student devices. No student accounts;
-- participants are a nickname or team name, never linked to the roster. Responses are
-- deleted when the session ends unless the teacher keeps aggregate results.
-- ---------------------------------------------------------------------------------------

create type public.class_session_status as enum ('open', 'closed');

create table public.class_sessions (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  library_item_id uuid references public.library_items (id) on delete set null,
  join_code text not null check (join_code ~ '^[A-Z0-9]{4,8}$'),
  status public.class_session_status not null default 'open',
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  keep_aggregate_results boolean not null default false
);

create unique index class_sessions_open_join_code_key
  on public.class_sessions (join_code) where status = 'open';
create index class_sessions_class_id_idx on public.class_sessions (class_id);
create index class_sessions_library_item_id_idx on public.class_sessions (library_item_id);

create table public.session_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.class_sessions (id) on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 24),
  team text check (char_length(team) <= 24),
  joined_at timestamptz not null default now()
);

create index session_participants_session_id_idx on public.session_participants (session_id);

create table public.session_responses (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.class_sessions (id) on delete cascade,
  participant_id uuid not null references public.session_participants (id) on delete cascade,
  question_key text not null check (char_length(question_key) between 1 and 60),
  response jsonb not null,
  is_correct boolean,
  created_at timestamptz not null default now()
);

create index session_responses_session_id_idx on public.session_responses (session_id);
create index session_responses_participant_id_idx on public.session_responses (participant_id);

create table public.class_session_results (
  session_id uuid primary key references public.class_sessions (id) on delete cascade,
  aggregate jsonb not null check (jsonb_typeof(aggregate) = 'object'),
  saved_at timestamptz not null default now()
);

alter table public.class_sessions enable row level security;
alter table public.session_participants enable row level security;
alter table public.session_responses enable row level security;
alter table public.class_session_results enable row level security;

create policy class_sessions_all on public.class_sessions
  for all to authenticated
  using (class_id in (select app.my_class_ids()))
  with check (class_id in (select app.my_class_ids()));
grant select, insert, update, delete on public.class_sessions to authenticated;

create policy session_participants_teacher on public.session_participants
  for select to authenticated
  using (session_id in (select s.id from public.class_sessions s));
create policy session_participants_teacher_delete on public.session_participants
  for delete to authenticated
  using (session_id in (select s.id from public.class_sessions s));
grant select, delete on public.session_participants to authenticated;

create policy session_responses_teacher on public.session_responses
  for select to authenticated
  using (session_id in (select s.id from public.class_sessions s));
create policy session_responses_teacher_delete on public.session_responses
  for delete to authenticated
  using (session_id in (select s.id from public.class_sessions s));
grant select, delete on public.session_responses to authenticated;

create policy class_session_results_all on public.class_session_results
  for all to authenticated
  using (session_id in (select s.id from public.class_sessions s))
  with check (session_id in (select s.id from public.class_sessions s));
grant select, insert, update, delete on public.class_session_results to authenticated;
