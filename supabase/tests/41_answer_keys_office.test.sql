-- Answer keys follow the library's screens (supabase/migrations/20270210090200_answer_keys_office.sql;
-- DECISIONS D-149, amending D-062 and D-065). Office and facilities staff, and board admins who
-- are not reviewers, read shared resources without their keys; the author, the teachers and the
-- direction the sharing reaches, and the board's reviewers keep reading them. The paths that read
-- keys still work: the item page, the print and the PDF (as the user), « Afficher la réponse »,
-- the device quiz, which is graded only with a key its teacher may read, and « Adapter », which no
-- longer copies keys for someone who may not read them.
begin;
\ir _helpers.psql
\ir _class_mode_helpers.psql
select plan(40);
select tests.build_fixture();
select tests.build_library_fixture();

-- More staff of board A: a teacher at school_a2; a vice-principal and facilities staff at
-- school_a1; a board admin who reviews nothing; a teacher at school_a1 who is office staff at
-- school_a2, in class_a_other's team; office staff at school_a2 who approve the board's content;
-- office staff at school_a1 who review faith content.
do $$
begin
  perform tests.create_user('teacher_a2');
  perform tests.create_user('vp_a');
  perform tests.create_user('facilities_a');
  perform tests.create_user('admin_a');
  perform tests.create_user('teacher_office_a2');
  perform tests.create_user('office_reviewer_a');
  perform tests.create_user('office_faith_a');
  insert into public.user_roles (user_id, role, board_id, school_id) values
    (tests.id('teacher_a2'), 'teacher', tests.id('board_a'), tests.id('school_a2')),
    (tests.id('vp_a'), 'vice_principal', tests.id('board_a'), tests.id('school_a1')),
    (tests.id('facilities_a'), 'facilities', tests.id('board_a'), tests.id('school_a1')),
    (tests.id('admin_a'), 'board_admin', tests.id('board_a'), null),
    (tests.id('teacher_office_a2'), 'teacher', tests.id('board_a'), tests.id('school_a1')),
    (tests.id('teacher_office_a2'), 'office_admin', tests.id('board_a'), tests.id('school_a2')),
    (tests.id('office_reviewer_a'), 'office_admin', tests.id('board_a'), tests.id('school_a2')),
    (tests.id('office_faith_a'), 'office_admin', tests.id('board_a'), tests.id('school_a1'));
  insert into public.class_teachers (class_id, user_id, role) values
    (tests.id('class_a_other'), tests.id('teacher_office_a2'), 'subject');
  insert into public.library_reviewers (board_id, user_id, approves_content, reviews_faith) values
    (tests.id('board_a'), tests.id('office_reviewer_a'), true, false),
    (tests.id('board_a'), tests.id('office_faith_a'), false, true);
end
$$;

-- Riddles (a base version and its key): reviewed and shared with school_a1, approved for the
-- board, reviewed and shared with school_a2, private and proposed to the board, private with
-- faith content and proposed, a board draft, and office_a's own draft.
select tests.library_item('school_key', 'teacher_a_other', 'riddle', 'teacher_reviewed', 'school',
  'school_a1');
select tests.library_item('board_key', 'teacher_a_other', 'riddle', 'board_approved', 'board',
  'school_a1');
select tests.library_item('a2_key', 'teacher_a2', 'riddle', 'teacher_reviewed', 'school',
  'school_a2');
select tests.library_item('requested_key', 'teacher_a_other', 'riddle', 'teacher_reviewed');
select tests.library_request('requested_key');
select tests.library_item('faith_key', 'teacher_a_other', 'riddle', 'teacher_reviewed');
update public.library_items set faith_content = true where id = tests.id('faith_key');
select tests.library_request('faith_key');
select tests.library_item('board_draft_key', null, 'riddle');
select tests.library_item('office_draft_key', 'office_a', 'riddle');
-- The battle quiz: approved for the board, the board's own, five versions with their keys.
select tests.battle_quiz('battle', null);
-- The same quiz, reviewed by teacher_a2 and shared with school_a2 only.
select tests.battle_quiz('a2_quiz', 'teacher_a2', 'school_a2');
update public.library_items
set status = 'teacher_reviewed', share_scope = 'school', approved_at = null
where id = tests.id('a2_quiz');

-- What the current user reads of each item, in order: the item (row level security), and how
-- many of its keys, joined to their versions as the item page, the print and the PDF read them.
create function tests.reads(p_items text[])
returns table (item_read boolean, keys_read integer)
language sql
as $$
  select exists (select 1 from public.library_items i where i.id = tests.id(x.k)),
    (select count(*)::integer
     from public.library_item_answer_keys a
     join public.library_item_versions v on v.id = a.version_id
     where v.item_id = tests.id(x.k))
  from unnest(p_items) with ordinality x (k, n)
  order by x.n;
$$;

grant execute on function tests.reads(text[]) to authenticated;

-- ---------------------------------------------------------------------------------------
-- 1. The policy and its predicate
-- ---------------------------------------------------------------------------------------

select results_eq(
  $$select policyname::text collate "default", cmd from pg_policies
    where schemaname = 'public' and tablename = 'library_item_answer_keys'$$,
  $$values ('library_item_answer_keys_select', 'SELECT')$$,
  'the keys have one policy, for reading'
);
select ok(
  not has_function_privilege('authenticated', 'app.library_item_keys_readable_by(uuid,uuid)', 'execute')
  and not has_function_privilege('anon', 'app.library_item_keys_readable_by(uuid,uuid)', 'execute')
  and has_function_privilege('service_role', 'app.library_item_keys_readable_by(uuid,uuid)', 'execute')
  and has_function_privilege('authenticated', 'app.can_read_library_item_keys(uuid)', 'execute')
  and not has_function_privilege('anon', 'app.can_read_library_item_keys(uuid)', 'execute'),
  'the predicate that takes a user is the worker''s; row level security runs the current user''s form'
);
select results_eq(
  $$select x.u, app.library_item_keys_readable_by(tests.id(x.u), tests.id('board_key'))
    from unnest(array['teacher_a', 'principal_a', 'vp_a', 'board_admin_a', 'office_a',
      'facilities_a', 'admin_a', 'teacher_b', 'former_teacher']) with ordinality x (u, n)
    order by x.n$$,
  $$values ('teacher_a', true), ('principal_a', true), ('vp_a', true), ('board_admin_a', true),
    ('office_a', false), ('facilities_a', false), ('admin_a', false), ('teacher_b', false),
    ('former_teacher', false)$$,
  'for a board resource: teachers, the direction and reviewers, not office, facilities or other admins'
);

-- ---------------------------------------------------------------------------------------
-- 2. Who no longer reads keys
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('office_a');
select results_eq(
  $$select * from tests.reads(array['school_key', 'board_key', 'battle'])$$,
  $$values (true, 0), (true, 0), (true, 0)$$,
  'office staff read the resources shared with their school and board, not their keys'
);
select is_empty(
  $$select k.answer_key from public.library_item_answer_keys k
    where k.version_id = tests.id('battle_v')$$,
  'nor a key asked for by its version'
);
select results_eq(
  $$select * from tests.reads(array['office_draft_key'])$$,
  $$values (true, 1)$$,
  'office staff still read the keys of their own resource'
);
select tests.clear_authentication();

select tests.authenticate_as('facilities_a');
select results_eq(
  $$select * from tests.reads(array['school_key', 'board_key'])$$,
  $$values (true, 0), (true, 0)$$,
  'facilities staff read shared resources without their keys'
);
select tests.clear_authentication();

select tests.authenticate_as('admin_a');
select results_eq(
  $$select * from tests.reads(array['school_key', 'board_key'])$$,
  $$values (false, 0), (true, 0)$$,
  'a board admin who reviews nothing reads the board''s resources without their keys'
);
select tests.clear_authentication();

select tests.authenticate_as('teacher_office_a2');
select results_eq(
  $$select * from tests.reads(array['school_key', 'board_key', 'a2_key'])$$,
  $$values (true, 1), (true, 1), (true, 0)$$,
  'a teacher who is office staff in another school reads keys only where she teaches, and the board''s'
);
select tests.clear_authentication();

select tests.authenticate_as('teacher_b');
select results_eq(
  $$select * from tests.reads(array['board_key'])$$,
  $$values (false, 0)$$,
  'another board''s teacher reads neither the resource nor its key'
);
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- 3. Who still reads keys
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select results_eq(
  $$select * from tests.reads(array['school_key', 'board_key', 'a2_key'])$$,
  $$values (true, 1), (true, 1), (false, 0)$$,
  'a teacher reads the keys of what her school and her board share with her'
);
select tests.clear_authentication();

select tests.authenticate_as('teacher_a_other');
select results_eq(
  $$select * from tests.reads(array['school_key', 'requested_key', 'faith_key'])$$,
  $$values (true, 1), (true, 1), (true, 1)$$,
  'the author reads her resources'' keys, shared or not'
);
select tests.clear_authentication();

select tests.authenticate_as('principal_a');
select results_eq(
  $$select * from tests.reads(array['school_key', 'board_key', 'battle'])$$,
  $$values (true, 1), (true, 1), (true, 5)$$,
  'the principal reads the keys, every version''s for the print and the PDF'
);
select tests.clear_authentication();

select tests.authenticate_as('vp_a');
select results_eq(
  $$select * from tests.reads(array['school_key', 'board_key'])$$,
  $$values (true, 1), (true, 1)$$,
  'the vice-principal reads the keys'
);
select tests.clear_authentication();

select tests.authenticate_as('principal_a2');
select results_eq(
  $$select * from tests.reads(array['school_key', 'board_key', 'a2_key'])$$,
  $$values (false, 0), (true, 1), (true, 1)$$,
  'the direction of another school reads its own school''s keys and the board''s'
);
select tests.clear_authentication();

select tests.authenticate_as('board_admin_a');
select results_eq(
  $$select * from tests.reads(array['school_key', 'a2_key', 'requested_key', 'faith_key',
    'board_draft_key', 'office_draft_key'])$$,
  $$values (true, 1), (true, 1), (true, 1), (true, 1), (true, 1), (false, 0)$$,
  'the content reviewer, a board admin, reads the keys of what she reviews, never of a private draft'
);
select tests.clear_authentication();

select tests.authenticate_as('office_reviewer_a');
select results_eq(
  $$select * from tests.reads(array['school_key', 'a2_key', 'requested_key', 'board_draft_key'])$$,
  $$values (true, 1), (true, 1), (true, 1), (true, 1)$$,
  'office staff who approve the board''s content read keys like any content reviewer'
);
select tests.clear_authentication();

select tests.authenticate_as('office_faith_a');
select results_eq(
  $$select * from tests.reads(array['faith_key', 'requested_key', 'school_key'])$$,
  $$values (true, 1), (false, 0), (true, 1)$$,
  'office staff who review faith content read the keys of the items they can read'
);
select tests.clear_authentication();

select tests.authenticate_as('faith_reviewer_a');
select results_eq(
  $$select * from tests.reads(array['faith_key', 'requested_key'])$$,
  $$values (true, 1), (false, 0)$$,
  'the faith reviewer reads the keys of requested faith content only'
);
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- 4. The paths that read keys: « Afficher la réponse » and the device quiz
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select lives_ok(
  $$select tests.remember('battle_s', (select session_id from public.start_class_session(
      tests.id('class_a'), tests.id('battle'), null, 'solo')))$$,
  'a teacher starts a device quiz with a board resource she did not write'
);
select is(
  (select k.answer_key ->> 'solution'
   from public.library_item_answer_keys k
   join public.library_item_versions v on v.id = k.version_id
   where k.version_id = tests.id('battle_v') and v.item_id = tests.id('battle')),
  'SENTINELLE-CORRIGE',
  '« Afficher la réponse » reads the key as the teacher'
);
select tests.clear_authentication();
select results_eq(
  $$select x.q ->> 'id', (x.q ->> 'scorable')::boolean
    from public.class_sessions s, jsonb_array_elements(s.questions) with ordinality x (q, n)
    where s.id = tests.id('battle_s') order by x.n$$,
  $$values ('q1', true), ('q2', true), ('q3', true), ('q4', true), ('q5', false)$$,
  'the device quiz is graded with the resource''s key'
);
select ok(exists (select 1 from public.class_session_keys where session_id = tests.id('battle_s')),
  'the session keeps its key apart, as before');

select tests.authenticate_as('office_a');
select throws_ok(
  $$select public.start_class_session(tests.id('class_a'), tests.id('battle'), null, 'solo')$$,
  '42501', null, 'office staff start no device quiz (D-090)'
);
select tests.clear_authentication();

select tests.authenticate_as('principal_a');
select throws_ok(
  $$select public.start_class_session(tests.id('class_a'), tests.id('battle'), null, 'solo')$$,
  '42501', null, 'nor does the direction: the device quiz stays with the class team'
);
select tests.clear_authentication();

-- A teacher in one school who is office staff in another: her class is at school_a1, the quiz is
-- shared only with school_a2, where she is office staff. She may use it, not read its key, and
-- the database does not grade with it for her (its definer function reads the key).
select tests.authenticate_as('teacher_office_a2');
select results_eq(
  $$select * from tests.reads(array['a2_quiz'])$$,
  $$values (true, 0)$$,
  'a teacher reads a quiz shared where she is office staff, without its keys'
);
select lives_ok(
  $$select tests.remember('office_quiz_s', (select session_id from public.start_class_session(
      tests.id('class_a_other'), tests.id('a2_quiz'), null, 'solo')))$$,
  'she can still play it on her class''s devices'
);
select tests.clear_authentication();
select results_eq(
  $$select x.q ->> 'id', (x.q ->> 'scorable')::boolean
    from public.class_sessions s, jsonb_array_elements(s.questions) with ordinality x (q, n)
    where s.id = tests.id('office_quiz_s') order by x.n$$,
  $$values ('q1', false), ('q2', false), ('q3', false), ('q4', false), ('q5', false)$$,
  'no question counts for points: the quiz is not graded with a key she may not read'
);
select is(
  (select k.answers from public.class_session_keys k where k.session_id = tests.id('office_quiz_s')),
  '{}'::jsonb,
  'the session keeps no key, so the projector has no answer to reveal'
);

-- The same teacher's quiz shared with the board, where she teaches, is graded as before.
select tests.authenticate_as('teacher_office_a2');
select lives_ok(
  $$select tests.remember('teacher_quiz_s', (select session_id from public.start_class_session(
      tests.id('class_a_other'), tests.id('battle'), null, 'solo', p_replace_open => true)))$$,
  'she starts a device quiz with a board resource in the same class'
);
select tests.clear_authentication();
select results_eq(
  $$select x.q ->> 'id', (x.q ->> 'scorable')::boolean
    from public.class_sessions s, jsonb_array_elements(s.questions) with ordinality x (q, n)
    where s.id = tests.id('teacher_quiz_s') order by x.n$$,
  $$values ('q1', true), ('q2', true), ('q3', true), ('q4', true), ('q5', false)$$,
  'that one is graded with the key she may read'
);

-- ---------------------------------------------------------------------------------------
-- 5. « Adapter »: the copy has keys only for someone who may read them
-- ---------------------------------------------------------------------------------------

select tests.remember(k, gen_random_uuid())
from unnest(array['office_copy', 'teacher_copy', 'reviewer_copy']) k;

select tests.authenticate_as('office_a');
select is(public.remix_library_item(tests.id('board_key'), tests.id('office_copy')),
  tests.id('office_copy'), 'office staff can still adapt a resource shared with them');
select results_eq(
  $$select * from tests.reads(array['office_copy'])$$,
  $$values (true, 0)$$,
  'their copy reads as theirs, with no key'
);
select tests.clear_authentication();
select results_eq(
  $$select (select count(*)::int from public.library_item_versions where item_id = tests.id('office_copy')),
      (select count(*)::int from public.library_item_versions v
       join public.library_item_answer_keys k on k.version_id = v.id
       where v.item_id = tests.id('office_copy'))$$,
  $$values (1, 0)$$,
  'the copy has the versions, not the keys: adapting cannot bring them back'
);

select tests.authenticate_as('teacher_a');
select is(public.remix_library_item(tests.id('board_key'), tests.id('teacher_copy')),
  tests.id('teacher_copy'), 'a teacher adapts the same resource');
select results_eq(
  $$select * from tests.reads(array['teacher_copy'])$$,
  $$values (true, 1)$$,
  'her copy keeps the key'
);
select tests.clear_authentication();

select tests.authenticate_as('office_reviewer_a');
select is(public.remix_library_item(tests.id('a2_key'), tests.id('reviewer_copy')),
  tests.id('reviewer_copy'), 'a reviewer who is office staff adapts a resource of her school');
select tests.clear_authentication();
select is(
  (select count(*)::int from public.library_item_versions v
   join public.library_item_answer_keys k on k.version_id = v.id
   where v.item_id = tests.id('reviewer_copy')),
  1, 'her copy keeps the key: she may read it'
);

-- ---------------------------------------------------------------------------------------
-- 6. Writing keys is unchanged: only through the functions
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select throws_ok(
  $$update public.library_item_answer_keys set answer_key = '{}'
    where version_id = tests.id('battle_v')$$,
  '42501', null, 'nobody writes keys directly'
);
select tests.clear_authentication();
select is(
  (select answer_key ->> 'solution' from public.library_item_answer_keys
   where version_id = tests.id('battle_v')),
  'SENTINELLE-CORRIGE', 'the key is unchanged'
);

select * from finish();
rollback;
