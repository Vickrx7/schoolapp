-- AI hardening: operator-only AI settings, request limits (parallel calls, discarded jobs), the
-- budget rules (defaults, pool, month), retention, provenance, what the API cannot change, and
-- personal levels that saved texts still use.
begin;
\ir _helpers.psql
select plan(54);
select tests.build_fixture();

-- The operator's CLI connects as service_role.
grant usage on schema tests to service_role;
grant select on tests.ids to service_role;
grant execute on function tests.id(text) to service_role;

update public.schools set ai_enabled = true
where id in (tests.id('school_a1'), tests.id('school_a2'));

-- 1. Budget defaults: no budget row and no board setting give 50 USD, ceiling 2x (D-040).
select results_eq(
  $$select allowance_usd, ceiling_usd, pool_usd, pooling
    from app.ai_budget_status(tests.id('school_a1'))$$,
  $$values (50::numeric, 100::numeric, 100::numeric, true)$$,
  'without a budget or a board default, a school gets 50 USD and a ceiling of 100'
);

-- 2. boards.settings.ai is set by the operator, never by board admins.
update public.boards set settings = settings || '{"ai": {"allowed": false}}'
where id = tests.id('board_a');

select tests.authenticate_as('board_admin_a');
select throws_ok(
  $$update public.boards
    set settings = jsonb_set(settings, '{ai,defaultMonthlyAllowanceUsd}', '1000000')
    where id = tests.id('board_a')$$,
  '42501', null, 'a board admin cannot raise the default allowance'
);
select throws_ok(
  $$update public.boards set settings = jsonb_set(settings, '{ai,ceilingMultiplier}', '1000')
    where id = tests.id('board_a')$$,
  '42501', null, 'a board admin cannot raise the ceiling multiplier'
);
select throws_ok(
  $$update public.boards set settings = jsonb_set(settings, '{ai,pooling}', 'true')
    where id = tests.id('board_a')$$,
  '42501', null, 'a board admin cannot change pooling'
);
select throws_ok(
  $$update public.boards set settings = jsonb_set(settings, '{ai,allowed}', 'true')
    where id = tests.id('board_a')$$,
  '42501', null, 'a board admin cannot allow AI the operator forbade'
);
select throws_ok(
  $$update public.boards set settings = settings - 'ai' where id = tests.id('board_a')$$,
  '42501', null, 'a board admin cannot remove the AI settings'
);
select lives_ok(
  $$update public.boards set name = 'Board A renamed',
      settings = settings || '{"anglaisStartGrade": 5}'
    where id = tests.id('board_a')$$,
  'a board admin still edits the other board settings'
);
select throws_ok(
  $$insert into public.ai_budgets (school_id, monthly_allowance_usd)
    values (tests.id('school_a1'), 1000)$$,
  '42501', null, 'a board admin cannot set a school budget'
);
select tests.clear_authentication();

select is(
  (select settings from public.boards where id = tests.id('board_a')),
  '{"ai": {"allowed": false}, "anglaisStartGrade": 5}'::jsonb,
  'the other setting changed, the AI settings did not'
);

select tests.authenticate_as('principal_a');
select throws_ok(
  $$update public.ai_budgets set monthly_allowance_usd = 1000
    where school_id = tests.id('school_a1')$$,
  '42501', null, 'a principal cannot change a school budget'
);
select tests.clear_authentication();

-- The operator (admin CLI, as service_role) sets them, within the app's bounds.
select set_config('role', 'service_role', true);
select lives_ok(
  $$update public.boards set settings = settings
      || '{"ai": {"allowed": true, "defaultMonthlyAllowanceUsd": 80, "ceilingMultiplier": 1.5}}'
    where id = tests.id('board_a')$$,
  'the operator sets the board''s AI settings'
);
select throws_ok(
  $$update public.boards set settings = jsonb_set(settings, '{ai,ceilingMultiplier}', '0.5')
    where id = tests.id('board_a')$$,
  '22023', null, 'the ceiling multiplier is at least 1'
);
select tests.clear_authentication();
select throws_ok(
  $$update public.boards set settings = jsonb_set(settings, '{ai,ceilingMultiplier}', '"abc"')
    where id = tests.id('board_a')$$,
  '22023', null, 'the ceiling multiplier is a number'
);
select throws_ok(
  $$update public.boards set settings = jsonb_set(settings, '{ai,defaultMonthlyAllowanceUsd}', '-1')
    where id = tests.id('board_a')$$,
  '22023', null, 'the default allowance is not negative'
);
select throws_ok(
  $$update public.boards set settings = jsonb_set(settings, '{ai,pooling}', '"yes"')
    where id = tests.id('board_a')$$,
  '22023', null, 'pooling is true or false'
);

select results_eq(
  $$select allowance_usd, ceiling_usd from app.ai_budget_status(tests.id('school_a1'))$$,
  $$values (80::numeric, 120::numeric)$$,
  'the board default allowance and ceiling multiplier apply'
);
insert into public.ai_budgets (school_id, monthly_allowance_usd, monthly_ceiling_usd) values
  (tests.id('school_a1'), 10, 30),
  (tests.id('school_a2'), 10, null);
select results_eq(
  $$select allowance_usd, ceiling_usd from app.ai_budget_status(tests.id('school_a2'))$$,
  $$values (10::numeric, 15::numeric)$$,
  'a school''s own budget overrides the board default'
);
select results_eq(
  $$select * from app.board_ai_settings('{"ai": {"allowed": "no",
      "defaultMonthlyAllowanceUsd": "1000000", "ceilingMultiplier": 1000, "pooling": 1}}')$$,
  $$values (true, 50::numeric, 2::numeric, true)$$,
  'invalid stored values read as the defaults, as in the app'
);
update public.boards set settings = settings - 'ai' where id = tests.id('board_a');

-- 3. The board pool (a1: allowance 10, ceiling 30; a2: allowance 10).
insert into public.ai_generations (board_id, school_id, feature, prompt_version, provider, model,
  status, estimated_cost_usd)
select b, s, 'differentiate', 'v1', 'fake', 'fake', 'succeeded', cost
from (values
  (tests.id('board_a'), tests.id('school_a1'), 25),
  (tests.id('board_a'), tests.id('school_a2'), 0.01),
  (tests.id('board_b'), tests.id('school_b1'), 999)
) v (b, s, cost);
select is((select available from app.ai_budget_status(tests.id('school_a1'))), false,
  'once the pool is used up, a school under its ceiling cannot borrow');
select is((select available from app.ai_budget_status(tests.id('school_a2'))), true,
  'another school can still use its own allowance');
select is((select pool_spent_usd from app.ai_budget_status(tests.id('school_a1'))), 25.01::numeric,
  'another board''s spending is not in the pool');

update public.ai_generations set estimated_cost_usd = 12 where school_id = tests.id('school_a1');
select is((select available from app.ai_budget_status(tests.id('school_a1'))), true,
  'while the pool has room, a school borrows past its allowance');
update public.schools set ai_enabled = false where id = tests.id('school_a2');
select is((select pool_usd from app.ai_budget_status(tests.id('school_a1'))), 10.00::numeric,
  'a school with AI off adds nothing to the pool');
select is((select available from app.ai_budget_status(tests.id('school_a1'))), false,
  'so there is nothing to borrow');
update public.schools set ai_enabled = true where id = tests.id('school_a2');
delete from public.ai_generations
where school_id in (tests.id('school_a1'), tests.id('school_a2'), tests.id('school_b1'));

-- 4. The month is the school's calendar month, in its own time zone.
update public.schools set timezone = 'America/Vancouver' where id = tests.id('school_a2');
insert into public.ai_generations (board_id, school_id, feature, prompt_version, provider, model,
  status, estimated_cost_usd, created_at)
select tests.id('board_a'), tests.id('school_a2'), 'differentiate', 'v1', 'fake', 'fake',
  'succeeded', cost, at
from (values
  (7, app.ai_month_start('America/Vancouver') - interval '1 second'),
  (2, app.ai_month_start('America/Vancouver'))
) v (cost, at);
select is((select school_spent_usd from app.ai_budget_status(tests.id('school_a2'))), 2::numeric,
  'spending before midnight on the 1st (school time) no longer counts');
select tests.authenticate_as('principal_a2');
select is(
  (select requests_this_month from public.ai_usage_summary(tests.id('school_a2'))), 1::bigint,
  'the budget screen counts this month''s requests only'
);
select tests.clear_authentication();
select is(
  app.ai_month_start('America/Toronto') at time zone 'America/Toronto',
  date_trunc('month', now() at time zone 'America/Toronto'),
  'the month starts at midnight on the 1st, school time'
);
select isnt(app.ai_month_start('America/Toronto'), app.ai_month_start('UTC'),
  'the month start depends on the time zone');

-- 5. Rate limit: 40 requests per hour per person (D-037), counted in a log the requester
--    cannot change, one request at a time.
do $$
begin
  for i in 1..40 loop
    perform tests.authenticate_as('teacher_a_other');
    perform public.request_ai_job(tests.id('school_a1'), 'differentiate',
      jsonb_build_object('n', i));
    perform tests.clear_authentication();
    update public.ai_jobs set status = 'succeeded', finished_at = now()
    where user_id = tests.id('teacher_a_other') and status = 'queued';
  end loop;
end
$$;

select tests.authenticate_as('teacher_a_other');
select throws_ok(
  $$select public.request_ai_job(tests.id('school_a1'), 'differentiate', '{"n": 41}')$$,
  'LXA03', null, 'the 41st request within an hour is refused'
);
-- « Supprimer » on each finished job.
delete from public.ai_jobs where status in ('succeeded', 'failed');
select throws_ok(
  $$select public.request_ai_job(tests.id('school_a1'), 'differentiate', '{"n": 42}')$$,
  'LXA03', null, 'discarding jobs does not give requests back'
);
select tests.clear_authentication();
select is((select count(*)::int from public.ai_jobs where user_id = tests.id('teacher_a_other')), 0,
  'the requester discarded their 40 finished jobs');

update public.ai_request_log set created_at = created_at - interval '61 minutes'
where user_id = tests.id('teacher_a_other');
select tests.authenticate_as('teacher_a_other');
select lives_ok(
  $$select public.request_ai_job(tests.id('school_a1'), 'differentiate', '{"n": 43}')$$,
  'requests older than an hour no longer count'
);
select tests.clear_authentication();

select ok(
  exists (
    select 1
    from pg_locks l
    cross join (
      select hashtextextended('ai_request:' || tests.id('teacher_a_other')::text, 0) as k
    ) h
    where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.granted and l.objsubid = 1
      and l.classid::bigint = (h.k >> 32) & 4294967295 and l.objid::bigint = h.k & 4294967295
  ),
  'a request holds a per-person lock, so parallel calls cannot all pass the limits'
);
select ok(
  not has_table_privilege('authenticated', 'public.ai_request_log',
    'select, insert, update, delete'),
  'the request log is closed to the API'
);

-- 6. Jobs and usage cannot be changed through the API (D-037).
select tests.authenticate_as('teacher_a');
select tests.remember('job_queued',
  public.request_ai_job(tests.id('school_a1'), 'differentiate', '{"text": "Bonjour"}'));
select tests.clear_authentication();

with r as (
  insert into public.ai_generations (board_id, school_id, user_id, feature, prompt_version,
    provider, model, status, estimated_cost_usd)
  values (tests.id('board_a'), tests.id('school_a1'), tests.id('teacher_a'), 'differentiate', 'v1',
    'anthropic', 'claude-opus-5-5', 'succeeded', 0.2)
  returning id
)
select tests.remember('gen', id) from r;
with r as (
  insert into public.ai_jobs (board_id, school_id, user_id, feature, input, status, result,
    ai_generation_id, finished_at)
  values (tests.id('board_a'), tests.id('school_a1'), tests.id('teacher_a'), 'differentiate',
    '{"text": "x"}', 'succeeded', '{"versions": []}', tests.id('gen'), now())
  returning id
)
select tests.remember('job_done', id) from r;

select tests.authenticate_as('teacher_a');
select throws_ok(
  $$update public.ai_jobs set status = 'succeeded', result = '{}'
    where id = tests.id('job_queued')$$,
  '42501', null, 'jobs cannot be updated through the API'
);
select throws_ok(
  $$delete from public.ai_generations where id = tests.id('gen')$$,
  '42501', null, 'a teacher cannot delete their usage'
);
delete from public.ai_jobs where id = tests.id('job_queued');
select tests.clear_authentication();
select is((select status::text from public.ai_jobs where id = tests.id('job_queued')), 'queued',
  'a job still open cannot be discarded');

select tests.authenticate_as('principal_a');
select throws_ok(
  $$delete from public.ai_generations where school_id = tests.id('school_a1')$$,
  '42501', null, 'the direction cannot delete usage'
);
select throws_ok(
  $$update public.ai_generations set estimated_cost_usd = 0
    where school_id = tests.id('school_a1')$$,
  '42501', null, 'usage cannot be changed through the API'
);
select tests.clear_authentication();

-- 7. Saving a result keeps its AI provenance (D-042). Unfinished jobs and other people's levels
--    are refused.
select tests.authenticate_as('teacher_a');
select lives_ok(
  $$select tests.remember('item', public.save_ai_job_to_library(tests.id('job_done'),
    'reading_passage', 'Le castor', '[{"language_level_id": null, "content": {"text": "x"}}]'))$$,
  'the requester saves a finished job'
);
select results_eq(
  $$select source::text, prompt_version, model, ai_generation_id
    from public.library_items where id = tests.id('item')$$,
  $$values ('ai_generated', 'v1', 'claude-opus-5-5', tests.id('gen'))$$,
  'the draft records the prompt version, the model and the usage row'
);
select throws_ok(
  $$select public.save_ai_job_to_library(tests.id('job_queued'), 'reading_passage', 'Texte',
    '[{"language_level_id": null, "content": {"text": "x"}}]')$$,
  '22023', null, 'a job without a result cannot be saved'
);
select tests.clear_authentication();

with r as (
  insert into public.language_levels (board_id, owner_user_id, code, label_fr)
  values (tests.id('board_a'), tests.id('teacher_a_other'), 'perso_autre', 'Niveau d''un collègue')
  returning id
)
select tests.remember('other_level', id) from r;
select tests.authenticate_as('teacher_a');
select throws_ok(
  format($$select public.save_ai_job_to_library(%L, 'reading_passage', 'Texte',
    '[{"language_level_id": "%s", "content": {"text": "x"}}]')$$,
    tests.id('job_done'), tests.id('other_level')),
  '22023', null, 'a colleague''s personal level is refused'
);
select tests.clear_authentication();

-- 8. Maintenance (D-043): old jobs are deleted, usage and saved drafts stay; stuck jobs fail.
with r as (
  insert into public.ai_generations (board_id, school_id, user_id, feature, prompt_version,
    provider, model, status, created_at)
  values (tests.id('board_a'), tests.id('school_a1'), tests.id('teacher_a'), 'differentiate', 'v1',
    'fake', 'fake', 'succeeded', now() - interval '31 days')
  returning id
)
select tests.remember('old_gen', id) from r;
with r as (
  insert into public.ai_jobs (board_id, school_id, user_id, feature, input, status, result,
    ai_generation_id, created_at, finished_at)
  values (tests.id('board_a'), tests.id('school_a1'), tests.id('teacher_a'), 'differentiate',
    '{"text": "Léa"}', 'succeeded', '{"versions": []}', tests.id('old_gen'),
    now() - interval '31 days', now() - interval '31 days')
  returning id
)
select tests.remember('old_job', id) from r;
select tests.authenticate_as('teacher_a');
select tests.remember('old_item', public.save_ai_job_to_library(tests.id('old_job'),
  'reading_passage', 'Ancien texte', '[{"language_level_id": null, "content": {"text": "x"}}]'));
select tests.clear_authentication();

select tests.remember(k, gen_random_uuid())
from unnest(array['recent_job', 'half_day_job', 'stuck_running', 'stuck_queued', 'live_running',
  'live_queued']) k;
insert into public.ai_jobs (id, board_id, school_id, user_id, feature, input, status, created_at,
  started_at)
select tests.id(m.key), tests.id('board_a'), tests.id('school_a1'), tests.id('teacher_a'),
  'differentiate', '{}', m.status::public.ai_job_status, now() - m.created_ago::interval,
  now() - m.started_ago::interval
from (values
  ('recent_job', 'succeeded', '29 days', null),
  ('half_day_job', 'succeeded', '12 hours', null),
  ('stuck_running', 'running', '17 minutes', '16 minutes'),
  ('stuck_queued', 'queued', '61 minutes', null),
  ('live_running', 'running', '2 minutes', '1 minute'),
  ('live_queued', 'queued', '59 minutes', null)
) m (key, status, created_ago, started_ago);
with r as (
  insert into public.ai_request_log (job_id, user_id, created_at)
  values (gen_random_uuid(), tests.id('teacher_a'), now() - interval '25 hours')
  returning job_id
)
select tests.remember('old_log', job_id) from r;
with r as (
  insert into public.ai_request_log (job_id, user_id, created_at)
  values (gen_random_uuid(), tests.id('teacher_a'), now() - interval '23 hours')
  returning job_id
)
select tests.remember('recent_log', job_id) from r;

select is(app.ai_jobs_maintenance(30), 1, 'the maintenance deletes jobs past the retention');
select results_eq(
  $$select k from unnest(array['old_job', 'recent_job', 'half_day_job']) k
    where exists (select 1 from public.ai_jobs where id = tests.id(k)) order by k$$,
  $$values ('half_day_job'), ('recent_job')$$,
  'a 31-day-old job is deleted, a 29-day-old one is kept'
);
select ok(
  exists (select 1 from public.ai_generations where id = tests.id('old_gen'))
  and exists (select 1 from public.library_items where id = tests.id('old_item')),
  'usage and the saved draft outlive the job'
);
select results_eq(
  $$select k, status::text, error_code, finished_at is not null
    from unnest(array['stuck_running', 'stuck_queued', 'live_running', 'live_queued']) k
    join public.ai_jobs j on j.id = tests.id(k) order by k$$,
  $$values ('live_queued', 'queued', null::text, false), ('live_running', 'running', null, false),
    ('stuck_queued', 'failed', 'timeout', true), ('stuck_running', 'failed', 'timeout', true)$$,
  'jobs running for 15 minutes or queued for an hour fail as a timeout; others are left alone'
);
select results_eq(
  $$select k from unnest(array['old_log', 'recent_log']) k
    where exists (select 1 from public.ai_request_log where job_id = tests.id(k))$$,
  $$values ('recent_log')$$,
  'request log entries older than a day are purged'
);

do $$ begin perform app.ai_jobs_maintenance(0); end $$;
select results_eq(
  $$select k from unnest(array['recent_job', 'half_day_job']) k
    where exists (select 1 from public.ai_jobs where id = tests.id(k))$$,
  $$values ('half_day_job')$$,
  'a retention below one day still keeps a day'
);
select ok(
  not has_function_privilege('authenticated', 'app.ai_jobs_maintenance(integer)', 'execute'),
  'only the worker runs the maintenance'
);

-- 9. A teacher's own level used by a saved text can't be deleted (D-046); it can be once
--    nothing uses it, and it still goes with its owner.
insert into public.language_levels (id, board_id, owner_user_id, code, label_fr) values
  (tests.remember('own_level', gen_random_uuid()), tests.id('board_a'), tests.id('teacher_a'),
   'accueil_t9', 'Accueil'),
  (tests.remember('unused_level', gen_random_uuid()), tests.id('board_a'), tests.id('teacher_a'),
   'libre_t9', 'Libre');
insert into public.library_items (id, board_id, school_id, type, title, source, author_id) values
  (tests.remember('saved_text', gen_random_uuid()), tests.id('board_a'), tests.id('school_a1'),
   'reading_passage', 'Le castor', 'ai_generated', tests.id('teacher_a'));
insert into public.library_item_versions (item_id, language_level_id, content)
values (tests.id('saved_text'), tests.id('own_level'), '{"text": "Le castor."}');

select tests.authenticate_as('teacher_a');
select throws_ok(
  $$delete from public.language_levels where id = tests.id('own_level')$$,
  '23503', null, 'a teacher cannot delete their own level while a saved text uses it'
);
select results_eq(
  $$delete from public.language_levels where id = tests.id('unused_level') returning code$$,
  $$values ('libre_t9')$$,
  'a level nothing uses can be deleted'
);
delete from public.library_items where id = tests.id('saved_text');
select results_eq(
  $$delete from public.language_levels where id = tests.id('own_level') returning code$$,
  $$values ('accueil_t9')$$,
  'once the saved text is gone, the level can be deleted'
);
select tests.clear_authentication();

select tests.create_user('leaving_teacher');
insert into public.language_levels (id, board_id, owner_user_id, code, label_fr) values
  (tests.remember('leaving_level', gen_random_uuid()), tests.id('board_a'),
   tests.id('leaving_teacher'), 'depart_t9', 'Départ');
insert into public.library_items (id, board_id, type, title, source, author_id) values
  (tests.remember('leaving_text', gen_random_uuid()), tests.id('board_a'), 'reading_passage',
   'Le hibou', 'ai_generated', tests.id('leaving_teacher'));
insert into public.library_item_versions (item_id, language_level_id, content)
values (tests.id('leaving_text'), tests.id('leaving_level'), '{"text": "Le hibou."}');
select lives_ok(
  $$delete from public.users where id = tests.id('leaving_teacher')$$,
  'removing a teacher still removes their levels, even one a saved text uses'
);

select * from finish();
rollback;
