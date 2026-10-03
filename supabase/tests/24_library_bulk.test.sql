-- Phase 5 bulk generation (« Génération en lot »): planning with deduplication, the refusals, the
-- run's life (start, cancel, submission, each answer, the report), what the board's content
-- reviewers see, « Approuver pour le conseil » in one step, the Phase 4 refactors, and the daily
-- clean-up (supabase/migrations/20261101090300_library_bulk.sql; DECISIONS D-095 to D-098, D-101).
begin;
\ir _helpers.psql
\ir _library_coverage_helpers.psql
\ir _library_bulk_helpers.psql
select plan(65);
select tests.build_fixture();
select tests.build_library_fixture();

-- Board A's own subject in grade 3 (tests.coverage_curriculum): Q1 (overall) with Q1.1 and Q1.2,
-- and Q2 (overall, no children). The coverage units, which bulk plans target, are Q1.1, Q1.2, Q2.
select tests.coverage_curriculum();

-- What the board already has:
--   (Q1.1, quiz): an approved board quiz and a teacher's board-shared reviewed quiz;
--   (Q1.2, worksheet): a board draft;
--   (Q2, worksheet): a teacher's worksheet shared with her school only, and an archived board one.
select tests.coverage_item('approved_quiz', null, 'quiz', 'board_approved', 'board', array['cov_s11']);
select tests.coverage_item('shared_quiz', 'teacher_a', 'quiz', 'teacher_reviewed', 'board',
  array['cov_s11'], 'school_a1');
select tests.coverage_item('board_draft_ws', null, 'worksheet', 'draft', 'private', array['cov_s12']);
select tests.coverage_item('school_ws', 'teacher_a', 'worksheet', 'teacher_reviewed', 'school',
  array['cov_o2'], 'school_a1');
select tests.coverage_item('archived_ws', null, 'worksheet', 'archived', 'private', array['cov_o2']);
update public.library_items set title = 'Le huard compte (brouillon du conseil)'
where id = tests.id('board_draft_ws');
update public.library_items set title = 'Titre visible de mon école seulement'
where id = tests.id('school_ws');
delete from public.event_outbox;

-- ---------------------------------------------------------------------------------------
-- 1. Planning is the operator's (D-095)
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('board_admin_a');
select is(
  tests.error_of($$select public.library_bulk_plan(tests.id('board_a'),
    tests.bulk_params(array['quiz']), 5, null)$$),
  '42501', 'a signed-in user (even a content reviewer) cannot plan a run'
);
select is(
  tests.error_of($$select public.library_bulk_start(gen_random_uuid())$$)
    || ' ' || tests.error_of($$select public.library_bulk_cancel(gen_random_uuid())$$),
  '42501 42501', 'nor start or cancel one'
);
select is(
  tests.error_of($$select app.library_bulk_finish(gen_random_uuid(), 'completed')$$)
    || ' ' || tests.error_of($$select app.library_maintenance()$$),
  '42501 42501', 'nor run the worker''s steps'
);
select tests.clear_authentication();

-- Two requests per attente at most here (perExpectation 2): only (Q1.1, quiz) is covered.
select set_config('role', 'service_role', true);
select tests.remember('run1', (public.library_bulk_plan(tests.id('board_a'),
  tests.bulk_params(array['quiz', 'worksheet'], '{"perExpectation": 2}'), 25,
  'Automne : nombres jusqu’à 1 000.') ->> 'runId')::uuid);
select tests.clear_authentication();

select results_eq(
  $$select ce.code, r.item_type::text, r.status, coalesce(r.reason, '')
    from public.library_bulk_requests r join public.curriculum_expectations ce on ce.id = r.expectation_id
    where r.run_id = tests.id('run1') order by ce.code, r.item_type::text$$,
  $$values ('Q1.1', 'quiz', 'skipped', 'covered'), ('Q1.1', 'worksheet', 'planned', ''),
      ('Q1.2', 'quiz', 'planned', ''), ('Q1.2', 'worksheet', 'planned', ''),
      ('Q2', 'quiz', 'planned', ''), ('Q2', 'worksheet', 'planned', '')$$,
  'the operator plans one request per coverage unit and type; two approved or board-shared items cover a pair'
);
select results_eq(
  $$select status, max_cost_usd, request_count, note from public.library_bulk_runs
    where id = tests.id('run1')$$,
  $$values ('planned', 25.00::numeric(10, 2), 5, 'Automne : nombres jusqu’à 1 000.')$$,
  'the run is planned with its cap, the number of requests to send and the operator''s note'
);

-- The input: labels from the database, the attente's grade, the board's levels, the type's
-- default duration, and the note with only board-visible titles.
select results_eq(
  $$select r.input ->> 'subjectLabel', r.input #>> '{expectations,0,code}',
      r.input #>> '{expectations,0,text}', r.input -> 'gradeCodes', r.input -> 'gradeLabels',
      (r.input ->> 'durationMinutes')::int, r.input -> 'subFriendly'
    from public.library_bulk_requests r
    where r.id = tests.bulk_request(tests.id('run1'), 'cov_o2', 'quiz')$$,
  $$values ('Matière cov', 'Q2', 'Attente générale sans contenu.', '["3"]'::jsonb,
      '["3e année"]'::jsonb, 30, 'false'::jsonb)$$,
  'each input holds the curriculum labels and texts read from the database'
);
select is(
  (select jsonb_agg(l ->> 'languageLevelId' order by l ->> 'key')
   from public.library_bulk_requests r, jsonb_array_elements(r.input -> 'levels') l
   where r.id = tests.bulk_request(tests.id('run1'), 'cov_o2', 'quiz')),
  (select jsonb_agg(ll.id::text order by ll.sort_order) from public.language_levels ll
   where ll.board_id = tests.id('board_a') and ll.owner_user_id is null and ll.active),
  'levels « all » asks for every board level (keys L1…), never a personal level'
);
select is(
  (select input ->> 'teacherNote' from public.library_bulk_requests
   where id = tests.bulk_request(tests.id('run1'), 'cov_s12', 'worksheet')),
  E'Automne : nombres jusqu’à 1 000.\nRessources existantes à ne pas reprendre : « Le huard compte (brouillon du conseil) ».',
  'the note holds the operator''s note and the titles of the board''s items for that attente and type'
);
select is(
  (select input ->> 'teacherNote' from public.library_bulk_requests
   where id = tests.bulk_request(tests.id('run1'), 'cov_o2', 'worksheet')),
  'Automne : nombres jusqu’à 1 000.',
  'a title shared with one school only (or archived) never goes into the note'
);
select ok(
  (select bool_and(char_length(input ->> 'teacherNote') <= 1000 and input -> 'catholic' = 'null'::jsonb)
   from public.library_bulk_requests where run_id = tests.id('run1') and status = 'planned'),
  'every note stays within 1,000 characters, with no faith link'
);

-- Refusals.
select set_config('role', 'service_role', true);
select is(
  tests.error_of($$select public.library_bulk_plan(tests.id('board_a'),
    tests.bulk_params(array['quiz']), 5, null)$$),
  'LXB03', 'a second active run for the board is refused'
);
select public.library_bulk_cancel(tests.id('run1'));
select is(
  tests.error_of($$select public.library_bulk_plan(tests.id('board_a'),
    tests.bulk_params(array['catholic_reflection']), 5, null)$$)
    || ' ' || tests.error_of($$select public.library_bulk_plan(tests.id('board_a'),
    tests.bulk_params(array['essay']), 5, null)$$)
    || ' ' || tests.error_of($$select public.library_bulk_plan(tests.id('board_a'),
    tests.bulk_params(array['quiz'], jsonb_build_object('subjectId',
      (select id from public.subjects where code = 'ere' and board_id is null))), 5, null)$$),
  '22023 22023 22023',
  'Catholic reflections, unknown types and Enseignement religieux are refused'
);
select is(
  left(tests.error_of($$select public.library_bulk_plan(tests.id('board_a'),
    tests.bulk_params(array['quiz']), 0, null)$$), 5)
    || ' ' || left(tests.error_of($$select public.library_bulk_plan(tests.id('board_a'),
    tests.bulk_params(array['quiz']), 1001, null)$$), 5),
  '23514 23514', 'a cap of 0 or above 1,000 is refused'
);
select is(
  tests.error_of($$select public.library_bulk_plan(tests.id('board_a'),
    tests.bulk_params(array['quiz'], '{"expectationCodes": ["Q9"]}'), 5, null)$$)
    || ' ' || tests.error_of($$select public.library_bulk_plan(tests.id('board_a'),
    tests.bulk_params(array['quiz'], '{"expectationCodes": ["Q2"], "strandCodes": ["Q"]}'), 5, null)$$)
    || ' ' || tests.error_of($$select public.library_bulk_plan(tests.id('board_a'),
    tests.bulk_params(array['quiz'], '{"perExpectation": 4}'), 5, null)$$)
    || ' ' || tests.error_of($$select public.library_bulk_plan(tests.id('board_a'),
    tests.bulk_params(array['quiz']) - 'durations', 5, null)$$),
  '22023 Q9 22023 22023 22023',
  'an unknown attente code, two filters, 4 items per attente and a missing duration are refused'
);
select tests.clear_authentication();
select tests.bulk_many_attentes(101);
select set_config('role', 'service_role', true);
select is(
  tests.error_of($$select public.library_bulk_plan(tests.id('board_a'),
    tests.bulk_params(array['quiz', 'worksheet', 'game', 'song', 'reading_passage'],
      jsonb_build_object('subjectId', tests.id('many_subject'))), 5, null)$$),
  'LXB02 505', 'more than 500 requests in one run are refused'
);
select tests.clear_authentication();
update public.boards set settings = jsonb_set(settings, '{ai}', '{"allowed": false}')
where id = tests.id('board_a');
select set_config('role', 'service_role', true);
select is(
  tests.error_of($$select public.library_bulk_plan(tests.id('board_a'),
    tests.bulk_params(array['quiz']), 5, null)$$),
  'LXA01', 'a board that does not allow AI gets LXA01'
);
select tests.clear_authentication();
update public.boards set settings = settings - 'ai' where id = tests.id('board_a');
select is(
  (select count(*)::int from public.library_bulk_runs where board_id = tests.id('board_a')),
  1, 'a refused plan leaves nothing behind (only the cancelled run remains)'
);

-- Deduplication with one item per attente (D-097): an approved item or a board draft covers a
-- pair, an item shared with one school does not. Filters.
select set_config('role', 'service_role', true);
select tests.remember('run2', (public.library_bulk_plan(tests.id('board_a'),
  tests.bulk_params(array['quiz', 'worksheet']), 25, null) ->> 'runId')::uuid);
select tests.clear_authentication();
select results_eq(
  $$select ce.code, r.item_type::text, r.status
    from public.library_bulk_requests r join public.curriculum_expectations ce on ce.id = r.expectation_id
    where r.run_id = tests.id('run2') and r.status = 'skipped' order by 1, 2$$,
  $$values ('Q1.1', 'quiz', 'skipped'), ('Q1.2', 'worksheet', 'skipped')$$,
  'an approved item or a board draft covers its pair; a school-shared item does not'
);
select set_config('role', 'service_role', true);
select public.library_bulk_cancel(tests.id('run2'));
select is(
  public.library_bulk_plan(tests.id('board_a'), tests.bulk_params(array['quiz', 'worksheet'],
    '{"fromCoverage": {"minApproved": 1}, "levels": "none"}'), 25, null) - 'runId',
  '{"planned": 3, "skipped": {"covered": 1}, "byType": {"quiz": {"planned": 2, "covered": 0}, "worksheet": {"planned": 1, "covered": 1}}}'::jsonb,
  '« --from-coverage 1 » targets only attentes without an approved item, and says what it planned'
);
select tests.clear_authentication();
select is(
  (select count(*)::int from public.library_bulk_requests r
   join public.library_bulk_runs u on u.id = r.run_id
   where u.status = 'planned' and u.board_id = tests.id('board_a')
     and (r.expectation_id = tests.id('cov_s11') or jsonb_array_length(r.input -> 'levels') > 0)),
  0, 'the covered attente is left out, and levels « none » asks for the base version only'
);
select set_config('role', 'service_role', true);
select public.library_bulk_cancel((select id from public.library_bulk_runs
  where board_id = tests.id('board_a') and status = 'planned'));
select is(
  (public.library_bulk_plan(tests.id('board_a'), tests.bulk_params(array['quiz'],
    '{"expectationCodes": ["Q2"]}'), 25, null) ->> 'planned')::int,
  1, 'an attente code targets that attente only'
);
select public.library_bulk_cancel((select id from public.library_bulk_runs
  where board_id = tests.id('board_a') and status = 'planned'));
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- 2. Starting and cancelling
-- ---------------------------------------------------------------------------------------

select set_config('role', 'service_role', true);
select tests.remember('run', (public.library_bulk_plan(tests.id('board_a'),
  tests.bulk_params(array['quiz', 'worksheet', 'game']), 10, null) ->> 'runId')::uuid);
select public.library_bulk_start(tests.id('run'));
select tests.clear_authentication();

select results_eq(
  $$select status, started_at is not null from public.library_bulk_runs where id = tests.id('run')$$,
  $$values ('running', true)$$,
  'starting moves the run to running'
);
select results_eq(
  $$select payload from public.event_outbox where event_type = 'library_bulk_run.started'$$,
  $$values (jsonb_build_object('runId', tests.id('run')))$$,
  'starting emits library_bulk_run.started with the run id only (it wakes the worker)'
);
select results_eq(
  $$select actor_type::text, details from public.audit_log
    where action = 'library_bulk_run.started' and entity_id = tests.id('run')$$,
  $$values ('service', '{"max_cost_usd": 10.00, "request_count": 7}'::jsonb)$$,
  'starting is audited as the operator, with the cap and the number of requests'
);
select set_config('role', 'service_role', true);
select is(
  tests.error_of($$select public.library_bulk_start(tests.id('run'))$$)
    || ' ' || tests.error_of($$select public.library_bulk_start(tests.id('run1'))$$)
    || ' ' || tests.error_of($$select public.library_bulk_cancel(tests.id('run1'))$$),
  'LXB01 LXB01 LXB01', 'a running or ended run cannot start, and an ended one cannot be cancelled'
);
select tests.clear_authentication();
select results_eq(
  $$select status, report #>> '{skipped,cancelled}', report #>> '{skipped,covered}'
    from public.library_bulk_runs where id = tests.id('run1')$$,
  $$values ('cancelled', '5', '1')$$,
  'cancelling a planned run ends it at once, its requests skipped as cancelled'
);

-- ---------------------------------------------------------------------------------------
-- 3. The worker's steps (as the database owner)
-- ---------------------------------------------------------------------------------------

-- Five requests fit and are sent; Q2 worksheet could not be prepared; Q2 game is over the cap.
select is(
  app.library_bulk_mark_submitting(tests.id('run'),
    (select jsonb_agg(jsonb_build_object('id', tests.bulk_request(tests.id('run'), e, t),
        'worstCaseUsd', 0.66, 'sentSha256', repeat('a', 64), 'sentText', 'Type de ressource : …'))
     from (values ('cov_s11', 'worksheet'), ('cov_s11', 'game'), ('cov_s12', 'quiz'),
       ('cov_s12', 'game'), ('cov_o2', 'quiz')) x (e, t)),
    jsonb_build_array(jsonb_build_object('id', tests.bulk_request(tests.id('run'), 'cov_o2', 'worksheet'),
      'reason', 'personalInfo'))),
  5, 'submitting marks the requests that fit as submitted'
);
select results_eq(
  $$select ce.code, r.item_type::text, r.status, coalesce(r.reason, '')
    from public.library_bulk_requests r join public.curriculum_expectations ce on ce.id = r.expectation_id
    where r.run_id = tests.id('run') and r.status in ('skipped', 'failed') order by 1, 2$$,
  $$values ('Q1.1', 'quiz', 'skipped', 'covered'), ('Q1.2', 'worksheet', 'skipped', 'covered'),
      ('Q2', 'game', 'skipped', 'cost_cap'), ('Q2', 'worksheet', 'failed', 'personalInfo')$$,
  'the rest is skipped for the cap, and a request that could not be prepared fails with its code'
);
select results_eq(
  $$select submit_started_at is not null, worst_case_usd from public.library_bulk_runs
    where id = tests.id('run')$$,
  $$values (true, 3.30::numeric(12, 6))$$,
  'the run records when submission began and its worst case'
);
select is(
  tests.error_of($$select app.library_bulk_mark_submitting(tests.id('run'), '[]', '[]')$$),
  'LXB01', 'a run is never submitted twice'
);
update public.library_bulk_runs set batch_id = 'fake-batch-1' where id = tests.id('run');

-- An answer: the board's draft (D-095).
select is(
  app.library_bulk_record_result(tests.bulk_request(tests.id('run'), 'cov_s12', 'quiz'),
    tests.bulk_generation(0.12), tests.bulk_output('Quiz : comparer des nombres'), null),
  'created', 'an answer becomes a draft'
);
select tests.remember('bulk_quiz', (select item_id from public.library_bulk_requests
  where id = tests.bulk_request(tests.id('run'), 'cov_s12', 'quiz')));
select results_eq(
  $$select i.board_owned, i.author_id, i.school_id, i.source::text, i.status::text,
      i.share_scope::text, i.bulk_run_id, i.prompt_version, i.model, i.ai_generation_id is not null
    from public.library_items i where i.id = tests.id('bulk_quiz')$$,
  $$values (true, null::uuid, null::uuid, 'ai_generated', 'draft', 'private', tests.id('run'),
      'v1', 'fake', true)$$,
  'the draft is the board''s own (no author, no school), private, AI-generated, from its run'
);
select results_eq(
  $$select (select count(*)::int from public.library_item_versions v where v.item_id = tests.id('bulk_quiz')),
      (select count(*)::int from public.library_item_versions v
        join public.library_item_answer_keys k on k.version_id = v.id where v.item_id = tests.id('bulk_quiz')),
      (select array_agg(e.expectation_id) from public.library_item_expectations e
        where e.item_id = tests.id('bulk_quiz')),
      (select array_agg(g.grade_code) from public.library_item_grades g where g.item_id = tests.id('bulk_quiz'))$$,
  $$values (5, 5, array[tests.id('cov_s12')], array['3'])$$,
  'with its base and level versions, their keys, its attente and grade'
);
select results_eq(
  $$select g.board_id, g.school_id, g.user_id, g.feature, g.batch_id, g.estimated_cost_usd, g.status::text
    from public.ai_generations g join public.library_items i on i.ai_generation_id = g.id
    where i.id = tests.id('bulk_quiz')$$,
  $$values (tests.id('board_a'), null::uuid, null::uuid, 'library_item', 'fake-batch-1',
      0.12::numeric(12, 6), 'succeeded')$$,
  'its cost is recorded for the board with the batch id, and no school or user'
);
select is(
  (select spent_usd from public.library_bulk_runs where id = tests.id('run')),
  0.12::numeric(12, 6), 'and added to what the run spent'
);
select results_eq(
  $$select actor_type::text, details from public.audit_log
    where action = 'library_item.generated' and entity_id = tests.id('bulk_quiz')$$,
  $$values ('system', jsonb_build_object('bulk_run_id', tests.id('run')))$$,
  'the draft is audited with its run'
);
select is(
  app.library_bulk_record_result(tests.bulk_request(tests.id('run'), 'cov_s12', 'quiz'),
    tests.bulk_generation(0.12), tests.bulk_output('Encore'), null),
  'already', 'a result read again is not recorded twice'
);
select is(
  (select count(*)::int from public.library_items where bulk_run_id = tests.id('run')),
  1, 'and makes no second draft'
);

-- A title like an existing item's: kept (it was paid for) and flagged (D-097).
select is(
  app.library_bulk_record_result(tests.bulk_request(tests.id('run'), 'cov_s11', 'worksheet'),
    tests.bulk_generation(0.10), tests.bulk_output('LE HUARD COMPTE — brouillon du conseil!'),
    null, array['student_name', 'Not a code!']),
  'created', 'an answer whose title is like an existing item''s is still a draft'
);
select results_eq(
  $$select problems from public.library_bulk_requests
    where id = tests.bulk_request(tests.id('run'), 'cov_s11', 'worksheet')$$,
  $$values (array['similar_title', 'student_name'])$$,
  'flagged « similar_title » for the reviewer (with the worker''s own codes, never text)'
);

-- Failures: a refusal (billed), an answer the database cannot store, and a missing answer.
select is(
  app.library_bulk_record_result(tests.bulk_request(tests.id('run'), 'cov_s11', 'game'),
    tests.bulk_generation(0.02, 'failed'), null, 'aiRefused')
  || ' ' || app.library_bulk_record_result(tests.bulk_request(tests.id('run'), 'cov_s12', 'game'),
    tests.bulk_generation(0.03), '{"title": "Sans version"}'::jsonb, null),
  'failed failed', 'a refused or unusable answer fails its request'
);
select results_eq(
  $$select r.reason, r.item_id, g.status::text, g.error_code, r.cost_usd
    from public.library_bulk_requests r join public.ai_generations g on g.id = r.ai_generation_id
    where r.run_id = tests.id('run') and r.item_type = 'game' and r.status = 'failed' order by 1$$,
  $$values ('aiRefused', null::uuid, 'failed', 'aiRefused', 0.02::numeric(12, 6)),
      ('invalidOutput', null::uuid, 'invalid_output', 'invalidOutput', 0.03::numeric(12, 6))$$,
  'their cost is still recorded, and an answer that cannot be stored leaves no draft'
);

-- Finishing (the batch had no answer for Q2 quiz).
select is(
  app.library_bulk_finish(tests.id('run'), 'completed') - 'spentUsd' - 'worstCaseUsd' - 'maxCostUsd',
  '{"requests": 9, "created": 2, "similarTitles": 1, "skipped": {"covered": 2, "costCap": 1, "cancelled": 0}, "failed": {"aiRefused": 1, "invalidOutput": 1, "personalInfo": 1, "batch_missing": 1}}'::jsonb,
  'finishing writes the report: created, similar titles, skipped and failed by code'
);
select results_eq(
  $$select status, finished_at is not null, (report ->> 'spentUsd')::numeric,
      (report ->> 'worstCaseUsd')::numeric, (report ->> 'maxCostUsd')::numeric
    from public.library_bulk_runs where id = tests.id('run')$$,
  $$values ('completed', true, 0.27, 3.30, 10.00)$$,
  'the run is completed, with what it spent, its worst case and its cap'
);
select results_eq(
  $$select e.payload, a.actor_type::text, a.details
    from public.event_outbox e join public.audit_log a on a.entity_id = e.aggregate_id
    where e.event_type = 'library_bulk_run.completed' and e.aggregate_id = tests.id('run')
      and a.action = 'library_bulk_run.completed'$$,
  $$values (jsonb_build_object('runId', tests.id('run')), 'system',
      '{"created": 2, "similar": 1, "skipped": 3, "failed": 4, "spent_usd": 0.270000, "error_code": null}'::jsonb)$$,
  'finishing emits library_bulk_run.completed and is audited with the counts'
);
select is(
  app.library_bulk_finish(tests.id('run'), 'failed', 'late') ->> 'created',
  '2', 'a run that has ended keeps its report'
);

-- ---------------------------------------------------------------------------------------
-- 4. What the board's content reviewers see
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('board_admin_a');
select results_eq(
  $$select id, status, max_cost_usd, spent_usd, report ->> 'created'
    from public.library_bulk_runs where id = tests.id('run')$$,
  $$values (tests.id('run'), 'completed', 10.00::numeric(10, 2), 0.27::numeric(12, 6), '2')$$,
  'a content reviewer sees the board''s runs and their report'
);
select is(
  (select count(*)::int from public.library_bulk_requests where run_id = tests.id('run')),
  9, 'and their requests'
);
select is(
  tests.error_of($$select input from public.library_bulk_requests limit 1$$)
    || ' ' || tests.error_of($$select sent_text from public.library_bulk_requests limit 1$$)
    || ' ' || tests.error_of($$select params from public.library_bulk_runs limit 1$$),
  '42501 42501 42501', 'but never what was sent, the inputs or the parameters'
);
select tests.clear_authentication();
select tests.authenticate_as('teacher_a');
select is(
  (select count(*)::int from public.library_bulk_runs)
    + (select count(*)::int from public.library_bulk_requests),
  0, 'a teacher sees no run and no request'
);
select is(
  tests.error_of($$update public.library_bulk_runs set status = 'failed'$$),
  '42501', 'nobody changes a run through the API'
);
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- 5. « Approuver pour le conseil » for a board draft, in one step
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select is(
  tests.error_of($$select public.library_approve_board_draft(tests.id('bulk_quiz'), 1, true)$$),
  '42501', 'someone who does not approve the board''s content cannot approve a board draft'
);
select tests.clear_authentication();
select tests.authenticate_as('board_admin_a');
select is(
  tests.error_of($$select public.library_approve_board_draft(tests.id('bulk_quiz'), 1, false)$$)
    || ' ' || tests.error_of($$select public.library_approve_board_draft(tests.id('bulk_quiz'), 7, true)$$)
    || ' ' || tests.error_of($$select public.library_approve_board_draft(tests.id('school_ws'), 1, true)$$),
  '22023 LXL07 42501',
  'the originality box is required, the revision must be the one read, and a teacher''s item is not a board draft'
);
select is(
  public.library_approve_board_draft(tests.id('bulk_quiz'), 1, true),
  'approved', 'a content reviewer approves a ready board draft in one step'
);
select results_eq(
  $$select status::text, share_scope::text, school_id, approved_by, review_requested_at
    from public.library_items where id = tests.id('bulk_quiz')$$,
  $$values ('board_approved', 'board', null::uuid, tests.id('board_admin_a'), null::timestamptz)$$,
  'it is approved and board-wide'
);
select tests.clear_authentication();
select results_eq(
  $$select action, details ->> 'via' from public.audit_log
    where entity_id = tests.id('bulk_quiz') and action like 'library_item.%' and action <> 'library_item.generated'
    order by id$$,
  $$values ('library_item.reviewed', null), ('library_item.review_requested', null),
      ('library_item.approved', 'board_draft')$$,
  'through the usual steps, each audited, the approval « via » the board drafts'
);
select results_eq(
  $$select payload from public.event_outbox
    where event_type = 'library_item.approved' and aggregate_id = tests.id('bulk_quiz')$$,
  $$values (jsonb_build_object('itemId', tests.id('bulk_quiz')))$$,
  'and emits library_item.approved'
);

-- Faith content: proposed, and its faith review comes first.
select tests.coverage_item('faith_draft', null, 'worksheet', 'draft', 'private', array['cov_o2']);
update public.library_items set faith_content = true where id = tests.id('faith_draft');
select tests.authenticate_as('board_admin_a');
select is(
  public.library_approve_board_draft(tests.id('faith_draft'), 1, true),
  'faith_review', 'a faith board draft stops after the proposal: its faith review comes first'
);
select tests.clear_authentication();
select results_eq(
  $$select status::text, review_requested_at is not null, share_scope::text
    from public.library_items where id = tests.id('faith_draft')$$,
  $$values ('teacher_reviewed', true, 'private')$$,
  'it waits in the queue, still private'
);

-- ---------------------------------------------------------------------------------------
-- 6. The Phase 4 refactors keep their behaviour
-- ---------------------------------------------------------------------------------------

select is(
  app.library_item_ai_input(tests.id('teacher_a'), tests.id('school_a1'), jsonb_build_object(
    'itemType', 'worksheet', 'gradeCodes', jsonb_build_array('3'),
    'subjectId', (select id from public.subjects where code = 'fra' and board_id is null),
    'expectationIds', jsonb_build_array(tests.id('exp_a')),
    'levelIds', jsonb_build_array(tests.id('level_personal_a')),
    'durationMinutes', 30, 'teacherNote', 'Note')),
  app.library_item_ai_input_for_board(tests.id('board_a'), tests.id('teacher_a'), jsonb_build_object(
    'itemType', 'worksheet', 'gradeCodes', jsonb_build_array('3'),
    'subjectId', (select id from public.subjects where code = 'fra' and board_id is null),
    'expectationIds', jsonb_build_array(tests.id('exp_a')),
    'levelIds', jsonb_build_array(tests.id('level_personal_a')),
    'durationMinutes', 30, 'teacherNote', 'Note')),
  '« Créer avec l''IA » builds the same input as before, the teacher''s own level included'
);
select is(
  tests.error_of($$select app.library_item_ai_input_for_board(tests.id('board_a'), null,
    jsonb_build_object('itemType', 'worksheet', 'gradeCodes', jsonb_build_array('3'),
      'subjectId', (select id from public.subjects where code = 'fra' and board_id is null),
      'expectationIds', jsonb_build_array(tests.id('exp_a')),
      'levelIds', jsonb_build_array(tests.id('level_personal_a')), 'durationMinutes', 30))$$)
    || ' ' || tests.error_of($$select app.library_item_ai_input(tests.id('outsider'),
      tests.id('school_a1'), '{}'::jsonb)$$),
  '22023 42501',
  'without a user only board levels are allowed; the school check still comes first'
);

-- ---------------------------------------------------------------------------------------
-- 7. Daily clean-up (D-101)
-- ---------------------------------------------------------------------------------------

-- A run stuck in submission, a planned run from two days ago, and what was sent 31 days ago.
select set_config('role', 'service_role', true);
select tests.remember('run_stuck', (public.library_bulk_plan(tests.id('board_a'),
  tests.bulk_params(array['song']), 5, null) ->> 'runId')::uuid);
select public.library_bulk_start(tests.id('run_stuck'));
select tests.clear_authentication();
update public.library_bulk_runs set submit_started_at = now() - interval '20 minutes'
where id = tests.id('run_stuck');
update public.library_bulk_runs set submit_started_at = now() - interval '31 days'
where id = tests.id('run');
insert into public.library_bulk_runs (id, board_id, params, max_cost_usd, created_at)
values (tests.remember('run_old_plan', gen_random_uuid()), tests.id('board_b'), '{}', 5,
  now() - interval '2 days');

select is(
  app.library_maintenance() - 'packImportsDeleted',
  '{"stuckFailed": 1, "plannedDeleted": 1, "runsDeleted": 0, "sentTextCleared": 5}'::jsonb,
  'the clean-up fails a stuck run, deletes an old planned run and clears old sent text'
);
select results_eq(
  $$select status, error_code from public.library_bulk_runs where id = tests.id('run_stuck')$$,
  $$values ('failed', 'submitUnconfirmed')$$,
  'a run whose submission was never confirmed fails and is never sent again'
);
select results_eq(
  $$select count(*)::int, count(sent_sha256)::int, count(sent_text)::int
    from public.library_bulk_requests where run_id = tests.id('run') and sent_sha256 is not null$$,
  $$values (5, 5, 0)$$,
  'what was sent is cleared after 30 days; its SHA-256 stays'
);
select is(
  (select count(*)::int from public.library_bulk_runs where id = tests.id('run_old_plan')),
  0, 'a run planned and never started is deleted after a day'
);

select * from finish();
rollback;
