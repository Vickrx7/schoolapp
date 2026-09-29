-- Schema-wide security invariants: RLS everywhere, nothing for anon, safe definer functions.
begin;
\ir _helpers.psql
select plan(19);

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
    where n.nspname in ('public', 'app', 'sub_portal') and p.prosecdef
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
  not has_table_privilege('authenticated', 'public.sub_code_attempts', 'select')
  and not has_table_privilege('authenticated', 'public.sub_code_attempts', 'insert')
  and not has_table_privilege('authenticated', 'public.sub_plan_classes', 'select')
  and not has_table_privilege('authenticated', 'public.sub_plan_classes', 'insert')
  and not has_table_privilege('authenticated', 'public.sub_plan_classes', 'delete'),
  'authenticated has no direct access to code attempts or the classes a plan covers'
);

select ok(
  not has_table_privilege('authenticated', 'public.absences', 'insert')
  and not has_table_privilege('authenticated', 'public.absences', 'update')
  and not has_table_privilege('authenticated', 'public.absences', 'delete')
  and not has_any_column_privilege('authenticated', 'public.absences', 'insert')
  and not has_any_column_privilege('authenticated', 'public.absences', 'update'),
  'absences are written only through functions'
);

select ok(
  not has_any_column_privilege('authenticated', 'public.sub_plans', 'insert')
  and not has_any_column_privilege('authenticated', 'public.sub_plans', 'update')
  and not has_table_privilege('authenticated', 'public.sub_plans', 'delete')
  and not has_any_column_privilege('authenticated', 'public.sub_reports', 'insert')
  and not has_any_column_privilege('authenticated', 'public.sub_reports', 'update')
  and not has_table_privilege('authenticated', 'public.sub_reports', 'delete'),
  'substitute plans and reports are read-only through the API'
);

select ok(
  not has_column_privilege('authenticated', 'public.lesson_progress', 'sub_report_id', 'insert')
  and not has_column_privilege('authenticated', 'public.lesson_progress', 'sub_report_id', 'update')
  and not has_column_privilege('authenticated', 'public.lesson_progress', 'completed_by', 'update'),
  'progress cannot be tied to a substitute report through the API'
);

select ok(
  not has_column_privilege('authenticated', 'public.class_sub_profiles', 'updated_by', 'insert')
  and not has_column_privilege('authenticated', 'public.class_sub_profiles', 'updated_by', 'update')
  and not has_column_privilege('authenticated', 'public.class_sub_profiles', 'class_id', 'update'),
  'the Fiche editor and class are set by the database'
);

select ok(
  not has_table_privilege('authenticated', 'public.audit_log', 'insert')
  and not has_table_privilege('authenticated', 'public.audit_log', 'update')
  and not has_table_privilege('authenticated', 'public.audit_log', 'delete'),
  'authenticated cannot write the audit log'
);

-- The substitute portal's role (D-049): it runs the portal functions and nothing else.
select set_eq(
  $$select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app', 'sub_portal')
      and has_function_privilege('lynx_sub_portal', p.oid, 'execute')$$,
  $$values ('sub_portal.redeem(text[],text,text)'), ('sub_portal.load(text,integer,text)'),
           ('sub_portal.alerts(text)'), ('sub_portal.end_session(text)'),
           ('sub_portal.save_report(text,jsonb,text,smallint,boolean)')$$,
  'lynx_sub_portal executes exactly the portal functions, and no public or app function'
);

select is_empty(
  $$select c.oid::regclass::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'app', 'sub_portal') and c.relkind in ('r', 'p', 'v', 'm', 'S')
      and (has_table_privilege('lynx_sub_portal', c.oid, 'select')
        or has_table_privilege('lynx_sub_portal', c.oid, 'insert')
        or has_table_privilege('lynx_sub_portal', c.oid, 'update')
        or has_table_privilege('lynx_sub_portal', c.oid, 'delete'))$$,
  'lynx_sub_portal has no table privileges'
);

select results_eq(
  $$select rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolbypassrls, rolreplication
    from pg_roles where rolname = 'lynx_sub_portal'$$,
  $$values (false, false, false, false, false, false)$$,
  'lynx_sub_portal is a plain role: no inheritance, no bypass of row level security'
);

select ok(
  exists (select 1 from pg_db_role_setting s
          where s.setrole = 'lynx_sub_portal'::regrole and s.setdatabase = 0
            and 'statement_timeout=5s' = any (s.setconfig)),
  'portal calls are cut off after 5 seconds'
);

select ok(
  not pg_has_role('authenticator', 'lynx_sub_portal', 'member')
  and not pg_has_role('anon', 'lynx_sub_portal', 'member')
  and not pg_has_role('authenticated', 'lynx_sub_portal', 'member')
  and not pg_has_role('service_role', 'lynx_sub_portal', 'member'),
  'no API role can become the portal role'
);

select is_empty(
  $$select r.rolname, p.proname
    from unnest(array['anon', 'authenticated', 'service_role']) r (rolname)
    cross join pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'sub_portal'
      and (has_schema_privilege(r.rolname, 'sub_portal', 'usage')
        or has_function_privilege(r.rolname, p.oid, 'execute'))$$,
  'API roles can neither use the sub_portal schema nor execute its functions'
);

select * from finish();
rollback;
