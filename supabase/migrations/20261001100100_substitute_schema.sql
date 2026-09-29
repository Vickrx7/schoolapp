-- Phase 3 (substitute hand-off): tables, columns and row level security.
--
-- The substitute tables have existed since the first migration, empty and unused. This migration
-- shapes them for the hand-off: absences and plans are written only through functions (next
-- migration), a plan is a generated layer plus the teacher's edits, the classes a plan covers are
-- stored by the database (never read from plan JSON), codes and sessions get their throttling and
-- device columns, reports get drafts and encrypted free text, and each class gets its « Fiche de
-- suppléance ».
-- DECISIONS: D-047, D-048, D-050, D-051, D-054, D-056, D-057.
-- Tests: supabase/tests/00_schema_invariants.test.sql, supabase/tests/10_substitute_plans.test.sql

-- ---------------------------------------------------------------------------------------
-- 1. Absences: every write goes through functions (publish_absence, update_absence,
--    cancel_absence). Reading is unchanged (owner, direction, office).
-- ---------------------------------------------------------------------------------------

alter table public.absences
  -- Adds a « Moment de foi » to the plans (D-058).
  add column catholic_connection boolean not null default true,
  -- Sent by the form so a retried tap publishes once.
  add column client_request_id uuid not null default gen_random_uuid(),
  add column cancelled_at timestamptz,
  -- Set when something the plans were built from changed; cleared when they are rebuilt (D-047).
  add column sources_changed_at timestamptz;

create unique index absences_client_request_key on public.absences (teacher_id, client_request_id);
create index absences_upcoming_idx on public.absences (school_id, ends_on) where status = 'published';

drop policy absences_insert on public.absences;
drop policy absences_update on public.absences;
-- Also removes the column-level grants. absences_select is unchanged.
revoke insert, update on public.absences from authenticated;

-- ---------------------------------------------------------------------------------------
-- 2. Plans. `plan` is the generated layer; the teacher's edits are an overlay that rebuilds
--    never overwrite (D-048). Only 'ready' and 'released' are used: a plan exists as soon as
--    the absence is published, and release is computed from review_deadline (D-047).
-- ---------------------------------------------------------------------------------------

alter table public.sub_plans
  alter column status set default 'ready',
  alter column plan set not null,
  alter column review_deadline set not null,
  add column generated_at timestamptz not null default now(),
  -- Bumped whenever what a reader sees changes (rebuild, edits); the portal audits per version.
  add column content_version integer not null default 1,
  add column edits jsonb
    check (edits is null or (jsonb_typeof(edits) = 'object' and pg_column_size(edits) <= 65536)),
  add column edits_revision integer not null default 0,
  add column edited_by uuid references public.users (id) on delete set null,
  add column edited_at timestamptz,
  add column released_by uuid references public.users (id) on delete set null,
  add constraint sub_plans_status_in_use check (status in ('ready', 'released')),
  add constraint sub_plans_plan_size check (pg_column_size(plan) <= 262144);

create index sub_plans_plan_date_idx on public.sub_plans (plan_date);
create index sub_plans_edited_by_idx on public.sub_plans (edited_by);
create index sub_plans_released_by_idx on public.sub_plans (released_by);

comment on column public.sub_plans.pdf_path is 'Unused: PDFs are rendered on demand (DECISIONS D-053).';

-- The owner reads and edits her plans. Direction and office read released plans only through
-- get_sub_plan_for_staff, which audits every view (D-056).
drop policy sub_plans_select on public.sub_plans;
create policy sub_plans_select on public.sub_plans
  for select to authenticated
  using (
    absence_id in (
      select a.id from public.absences a where a.teacher_id = (select app.active_user_id())
    )
  );

-- ---------------------------------------------------------------------------------------
-- 3. The classes a plan covers: the scope for the roster, alerts and report write-back. Set by
--    the database from the teacher's own classes, never from plan JSON (D-048). Definer
--    functions only.
-- ---------------------------------------------------------------------------------------

create table public.sub_plan_classes (
  sub_plan_id uuid not null references public.sub_plans (id) on delete cascade,
  class_id uuid not null references public.classes (id) on delete cascade,
  primary key (sub_plan_id, class_id)
);

create index sub_plan_classes_class_id_idx on public.sub_plan_classes (class_id);

alter table public.sub_plan_classes enable row level security;
revoke all on public.sub_plan_classes from anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 4. Access codes and sessions (D-050, D-051). The tables are empty in every install. The
--    per-code lockout is replaced by throttling per device and per network (sub_code_attempts).
-- ---------------------------------------------------------------------------------------

alter table public.sub_access_codes
  drop column failed_attempts,
  drop column locked_until,
  -- The window on the plan date (valid_on), computed in SQL in the school's time zone.
  add column valid_from timestamptz not null,
  add column max_devices smallint not null default 2 check (max_devices between 1 and 3),
  add column revoked_by uuid references public.users (id) on delete set null,
  -- hex(sha256(HMAC)): the web server sends the keyed MAC, never the code.
  add constraint sub_access_codes_hash_format check (code_hash ~ '^[0-9a-f]{64}$'),
  add constraint sub_access_codes_single_day
    check (expires_at > valid_from and expires_at - valid_from <= interval '24 hours');

create index sub_access_codes_active_idx on public.sub_access_codes (sub_plan_id) where revoked_at is null;
create index sub_access_codes_created_by_idx on public.sub_access_codes (created_by);
create index sub_access_codes_revoked_by_idx on public.sub_access_codes (revoked_by);

alter table public.sub_sessions
  add column sub_plan_id uuid not null references public.sub_plans (id) on delete cascade,
  -- HMAC of an HttpOnly device cookie: at most max_devices devices per code.
  add column device_key text not null check (device_key ~ '^[0-9a-f]{64}$'),
  add column last_seen_at timestamptz,
  -- The plan content_version this session last viewed (sub_plan.viewed is audited per version).
  add column last_viewed_version integer,
  add column revoked_by uuid references public.users (id) on delete set null,
  add constraint sub_sessions_token_format check (session_token_hash ~ '^[0-9a-f]{64}$');

create index sub_sessions_sub_plan_id_idx on public.sub_sessions (sub_plan_id);
create index sub_sessions_revoked_by_idx on public.sub_sessions (revoked_by);

-- sub_access_codes and sub_sessions keep no API grants.

-- Redemption attempts, for throttling. Both keys are HMACs made with the code key, so no raw
-- address or cookie is stored. Kept one day.
create table public.sub_code_attempts (
  id bigint generated always as identity primary key,
  device_key text not null check (device_key ~ '^[0-9a-f]{64}$'),
  ip_key text not null check (ip_key ~ '^[0-9a-f]{64}$'),
  succeeded boolean not null,
  attempted_at timestamptz not null default now()
);

create index sub_code_attempts_device_idx on public.sub_code_attempts (device_key, attempted_at desc);
create index sub_code_attempts_ip_idx on public.sub_code_attempts (ip_key, attempted_at desc);

alter table public.sub_code_attempts enable row level security;
revoke all on public.sub_code_attempts from anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 5. Reports (D-054): drafted during the day, tied to the session that started them. Free text
--    is encrypted by the web server; outcomes and absent-student ids stay in `content`.
-- ---------------------------------------------------------------------------------------

alter table public.sub_reports
  alter column status set default 'draft',
  alter column submitted_at drop not null,
  alter column submitted_at drop default,
  add column session_id uuid references public.sub_sessions (id) on delete set null,
  add column notes_ciphertext text
    check (notes_ciphertext is null
      or (notes_ciphertext ~ '^v\d+\.' and char_length(notes_ciphertext) <= 60000)),
  add column notes_key_version smallint,
  -- Set when the free text and the absent-student list are removed (D-059).
  add column notes_purged_at timestamptz,
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now(),
  add constraint sub_reports_content_size check (pg_column_size(content) <= 32768),
  add constraint sub_reports_submitted_at check (status = 'draft' or submitted_at is not null);

create index sub_reports_session_id_idx on public.sub_reports (session_id);

create trigger sub_reports_touch before update on public.sub_reports
  for each row execute function app.touch_updated_at();

-- Recreated in the next migration once app.sub_plan_window_ended exists (owner only; drafts
-- only after the access window).
drop policy sub_reports_select on public.sub_reports;

-- Progress written from a report. Insert and update grants on lesson_progress are per column,
-- so this column cannot be written through the API.
alter table public.lesson_progress
  add column sub_report_id uuid references public.sub_reports (id) on delete set null;

create index lesson_progress_sub_report_id_idx on public.lesson_progress (sub_report_id);

-- ---------------------------------------------------------------------------------------
-- 6. « Fiche de suppléance » (D-057): evergreen information per class for whoever replaces the
--    teacher. Class team only. No emergency or medical field on purpose: alerts have their own
--    encrypted store, and school-wide procedures live in schools.settings.substitute.
-- ---------------------------------------------------------------------------------------

create table public.class_sub_profiles (
  class_id uuid primary key references public.classes (id) on delete cascade,
  arrival_notes text check (char_length(arrival_notes) <= 2000),
  routines_notes text check (char_length(routines_notes) <= 2000),
  -- « Gestion de classe »: never shown to office staff, never printed, never sent to AI.
  classroom_management_notes text check (char_length(classroom_management_notes) <= 2000),
  dismissal_notes text check (char_length(dismissal_notes) <= 2000),
  fallback_activities text check (char_length(fallback_activities) <= 2000),
  -- « Collègue à côté »: an active teacher at the class's school (checked by trigger).
  neighbour_teacher_id uuid references public.users (id) on delete set null,
  neighbour_note text check (char_length(neighbour_note) <= 200),
  updated_by uuid references public.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

create index class_sub_profiles_neighbour_idx on public.class_sub_profiles (neighbour_teacher_id);
create index class_sub_profiles_updated_by_idx on public.class_sub_profiles (updated_by);

create trigger class_sub_profiles_touch before update on public.class_sub_profiles
  for each row execute function app.touch_updated_at();

alter table public.class_sub_profiles enable row level security;
revoke all on public.class_sub_profiles from anon, authenticated;

create policy class_sub_profiles_select on public.class_sub_profiles
  for select to authenticated
  using (class_id in (select app.my_class_ids()));

create policy class_sub_profiles_insert on public.class_sub_profiles
  for insert to authenticated
  with check (class_id in (select app.my_class_ids()));

create policy class_sub_profiles_update on public.class_sub_profiles
  for update to authenticated
  using (class_id in (select app.my_class_ids()))
  with check (class_id in (select app.my_class_ids()));

create policy class_sub_profiles_delete on public.class_sub_profiles
  for delete to authenticated
  using (class_id in (select app.my_homeroom_class_ids()));

grant select, delete on public.class_sub_profiles to authenticated;
grant insert (class_id, arrival_notes, routines_notes, classroom_management_notes, dismissal_notes,
  fallback_activities, neighbour_teacher_id, neighbour_note) on public.class_sub_profiles to authenticated;
grant update (arrival_notes, routines_notes, classroom_management_notes, dismissal_notes,
  fallback_activities, neighbour_teacher_id, neighbour_note) on public.class_sub_profiles to authenticated;

-- Keep function privileges closed (no new functions here; the invariant is re-applied anyway).
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon;
