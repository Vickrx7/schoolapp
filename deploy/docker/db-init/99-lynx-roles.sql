-- At the self-hosted database's first start (board-hosted; DECISIONS D-114): the logins Supabase
-- Auth (supabase_auth_admin) and PostgREST (authenticator) use, from POSTGRES_PASSWORD, as
-- Supabase's own self-hosting setup does. Run by the image's initialization as a superuser; never
-- again (a password change is a DEPLOYMENT.md step).
\set pgpass `echo "$POSTGRES_PASSWORD"`

-- Not in the server's log (the image logs statements while it initializes).
set log_statement = 'none';
set pgaudit.log = 'none';

alter user authenticator with password :'pgpass';
alter user supabase_auth_admin with password :'pgpass';
