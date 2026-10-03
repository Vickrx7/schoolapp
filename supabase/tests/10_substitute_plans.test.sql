-- Substitute hand-off: publishing absences with their plans, who sees what, the plan sources,
-- keeping plans fresh, the one plan writer, changing and cancelling absences, the owner's edits,
-- release, the direction and office functions, the report policy, the « Fiche de suppléance »,
-- retention and deleting a class (DECISIONS D-047, D-048, D-055, D-056, D-057, D-059, D-060).
begin;
\ir _helpers.psql
select plan(109);
select tests.build_fixture();

-- The week two weeks from now: wk(0) is its Monday, wk(4) its Friday, wk(7) the next Monday.
create function tests.wk(p_day integer)
returns date
language sql
as $$
  select (current_date + 14) - (extract(isodow from current_date + 14)::integer - 1) + p_day;
$$;

-- A school's local date, for statements run as a signed-in user (app.* is not theirs to call).
create function tests.today(p_school_key text)
returns date
language sql
security definer
set search_path = ''
as $$
  select app.school_local_today(tests.id(p_school_key));
$$;

grant execute on function tests.wk(integer), tests.today(text) to authenticated;

-- ---------------------------------------------------------------------------------------
-- Helpers: names, code windows and release times
-- ---------------------------------------------------------------------------------------

select results_eq(
  $$values (app.formal_staff_name('Isabelle Tremblay', 'Mme')),
           (app.formal_staff_name(' Marc   Gagnon ', 'M.')),
           (app.formal_staff_name('Isabelle Tremblay', null)),
           (app.formal_staff_name('Isabelle Tremblay', ' '))$$,
  $$values ('Mme Tremblay'), ('M. Gagnon'), ('Isabelle Tremblay'), ('Isabelle Tremblay')$$,
  'app.formal_staff_name: the honorific and the family name, else the display name'
);

-- A Central-time school, across the end of daylight saving time (2026-11-01).
update public.schools
set timezone = 'America/Winnipeg',
    settings = '{"substitute": {"accessFrom": "06:30", "accessUntil": "17:00"}}'
where id = tests.id('school_a2');
select results_eq(
  $$select w.valid_from, w.expires_at
    from unnest(array['2026-10-30', '2026-11-02']::date[]) d
    cross join lateral app.sub_access_window(tests.id('school_a2'), d) w
    order by d$$,
  $$values ('2026-10-30 11:30+00'::timestamptz, '2026-10-30 22:00+00'::timestamptz),
           ('2026-11-02 12:30+00'::timestamptz, '2026-11-02 23:00+00'::timestamptz)$$,
  'the code window follows the school''s hours in its own time zone, across DST'
);

update public.schools
set settings = '{"substitute": {"accessFrom": "18:00", "accessUntil": "07:00"}}'
where id = tests.id('school_a2');
select results_eq(
  $$select valid_from, expires_at from app.sub_access_window(tests.id('school_a2'), '2026-11-02')$$,
  $$values ('2026-11-02 11:00+00'::timestamptz, '2026-11-03 00:00+00'::timestamptz)$$,
  'an inverted setting falls back to 05:00-18:00'
);

select is(
  app.sub_plan_review_deadline(tests.id('school_a1'), tests.wk(0)),
  (tests.wk(0) + time '07:30') at time zone 'America/Toronto',
  'unreviewed plans are released at 07:30 local time by default'
);
update public.boards set settings = '{"subPlanAutoReleaseTime": "06:45"}' where id = tests.id('board_b');
select is(
  app.sub_plan_review_deadline(tests.id('school_b1'), tests.wk(0)),
  (tests.wk(0) + time '06:45') at time zone 'America/Toronto',
  'the board sets the release time'
);
select is(
  app.sub_plan_review_deadline(tests.id('school_a1'), current_date - 2), now(),
  'a release time already past means now'
);

-- ---------------------------------------------------------------------------------------
-- Publishing
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select lives_ok(
  $$select tests.remember('abs1', public.publish_absence(
      tests.id('school_a1'), tests.wk(0), tests.wk(0), 'full_day', 'Merci!', true,
      '00000000-0000-4000-8000-0000000000a1',
      tests.plan_items(array[tests.wk(0)], array[tests.id('class_a')])))$$,
  'a teacher publishes an absence with its plan'
);
select results_eq(
  $$select status::text, part::text, note, catholic_connection, sources_changed_at
    from public.absences where id = tests.id('abs1')$$,
  $$values ('published', 'full_day', 'Merci!', true, null::timestamptz)$$,
  'the absence is published and up to date'
);
select results_eq(
  $$select status::text, review_deadline, content_version, edits_revision
    from public.sub_plans where absence_id = tests.id('abs1')$$,
  $$values ('ready', (tests.wk(0) + time '07:30') at time zone 'America/Toronto', 1, 0)$$,
  'its plan is ready, to be released at 07:30 local time on the day'
);
select is(
  public.publish_absence(tests.id('school_a1'), tests.wk(0), tests.wk(0), 'full_day', null, true,
    '00000000-0000-4000-8000-0000000000a1',
    tests.plan_items(array[tests.wk(0)], array[tests.id('class_a')])),
  tests.id('abs1'),
  'a retried tap returns the same absence'
);
select is((select count(*)::int from public.absences where teacher_id = tests.id('teacher_a')), 1,
  'and records it once');
select lives_ok(
  $$select tests.remember('abs2', public.publish_absence(
      tests.id('school_a1'), tests.wk(2), tests.wk(3), 'full_day', null, false, gen_random_uuid(),
      tests.plan_items(array[current_date - 2, tests.wk(1), tests.wk(2), tests.wk(3)],
        array[tests.id('class_a')])))$$,
  'plans for days outside the absence or in the past are skipped silently'
);
select is((select count(*)::int from public.sub_plans where absence_id = tests.id('abs2')), 2,
  'only the absence''s days get a plan');
select tests.clear_authentication();

select tests.remember('plan1', (select id from public.sub_plans where absence_id = tests.id('abs1')));
select tests.remember('plan2a', (select id from public.sub_plans
  where absence_id = tests.id('abs2') and plan_date = tests.wk(2)));
select tests.remember('plan2b', (select id from public.sub_plans
  where absence_id = tests.id('abs2') and plan_date = tests.wk(3)));
select set_eq(
  $$select class_id from public.sub_plan_classes where sub_plan_id = tests.id('plan1')$$,
  $$values (tests.id('class_a'))$$,
  'the database records the classes the plan covers'
);

-- Refusals
select tests.authenticate_as('teacher_a');
select throws_ok(
  $$select public.publish_absence(tests.id('school_a1'), current_date - 2, current_date - 2,
      'full_day', null, true, gen_random_uuid(), '[]')$$,
  'LXS20', null, 'an absence cannot start in the past'
);
select throws_ok(
  $$select public.publish_absence(tests.id('school_a1'), tests.wk(7), tests.wk(7) + 14,
      'full_day', null, true, gen_random_uuid(), '[]')$$,
  'LXS21', null, 'an absence lasts at most 14 days'
);
select throws_ok(
  $$select public.publish_absence(tests.id('school_a1'), tests.wk(0), tests.wk(1),
      'full_day', null, true, gen_random_uuid(), '[]')$$,
  'LXS22', null, 'a teacher''s absences cannot overlap'
);
select lives_ok(
  $$select tests.remember('abs_am', public.publish_absence(
      tests.id('school_a1'), tests.wk(4), tests.wk(4), 'am', null, true, gen_random_uuid(),
      jsonb_build_array(jsonb_build_object(
        'date', tests.wk(4), 'classIds', jsonb_build_array(tests.id('class_a')),
        'plan', tests.plan_json(tests.wk(4)) || jsonb_build_object('classNotes', jsonb_build_array(
          jsonb_build_object('classId', tests.id('class_a'), 'arrival', 'Accueil à la porte.',
            'classManagement', 'Signal de silence')))))))$$,
  'a morning absence'
);
select lives_ok(
  $$select public.publish_absence(tests.id('school_a1'), tests.wk(4), tests.wk(4), 'pm', null, true,
      gen_random_uuid(), tests.plan_items(array[tests.wk(4)], array[tests.id('class_a')]))$$,
  'and an afternoon absence on the same day can both be published'
);
select throws_ok(
  $$select public.publish_absence(tests.id('school_a1'), tests.wk(9), tests.wk(10), 'am', null, true,
      gen_random_uuid(), '[]')$$,
  '22023', null, 'a half day is a single day'
);
select throws_ok(
  $$select public.publish_absence(tests.id('school_a1'), tests.wk(9), tests.wk(9), 'full_day', null,
      true, gen_random_uuid(), tests.plan_items(array[tests.wk(9)], array[tests.id('class_a_other')]))$$,
  '22023', null, 'a plan cannot cover a class the teacher does not teach'
);
select throws_ok(
  $$select public.publish_absence(tests.id('school_a1'), tests.wk(9), tests.wk(9), 'full_day', null,
      true, gen_random_uuid(), jsonb_build_array(jsonb_build_object('date', tests.wk(9),
        'classIds', jsonb_build_array(tests.id('class_a')), 'plan', tests.plan_json(tests.wk(10)))))$$,
  '22023', null, 'a plan''s date must be its day'
);
select throws_ok(
  $$select public.publish_absence(tests.id('school_a1'), tests.wk(9), tests.wk(9), 'full_day', null,
      true, gen_random_uuid(), jsonb_build_array(jsonb_build_object('date', tests.wk(9),
        'classIds', jsonb_build_array(tests.id('class_a')),
        'plan', tests.plan_json(tests.wk(9)) || '{"schemaVersion": 2}')))$$,
  '22023', null, 'only known plan versions are accepted'
);
select tests.clear_authentication();

select tests.remember('plan_am', (select id from public.sub_plans where absence_id = tests.id('abs_am')));

select tests.authenticate_as('office_a');
select throws_ok(
  $$select public.publish_absence(tests.id('school_a1'), tests.wk(9), tests.wk(9), 'full_day', null,
      true, gen_random_uuid(), '[]')$$,
  '42501', null, 'office staff cannot publish an absence'
);
select tests.clear_authentication();
select tests.authenticate_as('principal_a');
select throws_ok(
  $$select public.publish_absence(tests.id('school_a1'), tests.wk(9), tests.wk(9), 'full_day', null,
      true, gen_random_uuid(), '[]')$$,
  '42501', null, 'a principal cannot publish an absence (not a teacher there)'
);
select tests.clear_authentication();
select tests.authenticate_as('teacher_b');
select throws_ok(
  $$select public.publish_absence(tests.id('school_a1'), tests.wk(9), tests.wk(9), 'full_day', null,
      true, gen_random_uuid(), '[]')$$,
  '42501', null, 'a teacher from another board cannot publish at the school'
);
select tests.clear_authentication();
select tests.authenticate_as('former_teacher');
select throws_ok(
  $$select public.publish_absence(tests.id('school_a1'), tests.wk(9), tests.wk(9), 'full_day', null,
      true, gen_random_uuid(), '[]')$$,
  '42501', null, 'a deactivated teacher cannot publish'
);
select tests.clear_authentication();

delete from public.module_entitlements where school_id = tests.id('school_a1') and module = 'teaching';
select tests.authenticate_as('teacher_a');
select throws_ok(
  $$select public.publish_absence(tests.id('school_a1'), tests.wk(9), tests.wk(9), 'full_day', null,
      true, gen_random_uuid(), '[]')$$,
  '42501', null, 'a school without the Teaching module cannot publish'
);
select tests.clear_authentication();
insert into public.module_entitlements (school_id, module, valid_from)
values (tests.id('school_a1'), 'teaching', current_date - 1);

-- Events and audit: ids, dates and the part of day only.
select results_eq(
  $$select (select array_agg(k order by k) from jsonb_object_keys(e.payload) k)
    from public.event_outbox e
    where e.event_type = 'absence.published' and e.aggregate_id = tests.id('abs1')$$,
  $$values (array['absenceId', 'endsOn', 'part', 'startsOn'])$$,
  'absence.published carries ids, dates and the part of day'
);
select results_eq(
  $$select e.payload from public.event_outbox e
    where e.event_type = 'sub_plan.ready' and e.aggregate_id = tests.id('plan1')$$,
  $$values (jsonb_build_object('subPlanId', tests.id('plan1'), 'absenceId', tests.id('abs1'),
      'planDate', tests.wk(0)))$$,
  'sub_plan.ready carries the plan, its absence and its date'
);
select is_empty(
  $$select 1 from public.event_outbox e
    where e.payload::text ~ '(teacher_a|Class A|School A1|Merci)'$$,
  'no event carries a name or the note'
);
select is(
  (select count(*)::int from public.audit_log
   where action = 'absence.published' and entity_id = tests.id('abs1')),
  1, 'publishing is audited'
);

-- ---------------------------------------------------------------------------------------
-- Who sees what (D-056): plans are the owner's; absences are the owner's, direction's, office's.
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select is((select count(*)::int from public.sub_plans where absence_id = tests.id('abs1')), 1,
  'the owner reads her plan');
select tests.clear_authentication();
select tests.authenticate_as('principal_a');
select results_eq(
  $$select (select count(*)::int from public.sub_plans),
           (select count(*)::int from public.absences where id = tests.id('abs1'))$$,
  $$values (0, 1)$$,
  'direction sees the absence but reads no plan directly'
);
select tests.clear_authentication();
select tests.authenticate_as('office_a');
select results_eq(
  $$select (select count(*)::int from public.sub_plans),
           (select count(*)::int from public.absences where id = tests.id('abs1'))$$,
  $$values (0, 1)$$,
  'office sees the absence but reads no plan directly'
);
select tests.clear_authentication();
select tests.authenticate_as('teacher_a_other');
select results_eq(
  $$select (select count(*)::int from public.sub_plans),
           (select count(*)::int from public.absences where id = tests.id('abs1'))$$,
  $$values (0, 0)$$,
  'colleagues see neither'
);
select tests.clear_authentication();
select tests.authenticate_as('board_admin_a');
select is((select count(*)::int from public.sub_plans), 0, 'board admins read no plan');
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- Plan sources
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select ok(
  (select jsonb_path_query_array(s, '$.classes[*].id') = jsonb_build_array(tests.id('class_a'))
      and jsonb_path_query_array(s, '$.students[*].classId')
        = jsonb_build_array(tests.id('class_a'), tests.id('class_a'))
      and jsonb_path_query_array(s, '$.units[*].id') = jsonb_build_array(tests.id('unit_a'))
      and jsonb_array_length(s -> 'units' -> 0 -> 'lessons') = 3
      and jsonb_path_query_array(s, '$.blocks[*].classId') = jsonb_build_array(tests.id('class_a'))
      and s -> 'teacher' ->> 'id' = tests.id('teacher_a')::text
   from public.get_sub_plan_sources(tests.id('school_a1'), tests.wk(0), tests.wk(4)) s),
  'the sources hold the teacher''s own class only'
);
select ok(
  (select s::text !~ '(Léa|Nathan|Zoé|first_?[nN]ame)'
   from public.get_sub_plan_sources(tests.id('school_a1'), tests.wk(0), tests.wk(4)) s),
  'the sources never contain a student''s name'
);
select is(
  (select jsonb_path_query_array(s, '$.siblings[*].planDate')
   from public.get_sub_plan_sources(tests.id('school_a1'), tests.wk(2), tests.wk(3), tests.id('abs2')) s),
  jsonb_build_array(tests.wk(2), tests.wk(3)),
  'with an absence, the sources list its days'
);
select throws_ok(
  $$select public.get_sub_plan_sources(tests.id('school_a1'), tests.wk(0), tests.wk(0) + 14)$$,
  '22023', null, 'sources cover at most 14 days'
);
select tests.clear_authentication();
select tests.authenticate_as('teacher_a_other');
select throws_ok(
  $$select public.get_sub_plan_sources(tests.id('school_a1'), tests.wk(0), tests.wk(0), tests.id('abs1'))$$,
  '42501', null, 'a colleague cannot load the sources of someone else''s absence'
);
select tests.clear_authentication();
select tests.authenticate_as('office_a');
select throws_ok(
  $$select public.get_sub_plan_sources(tests.id('school_a1'), tests.wk(0), tests.wk(0))$$,
  '42501', null, 'office staff cannot load plan sources'
);
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- Keeping plans fresh (D-047)
-- ---------------------------------------------------------------------------------------

insert into public.lesson_progress (lesson_id, status, taught_on)
values (tests.id('lesson_a1'), 'completed', current_date);
select ok(
  (select sources_changed_at is not null from public.absences where id = tests.id('abs1')),
  'checking off a lesson of the class marks the absence out of date'
);
select is(
  (select count(*)::int from public.event_outbox
   where event_type = 'absence.sources_changed' and aggregate_id = tests.id('abs1')),
  1, 'and wakes the worker'
);
insert into public.lesson_progress (lesson_id, status, taught_on)
values (tests.id('lesson_a2'), 'completed', current_date);
select is(
  (select count(*)::int from public.event_outbox
   where event_type = 'absence.sources_changed' and aggregate_id = tests.id('abs1')),
  1, 'a second change adds no event'
);

update public.absences set sources_changed_at = null where id = tests.id('abs1');
insert into public.school_calendar_events (board_id, school_id, event_type, title, starts_on, ends_on)
values (tests.id('board_a'), tests.id('school_a2'), 'assembly', 'Rassemblement', tests.wk(0), tests.wk(0));
insert into public.school_calendar_events (board_id, school_id, event_type, title, starts_on, ends_on)
values (tests.id('board_a'), tests.id('school_a1'), 'assembly', 'Rassemblement', tests.wk(7), tests.wk(7));
select is(
  (select sources_changed_at from public.absences where id = tests.id('abs1')), null,
  'an event at another school, or on other days, changes nothing'
);
insert into public.school_calendar_events (board_id, school_id, event_type, title, starts_on, ends_on)
values (tests.id('board_a'), tests.id('school_a1'), 'mass', 'Messe', tests.wk(0), tests.wk(0));
select ok(
  (select sources_changed_at is not null from public.absences where id = tests.id('abs1')),
  'an event at the school on the absence''s day marks it out of date'
);

-- ---------------------------------------------------------------------------------------
-- The plan writer: compare-and-set for the worker; plans in use never change.
-- ---------------------------------------------------------------------------------------

update public.absences set sources_changed_at = '2026-01-01 00:00+00' where id = tests.id('abs1');
select is(
  app.write_absence_plans(tests.id('abs1'),
    jsonb_build_array(jsonb_build_object('date', tests.wk(0),
      'classIds', jsonb_build_array(tests.id('class_a')),
      'plan', tests.plan_json(tests.wk(0)) || '{"marker": "v2"}')),
    '2025-12-31 00:00+00', true),
  false,
  'the worker''s write is refused when the sources changed after it read them'
);
select results_eq(
  $$select content_version, plan ? 'marker' from public.sub_plans where id = tests.id('plan1')$$,
  $$values (1, false)$$,
  'and nothing is written'
);
select is(
  app.write_absence_plans(tests.id('abs1'),
    jsonb_build_array(jsonb_build_object('date', tests.wk(0),
      'classIds', jsonb_build_array(tests.id('class_a')),
      'plan', tests.plan_json(tests.wk(0)) || '{"marker": "v2"}')),
    '2026-01-01 00:00+00', true),
  true,
  'with the mark it read, the worker''s write goes through'
);
select results_eq(
  $$select p.content_version, p.plan ->> 'marker', a.sources_changed_at
    from public.sub_plans p join public.absences a on a.id = p.absence_id
    where p.id = tests.id('plan1')$$,
  $$values (2, 'v2', null::timestamptz)$$,
  'the plan is rebuilt, its version bumped and the absence up to date'
);

-- A substitute signed in to the second day of abs2.
insert into public.sub_access_codes (id, sub_plan_id, code_hash, valid_on, valid_from, expires_at)
values (tests.remember('code2b', gen_random_uuid()), tests.id('plan2b'), repeat('1', 64), tests.wk(3),
  (tests.wk(3) + time '05:00') at time zone 'America/Toronto',
  (tests.wk(3) + time '18:00') at time zone 'America/Toronto');
insert into public.sub_sessions (access_code_id, sub_plan_id, session_token_hash, expires_at, device_key)
values (tests.id('code2b'), tests.id('plan2b'), repeat('2', 64),
  (tests.wk(3) + time '18:00') at time zone 'America/Toronto', repeat('3', 64));

select is(
  app.write_absence_plans(tests.id('abs2'), jsonb_build_array(
    jsonb_build_object('date', tests.wk(2), 'classIds', jsonb_build_array(tests.id('class_a')),
      'plan', tests.plan_json(tests.wk(2)) || '{"marker": "v2"}'),
    jsonb_build_object('date', tests.wk(3), 'classIds', jsonb_build_array(tests.id('class_a')),
      'plan', tests.plan_json(tests.wk(3)) || '{"marker": "v2"}'))),
  true,
  'a rebuild without compare-and-set writes'
);
select results_eq(
  $$select plan_date, content_version from public.sub_plans
    where absence_id = tests.id('abs2') order by plan_date$$,
  $$values (tests.wk(2), 2), (tests.wk(3), 1)$$,
  'but a plan a substitute has signed in to is not rewritten'
);
select app.write_absence_plans(tests.id('abs2'),
  tests.plan_items(array[tests.wk(2)], array[tests.id('class_a')]));
select is((select count(*)::int from public.sub_plans where id = tests.id('plan2b')), 1,
  'nor deleted when its day is left out');

-- A plan for today that is already released is kept as it is when a rebuild leaves it out.
select tests.authenticate_as('teacher_a');
select lives_ok(
  $$select tests.remember('abs_today', public.publish_absence(tests.id('school_a1'),
      tests.today('school_a1'), tests.today('school_a1'), 'full_day', null, true, gen_random_uuid(),
      tests.plan_items(array[tests.today('school_a1')], array[tests.id('class_a')])))$$,
  'an absence can start today'
);
select lives_ok(
  $$select public.release_sub_plan(
      (select id from public.sub_plans where absence_id = tests.id('abs_today')))$$,
  'and its plan be released at once'
);
select tests.clear_authentication();
select app.write_absence_plans(tests.id('abs_today'), '[]');
select is((select count(*)::int from public.sub_plans where absence_id = tests.id('abs_today')), 1,
  'a released plan for today is fixed: a rebuild leaving the day out keeps it');

-- ---------------------------------------------------------------------------------------
-- Changing, rebuilding and cancelling absences
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select throws_ok(
  $$select public.update_absence(tests.id('abs2'), tests.wk(2), 'full_day', null, true,
      tests.plan_items(array[tests.wk(2)], array[tests.id('class_a')]))$$,
  'LXS12', null, 'an absence cannot be shortened past a day a substitute has used'
);
select lives_ok(
  $$select public.update_absence(tests.id('abs1'), tests.wk(0), 'am', 'Retour à midi', true,
      tests.plan_items(array[tests.wk(0)], array[tests.id('class_a')]))$$,
  'the part of day of a single-day absence can change'
);
select results_eq(
  $$select part::text, note, ends_on from public.absences where id = tests.id('abs1')$$,
  $$values ('am', 'Retour à midi', tests.wk(0))$$,
  'the absence is updated'
);
select lives_ok(
  $$select tests.remember('abs3', public.publish_absence(tests.id('school_a1'), tests.wk(7),
      tests.wk(8), 'full_day', null, true, gen_random_uuid(),
      tests.plan_items(array[tests.wk(7), tests.wk(8)], array[tests.id('class_a')])))$$,
  'a two-day absence'
);
select lives_ok(
  $$select public.update_absence(tests.id('abs3'), tests.wk(7), null, null, null,
      tests.plan_items(array[tests.wk(7)], array[tests.id('class_a')]))$$,
  'can be shortened'
);
select results_eq(
  $$select plan_date from public.sub_plans where absence_id = tests.id('abs3')$$,
  $$values (tests.wk(7))$$,
  'which removes the day no longer covered'
);
select lives_ok(
  $$select public.refresh_sub_plans(tests.id('abs1'),
      tests.plan_items(array[tests.wk(0)], array[tests.id('class_a')]))$$,
  'the owner rebuilds her plans on demand'
);
select tests.clear_authentication();

select results_eq(
  $$select action, count(*)::int from public.audit_log
    where entity_id in (tests.id('abs1'), tests.id('abs3')) and action = 'absence.updated'
    group by action$$,
  $$values ('absence.updated', 2)$$,
  'changes are audited'
);

insert into public.sub_access_codes (sub_plan_id, code_hash, valid_on, valid_from, expires_at)
select p.id, repeat('4', 64), p.plan_date,
  (p.plan_date + time '05:00') at time zone 'America/Toronto',
  (p.plan_date + time '18:00') at time zone 'America/Toronto'
from public.sub_plans p where p.absence_id = tests.id('abs3');

select tests.authenticate_as('teacher_a_other');
select throws_ok($$select public.cancel_absence(tests.id('abs3'))$$, '42501', null,
  'a colleague cannot cancel someone else''s absence');
select throws_ok($$select public.refresh_sub_plans(tests.id('abs1'), '[]')$$, '42501', null,
  'or rebuild its plans');
select tests.clear_authentication();
select tests.authenticate_as('teacher_a');
select lives_ok($$select public.cancel_absence(tests.id('abs3'))$$,
  'an absence no substitute has used can be cancelled');
select throws_ok($$select public.cancel_absence(tests.id('abs2'))$$, 'LXS12', null,
  'an absence a substitute has used cannot be cancelled');
select tests.clear_authentication();
select results_eq(
  $$select a.status::text,
      (select count(*)::int from public.sub_plans p where p.absence_id = a.id),
      (select count(*)::int from public.sub_access_codes c where c.code_hash = repeat('4', 64)),
      (select count(*)::int from public.event_outbox e
       where e.event_type = 'absence.cancelled' and e.aggregate_id = a.id)
    from public.absences a where a.id = tests.id('abs3')$$,
  $$values ('cancelled', 0, 0, 1)$$,
  'cancelling deletes the plans and their codes, and emits absence.cancelled'
);

-- ---------------------------------------------------------------------------------------
-- The owner's edits (an overlay, D-048)
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select is(
  public.save_sub_plan_edits(tests.id('plan1'), '{"overview": "Bonne journée!", "blocks": {}}', 0),
  1, 'the owner saves her edits and gets the next revision'
);
select throws_ok(
  $$select public.save_sub_plan_edits(tests.id('plan1'), '{"overview": "Autre"}', 0)$$,
  'LXS10', null, 'an edit based on an older revision is refused'
);
select throws_ok(
  $$select public.save_sub_plan_edits(tests.id('plan1'), '{"school": {"name": "X"}}', 1)$$,
  '22023', null, 'edits cannot carry other keys'
);
select throws_ok(
  $$select public.save_sub_plan_edits(tests.id('plan1'), '{"blocks": {"x": {}}}', 1)$$,
  '22023', null, 'block edits are keyed by timetable block id'
);
select tests.clear_authentication();
select results_eq(
  $$select edits_revision, edits ->> 'overview', edited_by from public.sub_plans
    where id = tests.id('plan1')$$,
  $$values (1, 'Bonne journée!', tests.id('teacher_a'))$$,
  'the edits are stored with who made them'
);
select tests.authenticate_as('teacher_a_other');
select throws_ok(
  $$select public.save_sub_plan_edits(tests.id('plan1'), null, 1)$$,
  '42501', null, 'a colleague cannot edit the plan'
);
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- Release
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select lives_ok($$select public.release_sub_plan(tests.id('plan1'))$$, 'the owner releases her plan');
select tests.clear_authentication();
select tests.authenticate_as('office_a');
select lives_ok($$select public.release_sub_plan(tests.id('plan2a'))$$, 'office releases a plan');
select tests.clear_authentication();
select tests.authenticate_as('teacher_a_other');
select throws_ok($$select public.release_sub_plan(tests.id('plan1'))$$, '42501', null,
  'a colleague cannot release a plan');
select tests.clear_authentication();
select results_eq(
  $$select status::text, released_by, reviewed_by from public.sub_plans
    where id in (tests.id('plan1'), tests.id('plan2a'))
    order by id = tests.id('plan1') desc$$,
  $$values ('released', tests.id('teacher_a'), tests.id('teacher_a')),
           ('released', tests.id('office_a'), null::uuid)$$,
  'the owner''s release counts as her review; office''s does not'
);
select is(
  (select count(*)::int from public.event_outbox
   where event_type = 'sub_plan.released' and aggregate_id in (tests.id('plan1'), tests.id('plan2a'))),
  2, 'a release by hand emits sub_plan.released'
);

-- ---------------------------------------------------------------------------------------
-- Direction and office: the staff plan view and the day's board (D-056)
-- ---------------------------------------------------------------------------------------

update public.students set active = false where id = tests.id('student_a2');

select tests.authenticate_as('office_a');
select results_eq(
  $$select s ->> 'released', s ? 'releaseAt', s ? 'plan'
    from public.get_sub_plan_for_staff(tests.id('plan_am')) s$$,
  $$values ('false', true, false)$$,
  'office cannot read a plan before its release'
);
select tests.clear_authentication();

update public.sub_plans set review_deadline = now() - interval '1 minute' where id = tests.id('plan_am');
select tests.authenticate_as('office_a');
select results_eq(
  $$select s ->> 'released', s -> 'roster', ((s -> 'plan' -> 'classNotes' -> 0) ? 'classManagement'),
      s -> 'plan' -> 'classNotes' -> 0 ->> 'arrival', s ->> 'role'
    from public.get_sub_plan_for_staff(tests.id('plan_am')) s$$,
  $$values ('true', jsonb_build_array(jsonb_build_object('id', tests.id('student_a1'),
      'classId', tests.id('class_a'), 'firstName', 'Léa')), false, 'Accueil à la porte.', 'office')$$,
  'once released, office reads the plan with the class''s active students, without « Gestion de classe »'
);
select tests.clear_authentication();
select results_eq(
  $$select p.status::text,
      (select count(*)::int from public.audit_log l where l.action = 'sub_plan.viewed'
       and l.entity_id = p.id and l.details ->> 'role' = 'office')
    from public.sub_plans p where p.id = tests.id('plan_am')$$,
  $$values ('ready', 1)$$,
  'a release by time writes nothing, and office''s view is audited'
);
select tests.authenticate_as('principal_a');
select is(
  (select s -> 'plan' -> 'classNotes' -> 0 ->> 'classManagement'
   from public.get_sub_plan_for_staff(tests.id('plan_am'), 'pdf') s),
  'Signal de silence',
  'direction reads « Gestion de classe »'
);
select tests.clear_authentication();
select is(
  (select count(*)::int from public.audit_log
   where action = 'sub_plan.printed' and entity_id = tests.id('plan_am') and details ->> 'role' = 'direction'),
  1, 'printing is audited as such'
);
select tests.authenticate_as('teacher_a_other');
select throws_ok($$select public.get_sub_plan_for_staff(tests.id('plan_am'))$$, '42501', null,
  'teachers cannot use the staff plan view');
select tests.clear_authentication();

-- A report whose contents the board must never show.
insert into public.sub_reports (sub_plan_id, content, status, submitted_at, notes_ciphertext, notes_key_version)
values (tests.id('plan2a'), '{"schemaVersion": 1, "lessons": [], "absentStudentIds": [], "x": "secret"}',
  'submitted', now(), 'v1.secret', 1);

select tests.authenticate_as('office_a');
select results_eq(
  $$select plan_date, teacher_name, class_names, released, report_status, active_codes, devices
    from public.list_school_sub_days(tests.id('school_a1'), tests.wk(0), tests.wk(4))
    where plan_id in (tests.id('plan1'), tests.id('plan2a'), tests.id('plan2b'))
    order by plan_date$$,
  $$values (tests.wk(0), 'teacher_a', array['Class A'], true, 'none', 0, 0),
           (tests.wk(2), 'teacher_a', array['Class A'], true, 'submitted', 0, 0),
           (tests.wk(3), 'teacher_a', array['Class A'], false, 'none', 1, 1)$$,
  'the office board lists each day''s plans with their status, codes, devices and report status'
);
select is_empty(
  $$select 1 from public.list_school_sub_days(tests.id('school_a1'), tests.wk(0), tests.wk(4)) r
    where to_jsonb(r)::text like '%secret%'$$,
  'but never report contents'
);
select tests.clear_authentication();
select tests.authenticate_as('principal_a');
select isnt_empty(
  $$select 1 from public.list_school_sub_days(tests.id('school_a1'), tests.wk(0), tests.wk(4))$$,
  'direction uses the board too'
);
select tests.clear_authentication();
select tests.authenticate_as('teacher_a');
select throws_ok(
  $$select * from public.list_school_sub_days(tests.id('school_a1'), tests.wk(0), tests.wk(4))$$,
  '42501', null, 'teachers do not'
);
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- Reports: the owner only; a draft once the day's access has ended (D-054).
-- ---------------------------------------------------------------------------------------

insert into public.absences (id, teacher_id, school_id, starts_on, ends_on, status, published_at)
values (tests.remember('abs_past', gen_random_uuid()), tests.id('teacher_a'), tests.id('school_a1'),
  current_date - 3, current_date - 3, 'published', now() - interval '4 days');
insert into public.sub_plans (id, absence_id, plan_date, plan, review_deadline)
values (tests.remember('plan_past', gen_random_uuid()), tests.id('abs_past'), current_date - 3,
  tests.plan_json(current_date - 3), now() - interval '3 days');
insert into public.sub_reports (sub_plan_id, content) values
  (tests.id('plan_past'), '{"schemaVersion": 1}'),
  (tests.id('plan1'), '{"schemaVersion": 1}');

select tests.authenticate_as('teacher_a');
select set_eq(
  $$select sub_plan_id from public.sub_reports$$,
  $$values (tests.id('plan_past')), (tests.id('plan2a'))$$,
  'the owner sees sent reports, and unsent drafts once the day''s access has ended'
);
select tests.clear_authentication();
select tests.authenticate_as('principal_a');
select is_empty($$select 1 from public.sub_reports$$, 'direction reads no report directly');
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- « Fiche de suppléance » (D-057): the class team only.
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select lives_ok(
  $$insert into public.class_sub_profiles (class_id, arrival_notes, neighbour_teacher_id, neighbour_note)
    values (tests.id('class_a'), 'Accueil à la porte.', tests.id('teacher_a_other'), 'Local 104')$$,
  'the homeroom teacher writes the Fiche'
);
select tests.clear_authentication();
select tests.authenticate_as('subject_teacher');
select lives_ok(
  $$update public.class_sub_profiles set routines_notes = 'Prière à 8 h 50.'
    where class_id = tests.id('class_a')$$,
  'any member of the class team can update it'
);
select throws_ok(
  $$update public.class_sub_profiles set neighbour_teacher_id = tests.id('teacher_b')
    where class_id = tests.id('class_a')$$,
  '22023', null, 'the neighbouring colleague must teach at the school'
);
select throws_ok(
  $$update public.class_sub_profiles set neighbour_teacher_id = tests.id('former_teacher')
    where class_id = tests.id('class_a')$$,
  '22023', null, 'and be active'
);
select tests.clear_authentication();
select results_eq(
  $$select routines_notes, neighbour_teacher_id, updated_by from public.class_sub_profiles
    where class_id = tests.id('class_a')$$,
  $$values ('Prière à 8 h 50.', tests.id('teacher_a_other'), tests.id('subject_teacher'))$$,
  'the database records who edited it last'
);
select tests.authenticate_as('principal_a');
select is_empty($$select 1 from public.class_sub_profiles$$, 'direction does not read the Fiche');
select tests.clear_authentication();
select tests.authenticate_as('office_a');
select is_empty($$select 1 from public.class_sub_profiles$$, 'nor does office');
select tests.clear_authentication();
select tests.authenticate_as('teacher_a_other');
select is_empty($$select 1 from public.class_sub_profiles$$, 'nor do other teachers');
select throws_ok(
  $$insert into public.class_sub_profiles (class_id, arrival_notes) values (tests.id('class_a'), 'X')$$,
  '42501', null, 'who cannot write it either'
);
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- Retention (D-059): the daily task.
-- ---------------------------------------------------------------------------------------

-- A code that expired 40 days ago, with its session, which the recent draft report points to.
insert into public.sub_access_codes (id, sub_plan_id, code_hash, valid_on, valid_from, expires_at)
values (tests.remember('old_code', gen_random_uuid()), tests.id('plan_past'), repeat('5', 64),
  current_date - 40, now() - interval '40 days 10 hours', now() - interval '40 days');
insert into public.sub_sessions (id, access_code_id, sub_plan_id, session_token_hash, expires_at, device_key)
values (tests.remember('old_session', gen_random_uuid()), tests.id('old_code'), tests.id('plan_past'),
  repeat('6', 64), now() - interval '40 days', repeat('7', 64));
update public.sub_reports set session_id = tests.id('old_session') where sub_plan_id = tests.id('plan_past');
insert into public.sub_code_attempts (device_key, ip_key, succeeded, attempted_at) values
  (repeat('8', 64), repeat('9', 64), false, now() - interval '25 hours'),
  (repeat('8', 64), repeat('9', 64), false, now() - interval '1 hour');
-- A report confirmed 61 days ago, and a draft never sent for a day 70 days ago.
update public.sub_reports set status = 'confirmed', confirmed_at = now() - interval '61 days'
where sub_plan_id = tests.id('plan2a');
insert into public.absences (id, teacher_id, school_id, starts_on, ends_on, status, published_at)
values (tests.remember('abs_old', gen_random_uuid()), tests.id('teacher_a'), tests.id('school_a1'),
  current_date - 70, current_date - 70, 'published', now() - interval '71 days');
insert into public.sub_plans (id, absence_id, plan_date, plan, review_deadline)
values (tests.remember('plan_old', gen_random_uuid()), tests.id('abs_old'), current_date - 70,
  tests.plan_json(current_date - 70), now() - interval '70 days');
insert into public.sub_reports (sub_plan_id, content, notes_ciphertext, notes_key_version)
values (tests.id('plan_old'),
  jsonb_build_object('schemaVersion', 1, 'absentStudentIds', jsonb_build_array(tests.id('student_a1'))),
  'v1.abc', 1);

select is(
  app.sub_access_maintenance(),
  '{"codesDeleted": 1, "attemptsDeleted": 1, "reportsPurged": 2}'::jsonb,
  'the daily task deletes old codes and attempts and purges old report notes'
);
select results_eq(
  $$select (select count(*)::int from public.sub_sessions where id = tests.id('old_session')), session_id
    from public.sub_reports where sub_plan_id = tests.id('plan_past')$$,
  $$values (0, null::uuid)$$,
  'sessions go with their codes; the report stays'
);
select set_eq(
  $$select sub_plan_id, notes_ciphertext, notes_key_version,
      content ? 'absentStudentIds' as has_absent, notes_purged_at is not null as purged
    from public.sub_reports
    where sub_plan_id in (tests.id('plan2a'), tests.id('plan_old'), tests.id('plan_past'))$$,
  $$values (tests.id('plan2a'), null::text, null::smallint, false, true),
           (tests.id('plan_old'), null::text, null::smallint, false, true),
           (tests.id('plan_past'), null::text, null::smallint, false, false)$$,
  'free text and absent students go 60 days after confirmation, or after the day if never confirmed'
);

-- ---------------------------------------------------------------------------------------
-- Deleting a class deletes the plans covering it, with the report's pending progress in the
-- plan's other classes (D-059).
-- ---------------------------------------------------------------------------------------

insert into public.class_teachers (class_id, user_id, role)
values (tests.id('class_a_other'), tests.id('teacher_a'), 'subject');
select tests.authenticate_as('teacher_a');
select lives_ok(
  $$select tests.remember('abs5', public.publish_absence(tests.id('school_a1'), tests.wk(1),
      tests.wk(1), 'full_day', null, true, gen_random_uuid(),
      tests.plan_items(array[tests.wk(1)], array[tests.id('class_a'), tests.id('class_a_other')])))$$,
  'a plan can cover several of the teacher''s classes'
);
select tests.clear_authentication();
select tests.remember('plan5', (select id from public.sub_plans where absence_id = tests.id('abs5')));
insert into public.sub_reports (id, sub_plan_id, content, status, submitted_at)
values (tests.remember('report5', gen_random_uuid()), tests.id('plan5'), '{"schemaVersion": 1}',
  'submitted', now());
insert into public.lesson_progress (lesson_id, status, taught_on, source, sub_report_id)
values (tests.id('lesson_a3'), 'pending_confirmation', tests.wk(1), 'substitute_report', tests.id('report5'));

select lives_ok($$delete from public.classes where id = tests.id('class_a_other')$$,
  'a class covered by a plan can be deleted');
select results_eq(
  $$select (select count(*)::int from public.sub_plans where id = tests.id('plan5')),
      (select count(*)::int from public.lesson_progress where lesson_id = tests.id('lesson_a3')),
      (select count(*)::int from public.audit_log where action = 'sub_plan.deleted'
       and entity_id = tests.id('plan5') and details ->> 'reason' = 'class_deleted')$$,
  $$values (0, 0, 1)$$,
  'its plans go, with their pending progress in other classes, and it is audited'
);

select * from finish();
rollback;
