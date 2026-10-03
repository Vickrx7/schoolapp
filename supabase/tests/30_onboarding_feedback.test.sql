-- Phase 6, slice S6 (supabase/migrations/20261201090300_onboarding_feedback.sql): a sample class
-- never shows in the direction's « Journal d'audit » (its team is not logged; its deletion is
-- `sample_class.deleted`, for the operator only), real classes are logged as before, and feedback
-- keeps an error reference as the page showed it.
-- DECISIONS: D-103, D-109, D-111, D-116.
begin;
\ir _helpers.psql
select plan(14);
select tests.build_fixture();

-- A sample class as buildSampleClass makes it (shortened).
create function tests.sample_payload()
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'name', 'Classe exemple (3e année)', 'gradeCodes', jsonb_build_array('3'),
    'students', jsonb_build_array(
      jsonb_build_object('firstName', 'Anouk', 'levelRank', 1),
      jsonb_build_object('firstName', 'Timéo', 'levelRank', 3)),
    'blocks', jsonb_build_array(
      jsonb_build_object('dayKey', 1, 'start', '08:55', 'end', '09:45', 'kind', 'subject',
        'subjectCode', 'fra', 'title', null)),
    'units', '[]'::jsonb);
$$;
grant execute on all functions in schema tests to authenticated;

-- What the direction of school a1 reads about a class (D-103).
create function tests.direction_entries(p_class uuid)
returns setof text
language sql
as $$
  select e.action from public.list_audit_entries(
    jsonb_build_object('entityId', p_class, 'from', (now() - interval '1 day')::text), null, 100) e;
$$;
grant execute on function tests.direction_entries(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------
-- 1. Making a sample class writes nothing the direction reads
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
-- A real class first, while the marker was never set in this transaction.
select tests.remember('real', public.create_class(tests.id('school_a1'), tests.id('year_a'), 'Vraie classe', array['4'], null));
select tests.remember('sample', public.create_sample_class(tests.id('school_a1'), tests.sample_payload()));
select is(nullif(current_setting('app.sample_class_setup', true), ''), null,
  'the setup marker is cleared once the class is made');
select tests.clear_authentication();

select is(
  (select count(*)::int from public.audit_log where entity_id = tests.id('sample')), 0,
  'no audit entry for the sample class or its teacher');
select results_eq(
  $$select action, details ->> 'role' from public.audit_log where entity_id = tests.id('real')$$,
  $$values ('class_teacher.added', 'homeroom')$$,
  'a real class still logs its teacher (unchanged)');

-- A colleague added to the sample class, then removed: not logged either.
insert into public.class_teachers (class_id, user_id, role)
values (tests.id('sample'), tests.id('subject_teacher'), 'subject');
delete from public.class_teachers where class_id = tests.id('sample') and user_id = tests.id('subject_teacher');
select is(
  (select count(*)::int from public.audit_log where entity_id = tests.id('sample')), 0,
  'its team changes are not logged');

-- The marker only spares the teacher it names, while it is set.
select set_config('app.sample_class_setup', tests.id('teacher_a')::text, true);
insert into public.class_teachers (class_id, user_id, role)
values (tests.id('real'), tests.id('subject_teacher'), 'subject');
select set_config('app.sample_class_setup', '', true);
select is(
  (select count(*)::int from public.audit_log
   where entity_id = tests.id('real') and action = 'class_teacher.added'
     and details ->> 'user_id' = tests.id('subject_teacher')::text), 1,
  'a colleague the marker does not name is logged');

-- ---------------------------------------------------------------------------------------
-- 2. Deleting it: for the operator only, never « Classe supprimée »
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select lives_ok(format($$delete from public.classes where id = %L$$, tests.id('sample')),
  'the teacher deletes her sample class');
select lives_ok(format($$delete from public.classes where id = %L$$, tests.id('real')),
  'and a real class');
select tests.clear_authentication();

select results_eq(
  $$select action, actor_type::text, actor_user_id, details from public.audit_log
    where entity_id = tests.id('sample')$$,
  $$values ('sample_class.deleted', 'user', tests.id('teacher_a'), '{}'::jsonb)$$,
  'the sample''s deletion is one entry, without its name');
select results_eq(
  $$select a.action, c.audience from public.audit_log a
    join public.audit_action_catalog c on c.action = a.action
    where a.entity_id = tests.id('sample')$$,
  $$values ('sample_class.deleted', 'operator')$$,
  'read by nobody through the API');
select is(
  (select details ->> 'name' from public.audit_log where entity_id = tests.id('real') and action = 'class.deleted'),
  'Vraie classe', 'a real class''s deletion is logged as before');

select tests.authenticate_as('principal_a');
select is_empty($$select * from tests.direction_entries(tests.id('sample'))$$,
  'the principal reads nothing about the sample class');
select set_eq($$select * from tests.direction_entries(tests.id('real'))$$,
  $$values ('class_teacher.added'), ('class.deleted')$$,
  'and everything about the real one');
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- 3. Feedback keeps the reference the page showed (D-111, D-116)
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select lives_ok(
  format($$select public.submit_feedback(%L, %L, 'problem', 'La page a planté.', '/classes/[id]',
    '2338492845@E394', 'dev', 'desktop', 'fr-CA', true)$$, tests.id('board_a'), tests.id('school_a1')),
  'a Next digest with its error code is kept');
select throws_ok(
  format($$select public.submit_feedback(%L, null, 'problem', 'x', null, 'ref with spaces', null,
    null, null, true)$$, tests.id('board_a')),
  '23514', null, 'anything else is refused');
select tests.clear_authentication();

select * from finish();
rollback;
