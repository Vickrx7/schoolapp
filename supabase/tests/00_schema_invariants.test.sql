-- Schema-wide security invariants: RLS everywhere, nothing for anon, safe definer functions.
begin;
\ir _helpers.psql
select plan(13);

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

select * from finish();
rollback;
