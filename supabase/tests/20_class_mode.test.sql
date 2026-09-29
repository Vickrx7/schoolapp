-- Class mode (Phase 5; DECISIONS D-082 to D-090): starting a device quiz, the question snapshot,
-- normalizing and grading answers, the projector's controls, joining and throttling, teams,
-- answers, what devices and the projector see, team scores, the class link, the class tab and
-- access. The privacy guarantees (keys never reach devices; answers are deleted) are in
-- 21_class_mode_privacy.
begin;
\ir _helpers.psql
\ir _class_mode_helpers.psql
select plan(137);
select tests.build_fixture();
select tests.build_library_fixture();
select tests.battle_quiz('quiz', 'teacher_a');
select tests.remember('quiz_level_v', (select id from public.library_item_versions
  where item_id = tests.id('quiz') and language_level_id is not null limit 1));
select tests.library_item('draft_other', 'teacher_a_other', 'quiz');
select tests.remember('draft_other_v', (select id from public.library_item_versions
  where item_id = tests.id('draft_other') and language_level_id is null));
select tests.library_item('break', 'teacher_a', 'brain_break');
select tests.library_item('ticket', 'teacher_a', 'exit_ticket');
select tests.battle_quiz('ang_quiz', 'teacher_a');
update public.library_items set subject_id = (select id from public.subjects where code = 'ang' and board_id is null)
where id = tests.id('ang_quiz');

-- ---------------------------------------------------------------------------------------
-- 1. Starting a session
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select lives_ok(
  $$select tests.remember('s1', (select session_id from public.start_class_session(
      tests.id('class_a'), tests.id('quiz'), tests.id('quiz_v'), 'teams', p_team_count => 2::smallint)))$$,
  'a teacher starts a device quiz for her class'
);
select matches(tests.join_code(tests.id('s1')), '^[ACDEFHJKMNPRTUVWXY3479]{6}$',
  'the join code has 6 characters from the alphabet without look-alikes');
select tests.clear_authentication();
select results_eq(
  $$select created_by, expires_at = now() + interval '2 hours',
       joining_closes_at = now() + interval '20 minutes', content_lang, item_title, phase,
       question_index::integer, status::text, version_id, mode, team_count::integer
    from public.class_sessions where id = tests.id('s1')$$,
  $$values (tests.id('teacher_a'), true, true, 'fr-CA', 'Ressource quiz', 'lobby', -1, 'open',
            tests.id('quiz_v'), 'teams', 2)$$,
  'the session records its creator, a 2-hour expiry, 20 minutes of joining and the version'
);
select ok(exists (select 1 from public.class_session_keys where session_id = tests.id('s1')),
  'the session''s key is stored apart from the snapshot');
select is_empty(
  $$select k
    from public.class_sessions s
    cross join lateral jsonb_path_query(s.questions, 'strict $.** ? (@.type() == "object")') o
    cross join lateral jsonb_object_keys(o) k
    where s.id = tests.id('s1')
    except
    select unnest(array['id', 'kind', 'prompt', 'hint', 'multipleAnswers', 'choices', 'left',
      'right', 'items', 'text', 'scorable'])$$,
  'the question snapshot holds whitelisted fields only'
);
select results_eq(
  $$select q.q ->> 'id', (q.q ->> 'scorable')::boolean
    from public.class_sessions s, jsonb_array_elements(s.questions) with ordinality q (q, n)
    where s.id = tests.id('s1') order by q.n$$,
  $$values ('q1', true), ('q2', true), ('q3', true), ('q4', true), ('q5', false)$$,
  'every kind is scored, except short answers by default'
);

select tests.authenticate_as('teacher_a');
select throws_ok(
  $$select public.start_class_session(tests.id('class_a'), tests.id('quiz'), null, 'solo')$$,
  'LXC01', null, 'a class has one open session at a time'
);
select lives_ok(
  $$select tests.remember('s2', (select session_id from public.start_class_session(
      tests.id('class_a'), tests.id('quiz'), null, 'solo', p_score_short_answers => true,
      p_replace_open => true)))$$,
  '« Terminer cette séance et lancer » ends the open session and starts another'
);
select tests.clear_authentication();
select results_eq(
  $$select s.status::text, (select count(*)::integer from public.audit_log a
      where a.action = 'class_session.ended' and a.entity_id = s.id)
    from public.class_sessions s where s.id = tests.id('s1')$$,
  $$values ('closed', 1)$$,
  'the replaced session is closed and its end is audited'
);
select results_eq(
  $$select s.version_id, s.team_count, s.team_choice, (q.q ->> 'scorable')::boolean
    from public.class_sessions s, jsonb_array_elements(s.questions) q (q)
    where s.id = tests.id('s2') and q.q ->> 'id' = 'q5'$$,
  $$values (tests.id('quiz_v'), null::smallint, 'random', true)$$,
  'without a version the base one plays; « Chacun pour soi » has no teams; short answers are scored on request'
);

select tests.authenticate_as('teacher_a');
select throws_ok(
  $$select public.start_class_session(tests.id('class_b'), tests.id('quiz'), null, 'solo',
      p_replace_open => true)$$,
  '42501', null, 'not in another teacher''s class'
);
select throws_ok(
  $$select public.start_class_session(tests.id('class_a'), tests.id('draft_other'), null, 'solo',
      p_replace_open => true)$$,
  '42501', null, 'not with a colleague''s private draft'
);
select throws_ok(
  $$select public.start_class_session(tests.id('class_a'), tests.id('quiz'), tests.id('draft_other_v'),
      'solo', p_replace_open => true)$$,
  '22023', null, 'not with another item''s version'
);
select throws_ok(
  $$select public.start_class_session(tests.id('class_a'), tests.id('break'), null, 'solo',
      p_replace_open => true)$$,
  'LXC04', null, 'a brain break is presented, not played on devices'
);
select throws_ok(
  $$select public.start_class_session(tests.id('class_a'), tests.id('ticket'), null, 'solo',
      p_replace_open => true)$$,
  'LXC04', null, 'an exit ticket is presented, not played on devices'
);
select throws_ok(
  $$select public.start_class_session(tests.id('class_a'), tests.id('quiz'), tests.id('quiz_level_v'),
      'solo', p_replace_open => true)$$,
  'LXC04', null, 'a version without questions cannot be played'
);
select throws_ok(
  $$select public.start_class_session(tests.id('class_a'), tests.id('quiz'), null, 'teams',
      p_team_count => 7::smallint, p_replace_open => true)$$,
  '22023', null, 'at most 6 teams'
);
select throws_ok(
  $$select public.start_class_session(tests.id('class_a'), tests.id('quiz'), null, 'teams',
      p_team_choice => 'x', p_replace_open => true)$$,
  '22023', null, 'teams are random or chosen by the devices'
);
select tests.clear_authentication();
update public.module_entitlements set enabled = false
where school_id = tests.id('school_a1') and module = 'library';
select tests.authenticate_as('teacher_a');
select throws_ok(
  $$select public.start_class_session(tests.id('class_a'), tests.id('quiz'), null, 'solo',
      p_replace_open => true)$$,
  '42501', null, 'not in a school without the Library module'
);
select tests.clear_authentication();
update public.module_entitlements set enabled = true
where school_id = tests.id('school_a1') and module = 'library';

select tests.authenticate_as('teacher_a');
select lives_ok(
  $$select tests.remember('s_ang', (select session_id from public.start_class_session(
      tests.id('class_a'), tests.id('ang_quiz'), null, 'solo', p_replace_open => true)))$$,
  'a quiz of Anglais starts'
);
select tests.clear_authentication();
select is((select content_lang from public.class_sessions where id = tests.id('s_ang')), 'en-CA',
  'Anglais content is played in English (the screens around it stay French)');

-- An expired session does not block the next one: it is closed first.
update public.class_sessions set expires_at = now() - interval '1 second' where id = tests.id('s_ang');
select tests.authenticate_as('teacher_a');
select lives_ok(
  $$select tests.remember('s3', (select session_id from public.start_class_session(
      tests.id('class_a'), tests.id('quiz'), null, 'teams', p_team_count => 2::smallint)))$$,
  'an expired session of the class does not block the next start'
);
select tests.clear_authentication();
select is((select status::text from public.class_sessions where id = tests.id('s_ang')), 'closed',
  'the expired session was closed by the start');

-- ---------------------------------------------------------------------------------------
-- 2. Normalizing short answers (D-087): the pinned vectors
-- ---------------------------------------------------------------------------------------

select results_eq(
  $$select app.normalize_answer(v) from unnest(array['Mille', '1 000', E'1 000', E'1 000',
      '12 345,67', '0,5', 'Cœur', 'l’eau', '« Paris »', '“Paris”', '3 4', 'Bravo!', 'ÉLÈVE', '3⁄4',
      'Le Huard…']) with ordinality t (v, n) order by n$$,
  $$values ('mille'), ('1000'), ('1000'), ('1000'), ('12345.67'), ('0.5'), ('coeur'), ('l''eau'),
      ('paris'), ('paris'), ('3 4'), ('bravo'), ('eleve'), ('3/4'), ('le huard')$$,
  'app.normalize_answer: case, accents, quotes, apostrophes, spaces in numbers, the decimal comma'
);

-- ---------------------------------------------------------------------------------------
-- 3. Grading (D-087): one row per valid answer, none for a shape that does not fit
-- ---------------------------------------------------------------------------------------

create temporary table grading (n integer, label text, question jsonb, key jsonb, response jsonb);
insert into grading values
  (1, 'mc right', '{"id":"q1","kind":"multiple_choice","multipleAnswers":false,"choices":[{"id":"a","text":"A"},{"id":"b","text":"B"}]}',
     '{"kind":"multiple_choice","choiceIds":["b"]}', '{"choiceIds":["b"]}'),
  (2, 'mc wrong', '{"id":"q1","kind":"multiple_choice","multipleAnswers":false,"choices":[{"id":"a","text":"A"},{"id":"b","text":"B"}]}',
     '{"kind":"multiple_choice","choiceIds":["b"]}', '{"choiceIds":["a"]}'),
  (3, 'mc two for one', '{"id":"q1","kind":"multiple_choice","multipleAnswers":false,"choices":[{"id":"a","text":"A"},{"id":"b","text":"B"}]}',
     '{"kind":"multiple_choice","choiceIds":["b"]}', '{"choiceIds":["a","b"]}'),
  (4, 'mc unknown id', '{"id":"q1","kind":"multiple_choice","multipleAnswers":false,"choices":[{"id":"a","text":"A"},{"id":"b","text":"B"}]}',
     '{"kind":"multiple_choice","choiceIds":["b"]}', '{"choiceIds":["z"]}'),
  (5, 'mc several, any order', '{"id":"q1","kind":"multiple_choice","multipleAnswers":true,"choices":[{"id":"a","text":"A"},{"id":"b","text":"B"},{"id":"c","text":"C"}]}',
     '{"kind":"multiple_choice","choiceIds":["a","c"]}', '{"choiceIds":["c","a","c"]}'),
  (6, 'mc several, part', '{"id":"q1","kind":"multiple_choice","multipleAnswers":true,"choices":[{"id":"a","text":"A"},{"id":"b","text":"B"},{"id":"c","text":"C"}]}',
     '{"kind":"multiple_choice","choiceIds":["a","c"]}', '{"choiceIds":["a"]}'),
  (7, 'mc extra field', '{"id":"q1","kind":"multiple_choice","multipleAnswers":false,"choices":[{"id":"a","text":"A"},{"id":"b","text":"B"}]}',
     '{"kind":"multiple_choice","choiceIds":["b"]}', '{"choiceIds":["b"],"note":"texte libre"}'),
  (8, 'true/false right', '{"id":"q2","kind":"true_false"}', '{"kind":"true_false","value":false}', '{"value":false}'),
  (9, 'true/false as text', '{"id":"q2","kind":"true_false"}', '{"kind":"true_false","value":false}', '{"value":"false"}'),
  (10, 'matching 2 of 3', '{"id":"q3","kind":"matching","left":[{"id":"l1","text":"1"},{"id":"l2","text":"2"},{"id":"l3","text":"3"}],"right":[{"id":"ra","text":"a"},{"id":"rb","text":"b"},{"id":"rc","text":"c"}]}',
     '{"kind":"matching","pairs":{"l1":"ra","l2":"rb","l3":"rc"}}', '{"pairs":{"l1":"ra","l2":"rb","l3":"rb"}}'),
  (11, 'matching all', '{"id":"q3","kind":"matching","left":[{"id":"l1","text":"1"},{"id":"l2","text":"2"},{"id":"l3","text":"3"}],"right":[{"id":"ra","text":"a"},{"id":"rb","text":"b"},{"id":"rc","text":"c"}]}',
     '{"kind":"matching","pairs":{"l1":"ra","l2":"rb","l3":"rc"}}', '{"pairs":{"l3":"rc","l1":"ra","l2":"rb"}}'),
  (12, 'matching missing a left id', '{"id":"q3","kind":"matching","left":[{"id":"l1","text":"1"},{"id":"l2","text":"2"},{"id":"l3","text":"3"}],"right":[{"id":"ra","text":"a"},{"id":"rb","text":"b"},{"id":"rc","text":"c"}]}',
     '{"kind":"matching","pairs":{"l1":"ra","l2":"rb","l3":"rc"}}', '{"pairs":{"l1":"ra","l2":"rb"}}'),
  (13, 'ordering right', '{"id":"q4","kind":"ordering","items":[{"id":"i1","text":"1"},{"id":"i2","text":"2"},{"id":"i3","text":"3"}]}',
     '{"kind":"ordering","orderedIds":["i2","i3","i1"]}', '{"orderedIds":["i2","i3","i1"]}'),
  (14, 'ordering wrong', '{"id":"q4","kind":"ordering","items":[{"id":"i1","text":"1"},{"id":"i2","text":"2"},{"id":"i3","text":"3"}]}',
     '{"kind":"ordering","orderedIds":["i2","i3","i1"]}', '{"orderedIds":["i1","i2","i3"]}'),
  (15, 'ordering not a permutation', '{"id":"q4","kind":"ordering","items":[{"id":"i1","text":"1"},{"id":"i2","text":"2"},{"id":"i3","text":"3"}]}',
     '{"kind":"ordering","orderedIds":["i2","i3","i1"]}', '{"orderedIds":["i2","i2","i1"]}'),
  (16, 'short answer scored', '{"id":"q5","kind":"short_answer"}', '{"kind":"short_answer","accepted":["1000"]}', '{"text":"« 1 000 »"}'),
  (17, 'short answer scored, wrong', '{"id":"q5","kind":"short_answer"}', '{"kind":"short_answer","accepted":["1000"]}', '{"text":"100"}'),
  (18, 'short answer not scored', '{"id":"q5","kind":"short_answer"}', '{"kind":"short_answer"}', '{"text":"1000"}'),
  (19, 'short answer too long', '{"id":"q5","kind":"short_answer"}', '{"kind":"short_answer","accepted":["1000"]}',
     jsonb_build_object('text', repeat('x', 101))),
  (20, 'no key for the question', '{"id":"q2","kind":"true_false"}', null, '{"value":true}');

select results_eq(
  $$select g.label, (select count(*)::integer from app.class_grade(g.question, g.key, g.response)),
       r.score::integer, r.correct
    from grading g left join lateral app.class_grade(g.question, g.key, g.response) r on true
    order by g.n$$,
  $$values ('mc right', 1, 100, true), ('mc wrong', 1, 0, false), ('mc two for one', 0, null, null),
      ('mc unknown id', 0, null, null), ('mc several, any order', 1, 100, true),
      ('mc several, part', 1, 0, false), ('mc extra field', 0, null, null),
      ('true/false right', 1, 100, true), ('true/false as text', 0, null, null),
      ('matching 2 of 3', 1, 67, false), ('matching all', 1, 100, true),
      ('matching missing a left id', 0, null, null), ('ordering right', 1, 100, true),
      ('ordering wrong', 1, 0, false), ('ordering not a permutation', 0, null, null),
      ('short answer scored', 1, 100, true), ('short answer scored, wrong', 1, 0, false),
      ('short answer not scored', 1, null, null), ('short answer too long', 0, null, null),
      ('no key for the question', 1, null, null)$$,
  'app.class_grade scores every kind and refuses shapes that do not fit'
);
select results_eq(
  $$select g.label, r.stored from grading g cross join lateral app.class_grade(g.question, g.key, g.response) r
    where g.n in (5, 16) order by g.n$$,
  $$values ('mc several, any order', '{"choiceIds": ["a", "c"]}'::jsonb), ('short answer scored', '{}'::jsonb)$$,
  'what is stored is ids only, and nothing for a short answer'
);
select is(
  app.class_mode_key(
    '[{"id":"q1","kind":"multiple_choice","multipleAnswers":false,"choices":[{"id":"a","text":"A"},{"id":"b","text":"B"}]},
      {"id":"q2","kind":"ordering","items":[{"id":"i1","text":"1"},{"id":"i2","text":"2"}]}]',
    '{"answers":[{"questionId":"q1","kind":"multiple_choice","correctChoiceIds":["a","b"],"explanation":""},
      {"questionId":"q2","kind":"ordering","orderedIds":["i1","i9"],"explanation":""}],"solution":""}',
    false),
  '{"q1": {"kind": "multiple_choice"}, "q2": {"kind": "ordering"}}'::jsonb,
  'a key entry that cannot be satisfied leaves the question unscored'
);

-- ---------------------------------------------------------------------------------------
-- 4. The projector's controls, answers, and what devices and the projector see (session s3:
--    2 random teams, answers shown)
-- ---------------------------------------------------------------------------------------

select is(tests.play(tests.id('s3'), 4, 'c'), 4, 'four devices join with the code');
select ok(
  (select bool_and(tests.portal_state(d.key) -> 'me' ->> 'team' in ('huards', 'castors'))
   from tests.devices d where d.key like 'c%'),
  'with random teams, each device gets a team when it joins'
);
select is(tests.portal_set_team('c1', 'castors'), '{"status": "ok", "outcome": "invalid"}'::jsonb,
  'devices cannot choose their team when teams are random');
select is(tests.portal_answer('c1', 0, tests.battle_answer('q1', true)) ->> 'outcome', 'closed',
  'no answer is taken in the lobby');

select tests.authenticate_as('teacher_a');
select throws_ok($$select public.class_session_control(tests.id('s3'), 'next', 0)$$,
  'LXC02', null, 'a stale version is refused (a double click, another tab)');
select throws_ok($$select tests.control('s3', 'reveal')$$,
  'LXC02', null, '« Afficher la réponse » only during a question');
select lives_ok($$select tests.control('s3', 'next')$$, '« Commencer » opens the first question');
select tests.clear_authentication();
select results_eq(
  $$select phase, question_index::integer, joining_open, question_closes_at
    from public.class_sessions where id = tests.id('s3')$$,
  $$values ('question', 0, false, null::timestamptz)$$,
  'the first question is open, joining is closed, and there is no timer by default'
);
select results_eq(
  $$select count(*)::integer from public.session_participants where session_id = tests.id('s3')
    group by team order by 1$$,
  $$values (2), (2)$$,
  'random teams are balanced'
);

select is(tests.portal_answer('c1', 1, tests.battle_answer('q2', true)) ->> 'outcome', 'closed',
  'an answer to another question is refused');
select is(tests.portal_answer('c1', 0, tests.battle_answer('q1', true)) ->> 'outcome', 'recorded',
  'a device answers the open question');
select results_eq(
  $$select r.score::integer, r.is_correct, r.response, r.question_key
    from public.session_responses r where r.participant_id = tests.participant('c1')$$,
  $$values (100, true, '{"choiceIds": ["c2"]}'::jsonb, 'q1')$$,
  'the right choice earns 100 points'
);
select is(tests.portal_answer('c1', 0, tests.battle_answer('q1', false)) ->> 'outcome', 'already',
  'one answer per question: a second one is not taken');
select is(tests.portal_answer('c2', 0, '{"choiceIds": ["c9"]}') ->> 'outcome', 'invalid',
  'an unknown choice is invalid');
select is((select count(*)::integer from public.session_responses where participant_id = tests.participant('c2')),
  0, '… and nothing is written');
select is(tests.portal_answer('c2', 0, tests.battle_answer('q1', false)) ->> 'outcome', 'recorded',
  'a wrong answer is recorded');
select ok(
  (select s ? 'myAnswer' and not (s -> 'myAnswer' ? 'result')
   from tests.portal_state('c1') s),
  'during the question a device knows it answered, not whether it was right'
);

select tests.authenticate_as('teacher_a');
select ok(not (public.class_session_live(tests.id('s3')) ? 'reveal'),
  'the projector gets no answer during the question');
select throws_ok($$select tests.control('s3', 'leaderboard')$$,
  'LXC02', null, '« Classement » only after the answer');
select lives_ok($$select tests.control('s3', 'reveal')$$, '« Afficher la réponse »');
select results_eq(
  $$select l -> 'reveal' -> 'distribution', (l -> 'reveal' ->> 'correctCount')::integer,
       l -> 'reveal' -> 'answer' -> 'choiceIds', l -> 'reveal' -> 'answer' -> 'display' ? 'explanation',
       (l ->> 'answered')::integer
    from public.class_session_live(tests.id('s3')) l$$,
  $$values ('{"c1": 0, "c2": 1, "c3": 1, "c4": 0}'::jsonb, 1, '["c2"]'::jsonb, true, 2)$$,
  'after the reveal the projector gets the answers per choice, the right count and the answer'
);
select tests.clear_authentication();
select is(tests.portal_state('c1') -> 'myAnswer' -> 'result', '{"correct": true, "points": 100}'::jsonb,
  'after the reveal a device learns its own result');
select is(tests.portal_state('c2') -> 'myAnswer' -> 'result', '{"correct": false, "points": 0}'::jsonb,
  '… right or not');
select is(tests.portal_answer('c3', 0, tests.battle_answer('q1', true)) ->> 'outcome', 'closed',
  'answers close with the reveal');

select tests.authenticate_as('teacher_a');
select is(tests.control('s3', 'leaderboard') ->> 'phase', 'leaderboard',
  'with answers shown, the ranking can follow each question');
select tests.clear_authentication();
select is(tests.portal_state('c1') ->> 'myTotal', '100', 'with answers shown, a device sees its total in the ranking');
select tests.authenticate_as('teacher_a');
select is(tests.control('s3', 'next') ->> 'index', '1', '« Question suivante »');

-- The teacher moves a device, removes one; a device leaves.
create temporary table moved_to (team text);
grant select on moved_to to authenticated;
insert into moved_to select case tests.device_team('c1') when 'huards' then 'castors' else 'huards' end;
select is(tests.control('s3', 'move', tests.participant('c1'), (select team from moved_to))
    -> 'devices' -> 'list' -> 0 ->> 'team',
  (select team from moved_to),
  '« Changer d''équipe » moves a device (number 1) to another team');
select throws_ok($$select tests.control('s3', 'move', tests.participant('c1'), 'orignaux')$$,
  '22023', null, 'only to a team of the session');
select tests.remember('c2_participant', tests.participant('c2'));
select lives_ok($$select tests.control('s3', 'remove', tests.participant('c2'))$$, '« Retirer »');
select tests.clear_authentication();
select is((select count(*)::integer from public.session_responses
           where participant_id = tests.id('c2_participant')),
  0, 'a removed device''s answers go with it');
select is(tests.portal_state('c2'), '{"status": "gone"}'::jsonb, 'a removed device is told it is out');
select is(tests.portal_answer('c3', 1, tests.battle_answer('q2', true)) ->> 'outcome', 'recorded',
  'a device answers the second question');
select tests.remember('c3_participant', tests.participant('c3'));
select tests.portal_leave('c3');
select is(tests.portal_state('c3'), '{"status": "gone"}'::jsonb, 'a device that left is out');
select is((select count(*)::integer from public.session_responses where participant_id = tests.id('c3_participant')),
  1, '… and its answers stay until the end (they count for its team)');

-- A timer closes answers.
update public.class_sessions set question_closes_at = now() - interval '1 second' where id = tests.id('s3');
select is(tests.portal_answer('c4', 1, tests.battle_answer('q2', true)) ->> 'outcome', 'closed',
  'after the timer, answers are closed');

-- The projector counts connected devices (seen within 20 s).
update public.session_participants set last_seen_at = now() - interval '30 seconds'
where id = tests.participant('c4');
select tests.authenticate_as('teacher_a');
select results_eq(
  $$select (l -> 'devices' ->> 'count')::integer, (l -> 'devices' ->> 'connected')::integer,
       jsonb_array_length(l -> 'devices' -> 'list')
    from public.class_session_live(tests.id('s3')) l$$,
  $$values (2, 1, 3)$$,
  'the projector counts active devices, those seen in the last 20 s, and lists every device'
);
select lives_ok($$select tests.control('s3', 'reveal')$$, 'reveal the second question');
select tests.control('s3', 'next');
select tests.control('s3', 'reveal');
select tests.control('s3', 'next');
select tests.control('s3', 'reveal');
select tests.control('s3', 'next');
select is(tests.control('s3', 'reveal') ->> 'index', '4', 'the last question');
select throws_ok($$select tests.control('s3', 'next')$$, 'LXC03', null,
  '« Question suivante » after the last question gives LXC03');
select is(tests.control('s3', 'finish') ->> 'phase', 'finished', '« Terminer » shows the end screen');
select throws_ok($$select tests.control('s3', 'finish')$$, 'LXC02', null, 'a finished game cannot finish again');
select tests.clear_authentication();
select is(tests.portal_state('c1') -> 'session' ->> 'phase', 'finished', 'devices see the end');

select tests.authenticate_as('teacher_a_other');
select throws_ok($$select tests.control('s3', 'finish')$$, '42501', null,
  'a colleague who is not on the class team cannot control the session');
select throws_ok($$select public.class_session_live(tests.id('s3'))$$, '42501', null,
  '… nor watch it');
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- 5. Answers hidden, teams chosen by the devices, team scores (session s4 in class_a_other:
--    3 teams, the devices pick huards or castors, orignaux stays empty)
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a_other');
select lives_ok(
  $$select tests.remember('s4', (select session_id from public.start_class_session(
      tests.id('class_a_other'), tests.id('quiz'), null, 'teams', p_team_count => 3::smallint,
      p_team_choice => 'device', p_reveal_answers => false)))$$,
  'a colleague starts a quiz with hidden answers where students choose their team'
);
select tests.clear_authentication();
select is(tests.portal_join('h1', tests.join_code(tests.id('s4')), null, 11) -> 'token' is not null, true,
  'a device joins');
select is(tests.portal_state('h1') -> 'me' ->> 'team', null, '… without a team yet');
select is(tests.portal_set_team('h1', 'sapins'), '{"status": "ok", "outcome": "invalid"}'::jsonb,
  'a team that is not in the list is refused');
select is(tests.portal_set_team('h1', 'huards') -> 'me' ->> 'team', 'huards', 'a device chooses its team');
select tests.portal_join('h2', tests.join_code(tests.id('s4')), null, 12);
select tests.portal_set_team('h2', 'huards');
select tests.portal_join('k1', tests.join_code(tests.id('s4')), null, 13);
select tests.portal_set_team('k1', 'castors');
select tests.portal_join('k2', tests.join_code(tests.id('s4')), null, 14);
select tests.portal_set_team('k2', 'castors');
select tests.portal_join('k3', tests.join_code(tests.id('s4')), null, 15);
select tests.portal_set_team('k3', 'castors');

select tests.authenticate_as('teacher_a_other');
select tests.control('s4', 'next');
select tests.clear_authentication();
select is(tests.portal_set_team('k1', 'huards'), '{"status": "ok", "outcome": "invalid"}'::jsonb,
  'after the first question a device keeps its team');
select tests.portal_answer('h1', 0, tests.battle_answer('q1', true));
select tests.portal_answer('h2', 0, tests.battle_answer('q1', false));
select tests.portal_answer('k1', 0, tests.battle_answer('q1', true));
select tests.authenticate_as('teacher_a_other');
select ok(tests.control('s4', 'reveal') -> 'reveal' ? 'distribution'
    and not (public.class_session_live(tests.id('s4')) -> 'reveal' ? 'answer'),
  'with answers hidden, the projector shows the distribution but not the answer');
select throws_ok($$select tests.control('s4', 'leaderboard')$$, 'LXC02', null,
  'with answers hidden, no ranking before the last question');
select tests.clear_authentication();
select ok(not (tests.portal_state('h1') -> 'myAnswer' ? 'result'),
  'with answers hidden, a device does not learn its result after the reveal');
select tests.authenticate_as('teacher_a_other');
select tests.control('s4', 'next');
select tests.clear_authentication();
select tests.portal_answer('h1', 1, tests.battle_answer('q2', true));
select tests.portal_answer('h2', 1, tests.battle_answer('q2', true));
select is(app.class_team_scores(tests.id('s4')),
  '[{"team": "huards", "members": 2, "score": 150}, {"team": "castors", "members": 3, "score": 100},
    {"team": "orignaux", "members": 0, "score": null}]'::jsonb,
  'team scores add each question''s average among the team''s answers; a silent device changes nothing; an empty team has no score and ranks last'
);
select tests.authenticate_as('teacher_a_other');
select tests.control('s4', 'reveal');
select tests.control('s4', 'next');
select tests.control('s4', 'reveal');
select tests.control('s4', 'next');
select tests.clear_authentication();
select tests.portal_answer('k1', 3, tests.battle_answer('q4', true));
select tests.portal_answer('k2', 3, tests.battle_answer('q4', false));
select is(app.class_team_scores(tests.id('s4')) -> 0 ->> 'team', 'huards',
  'a question nobody on a team answered counts 0 for it, and tied teams keep the list order');
select is((app.class_team_scores(tests.id('s4')) -> 1 ->> 'score')::integer, 150, '… (150 each)');
select tests.authenticate_as('teacher_a_other');
select tests.control('s4', 'reveal');
select tests.control('s4', 'next');
select tests.clear_authentication();
select tests.portal_answer('h1', 4, tests.battle_answer('q5', true));
select is((select score from public.session_responses where participant_id = tests.participant('h1')
           and question_index = 4), null, 'short answers are not scored by default');
select tests.authenticate_as('teacher_a_other');
select tests.control('s4', 'reveal');
select is(tests.control('s4', 'leaderboard') ->> 'phase', 'leaderboard',
  'with answers hidden, the ranking comes after the last question');
select tests.clear_authentication();
select ok(tests.portal_state('h1') ? 'leaderboard' and not (tests.portal_state('h1') ? 'myTotal'),
  '… devices see the team ranking, not yet their own total');
select tests.authenticate_as('teacher_a_other');
select tests.control('s4', 'finish');
select tests.clear_authentication();
select is(tests.portal_state('h1') ->> 'myTotal', '200', 'a device sees its total at the end');

-- ---------------------------------------------------------------------------------------
-- 6. Joining (session s5 in class_a: « Chacun pour soi », short answers scored)
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select public.end_class_session(tests.id('s3'), false);
select tests.remember('s5', (select session_id from public.start_class_session(
  tests.id('class_a'), tests.id('quiz'), null, 'solo', p_score_short_answers => true,
  p_seconds_per_question => 30::smallint)));
select tests.clear_authentication();
-- Known codes for the open sessions, so 'AAAAAA' below is certainly wrong.
update public.class_sessions set join_code = 'KKKKKK' where id = tests.id('s5');
update public.class_sessions set join_code = 'HHHHHH' where id = tests.id('s4');

select is(tests.portal_join('wrong', 'AAAAAA', null, 50) ->> 'outcome', 'invalid', 'a wrong code is refused');
select is((select count(*)::integer from public.class_join_failures
           where device_key = tests.device_key(50) and network_key = tests.network_key(1)),
  1, '… and the failure is recorded with the device and network keys');
select is(tests.portal_call('bad', $$select to_jsonb(j) from class_portal.join('K7M-4R9', null, 'x', 'y') j$$) ->> 'outcome',
  'invalid', 'malformed arguments are refused');
select results_eq(
  $$select j ->> 'outcome', char_length(j ->> 'token'), j ->> 'expires_at' is not null
    from tests.portal_join('s5d1', tests.join_code(tests.id('s5')), null, 51) j$$,
  $$values ('ok', 43, true)$$,
  'the right code joins: a 43-character token and the session''s expiry'
);
select results_eq(
  $$select s -> 'me' from tests.portal_state('s5d1') s$$,
  $$values ('{"device": 1}'::jsonb)$$,
  'the device is number 1, with no team in « Chacun pour soi »'
);
select is(tests.portal_join('s5d1', tests.join_code(tests.id('s5')), null, 51) ->> 'outcome', 'ok',
  'the same device joining again');
select results_eq(
  $$select count(*)::integer, min(device_number)::integer from public.session_participants
    where session_id = tests.id('s5')$$,
  $$values (1, 1)$$,
  '… gets its number back instead of a second one'
);

select tests.authenticate_as('teacher_a');
select tests.control('s5', 'lock');
select tests.clear_authentication();
select is(tests.portal_join('s5d2', tests.join_code(tests.id('s5')), null, 52) ->> 'outcome', 'locked',
  '« Fermer les inscriptions » closes joining');
select tests.authenticate_as('teacher_a');
select tests.control('s5', 'unlock');
select tests.clear_authentication();
select is(tests.portal_join('s5d2', tests.join_code(tests.id('s5')), null, 52) ->> 'outcome', 'ok',
  '« Rouvrir les inscriptions »');
update public.class_sessions set joining_closes_at = now() - interval '1 second' where id = tests.id('s5');
select is(tests.portal_join('s5d3', tests.join_code(tests.id('s5')), null, 53) ->> 'outcome', 'locked',
  'joining closes on its own after 20 minutes');
update public.class_sessions set joining_closes_at = now() + interval '5 minutes' where id = tests.id('s5');

insert into public.session_participants (session_id, nickname, device_number, token_hash, device_key)
select tests.id('s5'), n::text, n, encode(extensions.digest('fake-' || n, 'sha256'), 'hex'),
  tests.device_key(1000 + n)
from generate_series(3, 60) n;
update public.class_sessions set device_seq = 60 where id = tests.id('s5');
select is(tests.portal_join('s5d61', tests.join_code(tests.id('s5')), null, 61) ->> 'outcome', 'full',
  'a session takes at most 60 devices');
delete from public.session_participants where session_id = tests.id('s5') and device_number > 2;

select is(tests.portal_join('s5d5', tests.join_code(tests.id('s5')), null, 55) ->> 'outcome', 'ok',
  'once devices are removed, others can join');
update public.module_entitlements set enabled = false
where school_id = tests.id('school_a1') and module = 'library';
select is(tests.portal_join('s5d4', tests.join_code(tests.id('s5')), null, 54) ->> 'outcome', 'locked',
  'no joining in a school that lost the Library module');
update public.module_entitlements set enabled = true
where school_id = tests.id('school_a1') and module = 'library';

-- Throttling (D-084)
select tests.portal_join('t' || n, 'AAAAAA', null, 70) from generate_series(1, 9) n;
select is(tests.portal_join('t10', 'AAAAAA', null, 70) ->> 'outcome', 'invalid',
  'a device may fail 10 times in 15 minutes');
select results_eq(
  $$select j ->> 'outcome', (j ->> 'retry_after')::integer > 0
    from tests.portal_join('t11', tests.join_code(tests.id('s5')), null, 70) j$$,
  $$values ('wait', true)$$,
  'then it waits, even with the right code'
);
select is((select count(*)::integer from public.class_join_failures where device_key = tests.device_key(70)),
  10, 'nothing is recorded while a device waits');
insert into public.class_join_failures (device_key, network_key)
select tests.device_key(2000 + n), tests.network_key(9) from generate_series(1, 100) n;
select results_eq(
  $$select j ->> 'outcome', (j ->> 'retry_after')::integer between 1 and 10
    from tests.portal_join('n1', 'AAAAAA', null, 71, 9) j$$,
  $$values ('wait', true)$$,
  'after 100 failures on a network, typed codes wait at most 10 s'
);

-- The class link
select tests.authenticate_as('teacher_a');
select is(char_length(public.class_mode_link(tests.id('class_a'))), 43, 'the class link is 43 characters');
select is(public.class_mode_link(tests.id('class_a')), public.class_mode_link(tests.id('class_a')),
  'the class link stays the same');
select tests.clear_authentication();
select results_eq(
  $$select j ->> 'outcome', j ->> 'token' is not null
    from tests.portal_join('lnk', null, (select token from public.class_mode_links where class_id = tests.id('class_a')), 72, 9) j$$,
  $$values ('ok', true)$$,
  'a device with the class link joins the open lobby (links are not throttled by network)'
);
select is(tests.portal_join('lnk2', null, repeat('x', 43), 73) ->> 'outcome', 'invalid_link',
  'an unknown class link is refused');
select results_eq(
  $$select count(*)::integer, count(network_key)::integer from public.class_join_failures
    where device_key = tests.device_key(73)$$,
  $$values (1, 0)$$,
  '… and counts against the device only'
);
select tests.authenticate_as('teacher_b');
select is(char_length(public.class_mode_link(tests.id('class_b'))), 43, 'another class''s link');
select tests.clear_authentication();
select is(tests.portal_join('lnkb', null, (select token from public.class_mode_links where class_id = tests.id('class_b')), 74) ->> 'outcome',
  'waiting', 'a class link with no game open answers « waiting »');
select is((select count(*)::integer from public.class_join_failures where device_key = tests.device_key(74)),
  0, '… which is not a failure');
create temporary table link_tokens (label text primary key, token text);
grant select, insert on link_tokens to authenticated;
insert into link_tokens select 'old', token from public.class_mode_links where class_id = tests.id('class_a');
select tests.authenticate_as('teacher_a');
insert into link_tokens values ('new', public.class_mode_link(tests.id('class_a'), true));
select tests.clear_authentication();
select results_eq(
  $$select n.token <> o.token, l.token = n.token
    from link_tokens o, link_tokens n, public.class_mode_links l
    where o.label = 'old' and n.label = 'new' and l.class_id = tests.id('class_a')$$,
  $$values (true, true)$$,
  '« Remplacer le lien » gives a new link'
);
select is(tests.portal_join('lnk_old', null, (select token from link_tokens where label = 'old'), 75) ->> 'outcome',
  'invalid_link', '… and the old one stops working');
select is((select count(*)::integer from public.audit_log where action = 'class_mode_link.replaced'
           and entity_id = tests.id('class_a')), 1, '… and the replacement is audited');
select tests.authenticate_as('principal_a');
select throws_ok($$select public.class_mode_link(tests.id('class_a'))$$, '42501', null,
  'direction gets no class link');
select tests.clear_authentication();

-- Answers with a timer, and a scored short answer
select tests.authenticate_as('teacher_a');
select is(tests.control('s5', 'next') ->> 'closesAt' is not null, true, 'a timer sets when the question closes');
select tests.control('s5', 'reveal');
select tests.control('s5', 'next');
select tests.control('s5', 'reveal');
select tests.control('s5', 'next');
select tests.control('s5', 'reveal');
select tests.control('s5', 'next');
select tests.control('s5', 'reveal');
select tests.control('s5', 'next');
select tests.clear_authentication();
select is(tests.portal_answer('s5d1', 4, '{"text": "1 000"}') ->> 'outcome', 'recorded',
  'a short answer');
select results_eq(
  $$select score::integer, is_correct, response from public.session_responses
    where participant_id = tests.participant('s5d1') and question_index = 4$$,
  $$values (100, true, '{}'::jsonb)$$,
  '« 1 000 » is right when short answers are scored, and the text is not stored'
);

-- ---------------------------------------------------------------------------------------
-- 7. Keeping results, ending, the class tab
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select lives_ok($$select public.set_class_session_keep(tests.id('s5'), true)$$,
  '« Garder les résultats » while the session is open');
select is((public.class_session_live(tests.id('s5')) ->> 'keep')::boolean, true, '… the projector shows it');
select results_eq(
  $$select o -> 'open' ->> 'id', o -> 'open' ->> 'itemTitle', (o -> 'open' ->> 'mine')::boolean,
       jsonb_array_length(o -> 'results'), (o ->> 'hasLink')::boolean, (o ->> 'retentionDays')::integer
    from public.class_mode_overview(tests.id('class_a')) o$$,
  $$values (tests.id('s5')::text, 'Ressource quiz', true, 0, true, 365)$$,
  'the class tab shows the session in progress, the link and the retention'
);
select is(public.end_class_session(tests.id('s5'), true) ->> 'resultsKept', 'true', '« Terminer la séance »');
select is(public.end_class_session(tests.id('s5'), true), '{"alreadyClosed": true}'::jsonb,
  'ending again changes nothing');
select throws_ok($$select public.set_class_session_keep(tests.id('s5'), false)$$, 'LXC05', null,
  'a closed session cannot be changed');
select throws_ok($$select tests.control('s5', 'next')$$, 'LXC05', null, '… nor controlled');
select results_eq(
  $$select o -> 'open', o -> 'results' -> 0 ->> 'sessionId', (o -> 'results' -> 0 ->> 'participantCount')::integer
    from public.class_mode_overview(tests.id('class_a')) o$$,
  $$values ('null'::jsonb, tests.id('s5')::text, 4)$$,
  'the class tab lists the kept results'
);

-- ---------------------------------------------------------------------------------------
-- 8. Access
-- ---------------------------------------------------------------------------------------

select throws_ok($$update public.class_sessions set status = 'closed' where id = tests.id('s4')$$,
  '42501', null, 'sessions change only through functions');
delete from public.class_sessions where id = tests.id('s4');
select tests.clear_authentication();
select ok(exists (select 1 from public.class_sessions where id = tests.id('s4')),
  'deleting a session of another class does nothing');
select tests.authenticate_as('teacher_a_other');
delete from public.class_sessions where id = tests.id('s4');
select tests.clear_authentication();
select ok(exists (select 1 from public.class_sessions where id = tests.id('s4')),
  'an open session cannot be deleted (it is ended, so its answers go and the end is audited)');
select tests.authenticate_as('teacher_a');
delete from public.class_sessions where id = tests.id('s5');
select tests.clear_authentication();
select ok(not exists (select 1 from public.class_sessions where id = tests.id('s5'))
    and not exists (select 1 from public.class_session_results where session_id = tests.id('s5')),
  '« Supprimer » deletes a closed session and its kept results');
select tests.authenticate_as('principal_a');
select is((select count(*)::integer from public.class_sessions), 0,
  'direction does not see teachers'' sessions');
select throws_ok($$select public.class_mode_overview(tests.id('class_a'))$$, '42501', null,
  '… nor their class tab');
select tests.clear_authentication();

select tests.authenticate_anon();
select throws_ok($$select class_portal.state('x')$$, '42501', null, 'anonymous users cannot call the portal');
select tests.clear_authentication();
select tests.authenticate_as('teacher_a');
select throws_ok($$select class_portal.state('x')$$, '42501', null, 'staff cannot call the portal');
select throws_ok($$select app.class_grade('{}', '{}', '{}')$$, '42501', null, 'nor the grading function');
select tests.clear_authentication();

select * from finish();
rollback;
