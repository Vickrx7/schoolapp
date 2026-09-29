-- Baseline rules for tables whose features arrive in later phases.
begin;
\ir _helpers.psql
select plan(22);
select tests.build_fixture();

-- Library: private drafts, sharing only after review, safety notes for experiments.
select tests.authenticate_as('teacher_a');
select lives_ok(
  $$insert into public.library_items (id, board_id, type, title, source, author_id)
    values (tests.remember('item', gen_random_uuid()), tests.id('board_a'), 'worksheet', 'Fiche', 'teacher_created', tests.id('teacher_a'))$$,
  'a teacher can create a private draft'
);
select is((select bucket::text from public.library_items where id = tests.id('item')), 'pratiquer',
  'the bucket is derived from the item type');
select throws_ok(
  $$insert into public.library_items (board_id, type, title, source, author_id, status)
    values (tests.id('board_a'), 'worksheet', 'X', 'teacher_created', tests.id('teacher_a'), 'board_approved')$$,
  '42501', null, 'a teacher cannot create an already-approved item'
);
select tests.clear_authentication();

select tests.authenticate_as('teacher_a_other');
select is((select count(*)::int from public.library_items where id = tests.id('item')), 0,
  'drafts are private to their author');
select tests.clear_authentication();

select tests.authenticate_as('teacher_a');
select lives_ok(
  $$update public.library_items set status = 'teacher_reviewed', share_scope = 'school', school_id = tests.id('school_a1')
    where id = tests.id('item')$$,
  'the author can mark an item reviewed and share it with the school'
);
select throws_ok(
  $$update public.library_items set status = 'board_approved' where id = tests.id('item')$$,
  '42501', null, 'the author cannot approve their own item for the board'
);
select throws_ok(
  $$update public.library_items set board_id = tests.id('board_b') where id = tests.id('item')$$,
  '42501', null, 'an item cannot be moved to another board'
);
select throws_ok(
  $$update public.library_items set school_id = tests.id('school_b1') where id = tests.id('item')$$,
  '42501', null, 'an item cannot be shared into a school the author does not work in'
);
select throws_ok(
  $$update public.library_items set author_id = tests.id('teacher_a_other') where id = tests.id('item')$$,
  '42501', null, 'authorship cannot be reassigned through the API'
);
select throws_ok(
  $$insert into public.collections (board_id, school_id, owner_id, title, share_scope)
    values (tests.id('board_a'), tests.id('school_b1'), tests.id('teacher_a'), 'X', 'school')$$,
  '42501', null, 'a collection cannot be shared into another school'
);
select tests.clear_authentication();

select tests.authenticate_as('teacher_a_other');
select is((select count(*)::int from public.library_items where id = tests.id('item')), 1,
  'reviewed items shared with the school are visible to colleagues');
select tests.clear_authentication();

select tests.authenticate_as('teacher_b');
select is((select count(*)::int from public.library_items where id = tests.id('item')), 0,
  'school-shared items are not visible to other boards');
select tests.clear_authentication();

select tests.authenticate_as('teacher_a');
select throws_ok(
  $$insert into public.library_items (board_id, type, title, source, author_id, status)
    values (tests.id('board_a'), 'experiment', 'Volcan', 'teacher_created', tests.id('teacher_a'), 'draft');
    update public.library_items set status = 'teacher_reviewed' where title = 'Volcan'$$,
  '23514', null, 'an experiment cannot leave draft without safety notes'
);
select tests.clear_authentication();

-- Substitute hand-off: codes are never readable; absences are written only through functions
-- (publish_absence, tested in 10_substitute_plans) and visible to the right people.
select tests.authenticate_as('teacher_a');
select throws_ok($$select count(*) from public.sub_access_codes$$, '42501', null,
  'substitute codes are not readable through the API');
select throws_ok(
  $$insert into public.absences (teacher_id, school_id, starts_on, ends_on) values
    (tests.id('teacher_a'), tests.id('school_a1'), '2026-10-01', '2026-10-01')$$,
  '42501', null, 'a teacher cannot insert an absence directly'
);
select throws_ok(
  $$insert into public.absences (teacher_id, school_id, starts_on, ends_on) values
    (tests.id('teacher_a_other'), tests.id('school_a1'), '2026-10-01', '2026-10-01')$$,
  '42501', null, 'a teacher cannot record an absence for someone else'
);
select tests.clear_authentication();

insert into public.absences (teacher_id, school_id, starts_on, ends_on) values
  (tests.id('teacher_a'), tests.id('school_a1'), '2026-10-01', '2026-10-01');

select tests.authenticate_as('office_a');
select is((select count(*)::int from public.absences where teacher_id = tests.id('teacher_a')), 1,
  'office staff see absences in their school');
select tests.clear_authentication();

select tests.authenticate_as('teacher_a_other');
select is((select count(*)::int from public.absences where teacher_id = tests.id('teacher_a')), 0,
  'colleagues do not see each other''s absences');
select tests.clear_authentication();

-- Class mode: teachers run sessions; participants never come in through the teacher API.
select tests.authenticate_as('teacher_a');
select lives_ok(
  $$insert into public.class_sessions (id, class_id, join_code, expires_at)
    values (tests.remember('session', gen_random_uuid()), tests.id('class_a'), 'ABCD12', now() + interval '1 hour')$$,
  'a teacher can open a class-mode session'
);
select throws_ok(
  $$insert into public.session_participants (session_id, nickname) values (tests.id('session'), 'Les Castors')$$,
  '42501', null, 'participants cannot be added through the teacher API'
);
select throws_ok(
  $$insert into public.class_sessions (class_id, join_code, expires_at) values (tests.id('class_b'), 'ZZZZ99', now())$$,
  '42501', null, 'a teacher cannot open a session for another class'
);
select tests.clear_authentication();

select tests.authenticate_anon();
select throws_ok($$select count(*) from public.class_sessions$$, '42501', null,
  'anonymous users cannot read class sessions');
select tests.clear_authentication();

select * from finish();
rollback;
