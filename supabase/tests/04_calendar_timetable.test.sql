-- Timetable blocks and calendar events: scopes and validation.
begin;
\ir _helpers.psql
select plan(19);
select tests.build_fixture();

do $$
begin
  perform tests.remember('fra', (select id from public.subjects where code = 'fra' and board_id is null));
  insert into public.school_calendar_events (id, board_id, school_id, event_type, title, starts_on, ends_on)
  values
    (tests.remember('event_board_a', gen_random_uuid()), tests.id('board_a'), null, 'pa_day', 'PA day A', '2026-10-09', '2026-10-09'),
    (tests.remember('event_school_a1', gen_random_uuid()), tests.id('board_a'), tests.id('school_a1'), 'mass', 'Mass A1', '2026-10-08', '2026-10-08'),
    (tests.remember('event_board_b', gen_random_uuid()), tests.id('board_b'), null, 'pa_day', 'PA day B', '2026-10-09', '2026-10-09');
end
$$;

create function tests.visible_events()
returns text[]
language sql
as $$
  select coalesce(array_agg(title order by title), '{}') from public.school_calendar_events
  where id in (tests.id('event_board_a'), tests.id('event_school_a1'), tests.id('event_board_b'));
$$;
grant execute on function tests.visible_events() to authenticated;

select tests.authenticate_as('teacher_a');
select is(tests.visible_events(), array['Mass A1', 'PA day A'], 'teacher sees board-wide and own-school events');
select tests.clear_authentication();

select tests.authenticate_as('principal_a2');
select is(tests.visible_events(), array['PA day A'], 'another school''s staff sees only board-wide events');
select tests.clear_authentication();

select tests.authenticate_as('teacher_b');
select is(tests.visible_events(), array['PA day B'], 'another board sees none of board A''s events');
select tests.clear_authentication();

-- Writing events depends on scope.
select tests.authenticate_as('teacher_a');
select throws_ok(
  $$insert into public.school_calendar_events (board_id, school_id, event_type, title, starts_on, ends_on)
    values (tests.id('board_a'), null, 'pa_day', 'X', '2026-11-01', '2026-11-01')$$,
  '42501', null, 'a teacher cannot add a board-wide event'
);
select throws_ok(
  $$insert into public.school_calendar_events (board_id, school_id, event_type, title, starts_on, ends_on)
    values (tests.id('board_a'), tests.id('school_a1'), 'assembly', 'X', '2026-11-01', '2026-11-01')$$,
  '42501', null, 'a teacher cannot add a school-wide event'
);
select lives_ok(
  $$insert into public.school_calendar_events (board_id, school_id, class_id, event_type, title, starts_on, ends_on)
    values (tests.id('board_a'), tests.id('school_a1'), tests.id('class_a'), 'field_trip', 'Sortie', '2026-11-01', '2026-11-01')$$,
  'a teacher can add an event for their own class'
);
select throws_ok(
  $$insert into public.school_calendar_events (board_id, school_id, class_id, event_type, title, starts_on, ends_on)
    values (tests.id('board_a'), tests.id('school_a1'), tests.id('class_a_other'), 'field_trip', 'X', '2026-11-01', '2026-11-01')$$,
  '42501', null, 'a teacher cannot add an event for a colleague''s class'
);
select tests.clear_authentication();

select tests.authenticate_as('office_a');
select lives_ok(
  $$insert into public.school_calendar_events (board_id, school_id, event_type, title, starts_on, ends_on, start_time)
    values (tests.id('board_a'), tests.id('school_a1'), 'early_dismissal', 'Départ hâtif', '2026-11-19', '2026-11-19', '13:35')$$,
  'office staff can add school-wide events'
);
select tests.clear_authentication();

select tests.authenticate_as('board_admin_a');
select lives_ok(
  $$insert into public.school_calendar_events (board_id, school_id, event_type, title, starts_on, ends_on)
    values (tests.id('board_a'), null, 'holiday', 'Congé', '2026-12-21', '2027-01-01')$$,
  'a board admin can add board-wide events'
);
select tests.clear_authentication();

select throws_ok(
  $$insert into public.school_calendar_events (board_id, school_id, event_type, title, starts_on, ends_on)
    values (tests.id('board_a'), tests.id('school_b1'), 'mass', 'X', '2026-10-01', '2026-10-01')$$,
  '23503', null, 'an event''s school must belong to its board'
);

-- Timetable blocks.
select tests.authenticate_as('teacher_a');
select lives_ok(
  $$insert into public.timetable_blocks (class_id, day_key, start_time, end_time, kind, subject_id)
    values (tests.id('class_a'), 2, '09:00', '09:50', 'subject', tests.id('fra'))$$,
  'the teacher can add a block to their class timetable'
);
select throws_ok(
  $$insert into public.timetable_blocks (class_id, day_key, start_time, end_time, kind, subject_id)
    values (tests.id('class_a'), 6, '09:00', '09:50', 'subject', tests.id('fra'))$$,
  '22023', null, 'a weekly school has no day 6'
);
select throws_ok(
  $$insert into public.timetable_blocks (class_id, day_key, start_time, end_time, kind, teacher_id)
    values (tests.id('class_a'), 1, '10:00', '10:30', 'routine', tests.id('teacher_a_other'))$$,
  '22023', null, 'a block''s teacher must be on the class team'
);
select throws_ok(
  $$insert into public.timetable_blocks (class_id, day_key, start_time, end_time, kind)
    values (tests.id('class_a'), 1, '10:00', '09:30', 'recess')$$,
  '23514', null, 'a block must end after it starts'
);
select throws_ok(
  $$insert into public.timetable_blocks (class_id, day_key, start_time, end_time, kind)
    values (tests.id('class_a'), 1, '10:00', '10:30', 'subject')$$,
  '23514', null, 'a subject block needs a subject'
);
select tests.clear_authentication();

select tests.authenticate_as('office_a');
select throws_ok(
  $$insert into public.timetable_blocks (class_id, day_key, start_time, end_time, kind)
    values (tests.id('class_a'), 1, '10:00', '10:30', 'recess')$$,
  '42501', null, 'office staff can read but not edit class timetables'
);
select tests.clear_authentication();

-- Cycle schools.
update public.schools set schedule_type = 'cycle', cycle_length = 6 where id = tests.id('school_a1');
select tests.authenticate_as('teacher_a');
select lives_ok(
  $$insert into public.timetable_blocks (class_id, day_key, start_time, end_time, kind)
    values (tests.id('class_a'), 6, '10:00', '10:30', 'recess')$$,
  'a six-day cycle school has a day 6'
);
select throws_ok(
  $$insert into public.school_cycle_anchors (school_id, anchor_date, cycle_day) values (tests.id('school_a1'), '2026-09-02', 1)$$,
  '42501', null, 'teachers cannot reset the rotation'
);
select tests.clear_authentication();

select tests.authenticate_as('office_a');
select lives_ok(
  $$insert into public.school_cycle_anchors (school_id, anchor_date, cycle_day) values (tests.id('school_a1'), '2026-09-02', 1)$$,
  'office staff can set the rotation anchor'
);
select tests.clear_authentication();

select * from finish();
rollback;
