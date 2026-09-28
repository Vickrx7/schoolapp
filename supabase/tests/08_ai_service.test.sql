-- Phase 2 AI service: the school switch, jobs, budgets and saving results to the library.
begin;
\ir _helpers.psql
select plan(32);
select tests.build_fixture();

-- 1. AI is off by default; only the direction can turn it on, and that is audited.
select is((select ai_enabled from public.schools where id = tests.id('school_a1')), false,
  'AI is off by default');

select tests.authenticate_as('teacher_a');
update public.schools set ai_enabled = true where id = tests.id('school_a1');
select tests.clear_authentication();
select is((select ai_enabled from public.schools where id = tests.id('school_a1')), false,
  'a teacher cannot turn AI on');

select tests.authenticate_as('teacher_a');
select throws_ok(
  $$select public.request_ai_job(tests.id('school_a1'), 'differentiate', '{"text": "Bonjour"}')$$,
  'LXA01', null, 'no request while AI is off'
);
select tests.clear_authentication();

select tests.authenticate_as('principal_a');
update public.schools set ai_enabled = true where id = tests.id('school_a1');
select tests.clear_authentication();
select is((select ai_enabled from public.schools where id = tests.id('school_a1')), true,
  'the principal turns AI on');
select is((select count(*)::int from public.audit_log
  where action = 'school.ai_enabled' and entity_id = tests.id('school_a1')), 1,
  'turning AI on is audited');

-- 2. Requests: staff with a teaching or direction role at the school, valid input only.
select tests.authenticate_as('teacher_a');
select lives_ok(
  $$select tests.remember('job', public.request_ai_job(tests.id('school_a1'), 'differentiate',
    '{"text": "Léa lit un livre."}'))$$,
  'a teacher can request an AI job'
);
select is((select status::text from public.ai_jobs where id = tests.id('job')), 'queued',
  'the job is queued');
select throws_ok(
  $$select public.request_ai_job(tests.id('school_a1'), 'bulk_generate', '{}')$$,
  '22023', null, 'unknown features are refused'
);
select throws_ok(
  $$select public.request_ai_job(tests.id('school_a1'), 'differentiate', '"text"')$$,
  '22023', null, 'the input must be an object'
);
select throws_ok(
  $$select public.request_ai_job(tests.id('school_a2'), 'differentiate', '{}')$$,
  '42501', null, 'a teacher cannot use another school''s AI'
);
select throws_ok(
  $$insert into public.ai_jobs (board_id, school_id, user_id, feature, input)
    values (tests.id('board_a'), tests.id('school_a1'), tests.id('teacher_a'), 'differentiate', '{}')$$,
  '42501', null, 'jobs cannot be inserted directly'
);
select throws_ok(
  $$insert into public.ai_generations (school_id, feature, prompt_version, provider, model, status)
    values (tests.id('school_a1'), 'differentiate', 'v1', 'fake', 'fake', 'succeeded')$$,
  '42501', null, 'usage cannot be written through the API'
);
select tests.clear_authentication();

select is((select count(*)::int from public.event_outbox
  where event_type = 'ai.job_requested' and aggregate_id = tests.id('job')), 1,
  'a request emits ai.job_requested');
select is((select payload from public.event_outbox
  where event_type = 'ai.job_requested' and aggregate_id = tests.id('job')),
  '{"feature": "differentiate"}'::jsonb,
  'the event carries no content');

-- A board can forbid AI for all its schools, whatever the principal chose.
update public.boards set settings = settings || '{"ai": {"allowed": false}}' where id = tests.id('board_a');
select tests.authenticate_as('teacher_a');
select throws_ok(
  $$select public.request_ai_job(tests.id('school_a1'), 'differentiate', '{}')$$,
  'LXA01', null, 'no request when the board does not allow AI'
);
select tests.clear_authentication();
update public.boards set settings = settings - 'ai' where id = tests.id('board_a');

select tests.authenticate_as('office_a');
select throws_ok(
  $$select public.request_ai_job(tests.id('school_a1'), 'differentiate', '{}')$$,
  '42501', null, 'office staff cannot request AI jobs'
);
select tests.clear_authentication();

select tests.authenticate_as('former_teacher');
select throws_ok(
  $$select public.request_ai_job(tests.id('school_a1'), 'differentiate', '{}')$$,
  '42501', null, 'a deactivated user cannot request AI jobs'
);
select tests.clear_authentication();

-- 3. Only the requester sees a job (its input can name students).
select tests.authenticate_as('teacher_a_other');
select is((select count(*)::int from public.ai_jobs where id = tests.id('job')), 0,
  'colleagues cannot see a teacher''s job');
select tests.clear_authentication();
select tests.authenticate_as('principal_a');
select is((select count(*)::int from public.ai_jobs where id = tests.id('job')), 0,
  'the principal cannot see a teacher''s job');
select tests.clear_authentication();

-- 4. Too many open requests at once are refused.
select tests.authenticate_as('teacher_a');
select public.request_ai_job(tests.id('school_a1'), 'differentiate', '{"n": 2}');
select public.request_ai_job(tests.id('school_a1'), 'differentiate', '{"n": 3}');
select throws_ok(
  $$select public.request_ai_job(tests.id('school_a1'), 'differentiate', '{"n": 4}')$$,
  'LXA03', null, 'a fourth open request is refused'
);
select tests.clear_authentication();

-- 5. Budgets: own allowance first, then the board pool up to the ceiling.
update public.schools set ai_enabled = true where id = tests.id('school_a2');
insert into public.ai_budgets (school_id, monthly_allowance_usd, monthly_ceiling_usd) values
  (tests.id('school_a1'), 10, 15),
  (tests.id('school_a2'), 10, null);
insert into public.ai_generations (board_id, school_id, feature, prompt_version, provider, model,
  status, estimated_cost_usd)
values (tests.id('board_a'), tests.id('school_a1'), 'differentiate', 'v1', 'fake', 'fake',
  'succeeded', 12);

select is((select available from app.ai_budget_status(tests.id('school_a1'))), true,
  'past its allowance, a school borrows from the board pool');
select is((select pool_usd from app.ai_budget_status(tests.id('school_a1'))), 20.00::numeric,
  'the pool is the sum of the AI-enabled schools'' allowances');
select is((select ceiling_usd from app.ai_budget_status(tests.id('school_a2'))), 20.00::numeric,
  'the default ceiling is twice the allowance');

insert into public.ai_generations (board_id, school_id, feature, prompt_version, provider, model,
  status, estimated_cost_usd)
values (tests.id('board_a'), tests.id('school_a1'), 'differentiate', 'v1', 'fake', 'fake',
  'succeeded', 4);
select is((select available from app.ai_budget_status(tests.id('school_a1'))), false,
  'a school stops at its ceiling');
select is((select available from app.ai_budget_status(tests.id('school_a2'))), true,
  'another school can still use its own allowance');

update public.boards set settings = settings || '{"ai": {"pooling": false}}' where id = tests.id('board_a');
update public.ai_budgets set monthly_ceiling_usd = 30 where school_id = tests.id('school_a1');
select is((select available from app.ai_budget_status(tests.id('school_a1'))), false,
  'without pooling, the allowance is the limit');

select tests.authenticate_as('teacher_a_other');
select throws_ok(
  $$select public.request_ai_job(tests.id('school_a1'), 'differentiate', '{}')$$,
  'LXA02', null, 'no request once the budget is reached'
);
select throws_ok($$select * from public.ai_usage_summary(tests.id('school_a1'))$$,
  '42501', null, 'teachers do not see the budget screen');
select tests.clear_authentication();

select tests.authenticate_as('principal_a');
select is((select school_spent_usd from public.ai_usage_summary(tests.id('school_a1'))), 16.000000::numeric,
  'the principal sees this month''s spending');
select tests.clear_authentication();

-- 6. Saving a result: only the requester, only a finished job, with AI provenance.
update public.ai_jobs set status = 'succeeded', result = '{"versions": []}' where id = tests.id('job');

select tests.authenticate_as('teacher_a_other');
select throws_ok(
  $$select public.save_ai_job_to_library(tests.id('job'), 'reading_passage', 'Texte',
    '[{"language_level_id": null, "content": {"text": "x"}}]', '3')$$,
  '42501', null, 'only the requester can save a job''s result'
);
select tests.clear_authentication();

select tests.authenticate_as('teacher_a');
select lives_ok(
  $$select tests.remember('item', public.save_ai_job_to_library(tests.id('job'), 'reading_passage',
    'Le castor',
    format('[{"language_level_id": null, "content": {"text": "base"}},
             {"language_level_id": "%s", "content": {"text": "simple"}}]',
      (select id from public.language_levels where board_id = tests.id('board_a') and code = 'debutant'))::jsonb,
    '3'))$$,
  'the requester saves the result as a draft'
);
select results_eq(
  $$select source::text, status::text, share_scope::text,
      (select count(*)::int from public.library_item_versions v where v.item_id = i.id)
    from public.library_items i where i.id = tests.id('item')$$,
  $$values ('ai_generated', 'draft', 'private', 2)$$,
  'the draft is private, marked as AI-generated, with one version per level'
);
select tests.clear_authentication();

select * from finish();
rollback;
