-- Phase 6 (pilot readiness), slice S2: the audit viewer, AI usage totals, retention and the
-- system's status.
--
-- 1. The audit log is closed to the API (D-103): `select` is revoked from `authenticated` and its
--    policy dropped; `public.list_audit_entries` is the only reader, so its predicate is the rule.
--    A guard refuses new entries whose details hold free text (a first name, a note, a title, an
--    e-mail...), a string longer than 120 characters or more than 2 KB.
-- 2. The viewer (D-103): four audiences from `audit_action_catalog`; labels computed per viewer
--    (a person's name for colleagues only, a class name for classes the viewer may see, plan and
--    absence labels for the school's direction only, never a student's name); details pass a
--    whitelist of scalar keys; substitute entries whose code the office issued carry a flag
--    (D-056). The CSV export is audited (`log_audit_export`).
-- 3. The operator's changes are visible to the board (D-106): `boards.settings` keys `ai` and
--    `retention`, modules and AI budgets are audited by triggers (actor `service` for the service
--    role).
-- 4. AI usage rows are private to their author (D-104); board admins get per-school totals
--    (`board_ai_usage`), the direction keeps `ai_usage_summary`.
-- 5. Retention (D-105, implements D-018 and D-059): per-board settings (`boards.settings
--    .retention`, operator only, bounds in `app.retention_limits()`, the same as RETENTION_LIMITS
--    in packages/domain/src/settings.ts) and the nightly `app.retention_maintenance()`.
-- 6. Status (D-112): `system_status()` for board admins (a state and three times, no counts) and
--    `operator_status()` for the operator (counts).
-- 7. Permissions.
--
-- DECISIONS: D-013, D-017, D-018, D-056, D-059, D-103, D-104, D-105, D-106, D-112.
-- Tests: supabase/tests/05_audit_outbox.test.sql, 28_audit_viewer.test.sql, 29_retention.test.sql

-- ---------------------------------------------------------------------------------------
-- 1. The audit log is closed; the guard
-- ---------------------------------------------------------------------------------------

drop policy audit_log_select on public.audit_log;
revoke select on public.audit_log from authenticated;

-- Entries hold ids, dates, counts and short codes; never names, notes, titles, e-mails or alert
-- text (D-017). A plain trigger: it applies to every writer, the owner's functions included.
create function app.audit_log_guard_details()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.details ?| array['first_name', 'firstName', 'student_name', 'text', 'body', 'note',
                          'notes', 'message', 'content', 'title', 'email', 'phone']
     or pg_column_size(new.details) > 2048
     or jsonb_path_exists(new.details,
          'strict $.** ? (@.type() == "string" && @ like_regex "^.{121}" flag "s")') then
    raise exception 'audit details hold ids and short codes only' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger audit_log_guard_details before insert on public.audit_log
  for each row execute function app.audit_log_guard_details();

-- ---------------------------------------------------------------------------------------
-- 2. The viewer (D-103)
-- ---------------------------------------------------------------------------------------

-- What the signed-in viewer may see, computed once per call of the viewer's function: the labels
-- below check every id against it, never against a user id passed in by a caller.
create type app.audit_viewer as (
  user_id uuid,
  colleagues uuid[],          -- app.my_colleague_ids() and the admins of the viewer's boards
  classes uuid[],             -- app.my_schedule_class_ids()
  direction_schools uuid[],   -- app.my_direction_school_ids()
  staff_schools uuid[],       -- app.my_staff_school_ids()
  admin_boards uuid[],        -- app.my_admin_board_ids()
  boards uuid[]               -- app.my_board_ids()
);

-- A uuid held in an entry's details, or null (never an error that would hide the whole page).
create function app.audit_uuid(p_value text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case when p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then p_value::uuid end;
$$;

-- A person's display name, for the viewer, their colleagues and their boards' admins only (else
-- null: the screen says « Personne qui n'a plus accès »).
create function app.audit_person_label(p_user uuid, p_viewer app.audit_viewer)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.display_name
  from public.users u
  where u.id = p_user
    and (u.id = (p_viewer).user_id or u.id = any ((p_viewer).colleagues));
$$;

-- What an entry is about, in words the viewer may read. A student is shown only by their class
-- (« Élève · 3e année »), never by name; a deleted class by the name its deletion recorded.
create function app.audit_entity_label(p_type text, p_id uuid, p_details jsonb,
  p_viewer app.audit_viewer)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_label text;
begin
  if p_id is null or p_type is null then
    return null;
  end if;
  case p_type
    when 'class' then
      select c.name into v_label from public.classes c
      where c.id = p_id and c.id = any ((p_viewer).classes);
      if v_label is null and not exists (select 1 from public.classes c where c.id = p_id) then
        v_label := nullif(p_details ->> 'name', '');
      end if;
    when 'student' then
      select c.name into v_label
      from public.students st join public.classes c on c.id = st.class_id
      where st.id = p_id and c.id = any ((p_viewer).classes);
    when 'user' then
      v_label := app.audit_person_label(p_id, p_viewer);
    when 'school' then
      select s.name into v_label from public.schools s
      where s.id = p_id
        and (s.id = any ((p_viewer).staff_schools) or s.board_id = any ((p_viewer).admin_boards));
    when 'sub_plan', 'sub_report' then
      select p.plan_date::text || ' · ' || app.formal_staff_name(u.display_name, u.honorific)
      into v_label
      from public.sub_plans p
      join public.absences a on a.id = p.absence_id
      join public.users u on u.id = a.teacher_id
      where p.id = case when p_type = 'sub_plan' then p_id
                        else (select r.sub_plan_id from public.sub_reports r where r.id = p_id) end
        and a.school_id = any ((p_viewer).direction_schools);
    when 'absence' then
      select a.starts_on::text
          || case when a.ends_on <> a.starts_on then '–' || a.ends_on::text else '' end
          || ' · ' || app.formal_staff_name(u.display_name, u.honorific)
      into v_label
      from public.absences a join public.users u on u.id = a.teacher_id
      where a.id = p_id and a.school_id = any ((p_viewer).direction_schools);
    when 'library_item' then
      select i.title into v_label from public.library_items i
      where i.id = p_id and app.library_item_readable_by((p_viewer).user_id, p_id);
    when 'staff_invitation' then
      select i.display_name into v_label from public.staff_invitations i
      where i.id = p_id and i.board_id = any ((p_viewer).admin_boards);
    when 'board' then
      select b.name into v_label from public.boards b
      where b.id = p_id and b.id = any ((p_viewer).boards);
    else
      v_label := null;
  end case;
  return v_label;
end;
$$;

-- The details a viewer may read: a whitelist of keys with scalar values. Ids are dropped
-- (`code_id`, `sub_session_id`, `sub_plan_id`, `absence_id`, `class_id`, `alert_id`, `ai_job_id`,
-- `bulk_run_id`...); `user_id` and `issued_by` come back as labels.
create function app.audit_public_details(p_details jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
  from jsonb_each(case when jsonb_typeof(p_details) = 'object' then p_details else '{}' end) e
  where jsonb_typeof(e.value) in ('string', 'number', 'boolean')
    and e.key = any (array[
      'role', 'from', 'to', 'plan_date', 'starts_on', 'ends_on', 'part', 'previous_ends_on',
      'previous_part', 'alert_count', 'category', 'content_version', 'scope', 'scope_reduced',
      'revision', 'type', 'status', 'faith_reviewed', 'originality_confirmed', 'names_confirmed',
      'approves_content', 'reviews_faith', 'all', 'codes', 'sessions', 'completed',
      'not_completed', 'skipped', 'was_draft', 'lessons', 'pending_rows', 'resubmitted',
      'direction', 'reason', 'via', 'version', 'rows', 'count', 'students', 'results_kept', 'slug',
      'item_count', 'created', 'updated', 'unchanged', 'similar', 'failed', 'covered',
      'error_code', 'spent_usd', 'max_cost_usd', 'request_count', 'ever_approved', 'usage_count',
      'issued_by_role', 'module', 'enabled', 'keys', 'monthly_allowance_usd',
      'monthly_ceiling_usd',
      -- retention.purged (counts)
      'sub_plans', 'absences', 'classes', 'sample_classes', 'ai_usage', 'feedback',
      'invitations_expired', 'invitations_deleted', 'audit_rows'
    ]);
$$;

-- « Journal d'audit » (D-103): the school's direction reads the `direction` and
-- `direction_board` entries of their schools; board admins the `direction_board` and `board`
-- entries of their boards; `operator` entries and actions missing from the catalogue reach no one.
-- Office staff and teachers: 42501. Filters (`p_filters`, all optional): schoolId, boardId, from
-- and to (at most 366 days apart; default the 30 days before `to`, itself now), category,
-- actorUserId, actorType, entityId. `to` is excluded when given. Newest first; `p_before_id`
-- pages (keyset).
create function public.list_audit_entries(p_filters jsonb, p_before_id bigint default null,
  p_limit integer default 50)
returns table (
  id bigint,
  occurred_at timestamptz,
  action text,
  category text,
  actor_type public.audit_actor_type,
  actor_user_id uuid,
  actor_label text,
  issuer_label text,
  subject_label text,
  school_id uuid,
  school_name text,
  entity_type text,
  entity_id uuid,
  entity_label text,
  details jsonb,
  flags text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user uuid := app.active_user_id();
  v_direction uuid[] := array(select app.my_direction_school_ids());
  v_admin uuid[] := array(select app.my_admin_board_ids());
  v_filters jsonb := coalesce(p_filters, '{}');
  v_viewer app.audit_viewer;
  v_school uuid;
  v_board uuid;
  v_from timestamptz;
  v_to timestamptz;
  v_open_end boolean;
  v_category text;
  v_actor uuid;
  v_actor_type public.audit_actor_type;
  v_entity uuid;
begin
  if v_user is null or (cardinality(v_direction) = 0 and cardinality(v_admin) = 0) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  begin
    if jsonb_typeof(v_filters) <> 'object' then
      raise exception 'filters' using errcode = '22023';
    end if;
    v_school := nullif(v_filters ->> 'schoolId', '')::uuid;
    v_board := nullif(v_filters ->> 'boardId', '')::uuid;
    v_to := nullif(v_filters ->> 'to', '')::timestamptz;
    v_open_end := v_to is null;   -- up to now, included
    v_to := coalesce(v_to, now());
    v_from := coalesce(nullif(v_filters ->> 'from', '')::timestamptz, v_to - interval '30 days');
    v_category := nullif(v_filters ->> 'category', '');
    v_actor := nullif(v_filters ->> 'actorUserId', '')::uuid;
    v_actor_type := nullif(v_filters ->> 'actorType', '')::public.audit_actor_type;
    v_entity := nullif(v_filters ->> 'entityId', '')::uuid;
  exception when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or invalid_parameter_value then
    raise exception 'invalid filters' using errcode = '22023';
  end;
  if p_limit is null or p_limit not between 1 and 1000 or v_to <= v_from
     or v_to - v_from > interval '366 days'
     or (v_category is not null and v_category not in
       ('alerts', 'substitute', 'access', 'settings', 'classes', 'library', 'audit', 'system')) then
    raise exception 'invalid filters' using errcode = '22023';
  end if;

  -- Colleagues, and the admins of the viewer's boards (a principal reads who changed a role at
  -- their school).
  v_viewer := row(v_user,
    array(select app.my_colleague_ids()
          union
          select ur.user_id from public.user_roles ur
          where ur.role = 'board_admin' and ur.board_id in (select app.my_board_ids())),
    array(select app.my_schedule_class_ids()), v_direction, array(select app.my_staff_school_ids()),
    v_admin, array(select app.my_board_ids()))::app.audit_viewer;

  return query
  select a.id, a.occurred_at, a.action, c.category, a.actor_type, a.actor_user_id,
    app.audit_person_label(a.actor_user_id, v_viewer),
    case when a.actor_type = 'substitute'
      then app.audit_person_label(app.audit_uuid(a.details ->> 'issued_by'), v_viewer) end,
    case when a.details ? 'user_id'
      then app.audit_person_label(app.audit_uuid(a.details ->> 'user_id'), v_viewer) end,
    a.school_id, s.name, a.entity_type, a.entity_id,
    app.audit_entity_label(a.entity_type, a.entity_id, a.details, v_viewer),
    app.audit_public_details(a.details),
    case when a.actor_type = 'substitute' and a.details ->> 'issued_by_role' = 'office'
      then array['office_issued_code'] else array[]::text[] end
  from public.audit_log a
  join public.audit_action_catalog c on c.action = a.action
  left join public.schools s on s.id = a.school_id
  where ((c.audience in ('direction', 'direction_board') and a.school_id = any (v_direction))
      or (c.audience in ('direction_board', 'board') and a.board_id = any (v_admin)))
    and (v_school is null or a.school_id = v_school)
    and (v_board is null or a.board_id = v_board)
    and a.occurred_at >= v_from and (a.occurred_at < v_to or (v_open_end and a.occurred_at = v_to))
    and (v_category is null or c.category = v_category)
    and (v_actor is null or a.actor_user_id = v_actor)
    and (v_actor_type is null or a.actor_type = v_actor_type)
    and (v_entity is null or a.entity_id = v_entity)
    and (p_before_id is null or a.id < p_before_id)
  order by a.id desc
  limit p_limit;
end;
$$;

-- « Télécharger (CSV) » is itself audited (`audit_log.exported`, direction and board admins): by
-- the direction of `p_school_id`, or an admin of the board (the school's, when one is given).
-- Details: {rows, category, from, to}.
create function public.log_audit_export(p_board_id uuid, p_school_id uuid, p_filters jsonb,
  p_rows integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_board uuid := p_board_id;
  v_filters jsonb := coalesce(p_filters, '{}');
  v_category text;
  v_from timestamptz;
  v_to timestamptz;
begin
  if p_school_id is not null then
    select s.board_id into v_board from public.schools s where s.id = p_school_id;
    if v_board is null or (p_board_id is not null and p_board_id <> v_board) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
  end if;
  if app.active_user_id() is null or v_board is null or not (
    (p_school_id is not null
      and exists (select 1 from app.my_direction_school_ids() d where d = p_school_id))
    or exists (select 1 from app.my_admin_board_ids() b where b = v_board)
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  begin
    if jsonb_typeof(v_filters) <> 'object' then
      raise exception 'filters' using errcode = '22023';
    end if;
    v_category := nullif(v_filters ->> 'category', '');
    v_from := nullif(v_filters ->> 'from', '')::timestamptz;
    v_to := nullif(v_filters ->> 'to', '')::timestamptz;
  exception when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow then
    raise exception 'invalid filters' using errcode = '22023';
  end;
  if p_rows is null or p_rows not between 0 and 10000
     or (v_category is not null and v_category not in
       ('alerts', 'substitute', 'access', 'settings', 'classes', 'library', 'audit', 'system')) then
    raise exception 'invalid export' using errcode = '22023';
  end if;
  perform app.log_audit('audit_log.exported', v_board, p_school_id, 'audit_log', null,
    jsonb_strip_nulls(jsonb_build_object('rows', p_rows, 'category', v_category,
      'from', v_from, 'to', v_to)));
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 3. The operator's changes, visible to the board (D-106)
-- ---------------------------------------------------------------------------------------

-- The operator (the service role the admin CLI's key gets), else the signed-in user (no user:
-- the system). current_setting('role') still names the caller inside a definer function.
create function app.operator_actor_type()
returns public.audit_actor_type
language sql
stable
set search_path = ''
as $$
  select case when coalesce(current_setting('role', true), '') = 'service_role'
    then 'service'::public.audit_actor_type else 'user'::public.audit_actor_type end;
$$;

-- `boards.settings` keys `ai` and `retention` (`pnpm admin set-ai-board`, `set-retention`).
create function app.boards_audit_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keys text[] := array[]::text[];
begin
  if (new.settings -> 'ai') is distinct from (old.settings -> 'ai') then
    v_keys := array_append(v_keys, 'ai');
  end if;
  if (new.settings -> 'retention') is distinct from (old.settings -> 'retention') then
    v_keys := array_append(v_keys, 'retention');
  end if;
  if cardinality(v_keys) > 0 then
    perform app.log_audit('board.settings_changed', new.id, null, 'board', new.id,
      jsonb_build_object('keys', array_to_string(v_keys, ',')), app.operator_actor_type());
  end if;
  return null;
end;
$$;

create trigger boards_audit_settings after update of settings on public.boards
  for each row execute function app.boards_audit_settings();

-- A school's modules (`pnpm admin set-module`, `create-school`). Not when the school itself is
-- being deleted (its board's deletion removes its audit rows).
create function app.module_entitlements_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.module_entitlements := case when tg_op = 'DELETE' then old else new end;
  v_board uuid;
begin
  if tg_op = 'UPDATE' and (new.module, new.enabled, new.valid_from, new.valid_until)
     is not distinct from (old.module, old.enabled, old.valid_from, old.valid_until) then
    return null;
  end if;
  select s.board_id into v_board from public.schools s where s.id = v_row.school_id;
  if v_board is null then
    return null;
  end if;
  perform app.log_audit('school.module_changed', v_board, v_row.school_id, 'school',
    v_row.school_id, jsonb_build_object('module', v_row.module,
      'enabled', tg_op <> 'DELETE' and v_row.enabled), app.operator_actor_type());
  return null;
end;
$$;

create trigger module_entitlements_audit after insert or update or delete
  on public.module_entitlements
  for each row execute function app.module_entitlements_audit();

-- A school's AI budget (`pnpm admin set-ai-budget`).
create function app.ai_budgets_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_board uuid;
begin
  if tg_op = 'UPDATE' and (new.monthly_allowance_usd, new.monthly_ceiling_usd)
     is not distinct from (old.monthly_allowance_usd, old.monthly_ceiling_usd) then
    return null;
  end if;
  select s.board_id into v_board from public.schools s where s.id = new.school_id;
  if v_board is null then
    return null;
  end if;
  perform app.log_audit('school.ai_budget_changed', v_board, new.school_id, 'school',
    new.school_id, jsonb_build_object('monthly_allowance_usd', new.monthly_allowance_usd,
      'monthly_ceiling_usd', new.monthly_ceiling_usd), app.operator_actor_type());
  return null;
end;
$$;

create trigger ai_budgets_audit after insert or update on public.ai_budgets
  for each row execute function app.ai_budgets_audit();

-- ---------------------------------------------------------------------------------------
-- 4. AI usage (D-104): rows are their author's; totals through definer functions
-- ---------------------------------------------------------------------------------------

drop policy ai_generations_select on public.ai_generations;
create policy ai_generations_select on public.ai_generations
  for select to authenticated
  using (user_id = (select app.active_user_id()));

-- « Utilisation de l'IA » for a board's admins: per school (every school of the board, in its own
-- time zone's month), requests, failures and cost in USD; the board's bulk generation (no
-- school, D-096) on its own line with a null school, in the board's time zone, when it has any.
-- Never per person.
create function public.board_ai_usage(p_board_id uuid, p_month text)
returns table (school_id uuid, requests bigint, failed bigint, cost_usd numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if app.active_user_id() is null or p_board_id is null
     or not exists (select 1 from app.my_admin_board_ids() b where b = p_board_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'month: YYYY-MM' using errcode = '22023';
  end if;
  return query
  select x.school_id, x.requests, x.failed, x.cost_usd
  from (
    select s.id as school_id, s.name as sort_name,
      count(g.id) as requests,
      count(g.id) filter (where g.status <> 'succeeded') as failed,
      coalesce(sum(g.estimated_cost_usd), 0)::numeric as cost_usd
    from public.schools s
    left join public.ai_generations g
      on g.school_id = s.id
     and g.created_at >= ((p_month || '-01')::timestamp at time zone s.timezone)
     and g.created_at < (((p_month || '-01')::date + interval '1 month')::timestamp
                         at time zone s.timezone)
    where s.board_id = p_board_id
    group by s.id, s.name
    union all
    select null, null, count(*), count(*) filter (where g.status <> 'succeeded'),
      coalesce(sum(g.estimated_cost_usd), 0)::numeric
    from public.ai_generations g
    join public.boards bd on bd.id = g.board_id
    where g.board_id = p_board_id and g.school_id is null
      and g.created_at >= ((p_month || '-01')::timestamp at time zone bd.default_timezone)
      and g.created_at < (((p_month || '-01')::date + interval '1 month')::timestamp
                          at time zone bd.default_timezone)
    having count(*) > 0
  ) x
  order by x.school_id is null, x.sort_name, x.school_id;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 5. Retention (D-105)
-- ---------------------------------------------------------------------------------------

-- The bounds and defaults, in days: the same as RETENTION_LIMITS (packages/domain/src/
-- settings.ts; a unit test compares them). Every lower bound is 365 (MFIPPA Reg. 823 s.5).
create function app.retention_limits()
returns table (key text, default_days integer, min_days integer, max_days integer)
language sql
immutable
set search_path = ''
as $$
  values
    ('auditDays', 730, 365, 3650),
    ('subPlanDays', 365, 365, 1095),
    ('classDaysAfterYearEnd', 365, 365, 1095),
    ('aiUsageDays', 730, 365, 3650),
    ('feedbackDays', 365, 365, 1095);
$$;

-- A board's setting read as the app reads it (parseBoardSettings): a number within the bounds,
-- rounded, else the default. Null for an unknown key.
create function app.retention_days(p_settings jsonb, p_key text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    round(app.json_number_between(p_settings #> array['retention', p_key], l.min_days,
      l.max_days))::integer,
    l.default_days)
  from app.retention_limits() l
  where l.key = p_key;
$$;

-- `boards.settings.retention` belongs to the operator (`pnpm admin set-retention`): API users get
-- 42501, as for `settings.ai`. A value is an object of known keys whose values are whole numbers
-- within the bounds (22023 otherwise). Security invoker on purpose: current_user is the caller.
create function app.boards_guard_retention_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_retention jsonb := new.settings -> 'retention';
begin
  if tg_op = 'UPDATE' then
    if v_retention is not distinct from (old.settings -> 'retention') then
      return new;
    end if;
  elsif v_retention is null then
    return new;
  end if;

  if current_user in ('authenticated', 'anon') then
    raise exception 'retention settings are managed by the operator' using errcode = '42501';
  end if;
  if v_retention is not null and (
    jsonb_typeof(v_retention) <> 'object'
    or exists (
      select 1
      from jsonb_each(v_retention) e
      left join app.retention_limits() l on l.key = e.key
      where case
        when l.key is null then true
        when app.json_number_between(e.value, l.min_days, l.max_days) is null then true
        else (e.value)::numeric <> trunc((e.value)::numeric)
      end)
  ) then
    raise exception 'invalid retention settings' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger boards_guard_retention_settings before insert or update of settings
  on public.boards
  for each row execute function app.boards_guard_retention_settings();

-- Deletes a substitute plan as deleting its class does (D-059): the report's lessons awaiting
-- confirmation first (confirmed progress stays, without its report), then the plan with its
-- classes, codes, sessions and report. Audited `sub_plan.deleted {reason, plan_date}`. False when
-- the plan no longer exists.
create function app.purge_sub_plan(p_plan_id uuid, p_reason text,
  p_actor_type public.audit_actor_type default 'user')
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  select p.id, p.absence_id, p.plan_date, a.school_id, s.board_id into r
  from public.sub_plans p
  join public.absences a on a.id = p.absence_id
  join public.schools s on s.id = a.school_id
  where p.id = p_plan_id
  for update of p;
  if not found then
    return false;
  end if;
  delete from public.lesson_progress lp
  using public.sub_reports sr
  where sr.sub_plan_id = r.id and lp.sub_report_id = sr.id
    and lp.status = 'pending_confirmation';
  perform app.log_audit('sub_plan.deleted', r.board_id, r.school_id, 'sub_plan', r.id,
    jsonb_build_object('reason', p_reason, 'absence_id', r.absence_id, 'plan_date', r.plan_date),
    p_actor_type);
  delete from public.sub_plans p where p.id = r.id;   -- codes, sessions and report too
  return true;
end;
$$;

-- A class's student data, a year after its school year (D-105): the plans covering it, its
-- class-mode link (D-084) and its students (first names, levels; their alerts by cascade, each
-- audited by app.student_alerts_after_delete). The teacher's units, lessons, timetable, progress,
-- « Fiche de suppléance » and kept class-mode results stay. Audited `class.students_purged
-- {students}` (actor: the system).
create function app.purge_class_students(p_class_id uuid, out students_deleted integer,
  out plans_deleted integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class public.classes;
  v_board uuid;
  r record;
begin
  students_deleted := 0;
  plans_deleted := 0;
  select * into v_class from public.classes c where c.id = p_class_id for update;
  if not found then
    return;
  end if;
  select s.board_id into v_board from public.schools s where s.id = v_class.school_id;
  for r in
    select distinct spc.sub_plan_id from public.sub_plan_classes spc where spc.class_id = p_class_id
  loop
    if app.purge_sub_plan(r.sub_plan_id, 'class_retention') then
      plans_deleted := plans_deleted + 1;
    end if;
  end loop;
  delete from public.class_mode_links l where l.class_id = p_class_id;
  delete from public.students st where st.class_id = p_class_id;
  get diagnostics students_deleted = row_count;
  update public.classes c set students_purged_at = now() where c.id = p_class_id;
  perform app.log_audit('class.students_purged', v_board, v_class.school_id, 'class', p_class_id,
    jsonb_build_object('students', students_deleted));
end;
$$;

-- Supabase Auth's own audit entries (e-mails, IP addresses) after `p_days`. Returns the number
-- deleted, or -1 where this database role may not delete them (hosted platforms can refuse).
create function app.auth_log_maintenance(p_days integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if p_days is null or p_days < 1 then
    raise exception 'days must be positive' using errcode = '22023';
  end if;
  delete from auth.audit_log_entries e where e.created_at < now() - make_interval(days => p_days);
  get diagnostics v_deleted = row_count;
  return v_deleted;
exception when insufficient_privilege or undefined_table then
  return -1;
end;
$$;

-- The nightly retention job (worker task `retention_maintenance`, D-105). Per board, with its
-- settings: substitute plans (at most 2,000 a night), absences with no plan left, classes'
-- students (at most 200 classes a night), sample classes (60 days, D-109), the AI usage ledger,
-- feedback, invitations (pending ones expire after 14 days, processed ones go after 90), then the
-- audit log; one `retention.purged` audit row per board with what it removed. Then, for
-- everyone: dispatched outbox events after 90 days, usage and audit rows without a board after
-- the defaults, and Supabase Auth's audit entries after 90 days. Dates are compared with each
-- school's local date (studentPurgeDate and samplePurgeDate in packages/domain agree). Records
-- the `retention` heartbeat with the totals and returns them (counts only). Counts accumulate in
-- variables, so a pooled connection can run it again.
create function app.retention_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b record;
  r record;
  v_purged record;
  v_n integer;
  v_plans_left integer := 2000;
  v_classes_left integer := 200;
  v_sub_days integer;
  v_class_days integer;
  -- one board
  v_plans integer;
  v_absences integer;
  v_classes integer;
  v_students integer;
  v_samples integer;
  v_ai integer;
  v_feedback integer;
  v_expired integer;
  v_invitations integer;
  v_audit integer;
  -- totals
  t_boards integer := 0;
  t_plans integer := 0;
  t_absences integer := 0;
  t_classes integer := 0;
  t_students integer := 0;
  t_samples integer := 0;
  t_ai integer := 0;
  t_feedback integer := 0;
  t_expired integer := 0;
  t_invitations integer := 0;
  t_audit integer := 0;
  t_outbox integer := 0;
  v_auth integer;
  v_totals jsonb;
begin
  -- One run at a time (the cron's job key already ensures it; a manual call waits).
  perform pg_advisory_xact_lock(hashtext('app.retention_maintenance'));

  for b in select bd.id, bd.settings from public.boards bd order by bd.created_at, bd.id loop
    v_sub_days := app.retention_days(b.settings, 'subPlanDays');
    v_class_days := app.retention_days(b.settings, 'classDaysAfterYearEnd');

    -- 1. Substitute plans, a year (subPlanDays) after their date.
    v_plans := 0;
    for r in
      select p.id
      from public.sub_plans p
      join public.absences a on a.id = p.absence_id
      join public.schools s on s.id = a.school_id
      where s.board_id = b.id
        and p.plan_date < (now() at time zone s.timezone)::date - v_sub_days
      order by p.plan_date, p.id
      limit v_plans_left
    loop
      if app.purge_sub_plan(r.id, 'retention') then
        v_plans := v_plans + 1;
      end if;
    end loop;
    v_plans_left := v_plans_left - v_plans;

    -- 2. Absences ended before the same cutoff, once no plan is left.
    delete from public.absences a
    using public.schools s
    where s.id = a.school_id and s.board_id = b.id
      and a.ends_on < (now() at time zone s.timezone)::date - v_sub_days
      and not exists (select 1 from public.sub_plans p where p.absence_id = a.id);
    get diagnostics v_absences = row_count;

    -- 3. Classes' students, once their school year's end plus classDaysAfterYearEnd is past
    --    (again if students, a link or a plan came back after a purge).
    v_classes := 0;
    v_students := 0;
    for r in
      select c.id
      from public.classes c
      join public.schools s on s.id = c.school_id
      join public.school_years y on y.id = c.school_year_id
      where s.board_id = b.id and c.sample_owner_id is null
        and y.ends_on + v_class_days < (now() at time zone s.timezone)::date
        and (c.students_purged_at is null
          or exists (select 1 from public.students st where st.class_id = c.id)
          or exists (select 1 from public.class_mode_links l where l.class_id = c.id)
          or exists (select 1 from public.sub_plan_classes spc where spc.class_id = c.id))
      order by y.ends_on, c.id
      limit v_classes_left
    loop
      select * into v_purged from app.purge_class_students(r.id);
      v_classes := v_classes + 1;
      v_students := v_students + v_purged.students_deleted;
      v_plans := v_plans + v_purged.plans_deleted;
    end loop;
    v_classes_left := v_classes_left - v_classes;

    -- 4. Sample classes, whole, 60 days after they were created (`class.deleted`).
    delete from public.classes c
    using public.schools s
    where s.id = c.school_id and s.board_id = b.id and c.sample_owner_id is not null
      and (c.created_at at time zone s.timezone)::date + 60 <= (now() at time zone s.timezone)::date;
    get diagnostics v_samples = row_count;

    -- 5. The AI usage ledger.
    delete from public.ai_generations g
    where g.board_id = b.id
      and g.created_at < now() - make_interval(days => app.retention_days(b.settings, 'aiUsageDays'));
    get diagnostics v_ai = row_count;

    -- 6. Pilot feedback.
    delete from public.feedback f
    where f.board_id = b.id
      and f.created_at < now() - make_interval(days => app.retention_days(b.settings, 'feedbackDays'));
    get diagnostics v_feedback = row_count;

    -- 7. Invitations: pending ones expire after 14 days; processed ones go after 90.
    v_expired := 0;
    for r in
      select i.id from public.staff_invitations i
      where i.board_id = b.id and i.status = 'pending' and i.created_at < now() - interval '14 days'
    loop
      if app.fail_staff_invitation(r.id, 'expired') = 'failed' then
        v_expired := v_expired + 1;
      end if;
    end loop;
    delete from public.staff_invitations i
    where i.board_id = b.id and i.status <> 'pending'
      and coalesce(i.processed_at, i.created_at) < now() - interval '90 days';
    get diagnostics v_invitations = row_count;

    -- 8. The audit log, last (the entries above are new).
    perform set_config('app.audit_retention_purge', 'on', true);
    delete from public.audit_log a
    where a.board_id = b.id
      and a.occurred_at < now() - make_interval(days => app.retention_days(b.settings, 'auditDays'));
    get diagnostics v_audit = row_count;
    perform set_config('app.audit_retention_purge', 'off', true);

    if v_plans + v_absences + v_classes + v_samples + v_ai + v_feedback + v_expired
       + v_invitations + v_audit > 0 then
      perform app.log_audit('retention.purged', b.id, null, 'board', b.id, jsonb_build_object(
        'sub_plans', v_plans, 'absences', v_absences, 'classes', v_classes,
        'students', v_students, 'sample_classes', v_samples, 'ai_usage', v_ai,
        'feedback', v_feedback, 'invitations_expired', v_expired,
        'invitations_deleted', v_invitations, 'audit_rows', v_audit));
      t_boards := t_boards + 1;
    end if;
    t_plans := t_plans + v_plans;
    t_absences := t_absences + v_absences;
    t_classes := t_classes + v_classes;
    t_students := t_students + v_students;
    t_samples := t_samples + v_samples;
    t_ai := t_ai + v_ai;
    t_feedback := t_feedback + v_feedback;
    t_expired := t_expired + v_expired;
    t_invitations := t_invitations + v_invitations;
    t_audit := t_audit + v_audit;
  end loop;

  -- 9. Everyone: dispatched outbox events after 90 days (D-018).
  delete from public.event_outbox o where o.dispatched_at < now() - interval '90 days';
  get diagnostics t_outbox = row_count;

  -- 10. Usage rows without a board (it was deleted) after the default.
  delete from public.ai_generations g
  where g.board_id is null
    and g.created_at < now() - make_interval(days => app.retention_days('{}', 'aiUsageDays'));
  get diagnostics v_n = row_count;
  t_ai := t_ai + v_n;

  -- 11. Supabase Auth's audit entries after 90 days.
  v_auth := app.auth_log_maintenance(90);

  -- 12. Audit rows without a board, or of a deleted board, after the default.
  perform set_config('app.audit_retention_purge', 'on', true);
  delete from public.audit_log a
  where a.occurred_at < now() - make_interval(days => app.retention_days('{}', 'auditDays'))
    and (a.board_id is null
      or not exists (select 1 from public.boards bd where bd.id = a.board_id));
  get diagnostics v_n = row_count;
  perform set_config('app.audit_retention_purge', 'off', true);
  t_audit := t_audit + v_n;

  v_totals := jsonb_build_object(
    'boards', t_boards, 'subPlans', t_plans, 'absences', t_absences, 'classes', t_classes,
    'students', t_students, 'sampleClasses', t_samples, 'aiUsage', t_ai,
    'feedback', t_feedback, 'invitationsExpired', t_expired,
    'invitationsDeleted', t_invitations, 'auditRows', t_audit, 'outbox', t_outbox,
    'authLogs', case when v_auth < 0 then to_jsonb('not_permitted'::text) else to_jsonb(v_auth) end);
  perform app.record_heartbeat('retention', null, v_totals);
  return v_totals;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 6. Status (D-112)
-- ---------------------------------------------------------------------------------------

-- « État du système » for board admins: `ok` or `problem` and three times, never counts (the
-- hosted install serves several boards). The worker is fine when it beat in the last 5 minutes,
-- backups and retention in the last 26 hours. A component that never beat counts as a problem
-- (the worker at once; backups and retention once the install, i.e. its oldest board, is more
-- than 26 hours old).
create function public.system_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_worker timestamptz;
  v_backup timestamptz;
  v_retention timestamptz;
  v_settled boolean;
  v_worker_ok boolean;
  v_backup_ok boolean;
  v_retention_ok boolean;
begin
  if app.active_user_id() is null or not exists (select 1 from app.my_admin_board_ids()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select h.beat_at into v_worker from public.system_heartbeats h where h.component = 'worker';
  select h.beat_at into v_backup from public.system_heartbeats h where h.component = 'backup';
  select h.beat_at into v_retention from public.system_heartbeats h
  where h.component = 'retention';
  v_settled := coalesce((select min(b.created_at) from public.boards b), now())
    < now() - interval '26 hours';
  v_worker_ok := v_worker is not null and v_worker > now() - interval '5 minutes';
  v_backup_ok := case when v_backup is null then not v_settled
    else v_backup > now() - interval '26 hours' end;
  v_retention_ok := case when v_retention is null then not v_settled
    else v_retention > now() - interval '26 hours' end;
  return jsonb_build_object(
    'state', case when v_worker_ok and v_backup_ok and v_retention_ok then 'ok' else 'problem' end,
    'worker', jsonb_build_object('ok', v_worker_ok, 'at', v_worker),
    'backup', jsonb_build_object('ok', v_backup_ok, 'at', v_backup),
    'retention', jsonb_build_object('ok', v_retention_ok, 'at', v_retention));
end;
$$;

-- `pnpm admin status` (service role): the heartbeats with their details, the outbox (pending, the
-- oldest pending, failing ones), AI jobs (queued, running, failed in the last 24 hours) and
-- pending invitations.
create function public.operator_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'at', now(),
    'heartbeats', coalesce((
      select jsonb_agg(jsonb_build_object('component', h.component, 'at', h.beat_at,
        'release', h.release, 'details', h.details) order by h.component)
      from public.system_heartbeats h), '[]'::jsonb),
    'outbox', (
      select jsonb_build_object(
        'pending', count(*),
        'oldestPendingAt', min(o.occurred_at),
        'failing', count(*) filter (where o.dispatch_attempts >= 3))
      from public.event_outbox o where o.dispatched_at is null),
    'aiJobs', (
      select jsonb_build_object(
        'queued', count(*) filter (where j.status = 'queued'),
        'running', count(*) filter (where j.status = 'running'),
        'failedLastDay', count(*) filter (
          where j.status = 'failed' and coalesce(j.finished_at, j.created_at) > now() - interval '1 day'))
      from public.ai_jobs j),
    'invitations', (
      select jsonb_build_object('pending', count(*))
      from public.staff_invitations i where i.status = 'pending'));
$$;

-- ---------------------------------------------------------------------------------------
-- 7. Permissions
-- ---------------------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon;

-- Signed-in staff; each function checks who is calling.
grant execute on function
  public.list_audit_entries(jsonb, bigint, integer),
  public.log_audit_export(uuid, uuid, jsonb, integer),
  public.board_ai_usage(uuid, text),
  public.system_status()
to authenticated;
revoke execute on function
  public.list_audit_entries(jsonb, bigint, integer),
  public.log_audit_export(uuid, uuid, jsonb, integer),
  public.board_ai_usage(uuid, text),
  public.system_status()
from service_role;

-- The operator only (admin CLI).
revoke execute on function public.operator_status() from authenticated;
grant execute on function public.operator_status() to service_role;

-- The retention guard runs as its caller: the operator's settings writes read the bounds.
grant execute on function app.retention_limits() to service_role;

-- The database owner only (the worker's connection and the functions above).
revoke execute on function
  app.audit_log_guard_details(),
  app.audit_uuid(text),
  app.audit_person_label(uuid, app.audit_viewer),
  app.audit_entity_label(text, uuid, jsonb, app.audit_viewer),
  app.audit_public_details(jsonb),
  app.operator_actor_type(),
  app.boards_audit_settings(),
  app.module_entitlements_audit(),
  app.ai_budgets_audit(),
  app.retention_days(jsonb, text),
  app.boards_guard_retention_settings(),
  app.purge_sub_plan(uuid, text, public.audit_actor_type),
  app.purge_class_students(uuid),
  app.auth_log_maintenance(integer),
  app.retention_maintenance()
from authenticated, service_role;
revoke execute on function app.retention_limits() from authenticated;
