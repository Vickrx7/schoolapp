-- Phase 6, slice S7 (supabase/migrations/20261201090400_phase6_security_review.sql): colleagues
-- read names and addresses, never when someone accepted the pilot terms or hid their checklist;
-- the operator removes and restores access as board admins do, audited for the board.
-- DECISIONS: D-106, D-107, D-109.
begin;
\ir _helpers.psql
select plan(22);
select tests.build_fixture();

grant usage on schema tests to service_role;
grant select, insert on tests.ids to service_role;

-- The operator's connection (the admin CLI's service key).
create function tests.as_service()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'service_role', true);
end;
$$;

-- The SQLSTATE alone.
create function tests.code_of(p_sql text)
returns text
language sql
as $$
  select left(tests.error_of(p_sql), 5);
$$;

-- What the direction of school a1 reads about a person (D-103).
create function tests.direction_entries(p_user uuid)
returns table (action text, actor_type text)
language sql
as $$
  select e.action, e.actor_type::text from public.list_audit_entries(
    jsonb_build_object('entityId', p_user, 'from', (now() - interval '1 day')::text), null, 100) e
  where e.action like 'staff.%'
  order by e.id;
$$;

grant execute on all functions in schema tests to authenticated, service_role;

-- ---------------------------------------------------------------------------------------
-- 1. What a colleague reads of a profile (D-107, D-109)
-- ---------------------------------------------------------------------------------------

select ok(
  has_column_privilege('authenticated', 'public.users', 'id', 'select')
  and has_column_privilege('authenticated', 'public.users', 'email', 'select')
  and has_column_privilege('authenticated', 'public.users', 'display_name', 'select')
  and has_column_privilege('authenticated', 'public.users', 'honorific', 'select')
  and has_column_privilege('authenticated', 'public.users', 'preferred_locale', 'select')
  and has_column_privilege('authenticated', 'public.users', 'deactivated_at', 'select'),
  'signed-in users read the columns the app shows about people'
);
select ok(
  not has_table_privilege('authenticated', 'public.users', 'select')
  and not has_column_privilege('authenticated', 'public.users', 'terms_version', 'select')
  and not has_column_privilege('authenticated', 'public.users', 'terms_accepted_at', 'select')
  and not has_column_privilege('authenticated', 'public.users', 'onboarding_dismissed_at', 'select')
  and not has_column_privilege('authenticated', 'public.users', 'created_at', 'select')
  and not has_column_privilege('authenticated', 'public.users', 'updated_at', 'select'),
  'nor the terms, the checklist or the row''s times (they tell when someone first signed in)'
);

select tests.authenticate_as('teacher_a_other');
select lives_ok($$select public.accept_terms('2026-11-pilote-1')$$, 'a teacher accepts the terms');
select tests.authenticate_as('teacher_a');
select is(
  (select display_name from public.users where id = tests.id('teacher_a_other')),
  'teacher_a_other',
  'a colleague''s name is still readable'
);
select is(
  tests.code_of($$select terms_accepted_at from public.users where id = tests.id('teacher_a_other')$$),
  '42501',
  'a colleague''s terms acceptance is not'
);
select is(
  tests.code_of($$select updated_at from public.users where id = tests.id('teacher_a_other')$$),
  '42501',
  'nor when the colleague''s row last changed'
);
select is(
  (select count(*)::int from public.my_onboarding_state()),
  1,
  'my_onboarding_state: one row, the caller''s'
);
select is(
  (select terms_version from public.my_onboarding_state()),
  null,
  'with the caller''s own state (teacher_a has not accepted the terms)'
);
select tests.authenticate_as('teacher_a_other');
select results_eq(
  $$select terms_version, terms_accepted_at is not null, onboarding_dismissed_at is null
    from public.my_onboarding_state()$$,
  $$values ('2026-11-pilote-1', true, true)$$,
  'a person reads their own terms and checklist state'
);
select lives_ok(
  $$update public.users set onboarding_dismissed_at = now() where id = tests.id('teacher_a_other')$$,
  'and still hides their own checklist'
);
select ok(
  (select onboarding_dismissed_at is not null from public.my_onboarding_state()),
  'which the function then reads'
);
select tests.authenticate_anon();
select is(
  tests.code_of($$select * from public.my_onboarding_state()$$),
  '42501',
  'anon cannot run it'
);
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- 2. The operator removes and restores access as board admins do (D-106, D-107)
-- ---------------------------------------------------------------------------------------

select ok(
  has_function_privilege('service_role', 'public.operator_set_staff_active(uuid,boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.operator_set_staff_active(uuid,boolean)', 'execute')
  and not has_function_privilege('anon', 'public.operator_set_staff_active(uuid,boolean)', 'execute'),
  'operator_set_staff_active is the operator''s only (service role)'
);

select tests.as_service();
select is(
  public.operator_set_staff_active(tests.id('teacher_a'), false),
  true,
  'the operator removes a teacher''s access'
);
select is(
  public.operator_set_staff_active(tests.id('teacher_a'), false),
  false,
  'a second removal changes nothing'
);
select is(
  tests.code_of($$select public.operator_set_staff_active(gen_random_uuid(), false)$$),
  'P0002',
  'an account without a profile is refused'
);
select is(
  tests.code_of($$select public.operator_set_staff_active(null, false)$$),
  '22023',
  'so is a call without a person'
);
select tests.clear_authentication();

select ok(
  (select deactivated_at is not null from public.users where id = tests.id('teacher_a')),
  'the profile is deactivated'
);
select is(
  (select count(*)::int from public.event_outbox
   where event_type = 'staff.access_changed' and payload = jsonb_build_object('userId', tests.id('teacher_a'))),
  1,
  'the worker is told once (it bans the sign-in)'
);

select tests.as_service();
select is(
  public.operator_set_staff_active(tests.id('teacher_a'), true),
  true,
  'the operator restores it (pnpm admin invite)'
);
select tests.clear_authentication();

-- The school's direction reads both, with IP Lynx as the actor.
select tests.authenticate_as('principal_a');
select results_eq(
  $$select action, actor_type from tests.direction_entries(tests.id('teacher_a'))$$,
  $$values ('staff.access_removed', 'service'), ('staff.access_restored', 'service')$$,
  'the direction sees the removal and the restoration, by the operator'
);
select tests.authenticate_as('board_admin_a');
select results_eq(
  $$select e.action, e.actor_type::text from public.list_audit_entries(
      jsonb_build_object('boardId', tests.id('board_a'), 'entityId', tests.id('teacher_a'),
        'from', (now() - interval '1 day')::text), null, 100) e
    where e.action like 'staff.%' order by e.id$$,
  $$values ('staff.access_removed', 'service'), ('staff.access_restored', 'service')$$,
  'and so do the board''s admins'
);
select tests.clear_authentication();

select * from finish();
rollback;
