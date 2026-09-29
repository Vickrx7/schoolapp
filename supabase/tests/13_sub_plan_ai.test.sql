-- « Consignes détaillées » for substitute plans (3b): who may ask, when, the checks shared with
-- every AI request, applying the answer only to the plan's current request and only while no
-- substitute has opened the plan, removing it, and who reads it afterwards (DECISIONS D-037,
-- D-038, D-048, D-052, D-056). The worker's part is played by superuser updates of ai_jobs, as
-- apps/worker/src/ai.ts writes them.
begin;
\ir _helpers.psql
select plan(44);
select tests.build_fixture();

-- The week two weeks from now: wk(0) is its Monday.
create function tests.wk(p_day integer)
returns date
language sql
as $$
  select (current_date + 14) - (extract(isodow from current_date + 14)::integer - 1) + p_day;
$$;

create function tests.hex(p_text text)
returns text
language sql
as $$
  select encode(extensions.digest(p_text, 'sha256'), 'hex');
$$;

-- A request as the web server sends it (the database checks its shape and size only), with
-- `p_pad` characters of filler to test the size limit.
create function tests.ai_input(p_blocks integer default 1, p_pad integer default 0)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'weekday', 'lundi',
    'groups', '[]'::jsonb,
    'faith', jsonb_build_object('ref', 'c1000000-0000-4000-8000-000000000001', 'title', 'Le respect',
      'text', 'Je traite les autres comme j''aimerais être traité.'),
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', 'B' || n,
        'ref', jsonb_build_object('blockKey', '60000000-0000-4000-8000-00000000000' || n, 'lessonId', null),
        'subjectLabel', 'Français',
        'lesson', jsonb_build_object('title', 'Lire', 'content', 'Lecture du texte, puis questions.')))
      from generate_series(1, p_blocks) n), '[]'::jsonb),
    'pad', repeat('x', p_pad));
$$;

-- What the worker records when a job finishes (finishJob).
create function tests.finish_job(p_job uuid, p_status public.ai_job_status)
returns void
language sql
as $$
  update public.ai_jobs
  set status = p_status,
      result = case when p_status = 'succeeded' then
        '{"dayOverview": "Une journée calme.", "blocks": [], "faithSentence": "Pensons au respect."}'::jsonb
      end,
      sent_text = 'Journée de suppléance : un lundi.',
      finished_at = now()
  where id = p_job;
$$;

-- A substitute signed in on a plan, with a token the portal role can load.
create function tests.open_session(p_plan_key text)
returns text
language plpgsql
as $$
declare
  v_token text := substr(tests.hex('token:' || p_plan_key), 1, 43);
  v_code uuid;
begin
  insert into public.sub_access_codes (sub_plan_id, code_hash, valid_on, valid_from, expires_at)
  select p.id, tests.hex('code:' || p_plan_key), p.plan_date, now() - interval '1 hour',
    now() + interval '2 hours'
  from public.sub_plans p where p.id = tests.id(p_plan_key)
  returning id into v_code;
  insert into public.sub_sessions (access_code_id, sub_plan_id, session_token_hash, expires_at,
    device_key)
  values (v_code, tests.id(p_plan_key), tests.hex(v_token), now() + interval '2 hours',
    tests.hex('device:' || p_plan_key));
  return v_token;
end;
$$;

create function tests.portal_load(p_token text)
returns jsonb
language plpgsql
as $$
declare
  v jsonb;
begin
  perform tests.as_portal();
  v := sub_portal.load(p_token, null, 'poll');
  perform set_config('role', 'none', true);
  return v;
end;
$$;

create function tests.version(p_plan_key text)
returns integer
language sql
as $$
  select content_version from public.sub_plans where id = tests.id(p_plan_key);
$$;

grant execute on function tests.wk(integer), tests.ai_input(integer, integer),
  tests.version(text) to authenticated;

-- ---------------------------------------------------------------------------------------
-- The feature and the plan's AI layer
-- ---------------------------------------------------------------------------------------

select has_column('public', 'sub_plans', 'ai', 'plans have an AI layer');
select lives_ok(
  $$insert into public.ai_jobs (board_id, school_id, user_id, feature, input)
    values (tests.id('board_a'), tests.id('school_a1'), tests.id('teacher_a'), 'sub_plan', '{}')$$,
  'ai_jobs accepts the sub_plan feature'
);
select throws_ok(
  $$insert into public.ai_jobs (board_id, school_id, user_id, feature, input)
    values (tests.id('board_a'), tests.id('school_a1'), tests.id('teacher_a'), 'bulk_generate', '{}')$$,
  '23514', null, 'and still no other feature'
);
delete from public.ai_jobs;

-- Isabelle's absence: three days, each with its plan.
select tests.authenticate_as('teacher_a');
select tests.remember('abs', public.publish_absence(
  tests.id('school_a1'), tests.wk(0), tests.wk(2), 'full_day', null, true, gen_random_uuid(),
  tests.plan_items(array[tests.wk(0), tests.wk(1), tests.wk(2)], array[tests.id('class_a')])));
select tests.clear_authentication();
select tests.remember('plan1', (select id from public.sub_plans where absence_id = tests.id('abs') and plan_date = tests.wk(0)));
select tests.remember('plan2', (select id from public.sub_plans where absence_id = tests.id('abs') and plan_date = tests.wk(1)));
select tests.remember('plan3', (select id from public.sub_plans where absence_id = tests.id('abs') and plan_date = tests.wk(2)));
delete from public.event_outbox;

-- ---------------------------------------------------------------------------------------
-- Asking: the owner only, AI on, the school's budget and the person's limits
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select throws_ok(
  $$select public.request_sub_plan_ai(tests.id('plan1'), tests.ai_input(), tests.version('plan1'))$$,
  'LXA01', null, 'nothing is queued while the school''s AI is off'
);
select tests.clear_authentication();
update public.schools set ai_enabled = true where id = tests.id('school_a1');

select tests.authenticate_as('teacher_a');
select throws_ok(
  $$select public.request_ai_job(tests.id('school_a1'), 'sub_plan', tests.ai_input())$$,
  '22023', null, 'a substitute plan cannot be asked for through request_ai_job'
);
select lives_ok(
  $$select tests.remember('diff_job', public.request_ai_job(tests.id('school_a1'), 'differentiate',
      '{"text": "Bonjour"}'))$$,
  'request_ai_job still queues a differentiated text'
);
select throws_ok(
  $$select public.request_sub_plan_ai(tests.id('plan1'), tests.ai_input(), 99)$$,
  'LXS15', null, 'a plan that changed since the preview is refused'
);
select throws_ok(
  $$select public.request_sub_plan_ai(tests.id('plan1'), '{"blocks": []}', null)$$,
  '22023', null, 'a request without periods is refused'
);
select throws_ok(
  $$select public.request_sub_plan_ai(tests.id('plan1'), tests.ai_input(11), null)$$,
  '22023', null, 'a request with more than ten periods is refused'
);
select throws_ok(
  $$select public.request_sub_plan_ai(tests.id('plan1'), tests.ai_input(1, 100000), null)$$,
  '22023', null, 'a request over 96 KB is refused'
);
select lives_ok(
  $$select tests.remember('job1', public.request_sub_plan_ai(tests.id('plan1'), tests.ai_input(),
      tests.version('plan1')))$$,
  'the owner asks for detailed instructions'
);
select is(
  public.request_sub_plan_ai(tests.id('plan1'), tests.ai_input(), tests.version('plan1')),
  tests.id('job1'),
  'a second tap while the request runs returns the same request'
);
select tests.clear_authentication();

select results_eq(
  $$select feature, user_id, status::text, input -> 'blocks' -> 0 ->> 'key'
    from public.ai_jobs where id = tests.id('job1')$$,
  $$values ('sub_plan', tests.id('teacher_a'), 'queued', 'B1')$$,
  'the request is an AI job of the owner, with the input as sent'
);
select is(
  (select ai_job_id from public.sub_plans where id = tests.id('plan1')), tests.id('job1'),
  'the plan remembers its request'
);
select results_eq(
  $$select event_type, payload from public.event_outbox where aggregate_id = tests.id('job1')$$,
  $$values ('ai.job_requested', '{"feature": "sub_plan"}'::jsonb)$$,
  'the worker is woken with the feature only'
);
select is(
  (select count(*)::int from public.ai_request_log where job_id = tests.id('job1')), 1,
  'the request counts toward the hourly limit'
);

select tests.authenticate_as('teacher_a_other');
select throws_ok(
  $$select public.request_sub_plan_ai(tests.id('plan2'), tests.ai_input(), null)$$,
  '42501', null, 'a colleague cannot ask for someone else''s plan'
);
select tests.authenticate_as('principal_a');
select throws_ok(
  $$select public.request_sub_plan_ai(tests.id('plan2'), tests.ai_input(), null)$$,
  '42501', null, 'nor can the principal'
);
select tests.authenticate_as('office_a');
select throws_ok(
  $$select public.request_sub_plan_ai(tests.id('plan2'), tests.ai_input(), null)$$,
  '42501', null, 'nor the office'
);
select throws_ok(
  $$update public.sub_plans set ai = '{}' where id = tests.id('plan1')$$,
  '42501', null, 'nobody writes the AI layer through the API'
);
select tests.authenticate_as('teacher_a');
select throws_ok(
  $$select app.enqueue_ai_job(tests.id('teacher_a'), tests.id('school_a1'), 'sub_plan',
      '{}'::jsonb, 1000000)$$,
  '42501', null, 'the shared queueing function is not an API'
);
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- Applying the answer
-- ---------------------------------------------------------------------------------------

-- The plan's content version before the answer arrives.
create table tests.seen (key text primary key, n integer not null);
insert into tests.seen values ('plan1', tests.version('plan1'));
select tests.finish_job(tests.id('job1'), 'succeeded');
select results_eq(
  $$select ai ->> 'jobId', ai -> 'refs', ai ->> 'faithRef', ai -> 'result' ->> 'dayOverview'
    from public.sub_plans where id = tests.id('plan1')$$,
  $$values (tests.id('job1')::text,
    '[{"key": "B1", "ref": {"blockKey": "60000000-0000-4000-8000-000000000001", "lessonId": null}}]'::jsonb,
    'c1000000-0000-4000-8000-000000000001', 'Une journée calme.')$$,
  'the answer becomes the plan''s AI layer, with each block''s key and ids and nothing of the lesson'
);
select is(
  tests.version('plan1'), (select n + 1 from tests.seen where key = 'plan1'),
  'and a new content version'
);
select ok(
  (select (ai ->> 'appliedAt')::timestamptz <= now() from public.sub_plans where id = tests.id('plan1')),
  'the layer records when it was applied'
);

select tests.finish_job(tests.id('diff_job'), 'succeeded');
select is(
  (select ai ->> 'jobId' from public.sub_plans where id = tests.id('plan1')), tests.id('job1')::text,
  'a differentiated text finishing touches no plan'
);

-- ---------------------------------------------------------------------------------------
-- Readers of the released plan: direction and office, and the substitute
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select public.release_sub_plan(tests.id('plan1'));
select tests.authenticate_as('office_a');
select is(
  public.get_sub_plan_for_staff(tests.id('plan1')) -> 'ai' ->> 'jobId', tests.id('job1')::text,
  'the office reads the released plan with its AI layer'
);
select tests.clear_authentication();

create table tests.tokens (plan_key text primary key, token text not null);
insert into tests.tokens values ('plan1', tests.open_session('plan1'));
select is(
  tests.portal_load((select token from tests.tokens where plan_key = 'plan1'))
    -> 'plan' -> 'ai' ->> 'jobId',
  tests.id('job1')::text,
  'so does the substitute'
);
select ok(
  (tests.portal_load((select token from tests.tokens where plan_key = 'plan1'))
    -> 'context' ->> 'updatedAt')::timestamptz
  >= (select (ai ->> 'appliedAt')::timestamptz from public.sub_plans where id = tests.id('plan1')),
  '« Mis à jour à » counts the AI layer'
);

-- Once a substitute has opened the plan, AI no longer changes it; the teacher can still remove it.
select tests.authenticate_as('teacher_a');
select throws_ok(
  $$select public.request_sub_plan_ai(tests.id('plan1'), tests.ai_input(), tests.version('plan1'))$$,
  'LXS12', null, 'no new request once a substitute opened the plan'
);
select tests.authenticate_as('teacher_a_other');
select throws_ok(
  $$select public.clear_sub_plan_ai(tests.id('plan1'))$$,
  '42501', null, 'a colleague cannot remove it'
);
select tests.authenticate_as('teacher_a');
select lives_ok($$select public.clear_sub_plan_ai(tests.id('plan1'))$$, 'the owner removes it');
select tests.clear_authentication();
select results_eq(
  $$select ai, ai_job_id, content_version, edited_by from public.sub_plans where id = tests.id('plan1')$$,
  $$values (null::jsonb, null::uuid, (select n + 2 from tests.seen where key = 'plan1'),
           tests.id('teacher_a'))$$,
  'the layer and the request are gone, as a new version by the teacher'
);
select tests.authenticate_as('teacher_a');
select lives_ok($$select public.clear_sub_plan_ai(tests.id('plan1'))$$, 'removing twice is harmless');
select tests.clear_authentication();
select is(tests.version('plan1'), (select n + 2 from tests.seen where key = 'plan1'),
  'and changes nothing');

-- ---------------------------------------------------------------------------------------
-- Only the plan's current request, only without a substitute
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select lives_ok(
  $$select tests.remember('job_big', public.request_sub_plan_ai(tests.id('plan2'),
      tests.ai_input(1, 80000), tests.version('plan2')))$$,
  'a request between 64 and 96 KB is accepted (a day of long lessons)'
);
select tests.clear_authentication();
select tests.finish_job(tests.id('job_big'), 'failed');
select is((select ai from public.sub_plans where id = tests.id('plan2')), null,
  'a failed request leaves the plan as it was');

select tests.authenticate_as('teacher_a');
select lives_ok(
  $$select tests.remember('job3', public.request_sub_plan_ai(tests.id('plan2'), tests.ai_input(),
      tests.version('plan2')))$$,
  'the owner asks again'
);
select tests.clear_authentication();
select isnt(tests.id('job3'), tests.id('job_big'), 'as a new request');
update public.ai_jobs set status = 'queued' where id = tests.id('job_big');
select tests.finish_job(tests.id('job_big'), 'succeeded');
select is((select ai from public.sub_plans where id = tests.id('plan2')), null,
  'an older request''s answer is never applied');

insert into tests.tokens values ('plan2', tests.open_session('plan2'));
select tests.finish_job(tests.id('job3'), 'succeeded');
select results_eq(
  $$select ai, ai_job_id from public.sub_plans where id = tests.id('plan2')$$,
  $$values (null::jsonb, tests.id('job3'))$$,
  'an answer that arrives after a substitute opened the plan is not applied'
);

-- ---------------------------------------------------------------------------------------
-- The shared checks: budget and limits per person; the day is over
-- ---------------------------------------------------------------------------------------

insert into public.ai_budgets (school_id, monthly_allowance_usd, monthly_ceiling_usd)
values (tests.id('school_a1'), 0, 0);
select tests.authenticate_as('teacher_a');
select throws_ok(
  $$select public.request_sub_plan_ai(tests.id('plan3'), tests.ai_input(), null)$$,
  'LXA02', null, 'the school''s budget applies'
);
select tests.clear_authentication();
delete from public.ai_budgets where school_id = tests.id('school_a1');

insert into public.ai_jobs (board_id, school_id, user_id, feature, input)
select tests.id('board_a'), tests.id('school_a1'), tests.id('teacher_a'), 'differentiate', '{}'
from generate_series(1, 3);
select tests.authenticate_as('teacher_a');
select throws_ok(
  $$select public.request_sub_plan_ai(tests.id('plan3'), tests.ai_input(), null)$$,
  'LXA03', null, 'so do the limits per person, shared with every AI feature'
);
select tests.clear_authentication();
delete from public.ai_jobs where feature = 'differentiate' and status = 'queued';

-- A day that is over (inserted as the plan of a past date).
insert into public.absences (id, teacher_id, school_id, starts_on, ends_on, status, published_at)
values (tests.remember('abs_past', gen_random_uuid()), tests.id('teacher_a'), tests.id('school_a1'),
  current_date - 3, current_date - 3, 'published', now() - interval '4 days');
insert into public.sub_plans (id, absence_id, plan_date, plan, status, review_deadline)
values (tests.remember('plan_past', gen_random_uuid()), tests.id('abs_past'), current_date - 3,
  tests.plan_json(current_date - 3), 'released', now() - interval '3 days');
update public.sub_plans set ai = '{"refs": [], "result": {}}' where id = tests.id('plan_past');
select tests.authenticate_as('teacher_a');
select throws_ok(
  $$select public.request_sub_plan_ai(tests.id('plan_past'), tests.ai_input(), null)$$,
  'LXS14', null, 'no request for a day that is over'
);
select throws_ok(
  $$select public.clear_sub_plan_ai(tests.id('plan_past'))$$,
  'LXS14', null, 'and no change to it either'
);
select tests.clear_authentication();

select * from finish();
rollback;
