-- Schema-wide security invariants: RLS everywhere, nothing for anon, safe definer functions.
begin;
\ir _helpers.psql
select plan(8);

select is_empty(
  $$select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity$$,
  'every public table has row level security enabled'
);

select is_empty(
  $$select table_name, privilege_type from information_schema.role_table_grants
    where grantee = 'anon' and table_schema = 'public'$$,
  'anon has no privileges on any public table'
);

select is_empty(
  $$select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')$$,
  'anon cannot execute any public function'
);

select is_empty(
  $$select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app') and p.prosecdef
      and not coalesce(array_to_string(p.proconfig, ',') like '%search_path=%', false)$$,
  'every security definer function pins search_path'
);

select ok(
  not has_table_privilege('authenticated', 'public.student_alerts', 'select')
  and not has_table_privilege('authenticated', 'public.student_alerts', 'insert')
  and not has_table_privilege('authenticated', 'public.student_alerts', 'update')
  and not has_table_privilege('authenticated', 'public.student_alerts', 'delete'),
  'authenticated has no direct access to student_alerts'
);

select ok(
  not has_table_privilege('authenticated', 'public.event_outbox', 'select')
  and not has_table_privilege('authenticated', 'public.event_outbox', 'insert'),
  'authenticated has no access to the event outbox'
);

select ok(
  not has_table_privilege('authenticated', 'public.sub_access_codes', 'select')
  and not has_table_privilege('authenticated', 'public.sub_sessions', 'select'),
  'authenticated has no direct access to substitute codes or sessions'
);

select ok(
  not has_table_privilege('authenticated', 'public.audit_log', 'insert')
  and not has_table_privilege('authenticated', 'public.audit_log', 'update')
  and not has_table_privilege('authenticated', 'public.audit_log', 'delete'),
  'authenticated cannot write the audit log'
);

select * from finish();
rollback;
