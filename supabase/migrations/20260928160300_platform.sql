-- Platform: audit log (append-only), transactional event outbox, AI usage ledger.

-- ---------------------------------------------------------------------------------------
-- Audit log. No foreign keys on purpose: the record must survive deletion of the things it
-- describes. Only functions write to it; nobody can update it; deletes are allowed only for
-- the retention purge job (which sets app.audit_retention_purge = 'on').
-- ---------------------------------------------------------------------------------------

create table public.audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid,
  actor_type public.audit_actor_type not null default 'user',
  action text not null check (action ~ '^[a-z_]+(\.[a-z_]+)+$'),
  board_id uuid,
  school_id uuid,
  entity_type text,
  entity_id uuid,
  -- Never put student names or alert text in here.
  details jsonb not null default '{}' check (jsonb_typeof(details) = 'object')
);

create index audit_log_school_occurred_idx on public.audit_log (school_id, occurred_at desc);
create index audit_log_board_occurred_idx on public.audit_log (board_id, occurred_at desc);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id);

create function app.audit_log_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and current_setting('app.audit_retention_purge', true) = 'on' then
    return old;
  end if;
  raise exception 'audit_log is append-only' using errcode = '42501';
end;
$$;

create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function app.audit_log_immutable();

create function app.audit_log_no_truncate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only' using errcode = '42501';
end;
$$;

create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function app.audit_log_no_truncate();

create function app.log_audit(
  p_action text,
  p_board_id uuid,
  p_school_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_details jsonb default '{}',
  p_actor_type public.audit_actor_type default 'user'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  insert into public.audit_log (
    actor_user_id, actor_type, action, board_id, school_id, entity_type, entity_id, details
  ) values (
    v_actor,
    case when v_actor is null and p_actor_type = 'user' then 'system' else p_actor_type end,
    p_action, p_board_id, p_school_id, p_entity_type, p_entity_id, coalesce(p_details, '{}')
  );
end;
$$;

-- ---------------------------------------------------------------------------------------
-- Event outbox. Events are written in the same transaction as the change that caused them,
-- then dispatched by the worker (apps/worker). Payloads carry ids, never student names.
-- ---------------------------------------------------------------------------------------

create table public.event_outbox (
  id bigint generated always as identity primary key,
  -- Idempotency key handed to every handler.
  event_id uuid not null unique default gen_random_uuid(),
  event_type text not null check (event_type ~ '^[a-z_]+(\.[a-z_]+)+$'),
  board_id uuid,
  school_id uuid,
  aggregate_type text,
  aggregate_id uuid,
  payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz not null default now(),
  dispatched_at timestamptz,
  dispatch_attempts integer not null default 0,
  last_error text
);

create index event_outbox_pending_idx on public.event_outbox (id) where dispatched_at is null;

create function app.emit_event(
  p_event_type text,
  p_board_id uuid,
  p_school_id uuid,
  p_aggregate_type text,
  p_aggregate_id uuid,
  p_payload jsonb default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
begin
  insert into public.event_outbox (
    event_type, board_id, school_id, aggregate_type, aggregate_id, payload
  ) values (
    p_event_type, p_board_id, p_school_id, p_aggregate_type, p_aggregate_id,
    coalesce(p_payload, '{}')
  )
  returning event_id into v_event_id;

  -- Wakes the worker immediately; it also polls, so a missed notification only adds delay.
  perform pg_notify('event_outbox', v_event_id::text);
  return v_event_id;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- AI usage ledger (Phase 2 writes to it). Metadata only: no prompts, no outputs.
-- ---------------------------------------------------------------------------------------

create type public.ai_generation_status as enum ('succeeded', 'failed', 'invalid_output');

create table public.ai_generations (
  id uuid primary key default gen_random_uuid(),
  board_id uuid references public.boards (id) on delete set null,
  school_id uuid references public.schools (id) on delete set null,
  user_id uuid references public.users (id) on delete set null,
  feature text not null check (char_length(feature) between 1 and 60),
  prompt_version text not null check (char_length(prompt_version) between 1 and 40),
  provider text not null check (char_length(provider) between 1 and 40),
  model text not null check (char_length(model) between 1 and 80),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cache_read_tokens integer not null default 0 check (cache_read_tokens >= 0),
  latency_ms integer check (latency_ms >= 0),
  estimated_cost_usd numeric(12, 6) not null default 0 check (estimated_cost_usd >= 0),
  status public.ai_generation_status not null,
  error_code text check (char_length(error_code) <= 80),
  batch_id text check (char_length(batch_id) <= 120),
  created_at timestamptz not null default now()
);

create index ai_generations_school_created_idx on public.ai_generations (school_id, created_at desc);
create index ai_generations_user_id_idx on public.ai_generations (user_id);
create index ai_generations_board_id_idx on public.ai_generations (board_id);

alter table public.audit_log enable row level security;
alter table public.event_outbox enable row level security;
alter table public.ai_generations enable row level security;

-- Audit: direction reads their school, board admins read their board. No writes via API.
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (
    school_id in (select app.my_direction_school_ids())
    or board_id in (select app.my_admin_board_ids())
  );
grant select on public.audit_log to authenticated;

-- Outbox: no API access at all (the worker connects directly).

-- AI usage: users see their own rows; direction and board admins see their scope.
create policy ai_generations_select on public.ai_generations
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or school_id in (select app.my_direction_school_ids())
    or board_id in (select app.my_admin_board_ids())
  );
grant select on public.ai_generations to authenticated;
