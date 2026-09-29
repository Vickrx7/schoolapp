-- Substitute access codes and the portal: issuing codes (owner, direction, office), redeeming
-- them as the portal role with throttling, loading the day's plan, alerts, revoking and ending
-- access, and what the portal role may not do (DECISIONS D-049, D-050, D-051, D-056, D-060).
-- MACs, device and network keys are fixed 64-hex strings: the web server computes them.
begin;
\ir _helpers.psql
select plan(73);
select tests.build_fixture();

-- A 64-hex key, standing for an HMAC the web server would send.
create function tests.hex(p_text text)
returns text
language sql
as $$
  select encode(extensions.digest(p_text, 'sha256'), 'hex');
$$;

-- The portal role has no JWT claims and no access to pgTAP or to this schema, so each call
-- switches to it and back inside one of these helpers; the assertions stay with the caller.
create function tests.portal_redeem(p_macs text[], p_device text, p_ip text)
returns jsonb
language plpgsql
as $$
declare
  v jsonb;
begin
  perform tests.as_portal();
  select to_jsonb(r) into v from sub_portal.redeem(p_macs, p_device, p_ip) r;
  perform set_config('role', 'none', true);
  return v;
end;
$$;

create function tests.portal_load(p_token text, p_known integer default null,
  p_purpose text default 'view')
returns jsonb
language plpgsql
as $$
declare
  v jsonb;
begin
  perform tests.as_portal();
  v := sub_portal.load(p_token, p_known, p_purpose);
  perform set_config('role', 'none', true);
  return v;
end;
$$;

create function tests.portal_alerts(p_token text)
returns setof jsonb
language plpgsql
as $$
begin
  perform tests.as_portal();
  return query select to_jsonb(r) from sub_portal.alerts(p_token) r;
  perform set_config('role', 'none', true);
end;
$$;

create function tests.portal_end(p_token text)
returns void
language plpgsql
as $$
begin
  perform tests.as_portal();
  perform sub_portal.end_session(p_token);
  perform set_config('role', 'none', true);
end;
$$;

-- Runs any statement as the portal role (for what it must not be able to do).
create function tests.portal_exec(p_sql text)
returns void
language plpgsql
as $$
begin
  perform tests.as_portal();
  execute p_sql;
  perform set_config('role', 'none', true);
end;
$$;

-- Redemptions by name: the code `c`, the device `d` and the network `i` (keys derived from the
-- names), kept with their outcome and token.
create table tests.redeemed (key text primary key, result jsonb not null);

create function tests.redeem_as(p_key text, p_code text, p_device text, p_ip text)
returns jsonb
language plpgsql
as $$
declare
  v jsonb := tests.portal_redeem(array[tests.hex('mac:' || p_code)], tests.hex('dev:' || p_device),
    tests.hex('ip:' || p_ip));
begin
  insert into tests.redeemed (key, result) values (p_key, v)
  on conflict (key) do update set result = excluded.result;
  return v;
end;
$$;

create function tests.token(p_key text)
returns text
language sql
as $$
  select result ->> 'session_token' from tests.redeemed where key = p_key;
$$;

create function tests.code_id(p_code text)
returns uuid
language sql
as $$
  select id from public.sub_access_codes where code_hash = tests.hex(tests.hex('mac:' || p_code));
$$;

-- Opens a code's window around the real clock (the plan date is weeks ahead).
create function tests.open_window(p_code text)
returns void
language sql
as $$
  update public.sub_access_codes
  set valid_from = now() - interval '1 hour', expires_at = now() + interval '2 hours'
  where code_hash = tests.hex(tests.hex('mac:' || p_code));
$$;

-- Audit rows of this test's boards (a shared database keeps other runs' rows).
create function tests.audits(p_action text, p_actor public.audit_actor_type)
returns integer
language sql
as $$
  select count(*)::integer from public.audit_log
  where action = p_action and actor_type = p_actor
    and board_id in (tests.id('board_a'), tests.id('board_b'));
$$;

grant execute on all functions in schema tests to authenticated;

-- A school day two weeks ahead for the plans, and another for a spare absence.
select tests.authenticate_as('teacher_a');
select tests.remember('abs_a', public.publish_absence(tests.id('school_a1'), tests.school_day(14),
  tests.school_day(14), 'full_day', 'Merci!', true, gen_random_uuid(),
  tests.plan_items(array[tests.school_day(14)], array[tests.id('class_a')])));
select tests.remember('abs_x', public.publish_absence(tests.id('school_a1'), tests.school_day(21),
  tests.school_day(21), 'full_day', null, true, gen_random_uuid(),
  tests.plan_items(array[tests.school_day(21)], array[tests.id('class_a')])));
select tests.clear_authentication();
select tests.authenticate_as('teacher_b');
select tests.remember('abs_b', public.publish_absence(tests.id('school_b1'), tests.school_day(14),
  tests.school_day(14), 'full_day', null, true, gen_random_uuid(),
  tests.plan_items(array[tests.school_day(14)], array[tests.id('class_b')])));
select tests.clear_authentication();
select tests.remember('plan_a', (select id from public.sub_plans where absence_id = tests.id('abs_a')));
select tests.remember('plan_x', (select id from public.sub_plans where absence_id = tests.id('abs_x')));
select tests.remember('plan_b', (select id from public.sub_plans where absence_id = tests.id('abs_b')));

-- Alerts: one in the covered class, one for an inactive student there, one in another class of
-- the school, one at another board.
insert into public.students (id, class_id, first_name, active)
values (tests.remember('student_gone', gen_random_uuid()), tests.id('class_a'), 'Parti', false);
insert into public.student_alerts (id, student_id, class_id, category, body_ciphertext) values
  (tests.remember('alert_a1', gen_random_uuid()), tests.id('student_a1'), tests.id('class_a'), 'allergy', 'v1.a1'),
  (tests.remember('alert_gone', gen_random_uuid()), tests.id('student_gone'), tests.id('class_a'), 'medical', 'v1.gone'),
  (tests.remember('alert_other', gen_random_uuid()), tests.id('student_a_other'), tests.id('class_a_other'), 'medical', 'v1.other'),
  (tests.remember('alert_b', gen_random_uuid()), tests.id('student_b'), tests.id('class_b'), 'safety', 'v1.b');

-- ---------------------------------------------------------------------------------------
-- Issuing codes
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select lives_ok(
  $$select public.issue_sub_access_code(tests.id('plan_a'), tests.hex('mac:c1'))$$,
  'the absent teacher issues a code'
);
select throws_ok(
  $$select public.issue_sub_access_code(tests.id('plan_a'), 'not-a-mac')$$,
  '22023', null, 'the web server must send a MAC, never the code'
);
select tests.clear_authentication();

select tests.authenticate_as('office_a');
select lives_ok(
  $$select public.issue_sub_access_code(tests.id('plan_a'), tests.hex('mac:c2'))$$,
  'office staff issue a code'
);
select tests.clear_authentication();

select tests.remember('code_c1', tests.code_id('c1'));
select tests.remember('code_c2', tests.code_id('c2'));
select tests.authenticate_as('principal_a');
select throws_ok(
  $$select public.issue_sub_access_code(tests.id('plan_a'), tests.hex('mac:c3'))$$,
  'LXS13', null, 'at most two codes are active per plan'
);
select lives_ok(
  $$select public.revoke_sub_access_code(tests.id('code_c2'))$$,
  'the principal cuts a code'
);
select tests.clear_authentication();

-- Custom access hours (the window is computed in SQL in the school's time zone).
update public.schools
set settings = '{"substitute": {"accessFrom": "06:30", "accessUntil": "17:00"}}'
where id = tests.id('school_a1');
select tests.authenticate_as('principal_a');
select lives_ok(
  $$select public.issue_sub_access_code(tests.id('plan_a'), tests.hex('mac:c3'))$$,
  'and issues another one in its place'
);
select tests.clear_authentication();
update public.schools set settings = '{}' where id = tests.id('school_a1');

select results_eq(
  $$select code_hash, valid_on, valid_from, expires_at, max_devices::int, created_by
    from public.sub_access_codes where code_hash = tests.hex(tests.hex('mac:c3'))$$,
  $$values (tests.hex(tests.hex('mac:c3')), tests.school_day(14),
      (tests.school_day(14) + time '06:30') at time zone 'America/Toronto',
      (tests.school_day(14) + time '17:00') at time zone 'America/Toronto',
      2, tests.id('principal_a'))$$,
  'the database stores sha256 of the MAC, the plan date and the school''s access hours'
);
select is_empty(
  $$select 1 from public.sub_access_codes where code_hash in (tests.hex('mac:c1'), tests.hex('mac:c3'))$$,
  'the MAC itself is never stored'
);
select results_eq(
  $$select valid_from, expires_at from public.sub_access_codes where id = tests.code_id('c1')$$,
  $$select valid_from, expires_at from app.sub_access_window(tests.id('school_a1'), tests.school_day(14))$$,
  'by default a code is valid on its day from 05:00 to 18:00, local time'
);

select tests.authenticate_as('teacher_a_other');
select throws_ok(
  $$select public.issue_sub_access_code(tests.id('plan_a'), tests.hex('mac:c9'))$$,
  '42501', null, 'a colleague cannot issue a code for someone else''s plan'
);
select tests.clear_authentication();
select tests.authenticate_as('teacher_b');
select throws_ok(
  $$select public.issue_sub_access_code(tests.id('plan_a'), tests.hex('mac:c9'))$$,
  '42501', null, 'nor can a teacher from another board'
);
select tests.clear_authentication();

-- A day that is already over (as superuser: publishing refuses past days).
insert into public.absences (id, teacher_id, school_id, starts_on, ends_on, part, status, published_at)
values (tests.remember('abs_past', gen_random_uuid()), tests.id('teacher_a'), tests.id('school_a1'),
  current_date - 3, current_date - 3, 'full_day', 'published', now() - interval '4 days');
insert into public.sub_plans (id, absence_id, plan_date, plan, review_deadline)
values (tests.remember('plan_past', gen_random_uuid()), tests.id('abs_past'), current_date - 3,
  tests.plan_json(current_date - 3), now() - interval '3 days');
select tests.authenticate_as('teacher_a');
select throws_ok(
  $$select public.issue_sub_access_code(tests.id('plan_past'), tests.hex('mac:c9'))$$,
  'LXS14', null, 'no code for a day that is over'
);
select tests.clear_authentication();

update public.module_entitlements set enabled = false
where school_id = tests.id('school_a1') and module = 'teaching';
select tests.authenticate_as('teacher_a');
select throws_ok(
  $$select public.issue_sub_access_code(tests.id('plan_x'), tests.hex('mac:c9'))$$,
  '42501', null, 'no code without the Teaching module'
);
select tests.clear_authentication();
update public.module_entitlements set enabled = true
where school_id = tests.id('school_a1') and module = 'teaching';

select results_eq(
  $$select count(*)::int, bool_and(board_id = tests.id('board_a') and school_id = tests.id('school_a1')
      and entity_id = tests.id('plan_a') and not details ? 'code_hash')
    from public.audit_log where action = 'sub_code.issued' and board_id = tests.id('board_a')$$,
  $$values (3, true)$$,
  'issuing is audited with the school and board, never with the code'
);

-- ---------------------------------------------------------------------------------------
-- Redeeming (as lynx_sub_portal)
-- ---------------------------------------------------------------------------------------

select tests.open_window('c1');
select tests.open_window('c3');

select results_eq(
  $$select v ->> 'outcome', char_length(v ->> 'session_token'),
      (v ->> 'expires_at')::timestamptz = (select expires_at from public.sub_access_codes
                                           where id = tests.code_id('c1'))
    from (select tests.redeem_as('s1', 'c1', 'd1', 'i1') as v) r$$,
  $$values ('ok', 43, true)$$,
  'the right code opens a session: a 43-character token, valid until the code expires'
);
select results_eq(
  $$select session_token_hash, device_key, sub_plan_id, access_code_id
    from public.sub_sessions where access_code_id = tests.code_id('c1')$$,
  $$values (tests.hex(tests.token('s1')), tests.hex('dev:d1'), tests.id('plan_a'), tests.code_id('c1'))$$,
  'the session keeps only the token''s hash and the device key'
);
select results_eq(
  $$select actor_type::text, actor_user_id, board_id, school_id, entity_id
    from public.audit_log where action = 'sub_code.redeemed' and board_id = tests.id('board_a')$$,
  $$values ('substitute', null::uuid, tests.id('board_a'), tests.id('school_a1'), tests.id('plan_a'))$$,
  'redeeming is audited as the substitute, with the school and board'
);
select ok(
  exists (select 1 from public.event_outbox
          where event_type = 'sub_session.started' and aggregate_id = tests.id('plan_a')
            and payload ?& array['subPlanId', 'sessionId']),
  'sub_session.started is emitted'
);

select is(
  tests.redeem_as('bad', 'nope', 'dt', 'it') ->> 'outcome', 'invalid',
  'a wrong code is refused'
);
select is(
  (select count(*)::int from public.sub_code_attempts
   where device_key = tests.hex('dev:dt') and not succeeded),
  1, 'and the failed attempt is recorded'
);
select tests.redeem_as('bad', 'nope', 'dt', 'it') from generate_series(1, 4);
select results_eq(
  $$select v ->> 'outcome', (v ->> 'retry_after')::int > 0
    from (select tests.redeem_as('bad', 'c1', 'dt', 'it') as v) r$$,
  $$values ('wait', true)$$,
  'after 5 failures the device must wait, even with the right code'
);
select is(
  (select count(*)::int from public.sub_code_attempts where device_key = tests.hex('dev:dt')),
  5, 'no attempt is recorded while waiting'
);
select is(
  tests.redeem_as('s2', 'c1', 'd2', 'it') ->> 'outcome', 'ok',
  'another device on the same network still signs in'
);
insert into public.sub_code_attempts (device_key, ip_key, succeeded)
select tests.hex('dev:crowd' || i), tests.hex('ip:wifi'), false from generate_series(1, 50) i;
select is(
  tests.redeem_as('bad', 'c1', 'fresh', 'wifi') ->> 'outcome', 'wait',
  'after 50 failures from a network, every device there waits'
);
select is(
  tests.redeem_as('bad', 'c1', 'd3', 'i3') ->> 'outcome', 'used_up',
  'a code works on two devices at most'
);
select is(
  tests.redeem_as('s1b', 'c1', 'd1', 'i1') ->> 'outcome', 'ok',
  'the same device may sign in again'
);
select is(
  (select count(*)::int from public.sub_sessions
   where device_key = tests.hex('dev:d1') and revoked_at is null),
  1, 'and its earlier session ends (one live session per device)'
);
select is(
  tests.redeem_as('bad', 'c2', 'd4', 'i4') ->> 'outcome', 'invalid',
  'a revoked code is refused'
);

insert into public.sub_access_codes (sub_plan_id, code_hash, valid_on, valid_from, expires_at) values
  (tests.id('plan_a'), tests.hex(tests.hex('mac:past')), tests.school_day(14),
    now() - interval '5 hours', now() - interval '1 hour'),
  (tests.id('plan_a'), tests.hex(tests.hex('mac:future')), tests.school_day(14),
    now() + interval '1 hour', now() + interval '5 hours');
select results_eq(
  $$select tests.redeem_as('bad', 'past', 'd5', 'i5') ->> 'outcome'
    union all select tests.redeem_as('bad', 'future', 'd5', 'i5') ->> 'outcome'$$,
  $$values ('invalid'), ('invalid')$$,
  'a code is refused outside its window'
);

select tests.authenticate_as('teacher_a');
select public.issue_sub_access_code(tests.id('plan_x'), tests.hex('mac:cx'));
select tests.clear_authentication();
select tests.open_window('cx');
update public.absences set status = 'cancelled' where id = tests.id('abs_x');
select is(
  tests.redeem_as('bad', 'cx', 'd6', 'i6') ->> 'outcome', 'invalid',
  'a code for a cancelled absence is refused'
);
update public.absences set status = 'published' where id = tests.id('abs_x');

update public.module_entitlements set enabled = false
where school_id = tests.id('school_a1') and module = 'teaching';
select is(
  tests.redeem_as('bad', 'cx', 'd6', 'i6') ->> 'outcome', 'invalid',
  'a code is refused when the school no longer has the Teaching module'
);
select is(
  tests.portal_load(tests.token('s1b')) ->> 'status', 'expired',
  'and its sessions end'
);
update public.module_entitlements set enabled = true
where school_id = tests.id('school_a1') and module = 'teaching';

-- ---------------------------------------------------------------------------------------
-- Loading the day
-- ---------------------------------------------------------------------------------------

select results_eq(
  $$select v -> 'context' ->> 'released', v -> 'plan', v -> 'roster',
      (v -> 'context' ->> 'releaseAt')::timestamptz, v -> 'context' ->> 'absenceNote'
    from (select tests.portal_load(tests.token('s1b')) as v) r$$,
  $$values ('false', 'null'::jsonb, 'null'::jsonb,
      (tests.school_day(14) + time '07:30') at time zone 'America/Toronto', null::text)$$,
  'before release the substitute only learns when the plan will be ready'
);
select is(tests.audits('sub_plan.viewed', 'substitute'), 0, 'and nothing is audited as viewed');

select tests.authenticate_as('teacher_a');
select public.release_sub_plan(tests.id('plan_a'));
select tests.clear_authentication();

select results_eq(
  $$select v ->> 'status', v -> 'context' ->> 'planId', v -> 'context' ->> 'teacherName',
      v -> 'context' ->> 'absenceNote', v -> 'plan' -> 'plan' ->> 'schemaVersion'
    from (select tests.portal_load(tests.token('s1b')) as v) r$$,
  $$values ('ok', tests.id('plan_a')::text, 'teacher_a', 'Merci!', '1')$$,
  'once released, the plan and the teacher''s note are shown'
);
select set_eq(
  $$select s ->> 'firstName'
    from jsonb_array_elements(tests.portal_load(tests.token('s1b'), null, 'poll') -> 'roster') s$$,
  $$values ('Léa'), ('Nathan')$$,
  'the roster is the covered class''s active students, from the database'
);
select is(tests.audits('sub_plan.viewed', 'substitute'), 1, 'viewing is audited once');
select tests.portal_load(tests.token('s1b'));
select is(tests.audits('sub_plan.viewed', 'substitute'), 1,
  'a second view of the same version writes nothing');

select tests.authenticate_as('teacher_a');
select public.save_sub_plan_edits(tests.id('plan_a'), '{"overview": "Bonne journée!"}', 0);
select tests.clear_authentication();
select is(
  tests.portal_load(tests.token('s1b'), null, 'poll') -> 'plan' -> 'edits' ->> 'overview',
  'Bonne journée!', 'the teacher''s edits reach the substitute'
);
select is(tests.audits('sub_plan.viewed', 'substitute'), 1, 'polling is never audited');
select tests.portal_load(tests.token('s1b'));
select is(tests.audits('sub_plan.viewed', 'substitute'), 2, 'a new version is audited again');
select is(
  tests.portal_load(tests.token('s1b'),
    (select content_version from public.sub_plans where id = tests.id('plan_a')), 'poll') -> 'plan',
  to_jsonb('unchanged'::text),
  'the page learns cheaply that nothing changed'
);
select tests.portal_load(tests.token('s1b'), null, 'pdf');
select is(tests.audits('sub_plan.printed', 'substitute'), 1, 'every PDF is audited');
select ok(
  (select last_seen_at is not null from public.sub_sessions
   where session_token_hash = tests.hex(tests.token('s1b'))),
  'the office sees when the device was last active'
);
select results_eq(
  $$select tests.portal_load('x') ->> 'status'
    union all select tests.portal_load(repeat('A', 43)) ->> 'status'
    union all select tests.portal_load(null) ->> 'status'$$,
  $$values ('expired'), ('expired'), ('expired')$$,
  'an unknown token gets nothing'
);

-- The other board's plan, with its own code.
select tests.authenticate_as('teacher_b');
select public.issue_sub_access_code(tests.id('plan_b'), tests.hex('mac:cb'));
select tests.clear_authentication();
select tests.open_window('cb');
select tests.redeem_as('sb', 'cb', 'e1', 'i7');
select results_eq(
  $$select tests.portal_load(tests.token('s1b'), null, 'poll') -> 'context' ->> 'planId'
    union all select tests.portal_load(tests.token('sb'), null, 'poll') -> 'context' ->> 'planId'$$,
  $$values (tests.id('plan_a')::text), (tests.id('plan_b')::text)$$,
  'a session only ever reaches its own plan'
);

-- ---------------------------------------------------------------------------------------
-- Alerts
-- ---------------------------------------------------------------------------------------

select results_eq(
  $$select (a ->> 'alert_id')::uuid, a ->> 'body_ciphertext' from tests.portal_alerts(tests.token('s1b')) a$$,
  $$values (tests.id('alert_a1'), 'v1.a1')$$,
  'alerts: ciphertext only, for active students of the covered classes'
);
select tests.portal_alerts(tests.token('s1b'));
select results_eq(
  $$select count(*)::int, bool_and(actor_type = 'substitute' and entity_id = tests.id('class_a')
      and details ->> 'sub_plan_id' = tests.id('plan_a')::text and details ? 'sub_session_id')
    from public.audit_log where action = 'student_alert.viewed' and board_id = tests.id('board_a')$$,
  $$values (2, true)$$,
  'every reveal is audited per class, as the substitute'
);
select is_empty(
  $$select 1 from tests.portal_alerts(tests.token('sb'))$$,
  'a plan that is not released reveals no alert'
);
update public.schools set student_alerts_enabled = false where id = tests.id('school_a1');
select is_empty(
  $$select 1 from tests.portal_alerts(tests.token('s1b'))$$,
  'nor does a school with alerts off'
);
update public.schools set student_alerts_enabled = true where id = tests.id('school_a1');
select tests.authenticate_as('office_a');
select throws_ok(
  $$select * from public.get_class_alerts(tests.id('class_a'))$$,
  '42501', null, 'office staff still never read alerts'
);
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- Listing and revoking access
-- ---------------------------------------------------------------------------------------

select tests.remember('session_s2', (select id from public.sub_sessions
  where session_token_hash = tests.hex(tests.token('s2'))));
select tests.authenticate_as('office_a');
select results_eq(
  $$select jsonb_array_length(a -> 'codes'),
      (select array_agg(distinct (s ->> 'deviceNumber')::int) from jsonb_array_elements(a -> 'sessions') s),
      a::text ~ '(code_hash|session_token|device_key|mac:)'
    from (select public.list_sub_plan_access(tests.id('plan_a')) as a) r$$,
  $$values (5, array[1, 2], false)$$,
  'staff see codes and numbered devices, never a code, a token or a key'
);
select lives_ok(
  $$select public.revoke_sub_session(tests.id('session_s2'))$$,
  'office staff cut one device'
);
select tests.clear_authentication();
select is(tests.portal_load(tests.token('s2')) ->> 'status', 'expired', 'that device''s session ends');
select is(
  tests.redeem_as('bad', 'c1', 'd2', 'it') ->> 'outcome', 'revoked',
  'and it cannot sign in again with the same code'
);
select is(
  tests.portal_load(tests.token('s1b'), null, 'poll') ->> 'status', 'ok',
  'the other device keeps its access'
);

select tests.authenticate_as('teacher_a_other');
select throws_ok(
  $$select public.revoke_sub_plan_access(tests.id('plan_a'))$$,
  '42501', null, 'a colleague cannot cut access'
);
select throws_ok(
  $$select public.list_sub_plan_access(tests.id('plan_a'))$$,
  '42501', null, 'or list it'
);
select tests.clear_authentication();

select tests.authenticate_as('teacher_a');
select public.revoke_sub_access_code(tests.id('code_c1'));
select tests.clear_authentication();
select is(tests.portal_load(tests.token('s1b')) ->> 'status', 'expired', 'cutting a code ends its sessions');

select is(tests.redeem_as('s3', 'c3', 'd7', 'i8') ->> 'outcome', 'ok', 'the other active code still works');
select tests.authenticate_as('principal_a');
select public.revoke_sub_plan_access(tests.id('plan_a'));
select tests.clear_authentication();
select results_eq(
  $$select tests.portal_load(tests.token('s3')) ->> 'status',
      (select count(*)::int from public.sub_access_codes
       where sub_plan_id = tests.id('plan_a') and revoked_at is null)$$,
  $$values ('expired', 0)$$,
  '« Couper tout l''accès » ends every code and session'
);
select results_eq(
  $$select action, count(*)::int from public.audit_log
    where action in ('sub_code.revoked', 'sub_session.revoked') and board_id = tests.id('board_a')
    group by action order by action$$,
  $$values ('sub_code.revoked', 3), ('sub_session.revoked', 1)$$,
  'cutting access is audited'
);

-- ---------------------------------------------------------------------------------------
-- Ending the day
-- ---------------------------------------------------------------------------------------

select tests.redeem_as('sb2', 'cb', 'e2', 'i7');
select tests.portal_end(tests.token('sb'));
select results_eq(
  $$select tests.portal_load(tests.token('sb'), null, 'poll') ->> 'status'
    union all select tests.portal_load(tests.token('sb2'), null, 'poll') ->> 'status'$$,
  $$values ('expired'), ('ok')$$,
  '« Terminer ma journée » ends only that session'
);
select is(tests.audits('sub_session.ended', 'substitute'), 1, 'and is audited');
select is(
  tests.redeem_as('sb3', 'cb', 'e1', 'i7') ->> 'outcome', 'ok',
  'the substitute can come back with the same code on the same device'
);

-- ---------------------------------------------------------------------------------------
-- What each role cannot do
-- ---------------------------------------------------------------------------------------

select throws_ok(
  $$select tests.portal_exec('select 1 from public.absences')$$,
  '42501', null, 'the portal role cannot read tables'
);
select throws_ok(
  $$select tests.portal_exec(format('select public.publish_absence(%L, current_date, current_date,
      ''full_day'', null, true, gen_random_uuid(), ''[]'')', tests.id('school_a1')))$$,
  '42501', null, 'nor call staff functions'
);
select throws_ok(
  $$select tests.portal_exec('select app.log_audit(''x.y'', null, null, ''x'', null)')$$,
  '42501', null, 'nor app helpers'
);

select tests.authenticate_as('teacher_a');
select throws_ok(
  $$select * from sub_portal.redeem(array[tests.hex('mac:c3')], tests.hex('dev:x'), tests.hex('ip:x'))$$,
  '42501', null, 'signed-in staff cannot call the portal'
);
select tests.clear_authentication();

select tests.authenticate_anon();
select throws_ok(
  $$select * from sub_portal.redeem(array[repeat('0', 64)], repeat('0', 64), repeat('0', 64))$$,
  '42501', null, 'anon cannot redeem'
);
select throws_ok($$select sub_portal.load('x')$$, '42501', null, 'anon cannot load');
select throws_ok($$select * from sub_portal.alerts('x')$$, '42501', null, 'anon cannot read alerts');
select throws_ok($$select sub_portal.end_session('x')$$, '42501', null, 'anon cannot end a session');
select tests.clear_authentication();

select * from finish();
rollback;
