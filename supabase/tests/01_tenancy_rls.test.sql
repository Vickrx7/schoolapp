-- Who can see and change boards, schools, classes, students and people.
begin;
\ir _helpers.psql
select plan(58);
select tests.build_fixture();

-- ---------------------------------------------------------------------------------------
-- Visibility matrix: row counts each persona sees.
-- ---------------------------------------------------------------------------------------

create function tests.visible_counts()
returns table (boards int, schools int, classes int, students int, blocks int, units int)
language sql
as $$
  select
    (select count(*)::int from public.boards where id in (tests.id('board_a'), tests.id('board_b'))),
    (select count(*)::int from public.schools where board_id in (tests.id('board_a'), tests.id('board_b'))),
    (select count(*)::int from public.classes where school_id in (tests.id('school_a1'), tests.id('school_a2'), tests.id('school_b1'))),
    (select count(*)::int from public.students where class_id in (tests.id('class_a'), tests.id('class_a_other'), tests.id('class_b'))),
    (select count(*)::int from public.timetable_blocks where class_id in (tests.id('class_a'), tests.id('class_a_other'), tests.id('class_b'))),
    (select count(*)::int from public.units where class_id in (tests.id('class_a'), tests.id('class_a_other'), tests.id('class_b')));
$$;
grant execute on function tests.visible_counts() to authenticated;

select tests.authenticate_as('teacher_a');
select results_eq('select * from tests.visible_counts()', $$values (1, 1, 1, 2, 1, 1)$$,
  'teacher sees own board, school, class, 2 students, class schedule and units');
select tests.clear_authentication();

select tests.authenticate_as('subject_teacher');
select results_eq('select * from tests.visible_counts()', $$values (1, 1, 1, 2, 1, 1)$$,
  'a subject teacher on the class team sees that class like its homeroom teacher');
select tests.clear_authentication();

select tests.authenticate_as('teacher_a_other');
select results_eq('select * from tests.visible_counts()', $$values (1, 1, 1, 1, 1, 0)$$,
  'another teacher in the same school sees only their own class');
select tests.clear_authentication();

select tests.authenticate_as('principal_a');
select results_eq('select * from tests.visible_counts()', $$values (1, 1, 2, 3, 2, 0)$$,
  'principal sees all classes, rosters and schedules of their school, but no planning');
select tests.clear_authentication();

select tests.authenticate_as('office_a');
select results_eq('select * from tests.visible_counts()', $$values (1, 1, 2, 0, 2, 0)$$,
  'office admin sees classes and schedules, but no rosters or planning');
select tests.clear_authentication();

select tests.authenticate_as('principal_a2');
select results_eq('select * from tests.visible_counts()', $$values (1, 1, 0, 0, 0, 0)$$,
  'principal of another school in the same board sees none of school A1''s classes');
select tests.clear_authentication();

select tests.authenticate_as('board_admin_a');
select results_eq('select * from tests.visible_counts()', $$values (1, 2, 0, 0, 0, 0)$$,
  'board admin sees board configuration and schools, but no classes or students');
select tests.clear_authentication();

select tests.authenticate_as('teacher_b');
select results_eq('select * from tests.visible_counts()', $$values (1, 1, 1, 1, 1, 1)$$,
  'teacher in another board sees only their own board''s data');
select tests.clear_authentication();

select tests.authenticate_as('former_teacher');
select results_eq('select * from tests.visible_counts()', $$values (0, 0, 0, 0, 0, 0)$$,
  'a deactivated user sees nothing, even with roles and class assignments');
select tests.clear_authentication();

select tests.authenticate_as('outsider');
select results_eq('select * from tests.visible_counts()', $$values (0, 0, 0, 0, 0, 0)$$,
  'a signed-in user without roles sees nothing');
select tests.clear_authentication();

-- Anonymous (logged-out) requests are refused outright.
select tests.authenticate_anon();
select throws_ok('select count(*) from public.boards', '42501', null, 'anon cannot read boards');
select throws_ok('select count(*) from public.schools', '42501', null, 'anon cannot read schools');
select throws_ok('select count(*) from public.classes', '42501', null, 'anon cannot read classes');
select throws_ok('select count(*) from public.students', '42501', null, 'anon cannot read students');
select throws_ok('select count(*) from public.users', '42501', null, 'anon cannot read users');
select throws_ok($$select public.create_class(tests.id('school_a1'), tests.id('year_a'), 'X', array['3'])$$,
  '42501', null, 'anon cannot call create_class');
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- Students
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select lives_ok(
  $$insert into public.students (class_id, first_name) values (tests.id('class_a'), '  Marie   Ève ')$$,
  'teacher can add a student to their class'
);
select throws_ok(
  $$insert into public.students (class_id, first_name) values (tests.id('class_b'), 'Intrus')$$,
  '42501', null, 'teacher cannot add a student to another board''s class'
);
select throws_ok(
  $$insert into public.students (class_id, first_name) values (tests.id('class_a_other'), 'Intrus')$$,
  '42501', null, 'teacher cannot add a student to a colleague''s class'
);
select throws_ok(
  $$insert into public.students (class_id, first_name, created_by) values (tests.id('class_a'), 'X', tests.id('teacher_a'))$$,
  '42501', null, 'teacher cannot set columns outside the allowed list'
);
update public.students set first_name = 'Pirate' where id = tests.id('student_b');
update public.students set first_name = 'Pirate' where id = tests.id('student_a_other');
delete from public.students where id = tests.id('student_a_other');
select tests.clear_authentication();

select is((select first_name from public.students where class_id = tests.id('class_a') and first_name like 'Marie%'),
  'Marie Ève', 'student names are trimmed and whitespace-collapsed');
select is((select first_name from public.students where id = tests.id('student_b')), 'Adam',
  'teacher cannot rename another board''s student');
select is((select first_name from public.students where id = tests.id('student_a_other')), 'Zoé',
  'teacher cannot rename or delete a colleague''s student');

select tests.authenticate_as('principal_a');
select throws_ok(
  $$insert into public.students (class_id, first_name) values (tests.id('class_a'), 'X')$$,
  '42501', null, 'principal cannot add students (read-only oversight)'
);
select tests.clear_authentication();

do $$
begin
  perform tests.remember('level_a', (select id from public.language_levels where board_id = tests.id('board_a') and code = 'debutant'));
  perform tests.remember('level_b', (select id from public.language_levels where board_id = tests.id('board_b') and code = 'debutant'));
end
$$;
select tests.authenticate_as('teacher_a');
select throws_ok(
  $$insert into public.students (class_id, first_name, default_language_level_id)
    values (tests.id('class_a'), 'Y', tests.id('level_b'))$$,
  '22023', null, 'a student cannot get a language level from another board'
);
select lives_ok(
  $$insert into public.students (class_id, first_name, default_language_level_id)
    values (tests.id('class_a'), 'Y', tests.id('level_a'))$$,
  'a student can get one of the board''s language levels'
);
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- Classes: creation, update, deletion
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select lives_ok(
  $$select tests.remember('new_class', public.create_class(tests.id('school_a1'), tests.id('year_a'), '4e année', array['4', '4']))$$,
  'teacher can create a class in their school'
);
select is((select role::text from public.class_teachers where class_id = tests.id('new_class') and user_id = tests.id('teacher_a')),
  'homeroom', 'the creator becomes homeroom teacher');
select is((select count(*)::int from public.class_grades where class_id = tests.id('new_class')), 1,
  'duplicate grades are collapsed');
select throws_ok(
  $$select public.create_class(tests.id('school_b1'), tests.id('year_b'), 'X', array['3'])$$,
  '42501', null, 'teacher cannot create a class in another school'
);
select throws_ok(
  $$select public.create_class(tests.id('school_a1'), tests.id('year_b'), 'X', array['3'])$$,
  '22023', null, 'the school year must belong to the school''s board'
);
select throws_ok(
  $$select public.create_class(tests.id('school_a1'), tests.id('year_a'), 'X', array[]::text[])$$,
  '22023', null, 'a class needs at least one grade'
);
select tests.clear_authentication();

select is((select count(*)::int from public.event_outbox where event_type = 'class.created' and aggregate_id = tests.id('new_class')),
  1, 'creating a class emits class.created');

select tests.authenticate_as('principal_a');
select throws_ok(
  $$select public.create_class(tests.id('school_a1'), tests.id('year_a'), 'X', array['3'])$$,
  '42501', null, 'principal cannot create classes'
);
select tests.clear_authentication();

select tests.authenticate_as('subject_teacher');
delete from public.classes where id = tests.id('class_a');
select tests.clear_authentication();
select is((select count(*)::int from public.classes where id = tests.id('class_a')), 1,
  'a subject teacher cannot delete the class');

select tests.authenticate_as('teacher_a');
update public.classes set name = 'Classe A renommée' where id = tests.id('class_a');
select throws_ok(
  $$update public.classes set school_id = tests.id('school_b1') where id = tests.id('class_a')$$,
  '42501', null, 'a class cannot be moved to another school'
);
select lives_ok($$delete from public.classes where id = tests.id('new_class')$$,
  'homeroom teacher can delete their class');
select tests.clear_authentication();

select is((select name from public.classes where id = tests.id('class_a')), 'Classe A renommée',
  'teacher can rename their class');
select is((select count(*)::int from public.class_grades where class_id = tests.id('new_class')), 0,
  'deleting a class removes its data');
select is((select count(*)::int from public.audit_log where action = 'class.deleted' and entity_id = tests.id('new_class')),
  1, 'deleting a class is audited');

-- ---------------------------------------------------------------------------------------
-- Class teams
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select lives_ok(
  $$insert into public.class_teachers (class_id, user_id, role) values (tests.id('class_a'), tests.id('teacher_a_other'), 'support')$$,
  'homeroom teacher can add a colleague from the same school'
);
select throws_ok(
  $$insert into public.class_teachers (class_id, user_id, role) values (tests.id('class_a'), tests.id('teacher_b'), 'subject')$$,
  '42501', null, 'homeroom teacher cannot add a teacher from another school'
);
select throws_ok(
  $$insert into public.class_teachers (class_id, user_id, role) values (tests.id('class_a'), tests.id('principal_a'), 'subject')$$,
  '42501', null, 'only people with a teacher role can join a class team'
);
select throws_ok(
  $$delete from public.class_teachers where class_id = tests.id('class_a') and user_id = tests.id('teacher_a')$$,
  '23514', null, 'the last homeroom teacher cannot leave the class'
);
select tests.clear_authentication();

select tests.authenticate_as('subject_teacher');
select throws_ok(
  $$insert into public.class_teachers (class_id, user_id, role) values (tests.id('class_a'), tests.id('office_a'), 'support')$$,
  '42501', null, 'a subject teacher cannot change the class team'
);
select lives_ok(
  $$delete from public.class_teachers where class_id = tests.id('class_a') and user_id = tests.id('subject_teacher')$$,
  'anyone can leave a class team'
);
select tests.clear_authentication();

select is((select count(*)::int from public.audit_log where action in ('class_teacher.added', 'class_teacher.removed')
  and entity_id = tests.id('class_a') and actor_user_id is not null), 2, 'class team changes are audited');

-- ---------------------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select is((select count(*)::int from public.users where id in (
    tests.id('teacher_a'), tests.id('teacher_a_other'), tests.id('subject_teacher'), tests.id('principal_a'),
    tests.id('office_a'), tests.id('former_teacher'), tests.id('teacher_b'), tests.id('principal_a2'), tests.id('outsider'))),
  6, 'teacher sees colleagues from their school only');
select lives_ok($$update public.users set display_name = 'Isabelle T.' where id = tests.id('teacher_a')$$,
  'a user can update their own display name');
select throws_ok($$update public.users set email = 'x@y.z' where id = tests.id('teacher_a')$$,
  '42501', null, 'a user cannot change their email through the API');
update public.users set display_name = 'Pirate' where id = tests.id('teacher_a_other');
select throws_ok(
  $$insert into public.user_roles (user_id, role, board_id, school_id) values (tests.id('teacher_a'), 'principal', tests.id('board_a'), tests.id('school_a1'))$$,
  '42501', null, 'a user cannot grant themselves a role'
);
select tests.clear_authentication();

select is((select display_name from public.users where id = tests.id('teacher_a_other')), 'teacher_a_other',
  'a user cannot change someone else''s profile');
select is((select count(*)::int from public.audit_log where action = 'user_role.granted' and entity_id = tests.id('teacher_a')),
  1, 'role grants are audited');

-- ---------------------------------------------------------------------------------------
-- School settings
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
update public.schools set student_alerts_enabled = false where id = tests.id('school_a1');
select tests.clear_authentication();
select ok((select student_alerts_enabled from public.schools where id = tests.id('school_a1')),
  'a teacher cannot change school settings');

select tests.authenticate_as('principal_a');
select lives_ok($$update public.schools set student_alerts_enabled = false where id = tests.id('school_a1')$$,
  'the principal can change school settings');
select throws_ok($$update public.schools set timezone = 'Mars/Olympus' where id = tests.id('school_a1')$$,
  '22023', null, 'the time zone must be a real IANA zone');
select tests.clear_authentication();

select is((select count(*)::int from public.audit_log where action = 'school.student_alerts_disabled' and school_id = tests.id('school_a1')),
  1, 'turning alerts off is audited');

select tests.authenticate_as('board_admin_a');
select lives_ok($$update public.schools set schedule_type = 'cycle', cycle_length = 6 where id = tests.id('school_a2')$$,
  'board admin can configure a school''s schedule type');
select tests.clear_authentication();

select * from finish();
rollback;
