-- Regression tests for the Phase 1 security review fixes
-- (supabase/migrations/20260928170000_security_review_fixes.sql).
begin;
\ir _helpers.psql
\ir _class_mode_helpers.psql
select plan(23);
select tests.build_fixture();

do $$
declare
  v_parent uuid := tests.create_user('parent_a');
begin
  insert into public.user_roles (user_id, role, board_id, school_id)
  values (v_parent, 'parent', tests.id('board_a'), tests.id('school_a1'));

  -- A reviewed, board-shared quiz with an answer key.
  insert into public.library_items (id, board_id, type, title, source, author_id, status, share_scope)
  values (tests.remember('quiz', gen_random_uuid()), tests.id('board_a'), 'quiz', 'Quiz', 'teacher_created',
          tests.id('teacher_a'), 'teacher_reviewed', 'board');
  insert into public.library_item_versions (id, item_id, content)
  values (tests.remember('quiz_v', gen_random_uuid()), tests.id('quiz'), '{"q": 1}');
  insert into public.library_item_answer_keys (version_id, answer_key) values (tests.id('quiz_v'), '{"a": 1}');

  -- A private draft by another teacher, and one owned by the (deactivated) former teacher.
  insert into public.library_items (id, board_id, type, title, source, author_id)
  values (tests.remember('private_draft', gen_random_uuid()), tests.id('board_a'), 'worksheet', 'Privé',
          'teacher_created', tests.id('teacher_a_other')),
         (tests.remember('former_draft', gen_random_uuid()), tests.id('board_a'), 'worksheet', 'Ancien',
          'teacher_created', tests.id('former_teacher'));

  -- A board-B-only subject and a room in school B1.
  insert into public.subjects (id, board_id, code, label_fr)
  values (tests.remember('subject_b', gen_random_uuid()), tests.id('board_b'), 'b_only', 'Matière B');
  insert into public.rooms (id, school_id, name) values (tests.remember('room_b', gen_random_uuid()), tests.id('school_b1'), 'B-101');

  -- Teacher A's personal language level, given to a student in class A.
  insert into public.language_levels (id, board_id, owner_user_id, code, label_fr)
  values (tests.remember('personal_level', gen_random_uuid()), tests.id('board_a'), tests.id('teacher_a'), 'perso', 'Perso');
end
$$;

select tests.authenticate_as('teacher_a');
update public.students set default_language_level_id = tests.id('personal_level') where id = tests.id('student_a1');
select tests.clear_authentication();

-- 1. Deactivated users cannot write their own rows.
select tests.authenticate_as('former_teacher');
select throws_ok(
  $$update public.library_items set status = 'teacher_reviewed', share_scope = 'board'
    where id = tests.id('former_draft')$$,
  '42501', null, 'a deactivated user cannot update library items (nobody can, directly)'
);
update public.users set display_name = 'Encore là' where id = tests.id('former_teacher');
select throws_ok(
  $$insert into public.library_items (board_id, type, title, source, author_id)
    values (tests.id('board_a'), 'worksheet', 'X', 'teacher_created', tests.id('former_teacher'))$$,
  '42501', null, 'a deactivated user cannot create library items'
);
select throws_ok(
  $$insert into public.absences (teacher_id, school_id, starts_on, ends_on)
    values (tests.id('former_teacher'), tests.id('school_a1'), '2026-10-01', '2026-10-01')$$,
  '42501', null, 'a deactivated user cannot record absences'
);
select tests.clear_authentication();
select is((select status::text from public.library_items where id = tests.id('former_draft')), 'draft',
  'a deactivated user cannot publish their old drafts');
select is((select display_name from public.users where id = tests.id('former_teacher')), 'former_teacher',
  'a deactivated user cannot edit their profile');

-- 2. Parents are not board members for the library or configuration.
select tests.authenticate_as('parent_a');
select is((select count(*)::int from public.library_items where id = tests.id('quiz')), 0,
  'a parent cannot read board-shared library items');
select is((select count(*)::int from public.library_item_answer_keys), 0, 'a parent cannot read answer keys');
select throws_ok(
  $$insert into public.tags (board_id, slug, label_fr) values (tests.id('board_a'), 'x', 'X')$$,
  '42501', null, 'a parent cannot create tags'
);
select throws_ok(
  $$insert into public.library_items (board_id, type, title, source, author_id)
    values (tests.id('board_a'), 'worksheet', 'X', 'teacher_created', tests.id('parent_a'))$$,
  '42501', null, 'a parent cannot create library items'
);
select tests.clear_authentication();

select tests.authenticate_as('teacher_a_other');
select is((select count(*)::int from public.library_item_answer_keys where version_id = tests.id('quiz_v')), 1,
  'teachers in the board can still read shared answer keys');
select tests.clear_authentication();

-- 3. Audit gaps.
select tests.authenticate_as('teacher_a');
select lives_ok(
  $$select public.save_student_alert(tests.id('student_a2'), 'allergy', 'v1:x', 1::smallint)$$,
  'alert recorded'
);
select lives_ok($$delete from public.students where id = tests.id('student_a2')$$,
  'a teacher deletes a student who has an alert');
select lives_ok(
  $$update public.class_teachers set role = 'homeroom'
    where class_id = tests.id('class_a') and user_id = tests.id('subject_teacher')$$,
  'a homeroom teacher changes a team member''s role'
);
select tests.clear_authentication();
select is((select count(*)::int from public.audit_log where action = 'student_alert.deleted' and entity_id = tests.id('student_a2')),
  1, 'alerts deleted with their student are audited');
select is((select count(*)::int from public.audit_log where action = 'class_teacher.role_changed' and entity_id = tests.id('class_a')),
  1, 'class-team role changes are audited');
update public.user_roles set role = 'vice_principal' where user_id = tests.id('office_a');
select is((select count(*)::int from public.audit_log where action = 'user_role.changed' and entity_id = tests.id('office_a')),
  1, 'role changes are audited');

-- 4. A co-teacher can edit a student who has another teacher's personal level.
select tests.authenticate_as('subject_teacher');
select lives_ok($$update public.students set active = false where id = tests.id('student_a1')$$,
  'a co-teacher can deactivate a student who has another teacher''s personal level');
select tests.clear_authentication();

-- 5. References must stay in scope.
select tests.authenticate_as('teacher_a');
select throws_ok($$update public.classes set room_id = tests.id('room_b') where id = tests.id('class_a')$$,
  '22023', null, 'a class cannot use a room from another school');
select throws_ok(
  $$insert into public.units (class_id, subject_id, title) values (tests.id('class_a'), tests.id('subject_b'), 'X')$$,
  '22023', null, 'a unit cannot use another board''s subject'
);
select throws_ok(
  $$insert into public.timetable_blocks (class_id, day_key, start_time, end_time, kind, subject_id)
    values (tests.id('class_a'), 2, '09:00', '09:30', 'subject', tests.id('subject_b'))$$,
  '22023', null, 'a timetable block cannot use another board''s subject'
);
select throws_ok(
  $$update public.unit_lessons set library_item_id = tests.id('private_draft') where id = tests.id('lesson_a1')$$,
  '42501', null, 'a lesson cannot link someone else''s private library item'
);

-- 6. "Created by" is set by the database. Since Phase 5, class sessions start only through
--    public.start_class_session (D-089), and no column of theirs is writable through the API.
select tests.clear_authentication();
select tests.build_library_fixture();
select tests.battle_quiz('battle', 'teacher_a');
select tests.authenticate_as('teacher_a');
select tests.remember('session', (select session_id from public.start_class_session(
  tests.id('class_a'), tests.id('battle'), null, 'solo')));
select tests.clear_authentication();
select is((select created_by from public.class_sessions where id = tests.id('session')), tests.id('teacher_a'),
  'class sessions record their real creator');

select tests.authenticate_as('teacher_a');
select throws_ok(
  $$insert into public.class_sessions (class_id, join_code, expires_at, created_by)
    values (tests.id('class_a'), 'ACDEFH', now() + interval '1 hour', tests.id('teacher_a_other'))$$,
  '42501', null, 'the creator of a class session cannot be set through the API'
);
select tests.clear_authentication();

select * from finish();
rollback;
