-- AI service hardening (review of Phase 2):
--   1. Board admins could change the operator's AI settings (boards.settings.ai: allowed, default
--      allowance, ceiling multiplier, pooling) through the API, and so raise their own caps.
--   2. request_ai_job counted open and recent jobs, then inserted, without a lock: parallel calls
--      all passed the limits.
--   3. The 40-per-hour limit counted jobs, which the requester can delete ("Supprimer").
--   4. Deleting a teacher's own level that a saved text used silently dropped that version.
-- DECISIONS: D-037, D-039, D-040, D-043, D-046.
-- Tests: supabase/tests/09_ai_hardening.test.sql

-- ---------------------------------------------------------------------------------------
-- 1. boards.settings.ai belongs to the platform operator (`pnpm admin set-ai-board`, as
--    service_role). Board admins keep editing the rest of the board's settings.
-- ---------------------------------------------------------------------------------------

-- A JSON number within [p_min, p_max], else null.
create function app.json_number_between(p_value jsonb, p_min numeric, p_max numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p_value) = 'number' then
    case when p_value::numeric between p_min and p_max then p_value::numeric end
  end;
$$;

-- boards.settings.ai read the way the app reads it (packages/domain/src/settings.ts): a missing or
-- invalid value means the default, so a bad value can neither block requests nor lift a limit.
create function app.board_ai_settings(p_settings jsonb)
returns table (
  allowed boolean,
  default_allowance_usd numeric,
  ceiling_multiplier numeric,
  pooling boolean
)
language sql
immutable
-- One row. Without this the planner assumes 1000, and the budget query's cost estimate turns on
-- JIT compilation (about 400 ms per request).
rows 1
set search_path = ''
as $$
  select
    coalesce(case when jsonb_typeof(s.ai -> 'allowed') = 'boolean'
      then (s.ai -> 'allowed')::boolean end, true),
    coalesce(app.json_number_between(s.ai -> 'defaultMonthlyAllowanceUsd', 0, 100000), 50),
    coalesce(app.json_number_between(s.ai -> 'ceilingMultiplier', 1, 10), 2),
    coalesce(case when jsonb_typeof(s.ai -> 'pooling') = 'boolean'
      then (s.ai -> 'pooling')::boolean end, true)
  from (select p_settings -> 'ai' as ai) s;
$$;

-- Security invoker on purpose: current_user is the API role. Definer functions run as their owner
-- and may write the key; none does today.
create function app.boards_guard_ai_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ai jsonb := new.settings -> 'ai';
begin
  if tg_op = 'UPDATE' then
    if v_ai is not distinct from (old.settings -> 'ai') then
      return new;
    end if;
  elsif v_ai is null then
    return new;
  end if;

  if current_user in ('authenticated', 'anon') then
    raise exception 'AI settings are managed by the operator' using errcode = '42501';
  end if;
  -- Same bounds as the app's schema.
  if v_ai is not null and (
    jsonb_typeof(v_ai) <> 'object'
    or (v_ai ? 'allowed' and jsonb_typeof(v_ai -> 'allowed') <> 'boolean')
    or (v_ai ? 'pooling' and jsonb_typeof(v_ai -> 'pooling') <> 'boolean')
    or (v_ai ? 'defaultMonthlyAllowanceUsd'
        and app.json_number_between(v_ai -> 'defaultMonthlyAllowanceUsd', 0, 100000) is null)
    or (v_ai ? 'ceilingMultiplier'
        and app.json_number_between(v_ai -> 'ceilingMultiplier', 1, 10) is null)
  ) then
    raise exception 'invalid AI settings' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger boards_guard_ai_settings before insert or update of settings on public.boards
  for each row execute function app.boards_guard_ai_settings();

-- Same rule as before; the board settings are now read leniently.
create or replace function app.ai_budget_status(p_school_id uuid)
returns table (
  allowance_usd numeric,
  ceiling_usd numeric,
  school_spent_usd numeric,
  pool_usd numeric,
  pool_spent_usd numeric,
  pooling boolean,
  available boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select s.id, s.board_id from public.schools s where s.id = p_school_id
  ),
  defaults as (
    select
      a.default_allowance_usd as allowance,
      a.ceiling_multiplier as multiplier,
      a.pooling
    from public.boards b
    join target t on t.board_id = b.id
    cross join app.board_ai_settings(b.settings) a
  ),
  per_school as (
    select
      s.id,
      s.ai_enabled,
      coalesce(ab.monthly_allowance_usd, d.allowance) as allowance,
      coalesce(ab.monthly_ceiling_usd, coalesce(ab.monthly_allowance_usd, d.allowance) * d.multiplier)
        as ceiling,
      coalesce((
        select sum(g.estimated_cost_usd)
        from public.ai_generations g
        where g.school_id = s.id and g.created_at >= app.ai_month_start(s.timezone)
      ), 0) as spent
    from public.schools s
    cross join defaults d
    left join public.ai_budgets ab on ab.school_id = s.id
    where s.board_id = (select board_id from target)
  ),
  pool as (
    select
      coalesce(sum(allowance) filter (where ai_enabled), 0) as total,
      coalesce(sum(spent), 0) as spent
    from per_school
  )
  select
    ps.allowance,
    ps.ceiling,
    ps.spent,
    pool.total,
    pool.spent,
    d.pooling,
    ps.spent < ps.allowance
      or (d.pooling and ps.spent < ps.ceiling and pool.spent < pool.total)
  from per_school ps
  cross join pool
  cross join defaults d
  where ps.id = p_school_id;
$$;

-- ---------------------------------------------------------------------------------------
-- 2. Request limits. Every accepted request is logged in a table nobody can change through the
--    API, so discarding a finished job does not give a request back. The log holds no content
--    and is kept for a day (the limit looks back one hour).
-- ---------------------------------------------------------------------------------------

create table public.ai_request_log (
  job_id uuid primary key,
  user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index ai_request_log_user_created_idx on public.ai_request_log (user_id, created_at desc);

alter table public.ai_request_log enable row level security;
revoke all on public.ai_request_log from anon, authenticated;
-- No policies: written by request_ai_job, purged by the worker.

-- Jobs requested before this migration still count.
insert into public.ai_request_log (job_id, user_id, created_at)
select j.id, j.user_id, j.created_at from public.ai_jobs j
where j.created_at > now() - interval '1 day';

create or replace function public.request_ai_job(p_school_id uuid, p_feature text, p_input jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.active_user_id();
  v_board uuid;
  v_enabled boolean;
  v_job uuid;
begin
  if v_user is null or p_school_id is null or p_school_id not in (
    select app.my_school_ids(array['teacher', 'principal', 'vice_principal']::public.app_role[])
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_feature is null or p_feature not in ('differentiate') then
    raise exception 'unknown AI feature' using errcode = '22023';
  end if;
  if p_input is null or jsonb_typeof(p_input) <> 'object' or pg_column_size(p_input) > 65536 then
    raise exception 'invalid AI input' using errcode = '22023';
  end if;

  select s.board_id, s.ai_enabled and a.allowed
    into v_board, v_enabled
  from public.schools s
  join public.boards b on b.id = s.board_id
  cross join app.board_ai_settings(b.settings) a
  where s.id = p_school_id;
  if not v_enabled then
    raise exception 'AI is turned off for this school' using errcode = 'LXA01';
  end if;
  if not coalesce((select b.available from app.ai_budget_status(p_school_id) b), false) then
    raise exception 'AI budget reached for this month' using errcode = 'LXA02';
  end if;

  -- One request at a time per person: parallel calls wait here, and the counts below (a new
  -- snapshot per statement) then see the previous call's job.
  perform pg_advisory_xact_lock(hashtextextended('ai_request:' || v_user::text, 0));
  if (
    select count(*) from public.ai_jobs j
    where j.user_id = v_user and j.status in ('queued', 'running')
  ) >= 3 or (
    select count(*) from public.ai_request_log r
    where r.user_id = v_user and r.created_at > now() - interval '1 hour'
  ) >= 40 then
    raise exception 'too many AI requests' using errcode = 'LXA03';
  end if;

  insert into public.ai_jobs (board_id, school_id, user_id, feature, input)
  values (v_board, p_school_id, v_user, p_feature, p_input)
  returning id into v_job;
  insert into public.ai_request_log (job_id, user_id) values (v_job, v_user);

  -- The payload carries no content; the worker reads the job itself.
  perform app.emit_event(
    'ai.job_requested', v_board, p_school_id, 'ai_job', v_job,
    jsonb_build_object('feature', p_feature)
  );
  return v_job;
end;
$$;

-- Worker maintenance: fail jobs stuck in 'running' (worker crash), delete old jobs and old
-- request log entries. Returns the number of jobs deleted.
create or replace function app.ai_jobs_maintenance(p_retention_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  update public.ai_jobs
  set status = 'failed', error_code = 'timeout', finished_at = now()
  where status = 'running' and started_at < now() - interval '15 minutes';

  update public.ai_jobs
  set status = 'failed', error_code = 'timeout', finished_at = now()
  where status = 'queued' and created_at < now() - interval '1 hour';

  delete from public.ai_jobs
  where created_at < now() - make_interval(days => greatest(p_retention_days, 1));
  get diagnostics v_deleted = row_count;

  delete from public.ai_request_log where created_at < now() - interval '1 day';
  return v_deleted;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 3. Permissions
-- ---------------------------------------------------------------------------------------

revoke execute on all functions in schema app from public, anon;
-- The operator's writes run the guard's checks as service_role.
grant execute on function app.json_number_between(jsonb, numeric, numeric),
  app.board_ai_settings(jsonb) to service_role;

-- ---------------------------------------------------------------------------------------
-- 4. A teacher's own language level that a saved text uses can't be deleted (D-046). The
--    version's level would become null and the saved text would silently lose that version.
--    The teacher turns the level off instead. Checked here, where every saved text counts (a
--    copy the teacher can't see too). A level removed with its owner or board (a cascade) goes.
-- ---------------------------------------------------------------------------------------

create function app.language_levels_guard_in_use()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() = 1 and exists (
    select 1 from public.library_item_versions v where v.language_level_id = old.id
  ) then
    raise exception 'language level in use' using errcode = '23503';
  end if;
  return old;
end;
$$;

create trigger language_levels_guard_in_use before delete on public.language_levels
  for each row when (old.owner_user_id is not null)
  execute function app.language_levels_guard_in_use();

revoke execute on function app.language_levels_guard_in_use() from public, anon;
