-- Planner: units, lessons and progress are private to the class team; progress emits events.
begin;
\ir _helpers.psql
select plan(24);
select tests.build_fixture();

-- Direction does not see planning.
select tests.authenticate_as('principal_a');
select is((select count(*)::int from public.units where class_id = tests.id('class_a')), 0,
  'the principal does not see teachers'' units');
select is((select count(*)::int from public.unit_lessons where unit_id = tests.id('unit_a')), 0,
  'the principal does not see teachers'' lessons');
select tests.clear_authentication();

select tests.authenticate_as('teacher_b');
select is((select count(*)::int from public.unit_lessons where unit_id = tests.id('unit_a')), 0,
  'a teacher from another board does not see the lessons');
select throws_ok(
  $$insert into public.lesson_progress (lesson_id, status) values (tests.id('lesson_a1'), 'completed')$$,
  '42501', null, 'a teacher cannot record progress for someone else''s class'
);
select throws_ok($$select public.mark_lesson_taught(tests.id('lesson_a1'), '2026-09-29')$$,
  '42501', null, 'mark_lesson_taught cannot touch someone else''s class');
select tests.clear_authentication();

-- Checking off a lesson.
select tests.authenticate_as('teacher_a');
select lives_ok(
  $$insert into public.lesson_progress (lesson_id, status, taught_on) values (tests.id('lesson_a1'), 'completed', '2026-09-28')$$,
  'the teacher can check off a lesson'
);
select is((select class_id from public.lesson_progress where lesson_id = tests.id('lesson_a1')), tests.id('class_a'),
  'progress is attached to the lesson''s class automatically');
select is((select completed_by from public.lesson_progress where lesson_id = tests.id('lesson_a1')), tests.id('teacher_a'),
  'progress records who checked it off');
select throws_ok(
  $$insert into public.lesson_progress (lesson_id, status, source) values (tests.id('lesson_a2'), 'completed', 'substitute_report')$$,
  '42501', null, 'teachers cannot record progress as if it came from a substitute report'
);
select lives_ok(
  $$insert into public.lesson_progress (lesson_id, status) values (tests.id('lesson_a1'), 'skipped')
    on conflict (lesson_id) do update set status = excluded.status$$,
  'progress can be updated with an upsert'
);
select lives_ok($$delete from public.lesson_progress where lesson_id = tests.id('lesson_a1')$$,
  'the teacher can undo a check-off');
select lives_ok($$select public.mark_lesson_taught(tests.id('lesson_a2'), '2026-09-29')$$,
  'mark_lesson_taught checks off a lesson in one call');
select lives_ok($$select public.unmark_lesson(tests.id('lesson_a2'))$$,
  'unmark_lesson removes the check-off');
select tests.clear_authentication();

select is(
  (select array_agg(event_type order by id) from public.event_outbox where aggregate_id = tests.id('lesson_a1')),
  array['lesson.completed', 'lesson.progress_cleared'],
  'checking off emits lesson.completed; undoing emits lesson.progress_cleared'
);
select is(
  (select payload->>'class_id' from public.event_outbox where event_type = 'lesson.completed' and aggregate_id = tests.id('lesson_a1')),
  tests.id('class_a')::text,
  'the event payload carries ids only'
);

-- Subject teachers on the team can plan too.
select tests.authenticate_as('subject_teacher');
select lives_ok(
  $$insert into public.unit_lessons (unit_id, sequence_number, title) values (tests.id('unit_a'), 4, 'Lesson A4')$$,
  'a subject teacher on the class team can add lessons'
);
select tests.clear_authentication();

-- Reordering and activating units.
select tests.authenticate_as('teacher_a');
select lives_ok(
  $$select public.reorder_unit_lessons(tests.id('unit_a'), array[
      tests.id('lesson_a3'), tests.id('lesson_a1'), tests.id('lesson_a2'),
      (select id from public.unit_lessons where unit_id = tests.id('unit_a') and title = 'Lesson A4')])$$,
  'lessons can be reordered'
);
select is(
  (select array_agg(title order by sequence_number) from public.unit_lessons where unit_id = tests.id('unit_a')),
  array['Lesson A3', 'Lesson A1', 'Lesson A2', 'Lesson A4'],
  'the new order is saved'
);
select throws_ok(
  $$select public.reorder_unit_lessons(tests.id('unit_a'), array[tests.id('lesson_a1'), tests.id('lesson_a2')])$$,
  '22023', null, 'a reorder must list every lesson of the unit exactly once'
);
select lives_ok(
  $$insert into public.units (class_id, subject_id, title) values
    (tests.id('class_a'), (select subject_id from public.units where id = tests.id('unit_a')), 'Unit A next')$$,
  'the teacher can add a unit'
);
select lives_ok(
  $$select public.set_active_unit((select id from public.units where title = 'Unit A next'))$$,
  'the teacher can switch the active unit'
);
select is(
  (select array_agg(title || ':' || status order by title) from public.units where class_id = tests.id('class_a')),
  array['Unit A:planned', 'Unit A next:active'],
  'only one unit per subject is active'
);
select throws_ok(
  $$update public.units set class_id = tests.id('class_a_other') where id = tests.id('unit_a')$$,
  '42501', null, 'a unit cannot be moved to another class'
);
select tests.clear_authentication();

select tests.authenticate_as('teacher_b');
select throws_ok(
  $$select public.reorder_unit_lessons(tests.id('unit_a'), array[tests.id('lesson_a1')])$$,
  '22023', null, 'a teacher cannot reorder lessons in someone else''s unit'
);
select tests.clear_authentication();

select * from finish();
rollback;
