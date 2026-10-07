-- A database's fingerprint, to compare before a backup and after its restore (DECISIONS D-115;
-- the backup-restore CI job and the local drill): the row count of every table in public and of
-- auth.users, and a hash of the ids of the tables that matter most. Run it on a quiet database
-- (no worker):
--   psql "$URL" -X -A -t -q -f deploy/backup/fingerprint.sql > before.txt
select format('%s.%s %s', schemaname, tablename,
    (xpath('/row/n/text()',
      query_to_xml(format('select count(*) as n from %I.%I', schemaname, tablename), false, true, '')))[1]::text)
  from pg_catalog.pg_tables
  where schemaname = 'public' or (schemaname = 'auth' and tablename in ('users', 'identities'))
  order by schemaname, tablename;

select 'ids public.users ' || coalesce(md5(string_agg(id::text, ',' order by id)), '-') from public.users;
select 'ids public.classes ' || coalesce(md5(string_agg(id::text, ',' order by id)), '-') from public.classes;
select 'ids public.students ' || coalesce(md5(string_agg(id::text, ',' order by id)), '-') from public.students;
select 'ids public.audit_log ' || coalesce(md5(string_agg(id::text, ',' order by id)), '-') from public.audit_log;
select 'ids auth.users ' || coalesce(md5(string_agg(id::text, ',' order by id)), '-') from auth.users;
