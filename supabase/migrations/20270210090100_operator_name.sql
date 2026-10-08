-- The operator's name on its audit entries (DECISIONS D-147).
-- Tests: supabase/tests/40_operator_name.test.sql
--
-- The admin CLI's entries (actor `service`) read « IP Lynx » in « Journal d'audit », its CSV and
-- the board's whole export, whoever ran the command. On a board's own servers the operator is the
-- board's IT, so its log was misleading. The CLI now sends its `OPERATOR_NAME` with every request
-- (header `x-lynx-operator-name`: base64 of the name's UTF-8, since a header carries ASCII only),
-- and the database records it on each entry the request writes as the operator:
-- 1. `audit_log.operator_name`: nullable; set on `service` entries only; 1 to 80 characters, no
--    space at either end, none of the characters packages/config refuses (Unicode's control,
--    format, line and paragraph separator characters). Older entries keep null: « IP Lynx ».
--    A column rather than a key of `details`: the database checks it, and the viewer's details
--    whitelist and the export's details stay as they were.
-- 2. A `before insert` trigger fills it from the header, only for `service` entries written by
--    the service role's own requests (no header, or another role: null). A header that is not
--    base64 of UTF-8 text is refused (22023), as is a name the check refuses (23514): nothing the
--    request did is kept, so an entry never loses or garbles the name.
-- 3. `list_audit_entries` returns it as the actor's label of a `service` entry, and
--    `operator_export_audit` as its `actor_name`. The app shows « IP Lynx » when it is null.
--
-- The audit log stays closed to the API (D-103): no grant changes; the trigger function is the
-- owner's only. A restore (`session_replication_role = replica`) keeps the stored names.

-- ---------------------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------------------

alter table public.audit_log add column operator_name text
  constraint audit_log_operator_name_check check (
    operator_name is null or (
      actor_type = 'service'
      and char_length(operator_name) between 1 and 80
      and operator_name !~ '^[    -   　]|[    -   　]$'
      and operator_name !~ '[\u0001-\u001f\u007f-\u009f­؀-؅؜۝܏࢐-࢑࣢᠎​-‏ -‮⁠-⁤⁦-⁯﻿￹-￻\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]'
    ));

comment on column public.audit_log.operator_name is
  'The operator, as the admin CLI''s OPERATOR_NAME says (service entries only; null: IP Lynx). D-147.';

-- ---------------------------------------------------------------------------------------
-- 2. Filled from the operator's request
-- ---------------------------------------------------------------------------------------

-- A plain trigger, like the details guard: it applies to every writer, the owner's functions
-- included. `role` still names the caller inside a definer function (D-106).
create function app.audit_log_operator_name()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_header text;
begin
  new.operator_name := null;
  if new.actor_type <> 'service'
     or coalesce(current_setting('role', true), '') <> 'service_role' then
    return new;
  end if;
  v_header := nullif(nullif(current_setting('request.headers', true), '')::jsonb
    ->> 'x-lynx-operator-name', '');
  if v_header is not null then
    begin
      new.operator_name := convert_from(decode(v_header, 'base64'), 'UTF8');
    exception when invalid_parameter_value or character_not_in_repertoire
      or untranslatable_character then
      raise exception 'x-lynx-operator-name: base64 of the operator''s name in UTF-8'
        using errcode = '22023';
    end;
  end if;
  return new;
end;
$$;

create trigger audit_log_operator_name before insert on public.audit_log
  for each row execute function app.audit_log_operator_name();

-- Trigger functions: never called directly.
revoke execute on function app.audit_log_operator_name()
from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------
-- 3. Read back: the viewer and the board's whole export
-- ---------------------------------------------------------------------------------------

-- As in 20261201090200_audit_retention.sql, except the actor's label: a `service` entry's is the
-- operator's recorded name (null before D-147: the app says « IP Lynx »).
create or replace function public.list_audit_entries(p_filters jsonb,
  p_before_id bigint default null, p_limit integer default 50)
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
    case when a.actor_type = 'service' then a.operator_name
      else app.audit_person_label(a.actor_user_id, v_viewer) end,
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

-- As in 20261201090600_phase6_board_audit_export.sql, except `actor_name`: for a `service` entry,
-- the operator's recorded name (null before D-147: the CLI writes « IP Lynx »).
create or replace function public.operator_export_audit(p_board_id uuid,
  p_after_id bigint default 0, p_limit integer default 1000)
returns table (
  id bigint,
  occurred_at timestamptz,
  action text,
  audience text,
  category text,
  school_id uuid,
  school_name text,
  actor_type public.audit_actor_type,
  actor_user_id uuid,
  actor_name text,
  entity_type text,
  entity_id uuid,
  details jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_schools uuid[];
begin
  if not exists (select 1 from public.boards b where b.id = p_board_id) then
    raise exception 'no such board' using errcode = '22023';
  end if;
  if p_after_id is null or p_after_id < 0 or p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'after_id from 0, limit 1 to 1000' using errcode = '22023';
  end if;
  v_schools := array(select s.id from public.schools s where s.board_id = p_board_id);
  return query
  select a.id, a.occurred_at, a.action, c.audience, c.category, a.school_id, s.name,
    a.actor_type, a.actor_user_id,
    case when a.actor_type = 'service' then a.operator_name else u.display_name end,
    a.entity_type, a.entity_id, a.details
  from public.audit_log a
  left join public.audit_action_catalog c on c.action = a.action
  left join public.schools s on s.id = a.school_id
  left join public.users u on u.id = a.actor_user_id
  where (a.board_id = p_board_id or a.school_id = any (v_schools))
    and a.id > p_after_id
  order by a.id
  limit p_limit;
end;
$$;
