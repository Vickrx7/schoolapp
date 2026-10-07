-- Phase 5 curriculum coverage (« Couverture du curriculum »): what counts for each attente, who
-- sees « en révision », who may read a board's coverage, and the summary per grade and subject
-- (supabase/migrations/20261101090200_library_coverage.sql; DECISIONS D-094).
begin;
\ir _helpers.psql
\ir _library_coverage_helpers.psql
select plan(29);
select tests.build_fixture();
select tests.build_library_fixture();

-- Board A's own subject (grade 3): Q1 (overall) with Q1.1 and Q1.2, and Q2 (overall, no
-- children, « À vérifier »). Board B has one too.
select tests.coverage_curriculum();
select tests.coverage_curriculum('board_b', 'covb');

-- Approved items of board A.
select tests.coverage_item('a1', null, 'worksheet', 'board_approved', 'board', array['cov_s11']);
select tests.coverage_item('a2', 'teacher_a', 'quiz', 'board_approved', 'board',
  array['cov_s11', 'cov_s12'], 'school_a1');
select tests.coverage_item('a3', null, 'game', 'board_approved', 'board', array['cov_o1']);
select tests.coverage_item('a4', null, 'song', 'board_approved', 'board', array['cov_o1', 'cov_s11']);
-- Items that never count as approved.
select tests.coverage_item('archived', null, 'worksheet', 'archived', 'private', array['cov_s12']);
select tests.coverage_item('school_shared', 'teacher_a', 'worksheet', 'teacher_reviewed', 'school',
  array['cov_o2'], 'school_a1');
select tests.coverage_item('board_shared', 'teacher_a', 'worksheet', 'teacher_reviewed', 'board',
  array['cov_o2'], 'school_a1');
select tests.coverage_item('other_board', null, 'worksheet', 'board_approved', 'board',
  array['cov_o2'], null, 'board_b');
select tests.coverage_item('private_draft', 'teacher_a', 'worksheet', 'draft', 'private',
  array['cov_o2']);
-- In review: a requested item and a board draft; an archived board item is not.
select tests.coverage_item('requested', 'teacher_a', 'worksheet', 'teacher_reviewed', 'private',
  array['cov_o2']);
select tests.library_request('requested');
select tests.coverage_item('board_draft', null, 'worksheet', 'draft', 'private', array['cov_o2']);
select tests.coverage_item('board_archived', null, 'worksheet', 'archived', 'private',
  array['cov_o2']);

-- ---------------------------------------------------------------------------------------
-- 1. What counts (D-094)
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');

select results_eq(
  $$select code, approved from tests.coverage_of() where code in ('Q1.1', 'Q1.2')$$,
  $$values ('Q1.1', 3), ('Q1.2', 1)$$,
  'a specific attente counts the approved items linked to it directly (not those of its overall attente)'
);
select results_eq(
  $$select code, approved from tests.coverage_of() where code = 'Q1'$$,
  $$values ('Q1', 4)$$,
  'an overall attente counts its own items and its specific attentes'' items, each once'
);
select results_eq(
  $$select code, approved from tests.coverage_of() where code in ('Q1.2', 'Q2')$$,
  $$values ('Q1.2', 1), ('Q2', 0)$$,
  'archived items, other boards'' items and items that are only shared do not count'
);
select results_eq(
  $$select code, types from tests.coverage_of()$$,
  $$values ('Q1', '{game,quiz,song,worksheet}'::text[]), ('Q1.1', '{quiz,song,worksheet}'::text[]),
      ('Q1.2', '{quiz}'::text[]), ('Q2', '{}'::text[])$$,
  'the approved types of each attente, in curriculum order'
);
select results_eq(
  $$select c.code, c.kind::text, c.has_children, c.is_verified, c.parent_id, c.strand_id, c.text_fr
    from public.library_coverage(tests.id('board_a'), '3', tests.id('cov_subject')) c$$,
  $$values
    ('Q1', 'overall', true, true, null::uuid, tests.id('cov_strand'), 'Attente générale avec contenus.'),
    ('Q1.1', 'specific', false, true, tests.id('cov_o1'), tests.id('cov_strand'), 'Premier contenu.'),
    ('Q1.2', 'specific', false, true, tests.id('cov_o1'), tests.id('cov_strand'), 'Deuxième contenu.'),
    ('Q2', 'overall', false, false, null::uuid, tests.id('cov_strand'), 'Attente générale sans contenu.')$$,
  'each attente comes with its kind, children, « À vérifier » flag, parent, domaine and text'
);
select is(
  (select count(*)::int from tests.coverage_of() where in_review is not null),
  0, 'a teacher does not see « en révision »'
);
select ok(
  exists (select 1 from public.library_coverage(tests.id('board_a'), '3',
    (select id from public.subjects where code = 'fra' and board_id is null)) c
    where c.expectation_id = tests.id('exp_a')),
  'a standard subject''s attentes are listed for the board'
);
select tests.clear_authentication();

select tests.authenticate_as('principal_a');
select results_eq(
  $$select code, approved from tests.coverage_of() where code = 'Q1'$$,
  $$values ('Q1', 4)$$,
  'direction reads the coverage too'
);
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- 2. « En révision »: content reviewers and the operator
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('board_admin_a');
select results_eq(
  $$select code, in_review from tests.coverage_of()$$,
  $$values ('Q1', 0), ('Q1.1', 0), ('Q1.2', 0), ('Q2', 2)$$,
  'the content reviewer sees requested items and board drafts in review (not archived or only shared ones)'
);
select tests.clear_authentication();

select tests.authenticate_as('faith_reviewer_a');
select is(
  (select count(*)::int from tests.coverage_of() where in_review is not null),
  0, 'a faith reviewer does not see « en révision »'
);
select tests.clear_authentication();

select set_config('role', 'service_role', true);
select results_eq(
  $$select code, approved, in_review from tests.coverage_of() where code in ('Q1', 'Q2')$$,
  $$values ('Q1', 4, 0), ('Q2', 0, 2)$$,
  'the operator (service role) reads a board''s coverage, « en révision » included'
);
select throws_ok(
  $$select * from public.library_coverage(gen_random_uuid(), '3', tests.id('cov_subject'))$$,
  '22023', null, 'the operator gets 22023 for an unknown board'
);
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- 3. Who may read a board's coverage
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_b');
select throws_ok(
  $$select * from public.library_coverage(tests.id('board_a'), '3', tests.id('cov_subject'))$$,
  '42501', null, 'a teacher of another board cannot read the board''s coverage'
);
select tests.clear_authentication();

select tests.authenticate_as('teacher_a');
select throws_ok(
  $$select * from public.library_coverage(tests.id('board_a'), '3', tests.id('covb_subject'))$$,
  '22023', null, 'another board''s subject is refused'
);
select throws_ok(
  $$select * from public.library_coverage(tests.id('board_b'), '3', tests.id('covb_subject'))$$,
  '42501', null, 'a teacher cannot read another board''s coverage'
);
select throws_ok(
  $$select * from public.library_coverage(tests.id('board_a'), null, tests.id('cov_subject'))$$,
  '22023', null, 'a grade is required'
);
select tests.clear_authentication();

select tests.authenticate_as('former_teacher');
select throws_ok(
  $$select * from public.library_coverage(tests.id('board_a'), '3', tests.id('cov_subject'))$$,
  '42501', null, 'a deactivated account cannot read the coverage'
);
select tests.clear_authentication();

select tests.authenticate_as('outsider');
select throws_ok(
  $$select * from public.library_coverage_summary(tests.id('board_a'))$$,
  '42501', null, 'someone without a role in the board cannot read its summary'
);
select tests.clear_authentication();

select tests.authenticate_anon();
select throws_ok(
  $$select * from public.library_coverage(tests.id('board_a'), '3', tests.id('cov_subject'))$$,
  '42501', null, 'anon cannot call the coverage'
);
select tests.clear_authentication();

select ok(
  not has_function_privilege('authenticated', 'app.library_coverage_rows(uuid, text, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'app.library_coverage_access(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'app.library_coverage_rows(uuid, text, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.library_coverage_summary(uuid, integer)', 'execute'),
  'the counting rule and the access check are internal; anon executes nothing'
);

-- ---------------------------------------------------------------------------------------
-- 4. « Vue d'ensemble »: the summary per grade and subject
-- ---------------------------------------------------------------------------------------

-- Units: Q1.1 (3 approved), Q1.2 (1) and Q2 (0); Q1 has children, so it is a heading.
select tests.authenticate_as('teacher_a');
select results_eq(
  $$select * from tests.coverage_summary_of(2)$$,
  $$values (3, 1, 1, 1)$$,
  'at the default threshold 2: one attente without, one with few, one covered'
);
select results_eq(
  $$select s.unit_count, s.none_count, s.few_count, s.covered_count
    from public.library_coverage_summary(tests.id('board_a')) s
    where s.grade_code = '3' and s.subject_id = tests.id('cov_subject')$$,
  $$select * from tests.coverage_summary_of(2)$$,
  'the threshold is 2 by default'
);
select results_eq(
  $$select * from tests.coverage_summary_of(1)$$,
  $$values (3, 1, 0, 2)$$,
  'at threshold 1, every attente with one approved resource is covered'
);
select results_eq(
  $$select * from tests.coverage_summary_of(4)$$,
  $$values (3, 1, 2, 0)$$,
  'at threshold 4, attentes with 1 or 3 approved resources have few'
);
select throws_ok(
  $$select * from public.library_coverage_summary(tests.id('board_a'), 0)$$,
  '22023', null, 'a threshold below 1 is refused'
);
select throws_ok(
  $$select * from public.library_coverage_summary(tests.id('board_a'), 6)$$,
  '22023', null, 'a threshold above 5 is refused'
);
select results_eq(
  $$select exists (select 1 from public.library_coverage_summary(tests.id('board_a')) s
        where s.subject_id = tests.id('covb_subject')),
      exists (select 1 from public.library_coverage_summary(tests.id('board_a')) s
        where s.grade_code = '3'
          and s.subject_id = (select id from public.subjects where code = 'fra' and board_id is null))$$,
  $$values (false, true)$$,
  'the summary has the standard subjects and the board''s own, not another board''s'
);
select tests.clear_authentication();

select tests.authenticate_as('teacher_b');
select throws_ok(
  $$select * from public.library_coverage_summary(tests.id('board_a'))$$,
  '42501', null, 'a teacher of another board cannot read the board''s summary'
);
select tests.clear_authentication();

update public.subjects set active = false where id = tests.id('cov_subject');
select set_config('role', 'service_role', true);
select results_eq(
  $$select count(*)::int from tests.coverage_summary_of(2)$$,
  $$values (0)$$,
  'the operator reads the summary, and a subject that is no longer active is left out'
);
select tests.clear_authentication();

select * from finish();
rollback;
