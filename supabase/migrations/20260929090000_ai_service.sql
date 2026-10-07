-- Phase 2: the AI service.
--
-- AI requests are queued in ai_jobs and run by the background worker, which holds the provider
-- key and is the only writer of ai_generations (usage and cost). A school's AI is off until its
-- direction turns it on. Spending is capped per school, with unused allowance pooled per board.
-- Nothing personal is ever sent to a provider: see docs/ai-data-flow.md.

-- ---------------------------------------------------------------------------------------
-- 1. Per-school switch, off by default. Turning it on or off is audited.
-- ---------------------------------------------------------------------------------------

alter table public.schools add column ai_enabled boolean not null default false;
grant update (ai_enabled) on public.schools to authenticated;

create function app.schools_audit_ai_toggle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.ai_enabled is distinct from old.ai_enabled then
    perform app.log_audit(
      case when new.ai_enabled then 'school.ai_enabled' else 'school.ai_disabled' end,
      new.board_id, new.id, 'school', new.id
    );
  end if;
  return new;
end;
$$;

create trigger schools_audit_ai_toggle after update of ai_enabled on public.schools
  for each row execute function app.schools_audit_ai_toggle();

-- ---------------------------------------------------------------------------------------
-- 2. Budgets. Amounts are the provider cost in US dollars per calendar month (school time).
--    Schools without a row get the board default (boards.settings.ai), else 50 USD.
--    A board can also forbid AI for all its schools: boards.settings.ai.allowed = false.
-- ---------------------------------------------------------------------------------------

create table public.ai_budgets (
  school_id uuid primary key references public.schools (id) on delete cascade,
  plan text check (char_length(plan) between 1 and 40),
  monthly_allowance_usd numeric(10, 2) not null check (monthly_allowance_usd >= 0),
  -- The most one school may spend in a month by borrowing from its board's pool.
  -- Null: allowance x the board's ceiling multiplier (default 2).
  monthly_ceiling_usd numeric(10, 2)
    check (monthly_ceiling_usd is null or monthly_ceiling_usd >= monthly_allowance_usd),
  updated_at timestamptz not null default now()
);

create trigger ai_budgets_touch before update on public.ai_budgets
  for each row execute function app.touch_updated_at();

alter table public.ai_budgets enable row level security;
revoke all on public.ai_budgets from anon, authenticated;

create policy ai_budgets_select on public.ai_budgets
  for select to authenticated
  using (
    school_id in (select app.my_direction_school_ids())
    or school_id in (
      select s.id from public.schools s where s.board_id in (select app.my_admin_board_ids())
    )
  );
-- Set by the platform operator (admin CLI), never through the API.
grant select on public.ai_budgets to authenticated;

-- Provider request id, to reconcile usage with the provider's own billing.
alter table public.ai_generations
  add column provider_request_id text check (char_length(provider_request_id) <= 120);

-- Start of the current month in a school's time zone.
create function app.ai_month_start(p_timezone text)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select date_trunc('month', now() at time zone p_timezone) at time zone p_timezone;
$$;

-- Spending rule: a school can always use its own allowance. Past it, when pooling is on, it
-- may borrow what the board's other AI-enabled schools have not used, up to its ceiling.
create function app.ai_budget_status(p_school_id uuid)
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
      coalesce((b.settings -> 'ai' ->> 'defaultMonthlyAllowanceUsd')::numeric, 50) as allowance,
      coalesce((b.settings -> 'ai' ->> 'ceilingMultiplier')::numeric, 2) as multiplier,
      coalesce((b.settings -> 'ai' ->> 'pooling')::boolean, true) as pooling
    from public.boards b
    join target t on t.board_id = b.id
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

-- Usage and limits for the direction and board admins (the budget screen).
create function public.ai_usage_summary(p_school_id uuid)
returns table (
  allowance_usd numeric,
  ceiling_usd numeric,
  school_spent_usd numeric,
  pool_usd numeric,
  pool_spent_usd numeric,
  pooling boolean,
  available boolean,
  requests_this_month bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_school_id is null or not (
    p_school_id in (select app.my_direction_school_ids())
    or exists (
      select 1 from public.schools s
      where s.id = p_school_id and s.board_id in (select app.my_admin_board_ids())
    )
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  return query
  select b.*, (
    select count(*)
    from public.ai_generations g
    join public.schools s on s.id = g.school_id
    where g.school_id = p_school_id and g.created_at >= app.ai_month_start(s.timezone)
  )
  from app.ai_budget_status(p_school_id) b;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 3. Jobs: a request from a staff member, run by the worker.
--    `input` holds what the teacher typed (it may name students) and never leaves Canada.
--    `sent_text` is exactly what was sent to the provider, after de-identification.
--    Jobs are deleted after 30 days by the worker; usage stays in ai_generations.
-- ---------------------------------------------------------------------------------------

create type public.ai_job_status as enum ('queued', 'running', 'succeeded', 'failed');

create table public.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  school_id uuid not null references public.schools (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  feature text not null check (feature in ('differentiate')),
  input jsonb not null check (jsonb_typeof(input) = 'object'),
  status public.ai_job_status not null default 'queued',
  sent_text text check (char_length(sent_text) <= 200000),
  result jsonb check (result is null or jsonb_typeof(result) = 'object'),
  error_code text check (char_length(error_code) <= 80),
  ai_generation_id uuid references public.ai_generations (id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index ai_jobs_user_created_idx on public.ai_jobs (user_id, created_at desc);
create index ai_jobs_school_id_idx on public.ai_jobs (school_id);
create index ai_jobs_board_id_idx on public.ai_jobs (board_id);
create index ai_jobs_ai_generation_id_idx on public.ai_jobs (ai_generation_id);
create index ai_jobs_open_idx on public.ai_jobs (status) where status in ('queued', 'running');

alter table public.ai_jobs enable row level security;
revoke all on public.ai_jobs from anon, authenticated;

-- Only the requester sees a job (the input can name their students).
create policy ai_jobs_select on public.ai_jobs
  for select to authenticated
  using (user_id = (select app.active_user_id()));

create policy ai_jobs_delete on public.ai_jobs
  for delete to authenticated
  using (user_id = (select app.active_user_id()) and status in ('succeeded', 'failed'));

grant select, delete on public.ai_jobs to authenticated;

-- Error codes the app translates: LXA01 AI off, LXA02 budget reached, LXA03 too many requests.
create function public.request_ai_job(p_school_id uuid, p_feature text, p_input jsonb)
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

  select s.board_id, s.ai_enabled
         and coalesce((b.settings -> 'ai' ->> 'allowed')::boolean, true)
    into v_board, v_enabled
  from public.schools s
  join public.boards b on b.id = s.board_id
  where s.id = p_school_id;
  if not v_enabled then
    raise exception 'AI is turned off for this school' using errcode = 'LXA01';
  end if;
  if not coalesce((select b.available from app.ai_budget_status(p_school_id) b), false) then
    raise exception 'AI budget reached for this month' using errcode = 'LXA02';
  end if;
  if (
    select count(*) from public.ai_jobs j
    where j.user_id = v_user and j.status in ('queued', 'running')
  ) >= 3 or (
    select count(*) from public.ai_jobs j
    where j.user_id = v_user and j.created_at > now() - interval '1 hour'
  ) >= 40 then
    raise exception 'too many AI requests' using errcode = 'LXA03';
  end if;

  insert into public.ai_jobs (board_id, school_id, user_id, feature, input)
  values (v_board, p_school_id, v_user, p_feature, p_input)
  returning id into v_job;

  -- The payload carries no content; the worker reads the job itself.
  perform app.emit_event(
    'ai.job_requested', v_board, p_school_id, 'ai_job', v_job,
    jsonb_build_object('feature', p_feature)
  );
  return v_job;
end;
$$;

-- Worker maintenance: fail jobs stuck in 'running' (worker crash) and delete old jobs.
create function app.ai_jobs_maintenance(p_retention_days integer default 30)
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
  return v_deleted;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 4. Saving a result to the library as a private draft, with its AI provenance.
--    `p_versions` is [{"language_level_id": uuid|null, "content": {...}}, ...].
-- ---------------------------------------------------------------------------------------

create function public.save_ai_job_to_library(
  p_job_id uuid,
  p_type public.library_item_type,
  p_title text,
  p_versions jsonb,
  p_grade_code text default null,
  p_subject_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.active_user_id();
  v_job public.ai_jobs;
  v_gen public.ai_generations;
  v_item uuid;
  v_version jsonb;
  v_level uuid;
begin
  select * into v_job from public.ai_jobs where id = p_job_id;
  if v_user is null or v_job.id is null or v_job.user_id <> v_user
     or v_job.school_id not in (select app.my_staff_school_ids()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_job.status <> 'succeeded' then
    raise exception 'job has no result' using errcode = '22023';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 200 then
    raise exception 'invalid title' using errcode = '22023';
  end if;
  if p_type is null or p_type not in ('reading_passage', 'worksheet') then
    raise exception 'unsupported item type' using errcode = '22023';
  end if;
  if p_grade_code is not null and not exists (select 1 from public.grades where code = p_grade_code) then
    raise exception 'unknown grade' using errcode = '22023';
  end if;
  if p_subject_id is not null and not exists (
    select 1 from public.subjects s
    where s.id = p_subject_id and (s.board_id is null or s.board_id = v_job.board_id)
  ) then
    raise exception 'unknown subject' using errcode = '22023';
  end if;
  if p_versions is null or jsonb_typeof(p_versions) <> 'array'
     or jsonb_array_length(p_versions) not between 1 and 8
     or pg_column_size(p_versions) > 262144 then
    raise exception 'invalid versions' using errcode = '22023';
  end if;

  select * into v_gen from public.ai_generations where id = v_job.ai_generation_id;

  insert into public.library_items (
    board_id, school_id, type, title, status, share_scope, source, author_id, subject_id,
    prompt_version, model, ai_generation_id
  ) values (
    v_job.board_id, v_job.school_id, p_type, btrim(p_title), 'draft', 'private', 'ai_generated', v_user,
    p_subject_id, v_gen.prompt_version, v_gen.model, v_gen.id
  )
  returning id into v_item;

  if p_grade_code is not null then
    insert into public.library_item_grades (item_id, grade_code) values (v_item, p_grade_code);
  end if;

  for v_version in select * from jsonb_array_elements(p_versions) loop
    if jsonb_typeof(v_version -> 'content') is distinct from 'object' then
      raise exception 'invalid version content' using errcode = '22023';
    end if;
    v_level := nullif(v_version ->> 'language_level_id', '')::uuid;
    if v_level is not null and not exists (
      select 1 from public.language_levels ll
      where ll.id = v_level and ll.board_id = v_job.board_id
        and (ll.owner_user_id is null or ll.owner_user_id = v_user)
    ) then
      raise exception 'unknown language level' using errcode = '22023';
    end if;
    insert into public.library_item_versions (item_id, language_level_id, content)
    values (v_item, v_level, v_version -> 'content');
  end loop;

  perform app.log_audit('library_item.saved_from_ai', v_job.board_id, v_job.school_id,
    'library_item', v_item, jsonb_build_object('ai_job_id', v_job.id));
  return v_item;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 5. Permissions: functions are opt-in, as everywhere else.
-- ---------------------------------------------------------------------------------------

revoke execute on all functions in schema app from public, anon;
revoke execute on function public.ai_usage_summary(uuid) from public, anon;
revoke execute on function public.request_ai_job(uuid, text, jsonb) from public, anon;
revoke execute on function public.save_ai_job_to_library(
  uuid, public.library_item_type, text, jsonb, text, uuid) from public, anon;

grant execute on function public.ai_usage_summary(uuid) to authenticated;
grant execute on function public.request_ai_job(uuid, text, jsonb) to authenticated;
grant execute on function public.save_ai_job_to_library(
  uuid, public.library_item_type, text, jsonb, text, uuid) to authenticated;
-- Internal helpers: only reached through the functions above, or by the worker.
grant execute on function app.ai_month_start(text), app.ai_budget_status(uuid),
  app.ai_jobs_maintenance(integer) to service_role;
