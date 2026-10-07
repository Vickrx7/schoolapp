-- Phase 4: substitute plans use library resources
-- (supabase/migrations/20261015090300_sub_plan_library.sql; DECISIONS D-077, D-062).
begin;
\ir _helpers.psql
select plan(18);
select tests.build_fixture();
select tests.build_library_fixture();

-- unit_a (class_a: 3e année, Français, teacher_a) gets three more lessons. Lesson 1 is done; the
-- others each link a resource that a substitute must not get, except lesson 2.
insert into public.unit_lessons (id, unit_id, sequence_number, title) values
  (tests.remember('lesson_a4', gen_random_uuid()), tests.id('unit_a'), 4, 'Lesson A4'),
  (tests.remember('lesson_a5', gen_random_uuid()), tests.id('unit_a'), 5, 'Lesson A5'),
  (tests.remember('lesson_a6', gen_random_uuid()), tests.id('unit_a'), 6, 'Lesson A6');
insert into public.lesson_progress (lesson_id, status, taught_on, completed_by, source)
values (tests.id('lesson_a1'), 'completed', current_date - 1, tests.id('teacher_a'), 'teacher');
insert into public.unit_lesson_expectations (lesson_id, expectation_id) values
  (tests.id('lesson_a1'), tests.id('exp_a')),
  (tests.id('lesson_a2'), tests.id('exp_a'));
-- Léa works at the Débutant level; Nathan has no level.
update public.students set default_language_level_id = tests.board_level('board_a', 'debutant')
where id = tests.id('student_a1');

-- Linked to her lessons: her reviewed sheet (lesson 2), and five that never go to a substitute.
select tests.library_item('linked_ok', 'teacher_a', 'worksheet', 'teacher_reviewed');
select tests.library_item('done_linked', null, 'worksheet', 'board_approved', 'board');
select tests.library_item('linked_draft', 'teacher_a', 'worksheet');
select tests.library_item('linked_archived', 'teacher_a', 'worksheet', 'archived');
select tests.library_item('linked_elsewhere', 'faith_reviewer_a', 'worksheet', 'teacher_reviewed',
  'school', 'school_a2');
select tests.library_item('linked_not_sub', 'teacher_a', 'worksheet', 'teacher_reviewed');
-- Board resources for exp_a: an approved reading passage and lesson plan, and four that do not
-- qualify (not sub-friendly, another board, another grade, not approved).
select tests.library_item('approved_match', null, 'reading_passage', 'board_approved', 'board');
select tests.library_item('approved_plan', null, 'lesson_plan', 'board_approved', 'board');
select tests.library_item('approved_not_sub', null, 'reading_passage', 'board_approved', 'board');
select tests.library_item('approved_board_b', null, 'reading_passage', 'board_approved', 'board',
  null, 'board_b');
select tests.library_item('approved_grade_5', null, 'reading_passage', 'board_approved', 'board');
select tests.library_item('reviewed_shared', 'teacher_a_other', 'reading_passage', 'teacher_reviewed',
  'board');
update public.library_item_grades set grade_code = '5' where item_id = tests.id('approved_grade_5');
-- Only the done lesson could use this one.
delete from public.library_item_expectations where item_id = tests.id('done_linked');
update public.library_items set sub_friendly = true
where id in (tests.id('linked_ok'), tests.id('done_linked'), tests.id('linked_draft'),
  tests.id('linked_archived'), tests.id('linked_elsewhere'), tests.id('approved_match'),
  tests.id('approved_plan'), tests.id('approved_board_b'), tests.id('approved_grade_5'),
  tests.id('reviewed_shared'));
update public.unit_lessons l set library_item_id = v.item
from (values
  (tests.id('lesson_a1'), tests.id('done_linked')),
  (tests.id('lesson_a2'), tests.id('linked_ok')),
  (tests.id('lesson_a3'), tests.id('linked_draft')),
  (tests.id('lesson_a4'), tests.id('linked_archived')),
  (tests.id('lesson_a5'), tests.id('linked_elsewhere')),
  (tests.id('lesson_a6'), tests.id('linked_not_sub'))
) as v (lesson, item)
where l.id = v.lesson;
-- The approved passage has a key with answers (never sent); the others have none.
insert into public.library_item_answer_keys (version_id, answer_key)
select v.id, '{"answers": [{"questionId": "q1", "kind": "short_answer", "sampleAnswer": "SENTINELLE-CORRIGE", "acceptableAnswers": [], "explanation": ""}], "solution": ""}'
from public.library_item_versions v where v.item_id = tests.id('approved_match');

create temporary table loaded on commit drop as
select app.sub_plan_library_sources(tests.id('teacher_a'), tests.id('school_a1')) as sources;

-- ---------------------------------------------------------------------------------------
-- 1. Candidates for the open lessons
-- ---------------------------------------------------------------------------------------

select results_eq(
  $$select (c ->> 'itemId')::uuid, c ->> 'reason'
    from loaded, jsonb_array_elements(sources -> 'lessonCandidates') lc,
      jsonb_array_elements(lc -> 'candidates') with ordinality as x (c, n)
    where (lc ->> 'lessonId')::uuid = tests.id('lesson_a2')
    order by n$$,
  $$values (tests.id('linked_ok'), 'linked'), (tests.id('approved_match'), 'expectation'),
    (tests.id('approved_plan'), 'expectation')$$,
  'the lesson''s own reviewed resource comes first, then approved ones for its attente (a student sheet before a lesson plan)'
);
select results_eq(
  $$select (lc ->> 'lessonId')::uuid from loaded, jsonb_array_elements(sources -> 'lessonCandidates') lc$$,
  $$values (tests.id('lesson_a2'))$$,
  'done lessons, and lessons linking a draft, an archived, an unusable or a not sub-friendly resource, get nothing'
);
select set_eq(
  $$select (i ->> 'id')::uuid from loaded, jsonb_array_elements(sources -> 'items') i$$,
  $$values (tests.id('linked_ok')), (tests.id('approved_match')), (tests.id('approved_plan'))$$,
  'resources of another board or grade, not sub-friendly or only reviewed are not candidates'
);
select results_eq(
  $$select (lc -> 'candidates' -> 1 ->> 'overlap')::int
    from loaded, jsonb_array_elements(sources -> 'lessonCandidates') lc$$,
  $$values (1)$$,
  'each candidate says how many attentes it shares with the lesson'
);

select tests.library_item('a_test', null, 'unit_test', 'board_approved', 'board');
select throws_ok(
  $$update public.library_items set sub_friendly = true where id = tests.id('a_test')$$,
  '23514', null, 'a unit test is never sub-friendly'
);
select tests.library_item('close_experiment', 'teacher_a', 'experiment', 'teacher_reviewed');
select throws_ok(
  $$update public.library_items set safety_notes = tests.safety_notes('close'), sub_friendly = true
    where id = tests.id('close_experiment')$$,
  '23514', null, 'an experiment that needs close supervision is never sub-friendly'
);
select lives_ok(
  $$update public.library_items set sub_friendly = true where id = tests.id('close_experiment')$$,
  'an experiment under standard supervision may be sub-friendly'
);

-- ---------------------------------------------------------------------------------------
-- 2. Versions and keys
-- ---------------------------------------------------------------------------------------

select results_eq(
  $$select (v ->> 'levelId')::uuid
    from loaded, jsonb_array_elements(sources -> 'items') i, jsonb_array_elements(i -> 'versions') v
    where (i ->> 'id')::uuid = tests.id('approved_match')
    order by v ->> 'levelId' nulls first$$,
  $$values (null::uuid), (tests.board_level('board_a', 'debutant'))$$,
  'a resource comes with its base version and the versions of the class''s levels only'
);
select ok(
  not jsonb_path_exists((select sources from loaded), '$.**.answers')
    and position('SENTINELLE-CORRIGE' in (select sources::text from loaded)) = 0,
  'no answer key is ever loaded'
);
select results_eq(
  $$select (i ->> 'id')::uuid, (i ->> 'hasAnswerKey')::boolean
    from loaded, jsonb_array_elements(sources -> 'items') i order by i ->> 'title'$$,
  $$values (tests.id('approved_match'), true), (tests.id('approved_plan'), false),
    (tests.id('linked_ok'), false)$$,
  'hasAnswerKey says whether a key with answers exists'
);

update public.module_entitlements set enabled = false
where school_id = tests.id('school_a1') and module = 'library';
select is(
  app.sub_plan_library_sources(tests.id('teacher_a'), tests.id('school_a1')),
  '{"items": [], "lessonCandidates": []}'::jsonb,
  'a school without the Library module gets no resources'
);
update public.module_entitlements set enabled = true
where school_id = tests.id('school_a1') and module = 'library';

-- ---------------------------------------------------------------------------------------
-- 3. The teacher's call
-- ---------------------------------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated', 'app.sub_plan_library_sources(uuid, uuid)', 'execute'),
  'the loader that takes a teacher is for the worker only'
);
select tests.authenticate_as('office_a');
select throws_ok(
  $$select public.get_sub_plan_library_sources(tests.id('school_a1'))$$,
  '42501', null, 'office staff cannot load a teacher''s resources'
);
select tests.clear_authentication();
update public.module_entitlements set enabled = false
where school_id = tests.id('school_a1') and module = 'teaching';
select tests.authenticate_as('teacher_a');
select throws_ok(
  $$select public.get_sub_plan_library_sources(tests.id('school_a1'))$$,
  '42501', null, 'a school without the Teaching module has no substitute plans'
);
select tests.clear_authentication();
update public.module_entitlements set enabled = true
where school_id = tests.id('school_a1') and module = 'teaching';
select tests.authenticate_as('teacher_a');
select set_config('tests.got', public.get_sub_plan_library_sources(tests.id('school_a1'))::text, true);
select tests.clear_authentication();
select is(
  current_setting('tests.got')::jsonb,
  app.sub_plan_library_sources(tests.id('teacher_a'), tests.id('school_a1')),
  'a teacher gets the loader''s result for herself'
);

-- ---------------------------------------------------------------------------------------
-- 4. A lesson's attentes rebuild upcoming plans (D-077)
-- ---------------------------------------------------------------------------------------

insert into public.absences (id, teacher_id, school_id, starts_on, ends_on, status, published_at)
values (tests.remember('abs_a', gen_random_uuid()), tests.id('teacher_a'), tests.id('school_a1'),
  tests.school_day(7), tests.school_day(7), 'published', now());
update public.absences set sources_changed_at = null where id = tests.id('abs_a');

select tests.authenticate_as('teacher_a');
insert into public.unit_lesson_expectations (lesson_id, expectation_id)
values (tests.id('lesson_a3'), tests.id('exp_a'));
select tests.clear_authentication();
select isnt((select sources_changed_at from public.absences where id = tests.id('abs_a')), null,
  'adding an attente to a lesson marks the teacher''s upcoming absence out of date');

update public.absences set sources_changed_at = null where id = tests.id('abs_a');
select tests.authenticate_as('teacher_a');
delete from public.unit_lesson_expectations where lesson_id = tests.id('lesson_a3');
select tests.clear_authentication();
select isnt((select sources_changed_at from public.absences where id = tests.id('abs_a')), null,
  'removing one does too');

select lives_ok(
  $$delete from public.units where id = tests.id('unit_a')$$,
  'deleting a unit with lesson attentes works (the unit''s own trigger reports it)'
);

select * from finish();
rollback;
