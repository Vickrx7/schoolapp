-- Final safety net, re-runnable: anon gets nothing in public, and every public table must
-- have RLS enabled. Future migrations that add tables should keep this invariant; the RLS
-- test suite checks it too (supabase/tests/00_schema_invariants.test.sql).

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Functions are callable only by roles that were granted EXECUTE explicitly.
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon;

-- Invoker-context helpers (called from non-definer triggers or generated columns).
grant execute on function app.assert_valid_timezone(text) to authenticated, service_role;
grant execute on function app.touch_updated_at() to authenticated, service_role;

do $$
declare
  v_missing text;
begin
  select string_agg(c.relname, ', ')
  into v_missing
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

  if v_missing is not null then
    raise exception 'tables without row level security: %', v_missing;
  end if;
end
$$;
