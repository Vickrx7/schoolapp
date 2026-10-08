-- The operator's name on its audit entries (supabase/migrations/20270210090100_operator_name.sql):
-- the admin CLI sends OPERATOR_NAME (header x-lynx-operator-name, base64 of its UTF-8); the
-- database records it on the `service` entries of that request only, checks it, and returns it to
-- « Journal d'audit » and the board's whole export. Older entries keep null (« IP Lynx »).
-- DECISIONS: D-103, D-106, D-122, D-148.
begin;
\ir _helpers.psql
select plan(27);
select tests.build_fixture();

grant usage on schema tests to service_role;
grant select on tests.ids to service_role;

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

-- The request's headers, as PostgREST sets them: the name as the CLI sends it (base64 of its
-- UTF-8, on one line), or a raw value.
create function tests.operator_header(p_name text)
returns void
language sql
as $$
  select set_config('request.headers', json_build_object('x-lynx-operator-name',
    translate(encode(convert_to(p_name, 'UTF8'), 'base64'), E'\n', ''))::text, true);
$$;

create function tests.raw_header(p_value text)
returns void
language sql
as $$
  select set_config('request.headers', json_build_object('x-lynx-operator-name', p_value)::text,
    true);
$$;

create function tests.no_header()
returns void
language sql
as $$
  select set_config('request.headers', '{"accept": "application/json"}', true);
$$;

-- The last entry before each step.
create table tests.marks (key text primary key, id bigint not null);
create function tests.mark(p_key text)
returns void
language sql
as $$
  insert into tests.marks (key, id)
  values (p_key, coalesce((select max(id) from public.audit_log), 0));
$$;
create function tests.since(p_key text)
returns bigint
language sql
as $$
  select id from tests.marks where key = p_key;
$$;

grant select on tests.marks to service_role;
grant execute on all functions in schema tests to authenticated, service_role;

-- ---------------------------------------------------------------------------------------
-- 1. The column, its check and its trigger
-- ---------------------------------------------------------------------------------------

select has_column('public', 'audit_log', 'operator_name', 'entries have the operator''s name');
select col_is_null('public', 'audit_log', 'operator_name',
  'it may be null (entries of people, the system, and the operator before D-148)');
select ok(exists (select 1 from pg_constraint
    where conrelid = 'public.audit_log'::regclass and conname = 'audit_log_operator_name_check'
      and contype = 'c'),
  'the database checks the name');
select has_trigger('public', 'audit_log', 'audit_log_operator_name',
  'a trigger fills it from the operator''s request');
select ok(
  not has_function_privilege('anon', 'app.audit_log_operator_name()', 'execute')
  and not has_function_privilege('authenticated', 'app.audit_log_operator_name()', 'execute')
  and not has_function_privilege('service_role', 'app.audit_log_operator_name()', 'execute')
  and not has_column_privilege('anon', 'public.audit_log', 'operator_name', 'select')
  and not has_column_privilege('authenticated', 'public.audit_log', 'operator_name', 'select')
  and not has_column_privilege('authenticated', 'public.audit_log', 'operator_name', 'insert'),
  'the API cannot call the trigger, nor read or write the column (the log stays closed, D-103)');

-- ---------------------------------------------------------------------------------------
-- 2. The operator's requests
-- ---------------------------------------------------------------------------------------

select tests.mark('ops');
select tests.as_service();
select tests.operator_header('Équipe TI — Conseil d’Exemple');
select lives_ok(format($$select public.log_operator_access(%L, 'support')$$, tests.id('board_a')),
  'the operator records an access with its name');
select results_eq(
  $$select actor_type::text, operator_name from public.audit_log
    where action = 'operator.access' and details ->> 'reason' = 'support'
      and id > tests.since('ops')$$,
  $$values ('service', 'Équipe TI — Conseil d’Exemple')$$,
  'the entry names the operator as its request said'
);

-- An entry a trigger writes in the same kind of request (set-module) is named too.
update public.module_entitlements set enabled = false
where school_id = tests.id('school_a1') and module = 'library';
select results_eq(
  $$select actor_type::text, operator_name from public.audit_log
    where action = 'school.module_changed' and id > tests.since('ops')$$,
  $$values ('service', 'Équipe TI — Conseil d’Exemple')$$,
  'a change of a module, audited by its trigger, names the operator too'
);

-- An older CLI (no header): null, which the app reads « IP Lynx ».
select tests.no_header();
select lives_ok(format($$select public.log_operator_access(%L, 'incident')$$, tests.id('board_a')),
  'an access recorded without a name');
select results_eq(
  $$select actor_type::text, operator_name from public.audit_log
    where action = 'operator.access' and details ->> 'reason' = 'incident'
      and id > tests.since('ops')$$,
  $$values ('service', null::text)$$,
  'without the header the entry has no name'
);

-- 80 characters, accents and all.
select tests.operator_header(repeat('é', 80));
select lives_ok(format($$select public.log_operator_access(%L, 'restore')$$, tests.id('board_a')),
  'a name of 80 characters is accepted');
select is(
  (select char_length(operator_name) from public.audit_log
   where action = 'operator.access' and details ->> 'reason' = 'restore'
     and id > tests.since('ops')),
  80, 'and kept whole');

-- Refused: nothing the request did is kept.
select tests.operator_header(repeat('x', 81));
select throws_ok(format($$select public.log_operator_access(%L, 'migration')$$,
    tests.id('board_a')), '23514', null, 'a name of 81 characters is refused');
select tests.operator_header(' IP Lynx');
select throws_ok(format($$select public.log_operator_access(%L, 'migration')$$,
    tests.id('board_a')), '23514', null, 'a name that starts with a space is refused');
select tests.operator_header('IP Lynx' || chr(160));
select throws_ok(format($$select public.log_operator_access(%L, 'migration')$$,
    tests.id('board_a')), '23514', null, 'a name that ends with a no-break space is refused');
select tests.operator_header(E'IP\tLynx');
select throws_ok(format($$select public.log_operator_access(%L, 'migration')$$,
    tests.id('board_a')), '23514', null, 'a control character is refused');
select tests.operator_header('xnyL PI' || chr(8238));
select throws_ok(format($$select public.log_operator_access(%L, 'migration')$$,
    tests.id('board_a')), '23514', null, 'a character that reverses the text is refused');
select tests.operator_header('IP' || chr(8203) || 'Lynx');
select throws_ok(format($$select public.log_operator_access(%L, 'migration')$$,
    tests.id('board_a')), '23514', null, 'an invisible character is refused');
select tests.raw_header('IP Lynx!');
select throws_ok(format($$select public.log_operator_access(%L, 'migration')$$,
    tests.id('board_a')), '22023', null, 'a header that is not base64 is refused');
select tests.raw_header(encode('\xff'::bytea, 'base64'));
select throws_ok(format($$select public.log_operator_access(%L, 'migration')$$,
    tests.id('board_a')), '22023', null, 'a header that is not UTF-8 text is refused');
select is(
  (select count(*)::int from public.audit_log
   where action = 'operator.access' and details ->> 'reason' = 'migration'),
  0, 'the refused requests recorded nothing');
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- 3. Nobody else is named
-- ---------------------------------------------------------------------------------------

-- A board admin's request carrying the header: their entry is theirs.
select tests.mark('others');
select tests.authenticate_as('board_admin_a');
select tests.operator_header('Équipe TI — Conseil d’Exemple');
select public.log_audit_export(tests.id('board_a'), null, '{}', 0);
select tests.clear_authentication();
select results_eq(
  $$select actor_type::text, actor_user_id, operator_name from public.audit_log
    where action = 'audit_log.exported' and id > tests.since('others')$$,
  format($$values ('user', %L::uuid, null::text)$$, tests.id('board_admin_a')),
  'a signed-in person''s entry never carries the operator''s name'
);

-- The database owner (psql) with the header, writing the name itself: dropped.
select tests.remember('forged', gen_random_uuid());
insert into public.audit_log (actor_type, action, board_id, entity_type, entity_id, operator_name)
values ('service', 'operator.access', tests.id('board_a'), 'board', tests.id('forged'), 'Forged');
select is(
  (select operator_name from public.audit_log where entity_id = tests.id('forged')),
  null, 'only the operator''s own request names it; a name written any other way is dropped');
select tests.no_header();

-- A recorded name never changes.
select throws_ok(
  $$update public.audit_log set operator_name = 'Autre nom' where action = 'operator.access'$$,
  '42501', null, 'the name cannot be changed afterwards (the log is append-only)');

-- ---------------------------------------------------------------------------------------
-- 4. Read back: « Journal d'audit » and the board's whole export
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('board_admin_a');
select results_eq(
  $$select actor_type::text, actor_label, details ->> 'reason' from public.list_audit_entries(
      '{"category": "access"}', null, 100) e
    where e.action = 'operator.access' and e.details ? 'reason' order by e.id$$,
  format($$values ('service', 'Équipe TI — Conseil d’Exemple', 'support'),
    ('service', null::text, 'incident'), ('service', %L, 'restore')$$, repeat('é', 80)),
  'the board''s admins read the operator''s name (null before it was recorded)'
);
select results_eq(
  $$select actor_type::text, actor_label from public.list_audit_entries('{"category": "audit"}',
      null, 100) e
    where e.action = 'audit_log.exported'$$,
  $$values ('user', 'board_admin_a')$$,
  'a person''s entry still reads their name'
);
select tests.clear_authentication();

select tests.as_service();
select results_eq(
  format($$select actor_type::text, actor_name from public.operator_export_audit(%L)
    where action in ('operator.access', 'audit_log.exported') and entity_id is distinct from %L
    order by id$$, tests.id('board_a'), tests.id('forged')),
  format($$values ('service', 'Équipe TI — Conseil d’Exemple'), ('service', null::text),
    ('service', %L), ('user', 'board_admin_a')$$, repeat('é', 80)),
  'the board''s whole export names the operator too, and people as before'
);
select tests.clear_authentication();

select * from finish();
rollback;
