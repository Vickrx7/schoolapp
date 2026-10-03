-- Before a restore test's backup (the backup-restore CI job and the local drill; DECISIONS D-115),
-- on top of the demo seed:
--   * a person whose access was removed in the database but whose Auth account is not banned yet
--     (the worker bans it a moment later, D-107; a backup can fall in between): the restore must
--     ban it;
--   * two events dispatched ten minutes before the backup, whose queued jobs a backup loses: the
--     restore hands `staff.access_changed` back to the worker, not `absence.published`.
-- apps/admin/src/restore-smoke.int.test.ts checks both after the restore, then removes them.
begin;

with a as (
  insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token,
    recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', 'fe000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'acces.retire@demo.lynx.test', now(),
    '{"provider": "email", "providers": ["email"]}', '{}', now(), now(), '', '', '', '')
  returning id, email
), i as (
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at)
  select gen_random_uuid(), a.id, a.id::text,
    jsonb_build_object('sub', a.id::text, 'email', a.email, 'email_verified', true),
    'email', now(), now()
  from a
  returning user_id
)
insert into public.users (id, email, display_name, deactivated_at)
select i.user_id, 'acces.retire@demo.lynx.test', 'Accès retiré', now() - interval '5 minutes' from i;

insert into public.event_outbox (event_type, aggregate_type, aggregate_id, occurred_at, dispatched_at,
  dispatch_attempts)
values
  ('staff.access_changed', 'user', 'fe000000-0000-4000-8000-000000000001',
    now() - interval '10 minutes', now() - interval '10 minutes', 1),
  ('absence.published', 'absence', 'fe000000-0000-4000-8000-000000000002',
    now() - interval '10 minutes', now() - interval '10 minutes', 1);

commit;
