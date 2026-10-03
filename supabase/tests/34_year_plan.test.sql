-- « Mon année », slice S1 (supabase/migrations/20270111090000_year_plan.sql): report periods,
-- a unit's planned window, unit-level attentes, save_unit_plan and start_unit, plans rebuilt
-- only for what they read, and the student purge keeping the planning.
-- DECISIONS: D-047 (amended), D-105, D-123, D-124.
-- The new tables' owner assertions (row level security, nothing for anon, the grants) live here
-- rather than in 00_schema_invariants, so this file has one owner.
begin;
\ir _helpers.psql
select plan(81);
select tests.build_fixture();
select tests.build_library_fixture();

-- A class's planning is the class team's: helpers for the checks below, as the owner.
create function tests.window_of(p_unit uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  select coalesce(u.planned_start_on::text, '-') || ' ' || coalesce(u.planned_end_on::text, '-')
  from public.units u where u.id = p_unit;
$$;

create function tests.unit_attentes(p_unit uuid)
returns integer
language sql
security definer
set search_path = ''
as $$
  select count(*)::integer from public.unit_expectations ue where ue.unit_id = p_unit;
$$;

grant execute on function tests.window_of(uuid), tests.unit_attentes(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------
-- report_periods (D-124): the board's staff read them, its admins write them
-- ---------------------------------------------------------------------------------------

select ok(
  (select c.relrowsecurity from pg_class c where c.oid = 'public.report_periods'::regclass)
  and (select c.relrowsecurity from pg_class c where c.oid = 'public.unit_expectations'::regclass),
  'report_periods and unit_expectations have row level security'
);

select is_empty(
  $$select t.tbl, p.priv
    from unnest(array['public.report_periods', 'public.unit_expectations']) t (tbl)
    cross join unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references',
      'trigger']) p (priv)
    where has_table_privilege('anon', t.tbl, p.priv)
      or (p.priv in ('select', 'insert', 'update', 'references')
        and has_any_column_privilege('anon', t.tbl, p.priv))$$,
  'anon has no privilege on report_periods or unit_expectations'
);

select results_eq(
  $$select a.attname::text collate "default",
      has_column_privilege('authenticated', 'public.report_periods', a.attname, 'insert'),
      has_column_privilege('authenticated', 'public.report_periods', a.attname, 'update')
    from pg_attribute a
    where a.attrelid = 'public.report_periods'::regclass and a.attnum > 0 and not a.attisdropped
    order by a.attnum$$,
  $$values ('id', false, false), ('school_year_id', true, false), ('kind', true, false),
    ('starts_on', true, true), ('ends_on', true, true), ('due_on', true, true),
    ('issued_on', true, true), ('created_at', false, false), ('updated_at', false, false)$$,
  'report periods: insert on the period''s columns, update on its dates only'
);

select ok(
  has_table_privilege('authenticated', 'public.report_periods', 'select')
  and has_table_privilege('authenticated', 'public.report_periods', 'delete')
  and not has_table_privilege('authenticated', 'public.report_periods', 'truncate'),
  'authenticated selects and deletes report periods (row level security decides which)'
);

select tests.authenticate_as('board_admin_a');
select lives_ok(
  $$insert into public.report_periods (school_year_id, kind, starts_on, ends_on, due_on, issued_on)
    values (tests.id('year_a'), 'progress', '2026-09-01', '2026-10-30', '2026-11-06', '2026-11-13')$$,
  'a board admin adds a report period to a school year of the board'
);
select results_eq(
  $$update public.report_periods set ends_on = '2026-10-31', issued_on = null
    where school_year_id = tests.id('year_a') and kind = 'progress'
    returning ends_on, issued_on$$,
  $$values ('2026-10-31'::date, null::date)$$,
  'and changes its dates'
);
select throws_ok(
  $$insert into public.report_periods (school_year_id, kind, starts_on, ends_on)
    values (tests.id('year_a'), 'term1', '2026-08-25', '2027-01-29')$$,
  'LXY03', null, 'a window that starts before the school year is refused (LXY03)'
);
select throws_ok(
  $$update public.report_periods set ends_on = '2027-07-15'
    where school_year_id = tests.id('year_a') and kind = 'progress'$$,
  'LXY03', null, 'and so is one that ends after it'
);
select throws_ok(
  $$insert into public.report_periods (school_year_id, kind, starts_on, ends_on)
    values (tests.id('year_a'), 'term1', '2027-01-29', '2026-09-01')$$,
  '23514', null, 'a window that ends before it starts is refused'
);
select throws_ok(
  $$insert into public.report_periods (school_year_id, kind, starts_on, ends_on, due_on)
    values (tests.id('year_a'), 'term1', '2026-09-01', '2027-01-29', '2026-08-31')$$,
  '23514', null, 'so is a « saisie » date before the window'
);
select throws_ok(
  $$insert into public.report_periods (school_year_id, kind, starts_on, ends_on)
    values (tests.id('year_a'), 'progress', '2026-09-01', '2026-10-30')$$,
  '23505', null, 'a year has one period of each kind'
);
select throws_ok(
  $$insert into public.report_periods (school_year_id, kind, starts_on, ends_on)
    values (tests.id('year_a'), 'term3', '2026-09-01', '2026-10-30')$$,
  '23514', null, 'and only the three Ontario kinds'
);
select throws_ok(
  $$insert into public.report_periods (school_year_id, kind, starts_on, ends_on)
    values (tests.id('year_b'), 'progress', '2026-09-01', '2026-10-30')$$,
  '42501', null, 'a board admin cannot add a period to another board''s year'
);
select lives_ok(
  $$insert into public.report_periods (school_year_id, kind, starts_on, ends_on)
    values (tests.id('year_a'), 'term1', '2026-09-01', '2027-01-29'),
           (tests.id('year_a'), 'term2', '2027-02-01', '2027-06-11')$$,
  'the two terms'
);
select tests.clear_authentication();

select tests.authenticate_as('teacher_a');
select is((select count(*)::int from public.report_periods), 3, 'a teacher of the board reads its periods');
select throws_ok(
  $$insert into public.report_periods (school_year_id, kind, starts_on, ends_on)
    values (tests.id('year_b'), 'progress', '2026-09-01', '2026-10-30')$$,
  '42501', null, 'a teacher cannot add a report period'
);
select is_empty(
  $$update public.report_periods set due_on = '2026-11-20' returning id$$,
  'nor change one'
);
select is_empty($$delete from public.report_periods returning id$$, 'nor delete one');
select tests.clear_authentication();

select tests.authenticate_as('principal_a');
select is((select count(*)::int from public.report_periods), 3, 'the principal reads them');
select tests.clear_authentication();
select tests.authenticate_as('office_a');
select is((select count(*)::int from public.report_periods), 3, 'office staff read them');
select tests.clear_authentication();
select tests.authenticate_as('teacher_b');
select is((select count(*)::int from public.report_periods), 0, 'another board''s staff read none');
select tests.clear_authentication();

select tests.authenticate_as('board_admin_a');
select results_eq(
  $$delete from public.report_periods
    where school_year_id = tests.id('year_a') and kind = 'term2' returning kind$$,
  $$values ('term2')$$,
  'a board admin deletes a period'
);
select tests.clear_authentication();

-- A year without classes, deleted with its periods (as the owner).
insert into public.school_years (id, board_id, name, starts_on, ends_on)
values (tests.remember('year_c', gen_random_uuid()), tests.id('board_a'), '2027-2028',
  '2027-09-01', '2028-06-28');
insert into public.report_periods (school_year_id, kind, starts_on, ends_on)
values (tests.id('year_c'), 'progress', '2027-09-01', '2027-10-29');
update public.school_years set starts_on = '2027-09-07' where id = tests.id('year_c');
select is(
  (select count(*)::int from public.report_periods where school_year_id = tests.id('year_c')), 1,
  'editing a year''s dates later is not blocked by its periods'
);
delete from public.school_years where id = tests.id('year_c');
select is(
  (select count(*)::int from public.report_periods where school_year_id = tests.id('year_c')), 0,
  'periods go with their school year'
);

-- ---------------------------------------------------------------------------------------
-- A unit's planned window (D-123)
-- ---------------------------------------------------------------------------------------

select ok(
  has_column_privilege('authenticated', 'public.units', 'planned_start_on', 'insert')
  and has_column_privilege('authenticated', 'public.units', 'planned_end_on', 'insert')
  and has_column_privilege('authenticated', 'public.units', 'planned_start_on', 'update')
  and has_column_privilege('authenticated', 'public.units', 'planned_end_on', 'update'),
  'the class team may set a unit''s window'
);

select tests.authenticate_as('teacher_a');
select throws_ok(
  $$update public.units set planned_start_on = '2026-10-05' where id = tests.id('unit_a')$$,
  '23514', null, 'a window has both dates'
);
select throws_ok(
  $$update public.units set planned_start_on = '2026-10-16', planned_end_on = '2026-10-05'
    where id = tests.id('unit_a')$$,
  '23514', null, 'and does not end before it starts'
);
select throws_ok(
  $$update public.units set planned_start_on = '2026-08-24', planned_end_on = '2026-09-25'
    where id = tests.id('unit_a')$$,
  'LXY01', null, 'a window starting before the class''s school year is refused (LXY01)'
);
select throws_ok(
  $$update public.units set planned_start_on = '2027-06-14', planned_end_on = '2027-07-09'
    where id = tests.id('unit_a')$$,
  'LXY01', null, 'and one ending after it'
);
select results_eq(
  $$update public.units set planned_start_on = '2026-09-01', planned_end_on = '2026-10-16'
    where id = tests.id('unit_a') returning planned_start_on, planned_end_on$$,
  $$values ('2026-09-01'::date, '2026-10-16'::date)$$,
  'a window inside the year, its first day included, is saved'
);
select tests.clear_authentication();

-- A year shortened afterwards does not block other changes to the unit.
update public.school_years set starts_on = '2026-09-02' where id = tests.id('year_a');
select tests.authenticate_as('teacher_a');
select lives_ok(
  $$update public.units set title = 'Unit A' where id = tests.id('unit_a')$$,
  'a window left outside a year edited later does not block other changes'
);
select tests.clear_authentication();
update public.school_years set starts_on = '2026-09-01' where id = tests.id('year_a');

select tests.authenticate_as('principal_a');
select is_empty(
  $$update public.units set planned_start_on = '2026-11-02', planned_end_on = '2026-11-27'
    where id = tests.id('unit_a') returning id$$,
  'the principal changes no unit''s window'
);
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- unit_expectations: the class team only, of the unit's subject and grades
-- ---------------------------------------------------------------------------------------

select ok(
  has_table_privilege('authenticated', 'public.unit_expectations', 'select')
  and has_table_privilege('authenticated', 'public.unit_expectations', 'insert')
  and has_table_privilege('authenticated', 'public.unit_expectations', 'delete')
  and not has_table_privilege('authenticated', 'public.unit_expectations', 'update')
  and not has_any_column_privilege('authenticated', 'public.unit_expectations', 'update'),
  'authenticated selects, inserts and deletes unit attentes, never updates them'
);
select ok(
  exists (select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'unit_expectations'
      and indexname = 'unit_expectations_expectation_id_idx'
      and indexdef like '%(expectation_id)'),
  'the attente of a unit link is indexed'
);

select tests.authenticate_as('teacher_a');
select lives_ok(
  $$insert into public.unit_expectations (unit_id, expectation_id)
    values (tests.id('unit_a'), tests.id('exp_a'))$$,
  'the homeroom teacher links an attente to a unit'
);
select throws_ok(
  $$insert into public.unit_expectations (unit_id, expectation_id)
    values (tests.id('unit_a'), tests.id('exp_other'))$$,
  'LXY02', null, 'an attente of another subject and grade is refused (LXY02)'
);
select throws_ok(
  $$update public.units set subject_id = (select id from public.subjects
      where code = 'mat' and board_id is null)
    where id = tests.id('unit_a')$$,
  'LXY02', null, 'a unit with attentes keeps its subject (LXY02)'
);
select tests.clear_authentication();

select tests.authenticate_as('subject_teacher');
select is(
  (select count(*)::int from public.unit_expectations where unit_id = tests.id('unit_a')), 1,
  'the subject teacher of the class sees them'
);
select results_eq(
  $$delete from public.unit_expectations where unit_id = tests.id('unit_a') returning expectation_id$$,
  $$select tests.id('exp_a')$$,
  'and may remove one'
);
select lives_ok(
  $$insert into public.unit_expectations (unit_id, expectation_id)
    values (tests.id('unit_a'), tests.id('exp_a'))$$,
  'or add it back'
);
select tests.clear_authentication();

select tests.authenticate_as('principal_a');
select is((select count(*)::int from public.unit_expectations), 0, 'the principal sees no unit attentes');
select throws_ok(
  $$insert into public.unit_expectations (unit_id, expectation_id)
    values (tests.id('unit_a'), tests.id('exp_a_parent'))$$,
  '42501', null, 'nor adds one'
);
select tests.clear_authentication();
select tests.authenticate_as('office_a');
select is((select count(*)::int from public.unit_expectations), 0, 'office staff see none');
select throws_ok(
  $$insert into public.unit_expectations (unit_id, expectation_id)
    values (tests.id('unit_a'), tests.id('exp_a_parent'))$$,
  '42501', null, 'nor add one'
);
select tests.clear_authentication();
select tests.authenticate_as('board_admin_a');
select is((select count(*)::int from public.unit_expectations), 0, 'a board admin sees none');
select throws_ok(
  $$insert into public.unit_expectations (unit_id, expectation_id)
    values (tests.id('unit_a'), tests.id('exp_a_parent'))$$,
  '42501', null, 'nor adds one'
);
select tests.clear_authentication();
select tests.authenticate_as('teacher_b');
select is((select count(*)::int from public.unit_expectations), 0, 'another board''s teacher sees none');
select throws_ok(
  $$insert into public.unit_expectations (unit_id, expectation_id)
    values (tests.id('unit_a'), tests.id('exp_other'))$$,
  '42501', null, 'and learns nothing about the unit: refused by row level security'
);
select tests.clear_authentication();

-- former_teacher's access was removed; give them the class to show the team is not enough.
insert into public.class_teachers (class_id, user_id, role)
values (tests.id('class_a'), tests.id('former_teacher'), 'subject');
select tests.authenticate_as('former_teacher');
select is((select count(*)::int from public.unit_expectations), 0,
  'someone whose access was removed sees none, even on the class team');
select throws_ok(
  $$insert into public.unit_expectations (unit_id, expectation_id)
    values (tests.id('unit_a'), tests.id('exp_a_parent'))$$,
  '42501', null, 'nor adds one'
);
select tests.clear_authentication();
delete from public.class_teachers
where class_id = tests.id('class_a') and user_id = tests.id('former_teacher');

-- ---------------------------------------------------------------------------------------
-- save_unit_plan and start_unit (security invoker)
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select lives_ok(
  $$select tests.remember('unit_planned', public.save_unit_plan(null, tests.id('class_a'),
      (select id from public.subjects where code = 'fra' and board_id is null),
      'Les textes informatifs', null, '2026-11-02', '2026-11-27',
      array[tests.id('exp_a'), tests.id('exp_a_parent')]))$$,
  'save_unit_plan creates a unit'
);
select results_eq(
  $$select status::text, title, planned_start_on, planned_end_on, created_by
    from public.units where id = tests.id('unit_planned')$$,
  $$values ('planned', 'Les textes informatifs', '2026-11-02'::date, '2026-11-27'::date,
    tests.id('teacher_a'))$$,
  'as « À venir », with its window'
);
select results_eq(
  $$select expectation_id from public.unit_expectations
    where unit_id = tests.id('unit_planned') order by expectation_id$$,
  $$select x from unnest(array[tests.id('exp_a'), tests.id('exp_a_parent')]) x order by x$$,
  'and its attentes'
);
select is(
  public.save_unit_plan(tests.id('unit_planned'), tests.id('class_a'),
    (select id from public.subjects where code = 'fra' and board_id is null),
    'Lire pour s''informer', 'Textes informatifs', '2026-11-09', '2026-12-04',
    array[tests.id('exp_a_parent')]),
  tests.id('unit_planned'),
  'save_unit_plan changes a unit'
);
select results_eq(
  $$select title, description, planned_start_on, planned_end_on,
      (select array_agg(expectation_id) from public.unit_expectations
       where unit_id = tests.id('unit_planned'))
    from public.units where id = tests.id('unit_planned')$$,
  $$values ('Lire pour s''informer', 'Textes informatifs', '2026-11-09'::date,
    '2026-12-04'::date, array[tests.id('exp_a_parent')])$$,
  'its title, description and window, and replaces its attentes'
);
select lives_ok(
  $$select public.save_unit_plan(tests.id('unit_planned'), tests.id('class_a'),
      (select id from public.subjects where code = 'fra' and board_id is null),
      'Lire pour s''informer', null, null, null, '{}')$$,
  'a window and the attentes can be removed'
);
select is(
  tests.window_of(tests.id('unit_planned')) || ' ' || tests.unit_attentes(tests.id('unit_planned')),
  '- - 0', 'the unit has neither'
);
select throws_ok(
  $$select public.save_unit_plan(tests.id('unit_planned'), tests.id('class_a'),
      (select id from public.subjects where code = 'fra' and board_id is null),
      'Lire pour s''informer', null, null, null,
      array(select gen_random_uuid() from generate_series(1, 201)))$$,
  '22023', null, 'more than 200 attentes are refused'
);
select throws_ok(
  $$select public.save_unit_plan(tests.id('unit_planned'), tests.id('class_a'),
      (select id from public.subjects where code = 'fra' and board_id is null),
      'Lire pour s''informer', null, null, null, array[tests.id('exp_a'), tests.id('exp_a')])$$,
  '22023', null, 'so are duplicates'
);
select throws_ok(
  $$select public.save_unit_plan(tests.id('unit_planned'), tests.id('class_a'),
      (select id from public.subjects where code = 'fra' and board_id is null),
      'Lire pour s''informer', null, null, null, null)$$,
  '22023', null, 'and a missing list'
);
select throws_ok(
  $$select public.save_unit_plan(tests.id('unit_planned'), tests.id('class_a'),
      (select id from public.subjects where code = 'mat' and board_id is null),
      'Lire pour s''informer', null, null, null, '{}')$$,
  '22023', null, 'a unit''s subject does not change through save_unit_plan'
);
select throws_ok(
  $$select public.save_unit_plan(gen_random_uuid(), tests.id('class_a'),
      (select id from public.subjects where code = 'fra' and board_id is null),
      'Inconnue', null, null, null, '{}')$$,
  'P0002', null, 'an unknown unit is not found'
);
select throws_ok(
  $$select public.save_unit_plan(tests.id('unit_planned'), tests.id('class_a_other'),
      (select id from public.subjects where code = 'fra' and board_id is null),
      'Ailleurs', null, null, null, '{}')$$,
  'P0002', null, 'nor is a unit named with another class'
);
select throws_ok(
  $$select public.save_unit_plan(null, tests.id('class_a'),
      (select id from public.subjects where code = 'fra' and board_id is null),
      'Trop tard', null, '2027-06-21', '2027-07-02', '{}')$$,
  'LXY01', null, 'a window outside the year is refused through save_unit_plan too'
);
select throws_ok(
  $$select public.save_unit_plan(null, tests.id('class_a'),
      (select id from public.subjects where code = 'fra' and board_id is null),
      'Mauvaise attente', null, null, null, array[tests.id('exp_other')])$$,
  'LXY02', null, 'and an attente of another subject'
);
select tests.clear_authentication();

select tests.authenticate_as('teacher_b');
select throws_ok(
  $$select public.save_unit_plan(null, tests.id('class_a'),
      (select id from public.subjects where code = 'fra' and board_id is null),
      'Intrusion', null, null, null, '{}')$$,
  '42501', null, 'another board''s teacher cannot plan a unit in the class'
);
select throws_ok(
  $$select public.save_unit_plan(tests.id('unit_a'), tests.id('class_a'),
      (select id from public.subjects where code = 'fra' and board_id is null),
      'Intrusion', null, null, null, '{}')$$,
  'P0002', null, 'nor change one of its units'
);
select throws_ok(
  $$select public.start_unit(tests.id('unit_planned'), false)$$,
  'P0002', null, 'nor start one'
);
select tests.clear_authentication();

select tests.authenticate_as('teacher_a');
select lives_ok(
  $$select public.start_unit(tests.id('unit_planned'), false)$$,
  'start_unit starts a planned unit'
);
select results_eq(
  $$select id, status::text from public.units
    where id in (tests.id('unit_planned'), tests.id('unit_a')) order by status::text$$,
  $$values (tests.id('unit_planned'), 'active'), (tests.id('unit_a'), 'planned')$$,
  'and the current unit goes back to « À venir »'
);
select lives_ok(
  $$select public.start_unit(tests.id('unit_a'), true)$$,
  'with « Terminer », the current unit is finished first'
);
select results_eq(
  $$select id, status::text from public.units
    where id in (tests.id('unit_planned'), tests.id('unit_a')) order by status::text$$,
  $$values (tests.id('unit_a'), 'active'), (tests.id('unit_planned'), 'completed')$$,
  'it is « Terminée » and the started unit « En cours »'
);
select tests.clear_authentication();

select ok(
  has_function_privilege('authenticated',
    'public.save_unit_plan(uuid,uuid,uuid,text,text,date,date,uuid[])', 'execute')
  and has_function_privilege('authenticated', 'public.start_unit(uuid,boolean)', 'execute')
  and not has_function_privilege('anon',
    'public.save_unit_plan(uuid,uuid,uuid,text,text,date,date,uuid[])', 'execute')
  and not has_function_privilege('anon', 'public.start_unit(uuid,boolean)', 'execute'),
  'signed-in users execute save_unit_plan and start_unit; anon does not'
);
select is_empty(
  $$select f from unnest(array['app.report_periods_validate()', 'app.units_plan_guard()',
      'app.unit_expectations_validate()']) f
    cross join unnest(array['anon', 'authenticated']) r (rolname)
    where has_function_privilege(r.rolname, f, 'execute')$$,
  'the trigger functions are executable by no API role'
);

-- ---------------------------------------------------------------------------------------
-- Plans are rebuilt only for what they read (amends D-047)
-- ---------------------------------------------------------------------------------------

insert into public.absences (id, teacher_id, school_id, starts_on, ends_on, status, published_at)
values (tests.remember('abs_y', gen_random_uuid()), tests.id('teacher_a'), tests.id('school_a1'),
  tests.school_day(21), tests.school_day(21), 'published', now());
update public.absences set sources_changed_at = null where id = tests.id('abs_y');

select tests.authenticate_as('teacher_a');
update public.units set planned_start_on = '2026-09-14', planned_end_on = '2026-10-23'
where id = tests.id('unit_a');
update public.units set description = 'Une description' where id = tests.id('unit_a');
select public.save_unit_plan(tests.id('unit_a'), tests.id('class_a'),
  (select id from public.subjects where code = 'fra' and board_id is null),
  'Unit A', 'Autre description', '2026-09-21', '2026-10-30', array[tests.id('exp_a')]);
select tests.clear_authentication();
select is(
  (select sources_changed_at from public.absences where id = tests.id('abs_y')), null,
  'a window, a description or unit attentes saved leave the teacher''s plans alone'
);

select tests.authenticate_as('teacher_a');
update public.units set title = 'Unit A, renamed' where id = tests.id('unit_a');
select tests.clear_authentication();
select ok(
  (select sources_changed_at is not null from public.absences where id = tests.id('abs_y')),
  'a new title marks the plans out of date'
);

update public.absences set sources_changed_at = null where id = tests.id('abs_y');
select tests.authenticate_as('teacher_a');
select public.set_active_unit(tests.id('unit_planned'));
select tests.clear_authentication();
select ok(
  (select sources_changed_at is not null from public.absences where id = tests.id('abs_y')),
  'so does a change of status'
);

-- ---------------------------------------------------------------------------------------
-- Retention (D-105): the student purge keeps the planning; deleting a unit or class does not
-- ---------------------------------------------------------------------------------------

select is(
  (select (app.purge_class_students(tests.id('class_a'))).students_deleted), 2,
  'the class''s students are purged'
);
select results_eq(
  $$select tests.window_of(tests.id('unit_a')), tests.unit_attentes(tests.id('unit_a'))$$,
  $$values ('2026-09-21 2026-10-30', 1)$$,
  'its units keep their window and attentes'
);

delete from public.units where id = tests.id('unit_planned');
select is(
  (select count(*)::int from public.unit_expectations where unit_id = tests.id('unit_planned')), 0,
  'a unit''s attentes go with the unit'
);
delete from public.classes where id = tests.id('class_a');
select is(
  (select count(*)::int from public.unit_expectations where unit_id = tests.id('unit_a')), 0,
  'and with its class'
);

select * from finish();
rollback;
