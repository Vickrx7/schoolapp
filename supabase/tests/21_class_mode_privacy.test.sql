-- The two SPEC §11 guarantees of class mode (DECISIONS D-086, D-088, D-089):
--   1. answer keys never reach student devices: every portal output of whole sessions is
--      recorded and scanned for sentinels planted in every key field, and the portal role can
--      read no table and run no grading or AI function;
--   2. answers are deleted when a session ends (by the teacher, by the worker's sweep, or by the
--      next call after it expired), and only the class aggregates the teacher chose survive,
--      for the board's retention.
begin;
\ir _helpers.psql
\ir _class_mode_helpers.psql
select plan(40);
select tests.build_fixture();
select tests.build_library_fixture();
select tests.battle_quiz('quiz', 'teacher_a');

-- ---------------------------------------------------------------------------------------
-- 1. Answer keys never reach devices
-- ---------------------------------------------------------------------------------------

-- A whole session with answers shown and short answers scored: 3 devices choose their team,
-- then every question is answered right by one, wrong by another, with an invalid attempt and a
-- resent answer, and every device polls in every phase.
select tests.authenticate_as('teacher_a');
select tests.remember('p1', (select session_id from public.start_class_session(
  tests.id('class_a'), tests.id('quiz'), null, 'teams', p_team_count => 3::smallint,
  p_team_choice => 'device', p_score_short_answers => true)));
select tests.clear_authentication();
select is(tests.play(tests.id('p1'), 3, 'a'), 3, 'three devices join and choose their team');
select ok(
  (select s.questions::text !~ '(SENTINELLE|sentinelle|correct|explanation|solution|"answer"|teacherNote)'
   from public.class_sessions s where s.id = tests.id('p1')),
  'the question snapshot holds no key, no teacher-only field and nothing outside the whitelist'
);

do $$
declare
  v_q text;
  i integer;
begin
  for i in 0 .. 4 loop
    v_q := 'q' || (i + 1);
    perform tests.authenticate_as('teacher_a');
    perform tests.control('p1', 'next');
    perform tests.clear_authentication();
    perform tests.portal_state('a1'); perform tests.portal_state('a2'); perform tests.portal_state('a3');
    perform tests.portal_answer('a1', i, tests.battle_answer(v_q, true));
    perform tests.portal_answer('a1', i, tests.battle_answer(v_q, true));
    perform tests.portal_answer('a2', i, '{"choiceIds": ["zz"], "text": "sentinelle"}');
    perform tests.portal_answer('a2', i, tests.battle_answer(v_q, false));
    perform tests.portal_state('a1'); perform tests.portal_state('a2', 1);
    perform tests.authenticate_as('teacher_a');
    perform tests.control('p1', 'reveal');
    perform tests.clear_authentication();
    perform tests.portal_answer('a3', i, tests.battle_answer(v_q, true));
    perform tests.portal_state('a1'); perform tests.portal_state('a2'); perform tests.portal_state('a3');
    perform tests.authenticate_as('teacher_a');
    perform tests.control('p1', 'leaderboard');
    perform tests.clear_authentication();
    perform tests.portal_state('a1'); perform tests.portal_state('a2'); perform tests.portal_state('a3');
  end loop;
  perform tests.authenticate_as('teacher_a');
  perform tests.control('p1', 'finish');
  perform tests.clear_authentication();
  perform tests.portal_state('a1'); perform tests.portal_state('a2'); perform tests.portal_state('a3');
  perform tests.portal_set_team('a3', 'huards');
end;
$$;

select is((select count(*)::integer from public.session_responses where session_id = tests.id('p1')),
  10, 'the session was played: 2 answers to each of the 5 questions');
select is_empty(
  $$select label from tests.portal_outputs
    where payload::text ~ '(SENTINELLE|sentinelle|correctChoiceIds|orderedIds|accepted|sampleAnswer|acceptable|explanation|solution|answers|pairs|choiceIds)'$$,
  'no portal output of the session holds a sentinel or a key field'
);
select is_empty(
  $$select distinct k from tests.portal_outputs o
    cross join lateral jsonb_path_query(o.payload, 'strict $.** ? (@.type() == "object")') x
    cross join lateral jsonb_object_keys(x) k
    except
    select unnest(array['status', 'outcome', 'state', 'version', 'serverNow', 'session', 'title',
      'lang', 'mode', 'phase', 'index', 'total', 'closesAt', 'joiningOpen', 'teamChoice', 'teams',
      'me', 'device', 'team', 'question', 'id', 'kind', 'prompt', 'hint', 'multipleAnswers',
      'choices', 'left', 'right', 'items', 'text', 'scorable', 'myAnswer', 'answered', 'result',
      'correct', 'points', 'leaderboard', 'members', 'score', 'myTotal', 'token', 'expires_at',
      'retry_after'])$$,
  'every field a device received is on the list of what devices may see'
);
select ok(
  (select bool_and(not (payload ? 'state') or payload -> 'state' -> 'question' is null
                   or not (payload -> 'state' -> 'question' ? 'answer'))
   from tests.portal_outputs),
  'no question sent to a device carries an answer'
);

-- A session with answers hidden (a colleague's class): before the end, no device learns
-- whether it was right.
select tests.authenticate_as('teacher_a_other');
select tests.remember('p2', (select session_id from public.start_class_session(
  tests.id('class_a_other'), tests.id('quiz'), null, 'solo', p_reveal_answers => false,
  p_score_short_answers => true)));
select tests.clear_authentication();
select tests.play(tests.id('p2'), 2, 'b');
do $$
declare
  v_q text;
  i integer;
begin
  for i in 0 .. 4 loop
    v_q := 'q' || (i + 1);
    perform tests.authenticate_as('teacher_a_other');
    perform tests.control('p2', 'next');
    perform tests.clear_authentication();
    perform tests.portal_answer('b1', i, tests.battle_answer(v_q, true));
    perform tests.portal_answer('b2', i, tests.battle_answer(v_q, false));
    perform tests.authenticate_as('teacher_a_other');
    perform tests.control('p2', 'reveal');
    perform tests.clear_authentication();
    perform tests.portal_state('b1'); perform tests.portal_state('b2');
  end loop;
  perform tests.authenticate_as('teacher_a_other');
  perform tests.control('p2', 'leaderboard');
  perform tests.clear_authentication();
  perform tests.portal_state('b1'); perform tests.portal_state('b2');
end;
$$;
select is_empty(
  $$select label from tests.portal_outputs
    where label ~ ' b[12]$' and (payload::text ~ '"(correct|points)"')$$,
  'with answers hidden, no device output says right or wrong, or gives points, before the end'
);
select tests.authenticate_as('teacher_a_other');
select is(public.class_session_live(tests.id('p2')) -> 'reveal' -> 'answer', null,
  'with answers hidden, the projector never gets the answer either');
select tests.control('p2', 'finish');
select tests.clear_authentication();
select is(tests.portal_state('b1') ->> 'myTotal', '500', 'at the end, a device learns its total');

-- The portal role reads no table and runs no grading or AI function.
select throws_ok($$select tests.class_portal_exec('select 1 from public.library_item_answer_keys')$$,
  '42501', null, 'the portal role cannot read answer keys');
select throws_ok($$select tests.class_portal_exec('select 1 from public.class_session_keys')$$,
  '42501', null, 'the portal role cannot read session keys');
select throws_ok($$select tests.class_portal_exec('select 1 from public.session_responses')$$,
  '42501', null, 'the portal role cannot read answers');
select throws_ok($$select tests.class_portal_exec('select 1 from public.class_mode_links')$$,
  '42501', null, 'the portal role cannot read class links');
select throws_ok($$select tests.class_portal_exec('select 1 from public.class_sessions')$$,
  '42501', null, 'the portal role cannot read sessions');
select throws_ok($$select tests.class_portal_exec('select app.class_grade(''{}'', ''{}'', ''{}'')')$$,
  '42501', null, 'the portal role cannot run the grading function');
select throws_ok($$select tests.class_portal_exec('select app.class_mode_key(''[]'', ''{}'', true)')$$,
  '42501', null, 'the portal role cannot build keys');
select throws_ok(
  $$select tests.class_portal_exec(format('select public.request_ai_job(%L, ''differentiate'', ''{}'')',
      tests.id('school_a1')))$$,
  '42501', null, 'the portal role cannot run AI (students never use AI)');
select throws_ok(
  $$select tests.class_portal_exec(format('select public.start_class_session(%L, %L, null, ''solo'')',
      tests.id('class_a'), tests.id('quiz')))$$,
  '42501', null, 'the portal role cannot run the teacher functions');

-- ---------------------------------------------------------------------------------------
-- 2. Answers are deleted when the session ends
-- ---------------------------------------------------------------------------------------

-- The teacher ends p1 without keeping results.
select tests.authenticate_as('teacher_a');
select is(public.end_class_session(tests.id('p1'), false),
  '{"resultsKept": false, "responsesDeleted": 10, "participantsDeleted": 3}'::jsonb,
  '« Terminer la séance » deletes the answers and devices');
select tests.clear_authentication();
select results_eq(
  $$select (select count(*)::integer from public.session_responses where session_id = tests.id('p1')),
       (select count(*)::integer from public.session_participants where session_id = tests.id('p1')),
       (select count(*)::integer from public.class_session_keys where session_id = tests.id('p1')),
       (select count(*)::integer from public.class_session_results where session_id = tests.id('p1')),
       s.status::text, s.questions, s.phase
    from public.class_sessions s where s.id = tests.id('p1')$$,
  $$values (0, 0, 0, 0, 'closed', '[]'::jsonb, 'finished')$$,
  'nothing of the session remains but its closed row, without questions or results'
);
select results_eq(
  $$select actor_type::text, actor_user_id, details from public.audit_log
    where action = 'class_session.ended' and entity_id = tests.id('p1')$$,
  $$values ('user', tests.id('teacher_a'),
      '{"results_kept": false, "responses_deleted": 10, "participants_deleted": 3}'::jsonb)$$,
  'the end is audited with counts only'
);
select is(tests.portal_state('a1'), '{"status": "gone"}'::jsonb, 'devices are told the game is over');
select is(tests.portal_answer('a1', 4, tests.battle_answer('q5', true)), '{"status": "gone"}'::jsonb,
  'an answer after the end is refused');
select is((select count(*)::integer from public.session_responses where session_id = tests.id('p1')),
  0, '… and writes nothing');

-- The teacher ends p2 keeping the class's results: counts only, nothing about a device.
create temporary table p2_secrets as
  select id::text as v from public.session_participants where session_id = tests.id('p2')
  union all select token_hash from public.session_participants where session_id = tests.id('p2')
  union all select device_key from public.session_participants where session_id = tests.id('p2');
select tests.authenticate_as('teacher_a_other');
select is(public.end_class_session(tests.id('p2'), true) ->> 'resultsKept', 'true',
  '« Garder les résultats de la classe (sans noms) »');
select tests.clear_authentication();
select results_eq(
  $$select (select count(*)::integer from public.session_responses where session_id = tests.id('p2')),
       (select count(*)::integer from public.session_participants where session_id = tests.id('p2')),
       (r.aggregate ->> 'deviceCount')::integer, (r.aggregate ->> 'questionsPlayed')::integer,
       (r.aggregate -> 'questions' -> 0 ->> 'correct')::integer
    from public.class_session_results r where r.session_id = tests.id('p2')$$,
  $$values (0, 0, 2, 5, 1)$$,
  'the kept results are class counts; answers and devices are deleted'
);
select ok(
  (select r.aggregate::text !~ '(reponse-libre-xyz|sentinelle|SENTINELLE|"device"|"team"|Appareil|token)'
     and not exists (select 1 from p2_secrets x where r.aggregate::text like '%' || x.v || '%')
   from public.class_session_results r where r.session_id = tests.id('p2')),
  'kept results hold no device number, participant id, token, device key or typed answer'
);

-- Expiry through the worker's sweep: p3 (not kept) and p4 (kept) expire.
select tests.authenticate_as('teacher_a');
select tests.remember('p3', (select session_id from public.start_class_session(
  tests.id('class_a'), tests.id('quiz'), null, 'solo')));
select tests.clear_authentication();
select tests.authenticate_as('teacher_a_other');
select tests.remember('p4', (select session_id from public.start_class_session(
  tests.id('class_a_other'), tests.id('quiz'), null, 'solo')));
select public.set_class_session_keep(tests.id('p4'), true);
select tests.clear_authentication();
select tests.play(tests.id('p3'), 2, 'e');
select tests.play(tests.id('p4'), 2, 'f');
select tests.authenticate_as('teacher_a');
select tests.control('p3', 'next');
select tests.clear_authentication();
select tests.authenticate_as('teacher_a_other');
select tests.control('p4', 'next');
select tests.clear_authentication();
select tests.portal_answer('e1', 0, tests.battle_answer('q1', true));
select tests.portal_answer('e2', 0, tests.battle_answer('q1', false));
select tests.portal_answer('f1', 0, tests.battle_answer('q1', true));
update public.class_sessions set expires_at = now() - interval '1 second'
where id in (tests.id('p3'), tests.id('p4'));
select results_eq(
  $$select m ->> 'sessionsClosed', m ->> 'responsesDeleted', m ->> 'participantsDeleted'
    from app.class_sessions_maintenance() m$$,
  $$values ('2', '3', '4')$$,
  'the worker''s sweep closes expired sessions and deletes their answers'
);
select results_eq(
  $$select s.id, s.status::text, (select count(*)::integer from public.session_responses r where r.session_id = s.id),
       exists (select 1 from public.class_session_results r where r.session_id = s.id),
       (select a.actor_type::text from public.audit_log a where a.action = 'class_session.ended' and a.entity_id = s.id)
    from public.class_sessions s where s.id in (tests.id('p3'), tests.id('p4')) order by s.id = tests.id('p4')$$,
  $$values (tests.id('p3'), 'closed', 0, false, 'system'), (tests.id('p4'), 'closed', 0, true, 'system')$$,
  '… keeping the class results the teacher asked for, audited as the system'
);

-- Expiry through a call: with no worker, the next portal call closes it.
select tests.authenticate_as('teacher_a');
select tests.remember('p5', (select session_id from public.start_class_session(
  tests.id('class_a'), tests.id('quiz'), null, 'solo')));
select tests.clear_authentication();
select tests.play(tests.id('p5'), 1, 'g');
select tests.authenticate_as('teacher_a');
select tests.control('p5', 'next');
select tests.clear_authentication();
select tests.portal_answer('g1', 0, tests.battle_answer('q1', true));
update public.class_sessions set expires_at = now() - interval '1 second' where id = tests.id('p5');
select is(tests.portal_state('g1'), '{"status": "ended"}'::jsonb, 'a device polling an expired session is told it ended');
select results_eq(
  $$select s.status::text, (select count(*)::integer from public.session_responses r where r.session_id = s.id),
       (select count(*)::integer from public.session_participants p where p.session_id = s.id)
    from public.class_sessions s where s.id = tests.id('p5')$$,
  $$values ('closed', 0, 0)$$,
  '… and the call closed it and deleted its answers, without the worker'
);

-- The projector's poll and the class tab close an expired session too.
select tests.authenticate_as('teacher_a');
select tests.remember('p6', (select session_id from public.start_class_session(
  tests.id('class_a'), tests.id('quiz'), null, 'solo')));
select tests.clear_authentication();
update public.class_sessions set expires_at = now() - interval '1 second' where id = tests.id('p6');
select tests.authenticate_as('teacher_a');
select is(public.class_session_live(tests.id('p6')) ->> 'status', 'closed',
  'the projector''s poll closes an expired session');
select tests.remember('p7', (select session_id from public.start_class_session(
  tests.id('class_a'), tests.id('quiz'), null, 'solo')));
select tests.clear_authentication();
update public.class_sessions set expires_at = now() - interval '1 second' where id = tests.id('p7');
select tests.authenticate_as('teacher_a');
select is(public.class_mode_overview(tests.id('class_a')) -> 'open', 'null'::jsonb,
  'so does the class tab');
select tests.remember('p9', (select session_id from public.start_class_session(
  tests.id('class_a'), tests.id('quiz'), null, 'solo')));
select tests.clear_authentication();
select tests.play(tests.id('p9'), 1, 'j');
update public.class_sessions set expires_at = now() - interval '1 second' where id = tests.id('p9');
select is(tests.portal_join('j2', tests.join_code(tests.id('p9')), null, 99) ->> 'outcome', 'locked',
  'a device cannot join an expired session');
select results_eq(
  $$select status::text, (select count(*)::integer from public.session_participants p where p.session_id = s.id)
    from public.class_sessions s where s.id = tests.id('p9')$$,
  $$values ('closed', 0)$$,
  '… and trying closes it and deletes its devices'
);

-- Retention (D-089, D-101)
update public.boards set settings = settings || '{"classModeResultsRetentionDays": 30}'
where id = tests.id('board_a');
insert into public.class_sessions (id, class_id, join_code, status, created_at, expires_at, ended_at,
  keep_aggregate_results, phase)
values
  (tests.remember('kept_31', gen_random_uuid()), tests.id('class_a'), 'AAAAAA', 'closed',
   now() - interval '31 days', now() - interval '31 days' + interval '2 hours', now() - interval '31 days', true, 'finished'),
  (tests.remember('kept_29', gen_random_uuid()), tests.id('class_a'), 'AAAAAC', 'closed',
   now() - interval '29 days', now() - interval '29 days' + interval '2 hours', now() - interval '29 days', true, 'finished'),
  (tests.remember('bare_31', gen_random_uuid()), tests.id('class_a'), 'AAAAAD', 'closed',
   now() - interval '31 days', now() - interval '31 days' + interval '2 hours', now() - interval '31 days', false, 'finished'),
  (tests.remember('bare_29', gen_random_uuid()), tests.id('class_a'), 'AAAAAE', 'closed',
   now() - interval '29 days', now() - interval '29 days' + interval '2 hours', now() - interval '29 days', false, 'finished');
insert into public.class_session_results (session_id, aggregate, saved_at) values
  (tests.id('kept_31'), '{"schemaVersion": 1}', now() - interval '31 days'),
  (tests.id('kept_29'), '{"schemaVersion": 1}', now() - interval '29 days');
insert into public.class_join_failures (device_key, failed_at) values
  (tests.device_key(900), now() - interval '25 hours'),
  (tests.device_key(901), now() - interval '23 hours');
select results_eq(
  $$select (m ->> 'resultsDeleted')::integer, (m ->> 'sessionsDeleted')::integer >= 1,
       (m ->> 'joinFailuresDeleted')::integer >= 1
    from app.class_sessions_maintenance() m$$,
  $$values (1, true, true)$$,
  'the sweep applies retention'
);
select results_eq(
  $$select k.key, exists (select 1 from public.class_sessions s where s.id = k.id)
    from tests.ids k where k.key in ('kept_31', 'kept_29', 'bare_31', 'bare_29') order by k.key$$,
  $$values ('bare_29', true), ('bare_31', false), ('kept_29', true), ('kept_31', false)$$,
  'results go after the board''s retention (30 days here); closed sessions without results after 30 days'
);
select results_eq(
  $$select device_key = tests.device_key(901) from public.class_join_failures
    where device_key in (tests.device_key(900), tests.device_key(901))$$,
  $$values (true)$$,
  'join failures go after a day'
);

-- Deleting a class deletes its sessions, keys, results and link.
select tests.authenticate_as('teacher_a');
select tests.remember('p8', (select session_id from public.start_class_session(
  tests.id('class_a'), tests.id('quiz'), null, 'solo')));
select public.class_mode_link(tests.id('class_a'));
select tests.clear_authentication();
select tests.play(tests.id('p8'), 1, 'h');
delete from public.classes where id = tests.id('class_a');
select results_eq(
  $$select (select count(*)::integer from public.class_sessions where id in (tests.id('p8'), tests.id('p1'), tests.id('kept_29'))),
       (select count(*)::integer from public.class_session_keys where session_id = tests.id('p8')),
       (select count(*)::integer from public.class_session_results where session_id = tests.id('kept_29')),
       (select count(*)::integer from public.session_participants where session_id = tests.id('p8')),
       (select count(*)::integer from public.class_mode_links where class_id = tests.id('class_a'))$$,
  $$values (0, 0, 0, 0, 0)$$,
  'deleting a class deletes its sessions, keys, kept results, devices and class link'
);

select is_empty(
  $$select label from tests.portal_outputs
    where payload::text ~ '(SENTINELLE|sentinelle|correctChoiceIds|orderedIds|accepted|sampleAnswer|acceptable|explanation|solution|answers|pairs|choiceIds|reponse-libre)'$$,
  'no portal output of any session in this file holds a sentinel, a key field or a typed answer'
);

select * from finish();
rollback;
