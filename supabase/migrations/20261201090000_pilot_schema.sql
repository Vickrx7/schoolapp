-- Phase 6 (pilot readiness), shared schema: the tables, columns, audit catalogue and heartbeat
-- that the Phase 6 functions build on (accounts, onboarding, settings and feedback:
-- 20261201090100; audit viewer, retention and status: 20261201090200).
--
-- 1. Users: the pilot terms' version and acceptance (D-110), and the onboarding checklist's
--    dismissal (D-109). Only the dismissal is writable through the API; the terms are written by
--    `accept_terms` (a definer function).
-- 2. Classes: sample classes (D-109), never in substitute plans, and the time a class's student
--    data was purged after its school year (D-105). Neither column is writable through the API.
-- 3. Staff invitations (D-107): board admins read their board's; written by functions and the
--    worker only. No invitation e-mail leaves our servers: the inviter sends the message.
-- 4. Pilot feedback (D-116): board admins of the sender's board read it and mark it.
-- 5. The audit action catalogue (D-103): which audience may read each action. An action missing
--    from it is shown to nobody. It lists every action the migrations write today, plus Phase 6's.
-- 6. Heartbeats (D-112): the worker, the nightly retention job and backups record their last
--    run; board admins see a state and three times through `system_status()`, never counts.
-- 7. Indexes for the audit viewer and the retention purges.
--
-- DECISIONS: D-103, D-105, D-107, D-109, D-110, D-112, D-116.
-- Tests: supabase/tests/00_schema_invariants.test.sql

-- ---------------------------------------------------------------------------------------
-- 1. Users: terms and onboarding (D-109, D-110)
-- ---------------------------------------------------------------------------------------

alter table public.users
  -- `CURRENT_TERMS_VERSION` in packages/domain/src/legal.ts, e.g. 2026-11-pilote-1.
  add column terms_version text check (terms_version ~ '^[0-9]{4}-[0-9]{2}-[a-z0-9-]{1,24}$'),
  add column terms_accepted_at timestamptz,
  -- « Masquer » on the « Pour bien commencer » checklist.
  add column onboarding_dismissed_at timestamptz,
  add constraint users_terms_together check ((terms_version is null) = (terms_accepted_at is null));

-- The user's own row only (policy users_update_self). The terms are set by accept_terms.
grant update (onboarding_dismissed_at) on public.users to authenticated;

-- ---------------------------------------------------------------------------------------
-- 2. Classes: sample classes and the student-data purge (D-105, D-109). No grants: functions only.
-- ---------------------------------------------------------------------------------------

alter table public.classes
  -- The teacher whose « classe exemple » this is (set only by app.mark_sample_class). Sample
  -- classes are never part of a substitute plan, and are deleted 60 days after creation.
  add column sample_owner_id uuid references public.users (id) on delete cascade,
  -- When the nightly retention job removed the class's students (first names, levels, alerts),
  -- a year after its school year ended. Units, lessons, timetable and progress stay.
  add column students_purged_at timestamptz;

-- One sample class per teacher and school. Also the index of the foreign key.
create unique index classes_one_sample_idx on public.classes (sample_owner_id, school_id)
  where sample_owner_id is not null;

-- ---------------------------------------------------------------------------------------
-- 3. Staff invitations (D-107)
-- ---------------------------------------------------------------------------------------

create table public.staff_invitations (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  school_id uuid,
  email text not null check (char_length(email) between 3 and 320
    and email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  honorific text check (char_length(honorific) <= 20),
  role public.app_role not null
    check (role in ('teacher', 'principal', 'vice_principal', 'office_admin', 'board_admin')),
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed', 'cancelled')),
  error_code text check (error_code in ('authNotConfigured', 'authRefused', 'emailConflict', 'expired')),
  user_id uuid references public.users (id) on delete set null,
  invited_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  foreign key (school_id, board_id) references public.schools (id, board_id) on delete cascade,
  -- A board admin has no school; every other role has one.
  check ((role = 'board_admin') = (school_id is null)),
  check ((status = 'failed') = (error_code is not null))
);

create index staff_invitations_board_created_idx on public.staff_invitations (board_id, created_at desc);
create index staff_invitations_school_id_idx on public.staff_invitations (school_id);
create index staff_invitations_user_id_idx on public.staff_invitations (user_id);
create index staff_invitations_invited_by_idx on public.staff_invitations (invited_by);
-- One pending invitation per address, role and place (a second one is 23505: staffAlreadyInvited).
create unique index staff_invitations_one_pending on public.staff_invitations
  (board_id, email, role, coalesce(school_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'pending';

alter table public.staff_invitations enable row level security;
revoke all on public.staff_invitations from anon, authenticated;
create policy staff_invitations_select on public.staff_invitations for select to authenticated
  using (board_id in (select app.my_admin_board_ids()));
-- Writes: invite_staff, cancel_staff_invitation and the worker only.
grant select on public.staff_invitations to authenticated;

-- ---------------------------------------------------------------------------------------
-- 4. Pilot feedback (D-116)
-- ---------------------------------------------------------------------------------------

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  school_id uuid references public.schools (id) on delete set null,
  user_id uuid references public.users (id) on delete cascade,
  kind text not null check (kind in ('problem', 'idea', 'question')),
  message text not null check (char_length(btrim(message)) between 1 and 2000),
  -- The route's template (`/classes/[id]/planning`), never a real address with ids or a query.
  route text check (char_length(route) <= 200 and route ~ '^/[][A-Za-z0-9/_-]*$'),
  -- The « Référence » an error page showed, so a report can be matched to a log line.
  error_ref text check (char_length(error_ref) <= 40 and error_ref ~ '^[A-Za-z0-9-]+$'),
  app_release text check (char_length(app_release) <= 40),
  device text check (device in ('phone', 'tablet', 'desktop')),
  locale text check (locale in ('fr-CA', 'en-CA')),
  may_contact boolean not null default true,
  status text not null default 'new' check (status in ('new', 'read', 'done')),
  created_at timestamptz not null default now()
);

create index feedback_board_created_idx on public.feedback (board_id, created_at desc);
create index feedback_school_id_idx on public.feedback (school_id);
-- Also the 20-a-day limit (LXF01).
create index feedback_user_id_idx on public.feedback (user_id, created_at);

alter table public.feedback enable row level security;
revoke all on public.feedback from anon, authenticated;
create policy feedback_select on public.feedback for select to authenticated
  using (board_id in (select app.my_admin_board_ids()));
create policy feedback_update on public.feedback for update to authenticated
  using (board_id in (select app.my_admin_board_ids()))
  with check (board_id in (select app.my_admin_board_ids()));
grant select on public.feedback to authenticated;
-- « Nouveau », « Lu », « Traité ». Inserts go through submit_feedback only.
grant update (status) on public.feedback to authenticated;

-- ---------------------------------------------------------------------------------------
-- 5. Audit action catalogue (D-103): who may read each action. No API access at all: the
--    viewer's function reads it. An action missing from it is shown to nobody.
-- ---------------------------------------------------------------------------------------

create table public.audit_action_catalog (
  action text primary key check (action ~ '^[a-z_]+(\.[a-z_]+)+$'),
  category text not null check (category in
    ('alerts', 'substitute', 'access', 'settings', 'classes', 'library', 'audit', 'system')),
  -- direction: the school's principal and vice-principals only; direction_board: they and the
  -- board's admins; board: the board's admins only; operator: nobody through the API.
  audience text not null check (audience in ('direction', 'direction_board', 'board', 'operator'))
);

alter table public.audit_action_catalog enable row level security;
revoke all on public.audit_action_catalog from anon, authenticated;

insert into public.audit_action_catalog (action, category, audience) values
  -- The school's direction only (D-013, D-056): alerts, absences, substitute days, class teams.
  ('student_alert.viewed', 'alerts', 'direction'),
  ('student_alert.created', 'alerts', 'direction'),
  ('student_alert.updated', 'alerts', 'direction'),
  ('student_alert.deleted', 'alerts', 'direction'),
  ('absence.published', 'substitute', 'direction'),
  ('absence.updated', 'substitute', 'direction'),
  ('absence.cancelled', 'substitute', 'direction'),
  ('sub_plan.viewed', 'substitute', 'direction'),
  ('sub_plan.printed', 'substitute', 'direction'),
  ('sub_plan.released', 'substitute', 'direction'),
  ('sub_plan.deleted', 'substitute', 'direction'),
  ('sub_code.issued', 'substitute', 'direction'),
  ('sub_code.revoked', 'substitute', 'direction'),
  ('sub_code.redeemed', 'substitute', 'direction'),
  ('sub_session.revoked', 'substitute', 'direction'),
  ('sub_session.ended', 'substitute', 'direction'),
  ('sub_report.submitted', 'substitute', 'direction'),
  ('sub_report.viewed', 'substitute', 'direction'),
  ('sub_report.confirmed', 'substitute', 'direction'),
  ('class_teacher.added', 'classes', 'direction'),
  ('class_teacher.removed', 'classes', 'direction'),
  ('class_teacher.role_changed', 'classes', 'direction'),
  ('class.deleted', 'classes', 'direction'),
  ('class.students_purged', 'classes', 'direction'),
  -- The school's direction and the board's admins: staff access, roles, school switches, exports.
  ('user_role.granted', 'access', 'direction_board'),
  ('user_role.revoked', 'access', 'direction_board'),
  ('user_role.changed', 'access', 'direction_board'),
  ('staff.invited', 'access', 'direction_board'),
  ('staff.access_removed', 'access', 'direction_board'),
  ('staff.access_restored', 'access', 'direction_board'),
  ('staff.deleted', 'access', 'direction_board'),
  ('school.ai_enabled', 'settings', 'direction_board'),
  ('school.ai_disabled', 'settings', 'direction_board'),
  ('school.student_alerts_enabled', 'alerts', 'direction_board'),
  ('school.student_alerts_disabled', 'alerts', 'direction_board'),
  ('audit_log.exported', 'audit', 'direction_board'),
  -- The board's admins only: board governance, the operator's actions, the board's library.
  ('staff.invitation_cancelled', 'access', 'board'),
  ('operator.access', 'access', 'board'),
  ('board.settings_changed', 'settings', 'board'),
  ('school.module_changed', 'settings', 'board'),
  ('school.ai_budget_changed', 'settings', 'board'),
  ('retention.purged', 'system', 'board'),
  ('library_item.approved', 'library', 'board'),
  ('library_item.rejected', 'library', 'board'),
  ('library_item.retracted', 'library', 'board'),
  ('library_item.faith_approved', 'library', 'board'),
  ('library_item.faith_rejected', 'library', 'board'),
  ('library_item.faith_flagged', 'library', 'board'),
  ('library_item.deleted', 'library', 'board'),
  ('library_reviewer.designated', 'library', 'board'),
  ('library_reviewer.changed', 'library', 'board'),
  ('library_reviewer.removed', 'library', 'board'),
  ('content_pack.imported', 'library', 'board'),
  ('content_pack.exported', 'library', 'board'),
  ('library_bulk_run.planned', 'library', 'board'),
  ('library_bulk_run.started', 'library', 'board'),
  ('library_bulk_run.cancel_requested', 'library', 'board'),
  ('library_bulk_run.cancelled', 'library', 'board'),
  ('library_bulk_run.completed', 'library', 'board'),
  ('library_bulk_run.failed', 'library', 'board'),
  -- Nobody through the API: a teacher's private professional activity (D-013; D-101): drafting
  -- and sharing steps, AI generation, class mode, the terms.
  ('library_item.saved_from_ai', 'library', 'operator'),
  ('library_item.reviewed', 'library', 'operator'),
  ('library_item.returned_to_draft', 'library', 'operator'),
  ('library_item.shared', 'library', 'operator'),
  ('library_item.scope_reduced', 'library', 'operator'),
  ('library_item.review_requested', 'library', 'operator'),
  ('library_item.review_cancelled', 'library', 'operator'),
  ('library_item.archived', 'library', 'operator'),
  ('library_item.restored', 'library', 'operator'),
  ('library_item.generated', 'library', 'operator'),
  ('library_item.levels_generated', 'library', 'operator'),
  ('library_item.remixed', 'library', 'operator'),
  ('class_session.ended', 'classes', 'operator'),
  ('class_mode_link.replaced', 'classes', 'operator'),
  ('user.terms_accepted', 'access', 'operator');

-- ---------------------------------------------------------------------------------------
-- 6. Heartbeats (D-112): read through system_status() (board admins: a state and times) and
--    operator_status() (the operator: details). No API access to the table.
-- ---------------------------------------------------------------------------------------

create table public.system_heartbeats (
  component text primary key check (component in ('worker', 'retention', 'backup')),
  beat_at timestamptz not null default now(),
  release text check (char_length(release) <= 40),
  -- Counts and times only (the worker's last dispatch, a purge's totals, a backup's size).
  details jsonb not null default '{}'
    check (jsonb_typeof(details) = 'object' and pg_column_size(details) <= 4096)
);

alter table public.system_heartbeats enable row level security;
revoke all on public.system_heartbeats from anon, authenticated;

-- Records a component's beat. The worker's timer, the retention job and the backup script call
-- it on their own connections, as the database owner; no API role may.
create function app.record_heartbeat(p_component text, p_release text, p_details jsonb default '{}')
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.system_heartbeats (component, beat_at, release, details)
  values (p_component, now(), p_release, coalesce(p_details, '{}'))
  on conflict (component) do update
    set beat_at = excluded.beat_at, release = excluded.release, details = excluded.details;
$$;

-- ---------------------------------------------------------------------------------------
-- 7. Indexes for the audit viewer (filter by person) and the retention purges (by age)
-- ---------------------------------------------------------------------------------------

create index audit_log_actor_occurred_idx on public.audit_log (actor_user_id, occurred_at desc);
create index audit_log_occurred_idx on public.audit_log (occurred_at);
create index event_outbox_dispatched_at_idx on public.event_outbox (dispatched_at)
  where dispatched_at is not null;
create index ai_generations_created_at_idx on public.ai_generations (created_at);

-- ---------------------------------------------------------------------------------------
-- 8. Permissions: nothing new to execute for the API.
-- ---------------------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon;
revoke execute on function app.record_heartbeat(text, text, jsonb)
  from public, anon, authenticated, service_role;
