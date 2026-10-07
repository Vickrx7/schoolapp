-- Review C fixes (supabase/migrations/20270201090100_review_c_fixes.sql): a plan whose refresh
-- gave up is woken again; a past school year's end cannot move later through the API; the
-- feedback name check is limited per person.
begin;
\ir _helpers.psql
select plan(9);
select tests.build_fixture();

-- ---------------------------------------------------------------------------------------
-- 1. The stale-plan sweep
-- ---------------------------------------------------------------------------------------

insert into public.absences (id, teacher_id, school_id, starts_on, ends_on, status, published_at,
  sources_changed_at)
values
  (tests.remember('abs_stuck', gen_random_uuid()), tests.id('teacher_a'), tests.id('school_a1'),
   app.school_local_today(tests.id('school_a1')) + 1, app.school_local_today(tests.id('school_a1')) + 1,
   'published', now(), now() - interval '2 hours'),
  (tests.remember('abs_fresh', gen_random_uuid()), tests.id('teacher_a'), tests.id('school_a1'),
   app.school_local_today(tests.id('school_a1')) + 2, app.school_local_today(tests.id('school_a1')) + 2,
   'published', now(), now() - interval '5 minutes'),
  (tests.remember('abs_over', gen_random_uuid()), tests.id('teacher_a'), tests.id('school_a1'),
   app.school_local_today(tests.id('school_a1')) - 3, app.school_local_today(tests.id('school_a1')) - 3,
   'published', now(), now() - interval '2 hours');
delete from public.event_outbox;

select is(app.sweep_stale_absences(), 1,
  'an absence still marked after 30 minutes, not over, wakes the worker again');
select ok(
  exists (select 1 from public.event_outbox where event_type = 'absence.sources_changed'
          and aggregate_id = tests.id('abs_stuck'))
  and not exists (select 1 from public.event_outbox where aggregate_id in
          (tests.id('abs_fresh'), tests.id('abs_over'))),
  'neither a fresh mark nor an absence that is over');
select is(app.sweep_stale_absences(), 0, 'at most once an hour per absence');

select tests.authenticate_as('teacher_a');
select is(tests.error_of($$select app.sweep_stale_absences()$$), '42501', 'the worker''s only');
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- 2. A past school year's end (D-105)
-- ---------------------------------------------------------------------------------------

insert into public.school_years (id, board_id, name, starts_on, ends_on)
values (tests.remember('year_old', gen_random_uuid()), tests.id('board_a'), '2023-2024',
  '2023-09-01', '2024-06-28');

select tests.authenticate_as('board_admin_a');
select is(
  tests.error_of($$update public.school_years set ends_on = '2024-08-30'
                   where id = tests.id('year_old')$$),
  '42501', 'a board admin cannot move a past year''s end later (it would delay the purge)');
select lives_ok(
  $$update public.school_years set ends_on = '2024-06-21' where id = tests.id('year_old')$$,
  'earlier is fine');
select is(
  tests.error_of($$insert into public.school_years (board_id, name, starts_on, ends_on)
                   values (tests.id('board_a'), 'Long', '2030-09-01', '2032-06-30')$$),
  '23514', 'a year lasts at most 400 days');
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- 3. The feedback name check, 20 a day per person (D-116)
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('office_a');
select lives_ok(
  $$select count(*) from generate_series(1, 20) g,
      lateral (select * from public.feedback_student_names('Léa ' || g)) n$$,
  'twenty checks in a day');
select is(tests.error_of($$select * from public.feedback_student_names('Léa')$$), '54000',
  'the twenty-first is refused');
select tests.clear_authentication();

select * from finish();
rollback;
