-- The audit log is append-only and closed to the API; the outbox is internal.
begin;
\ir _helpers.psql
select plan(11);
select tests.build_fixture();

do $$
begin
  perform app.log_audit('test.event', tests.id('board_a'), tests.id('school_a1'), 'class', tests.id('class_a'));
  perform app.log_audit('test.event', tests.id('board_b'), tests.id('school_b1'), 'class', tests.id('class_b'));
end
$$;

select throws_ok($$update public.audit_log set action = 'tampered.event'$$, '42501', null,
  'audit entries cannot be modified, even by the database owner');
select throws_ok($$delete from public.audit_log$$, '42501', null,
  'audit entries cannot be deleted outside the retention purge');
select throws_ok($$truncate public.audit_log$$, '42501', null, 'the audit log cannot be truncated');

-- The raw table is closed to the API (D-103): everyone reads through public.list_audit_entries
-- (supabase/tests/28_audit_viewer.test.sql pins who sees what).
select tests.authenticate_as('teacher_a');
select throws_ok($$select count(*) from public.audit_log$$, '42501', null,
  'teachers cannot read the audit table');
select throws_ok(
  $$insert into public.audit_log (action) values ('fake.entry')$$,
  '42501', null, 'nobody can write audit entries through the API'
);
select throws_ok($$select count(*) from public.event_outbox$$, '42501', null,
  'the event outbox is not readable through the API');
select tests.clear_authentication();

select tests.authenticate_as('principal_a');
select throws_ok($$select count(*) from public.audit_log$$, '42501', null,
  'principals cannot read the audit table directly either');
select tests.clear_authentication();

select tests.authenticate_as('board_admin_a');
select throws_ok($$select count(*) from public.audit_log$$, '42501', null,
  'nor can board admins');
select tests.clear_authentication();

select is((select actor_type::text from public.audit_log where action = 'test.event' limit 1), 'system',
  'entries written without a signed-in user are attributed to the system');

-- The retention job can purge old entries by opting in explicitly.
set local app.audit_retention_purge = 'on';
select lives_ok($$delete from public.audit_log where action = 'test.event'$$,
  'the retention purge can delete entries when it opts in');
set local app.audit_retention_purge = 'off';

do $$
begin
  perform app.emit_event('test.happened', tests.id('board_a'), tests.id('school_a1'), 'class', tests.id('class_a'),
    '{"hello": "world"}');
end
$$;
select is((select payload from public.event_outbox where event_type = 'test.happened'), '{"hello": "world"}'::jsonb,
  'emit_event writes an outbox row with its payload');

select * from finish();
rollback;
