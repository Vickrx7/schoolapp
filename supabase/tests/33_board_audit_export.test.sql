-- Phase 6 review fixes, round B (supabase/migrations/20261201090600_phase6_board_audit_export.sql):
-- the operator exports a board's whole audit log, every audience and date, and records it; a
-- board can be deleted only within 7 days of such an export.
-- DECISIONS: D-103, D-106, D-122.
begin;
\ir _helpers.psql
select plan(25);
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

-- Board A's entries (its own and its schools'), as the table holds them.
create function tests.board_rows(p_board text)
returns setof public.audit_log
language sql
security definer
set search_path = ''
as $$
  select a.* from public.audit_log a
  where a.board_id = tests.id(p_board)
     or a.school_id in (select s.id from public.schools s where s.board_id = tests.id(p_board))
  order by a.id;
$$;
grant execute on function tests.board_rows(text) to service_role;

-- Entries of every audience: an old alert reading (beyond the viewer's 365 days), a teacher's
-- terms (operator only), an invitation at school A2, IP Lynx's access, and board B's alert.
insert into public.audit_log (occurred_at, actor_user_id, actor_type, action, board_id, school_id,
  entity_type, entity_id, details) values
  (now() - interval '800 days', tests.id('principal_a'), 'user', 'student_alert.viewed',
    tests.id('board_a'), tests.id('school_a1'), 'student', gen_random_uuid(), '{}'),
  (now() - interval '2 days', tests.id('teacher_a'), 'user', 'user.terms_accepted',
    tests.id('board_a'), null, 'user', tests.id('teacher_a'), '{"version": "2026-10-pilote-2"}'),
  (now() - interval '1 day', tests.id('board_admin_a'), 'user', 'staff.invited',
    tests.id('board_a'), tests.id('school_a2'), 'staff_invitation', gen_random_uuid(), '{}'),
  (now() - interval '1 day', null, 'service', 'operator.access', tests.id('board_a'), null,
    'board', tests.id('board_a'), '{"reason": "support"}'),
  (now(), tests.id('teacher_b'), 'user', 'student_alert.viewed', tests.id('board_b'),
    tests.id('school_b1'), 'student', gen_random_uuid(), '{}');

-- 1. The operator only.
select tests.authenticate_as('board_admin_a');
select throws_ok(format('select * from public.operator_export_audit(%L)', tests.id('board_a')),
  '42501', null, 'a board admin cannot export the whole log');
select throws_ok(format('select public.operator_log_audit_export(%L, 0, 0)', tests.id('board_a')),
  '42501', null, 'nor record an export');
select tests.clear_authentication();
select ok(not has_function_privilege('anon', 'public.operator_export_audit(uuid,bigint,integer)',
  'execute'), 'nor can anyone signed out');

-- 2. The export: every entry of the board, every audience and date, oldest first.
select tests.as_service();
create temp table export_a as
  select * from public.operator_export_audit(tests.id('board_a'), 0, 1000);
select results_eq(
  $$select id from export_a order by id$$,
  $$select id from tests.board_rows('board_a')$$,
  'it holds every entry of the board and of its schools, in order'
);
select is((select count(*)::int from export_a where school_id = tests.id('school_b1')), 0,
  'and nothing of another board');
select set_eq(
  $$select distinct audience from export_a where action in
    ('student_alert.viewed', 'user.terms_accepted', 'staff.invited', 'operator.access')$$,
  $$values ('direction'), ('operator'), ('direction_board'), ('board')$$,
  'every audience, the operator''s included'
);
select ok(exists (select 1 from export_a where occurred_at < now() - interval '700 days'),
  'and entries older than the viewer''s year');
select results_eq(
  $$select school_name, actor_name, category from export_a where action = 'staff.invited'$$,
  $$values ('School A2'::text, 'board_admin_a'::text, 'access'::text)$$,
  'with the school''s and the acting person''s names'
);
select results_eq(
  $$select actor_type::text, actor_name, details ->> 'reason' from export_a
    where action = 'operator.access'$$,
  $$values ('service', null::text, 'support')$$,
  'and the details as stored'
);
select results_eq(
  format($$select id from public.operator_export_audit(%L, %s, 1)$$, tests.id('board_a'),
    (select min(id) from export_a)),
  $$select id from export_a order by id offset 1 limit 1$$,
  'pages follow the last id'
);
select throws_ok(format('select * from public.operator_export_audit(%L, 0, 1001)',
  tests.id('board_a')), '22023', null, 'a page holds at most 1,000 entries');
select throws_ok(format('select * from public.operator_export_audit(%L)', gen_random_uuid()),
  '22023', null, 'an unknown board is refused');

-- 3. Recording it: only a file that holds every entry up to its last one.
select throws_ok(format('select public.operator_log_audit_export(%L, %s, %s)', tests.id('board_a'),
    (select max(id) from export_a), (select count(*) - 1 from export_a)),
  '22023', null, 'an export that misses an entry is refused');
select lives_ok(format('select public.operator_log_audit_export(%L, %s, %s)', tests.id('board_a'),
    (select max(id) from export_a), (select count(*) from export_a)),
  'a complete export is recorded');
select tests.clear_authentication();
select results_eq(
  $$select actor_type::text, board_id, school_id, (details ->> 'rows')::int,
      (details ->> 'last_id')::bigint = (select max(id) from export_a)
    from public.audit_log where action = 'audit_log.operator_exported'$$,
  $$select 'service'::text, tests.id('board_a'), null::uuid, (select count(*)::int from export_a), true$$,
  'as IP Lynx, for the board, with its count and last entry'
);
select tests.authenticate_as('board_admin_a');
select is(
  (select count(*)::int from public.list_audit_entries('{"category": "audit"}'::jsonb)
    where action = 'audit_log.operator_exported'),
  1, 'the board''s admins read it in their log'
);
select tests.authenticate_as('principal_a');
select is(
  (select count(*)::int from public.list_audit_entries('{"category": "audit"}'::jsonb)
    where action = 'audit_log.operator_exported'),
  0, 'a principal does not'
);
select tests.clear_authentication();

-- 4. Deleting a board needs an export of the last 7 days.
select tests.as_service();
select throws_ok(format($$select public.operator_delete_board(%L, 'not-the-slug')$$,
  tests.id('board_b')), '22023', null, 'the slug is checked first');
select throws_ok(format($$select public.operator_delete_board(%L, %L)$$, tests.id('board_b'),
    (select slug from public.boards where id = tests.id('board_b'))),
  'LXB01', null, 'a board whose log was never exported is not deleted');
select tests.clear_authentication();
insert into public.audit_log (occurred_at, actor_type, action, board_id, entity_type, details)
values (now() - interval '8 days', 'service', 'audit_log.operator_exported', tests.id('board_b'),
  'audit_log', jsonb_build_object('rows', 0, 'last_id', 0));
select tests.as_service();
select throws_ok(format($$select public.operator_delete_board(%L, %L)$$, tests.id('board_b'),
    (select slug from public.boards where id = tests.id('board_b'))),
  'LXB01', null, 'nor one whose last export is older than 7 days');
select tests.clear_authentication();

create temp table export_b as select * from tests.board_rows('board_b');
grant select on export_b to service_role;
select tests.as_service();
select lives_ok(format('select public.operator_log_audit_export(%L, %s, %s)', tests.id('board_b'),
    (select max(id) from export_b), (select count(*) from export_b)),
  'board B''s log is exported');
select tests.clear_authentication();
-- Written after the export: not in the file.
insert into public.audit_log (actor_type, action, board_id, entity_type, entity_id, details)
values ('service', 'operator.access', tests.id('board_b'), 'board', tests.id('board_b'),
  '{"reason": "support"}');
select tests.as_service();
create temp table deleted_b as
  select public.operator_delete_board(tests.id('board_b'),
    (select slug from public.boards where id = tests.id('board_b'))) as result;
select tests.clear_authentication();
select is((select (result ->> 'auditRowsSinceExport')::int from deleted_b), 1,
  'then the board is deleted, saying how many entries came after the export');
select is((select count(*)::int from public.boards where id = tests.id('board_b')), 0,
  'the board is gone');
select is((select count(*)::int from public.audit_log where board_id = tests.id('board_b')), 0,
  'with its whole log, the export''s record included');
select ok((select count(*) from public.audit_log where board_id = tests.id('board_a')) > 0,
  'another board keeps its log');

select * from finish();
rollback;
