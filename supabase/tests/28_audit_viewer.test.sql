-- Phase 6, slice S2 (supabase/migrations/20261201090200_audit_retention.sql): the audit viewer's
-- four audiences, labels per viewer, details whitelist, the office-issued flag, filters and
-- pages, the export's own entry, the details guard, the operator's settings changes, and AI usage
-- rows private to their author with totals for board admins.
-- DECISIONS: D-013, D-056, D-103, D-104, D-106.
begin;
\ir _helpers.psql
select plan(62);
select tests.build_fixture();
select tests.build_library_fixture();

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

-- The matrix of entries, by key.
create table tests.audit_keys (key text primary key, id bigint not null);
grant select on tests.audit_keys to authenticated;

create function tests.audit(p_key text, p_action text, p_board text, p_school text,
  p_entity_type text, p_entity_id uuid, p_details jsonb default '{}',
  p_actor_type public.audit_actor_type default 'user', p_actor text default null,
  p_occurred_at timestamptz default now())
returns bigint
language plpgsql
as $$
declare
  v_id bigint;
begin
  insert into public.audit_log (occurred_at, actor_user_id, actor_type, action, board_id,
    school_id, entity_type, entity_id, details)
  values (p_occurred_at, case when p_actor is not null then tests.id(p_actor) end, p_actor_type,
    p_action, case when p_board is not null then tests.id(p_board) end,
    case when p_school is not null then tests.id(p_school) end, p_entity_type, p_entity_id,
    p_details)
  returning id into v_id;
  insert into tests.audit_keys (key, id) values (p_key, v_id);
  return v_id;
end;
$$;

create function tests.audit_id(p_key text)
returns bigint
language sql
stable
as $$
  select id from tests.audit_keys where key = p_key;
$$;

-- The matrix keys the current user's viewer returns (default filters, i.e. the last 30 days).
create function tests.visible_keys(p_filters jsonb default '{}')
returns text[]
language sql
as $$
  select coalesce(array_agg(k.key order by k.key), '{}')
  from public.list_audit_entries(p_filters, null, 1000) e
  join tests.audit_keys k on k.id = e.id;
$$;

-- One entry as the current user's viewer returns it (none when it is not visible).
create function tests.entry(p_key text)
returns setof record
language sql
as $$
  select e.id, e.actor_label, e.issuer_label, e.subject_label, e.entity_label, e.details, e.flags
  from public.list_audit_entries('{}', tests.audit_id(p_key) + 1, 1) e
  where e.id = tests.audit_id(p_key);
$$;

grant execute on all functions in schema tests to anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- Setup (superuser): a published absence, an invitation, two resources and the matrix
-- ---------------------------------------------------------------------------------------

update public.users set honorific = 'Mme' where id = tests.id('teacher_a');
select tests.remember('absence_a', gen_random_uuid());
insert into public.absences (id, teacher_id, school_id, starts_on, ends_on, status)
values (tests.id('absence_a'), tests.id('teacher_a'), tests.id('school_a1'), '2026-11-12',
  '2026-11-13', 'published');
select tests.remember('invitation_a', gen_random_uuid());
insert into public.staff_invitations (id, board_id, email, display_name, role)
values (tests.id('invitation_a'), tests.id('board_a'), 'nouvelle@test.lynx.test',
  'Isabelle Nouvelle', 'board_admin');
select tests.library_item('private_item', 'teacher_a', 'quiz');
select tests.library_item('approved_item', null, 'reading_passage', 'board_approved', 'board');

select tests.remember('gone_class', gen_random_uuid());
do $$
begin
  -- School a1: the direction only.
  perform tests.audit('m_alert_view', 'student_alert.viewed', 'board_a', 'school_a1', 'class',
    tests.id('class_a'), jsonb_build_object('alert_count', 2, 'sub_session_id', gen_random_uuid(),
      'code_id', gen_random_uuid(), 'issued_by', tests.id('office_a'), 'issued_by_role', 'office'),
    'substitute');
  perform tests.audit('m_redeem_owner', 'sub_code.redeemed', 'board_a', 'school_a1', 'sub_plan',
    gen_random_uuid(), jsonb_build_object('code_id', gen_random_uuid(),
      'sub_session_id', gen_random_uuid(), 'issued_by', tests.id('teacher_a'),
      'issued_by_role', 'owner'), 'substitute');
  perform tests.audit('m_plan_view_dir', 'sub_plan.viewed', 'board_a', 'school_a1', 'sub_plan',
    gen_random_uuid(), jsonb_build_object('content_version', 1, 'issued_by', tests.id('principal_a'),
      'issued_by_role', 'direction'), 'substitute');
  perform tests.audit('m_absence', 'absence.published', 'board_a', 'school_a1', 'absence',
    tests.id('absence_a'), '{"starts_on": "2026-11-12", "ends_on": "2026-11-13", "part": "full_day"}',
    'user', 'teacher_a');
  perform tests.audit('m_class_teacher', 'class_teacher.added', 'board_a', 'school_a1', 'class',
    tests.id('class_a'), jsonb_build_object('user_id', tests.id('subject_teacher'), 'role', 'subject'),
    'user', 'teacher_a');
  perform tests.audit('m_student_alert', 'student_alert.created', 'board_a', 'school_a1', 'student',
    tests.id('student_a1'), jsonb_build_object('alert_id', gen_random_uuid(), 'category', 'medical'),
    'user', 'teacher_a');
  perform tests.audit('m_class_deleted', 'class.deleted', 'board_a', 'school_a1', 'class',
    tests.id('gone_class'), '{"name": "Classe disparue"}', 'user', 'teacher_a');
  perform tests.audit('m_revoked', 'sub_code.revoked', 'board_a', 'school_a1', 'sub_plan',
    gen_random_uuid(), '{"all": true, "codes": 2, "sessions": 1, "role": "owner"}', 'user',
    'teacher_a');
  perform tests.audit('m_confirmed', 'sub_report.confirmed', 'board_a', 'school_a1', 'sub_report',
    gen_random_uuid(), jsonb_build_object('completed', 3, 'sub_plan_id', gen_random_uuid()), 'user',
    'teacher_a');
  perform tests.audit('m_old', 'student_alert.viewed', 'board_a', 'school_a1', 'class',
    tests.id('class_a'), '{"alert_count": 1}', 'user', 'principal_a', now() - interval '40 days');
  -- School a1: the direction and the board's admins.
  perform tests.audit('m_role_a1', 'user_role.granted', 'board_a', 'school_a1', 'user',
    tests.id('teacher_a_other'), '{"role": "teacher"}', 'user', 'board_admin_a');
  perform tests.audit('m_ai_on_a1', 'school.ai_enabled', 'board_a', 'school_a1', 'school',
    tests.id('school_a1'), '{}', 'user', 'principal_a');
  perform tests.audit('m_teacher_b_actor', 'user_role.revoked', 'board_a', 'school_a1', 'user',
    tests.id('teacher_a_other'), '{"role": "teacher"}', 'user', 'teacher_b');
  -- School a1 and nobody through the API (a teacher's own activity, the terms).
  perform tests.audit('m_generated', 'library_item.generated', 'board_a', 'school_a1',
    'library_item', tests.id('private_item'), '{}', 'user', 'teacher_a');
  perform tests.audit('m_session_ended', 'class_session.ended', 'board_a', 'school_a1',
    'class_session', gen_random_uuid(), '{"results_kept": true}', 'user', 'teacher_a');
  perform tests.audit('m_terms', 'user.terms_accepted', null, null, 'user', tests.id('teacher_a'),
    '{"version": "2026-11-pilote-1"}', 'user', 'teacher_a');
  perform tests.audit('m_unknown', 'test.uncatalogued', 'board_a', 'school_a1', 'class',
    tests.id('class_a'));
  -- School a2 and board B.
  perform tests.audit('m_alert_a2', 'student_alert.viewed', 'board_a', 'school_a2', 'class',
    gen_random_uuid(), '{"alert_count": 1}', 'user', 'principal_a2');
  perform tests.audit('m_role_a2', 'user_role.granted', 'board_a', 'school_a2', 'user',
    tests.id('principal_a2'), '{"role": "principal"}', 'user', 'board_admin_a');
  perform tests.audit('m_alert_b1', 'student_alert.viewed', 'board_b', 'school_b1', 'class',
    tests.id('class_b'), '{"alert_count": 1}', 'user', 'teacher_b');
  perform tests.audit('m_role_b1', 'user_role.granted', 'board_b', 'school_b1', 'user',
    tests.id('teacher_b'), '{"role": "teacher"}', 'system');
  perform tests.audit('m_operator_b', 'operator.access', 'board_b', null, 'board',
    tests.id('board_b'), '{"reason": "support"}', 'service');
  -- Board A without a school: the board's admins.
  perform tests.audit('m_staff_invited_board', 'staff.invited', 'board_a', null, 'staff_invitation',
    tests.id('invitation_a'), '{"role": "board_admin"}', 'user', 'board_admin_a');
  perform tests.audit('m_approved_private', 'library_item.approved', 'board_a', 'school_a1',
    'library_item', tests.id('private_item'), '{"revision": 1, "type": "quiz"}', 'user',
    'board_admin_a');
  perform tests.audit('m_approved_shared', 'library_item.approved', 'board_a', null,
    'library_item', tests.id('approved_item'), '{"revision": 1, "type": "reading_passage"}',
    'user', 'board_admin_a');
  perform tests.audit('m_operator_access', 'operator.access', 'board_a', null, 'board',
    tests.id('board_a'), '{"reason": "support"}', 'service');
  perform tests.audit('m_retention', 'retention.purged', 'board_a', null, 'board',
    tests.id('board_a'), '{"sub_plans": 1, "audit_rows": 4}', 'system');
end
$$;

-- ---------------------------------------------------------------------------------------
-- 1. Grants
-- ---------------------------------------------------------------------------------------

select ok(
  has_function_privilege('authenticated', 'public.list_audit_entries(jsonb,bigint,integer)', 'execute')
  and has_function_privilege('authenticated', 'public.log_audit_export(uuid,uuid,jsonb,integer)', 'execute')
  and has_function_privilege('authenticated', 'public.board_ai_usage(uuid,text)', 'execute')
  and has_function_privilege('authenticated', 'public.system_status()', 'execute'),
  'signed-in staff may call the viewer, the export log, the usage totals and the status'
);
select ok(
  not has_function_privilege('anon', 'public.list_audit_entries(jsonb,bigint,integer)', 'execute')
  and not has_function_privilege('service_role', 'public.list_audit_entries(jsonb,bigint,integer)', 'execute')
  and not has_function_privilege('anon', 'public.board_ai_usage(uuid,text)', 'execute')
  and not has_function_privilege('anon', 'public.system_status()', 'execute'),
  'visitors and the service role may not'
);
select ok(
  not has_function_privilege('authenticated', 'app.audit_person_label(uuid,app.audit_viewer)', 'execute')
  and not has_function_privilege('authenticated', 'app.audit_entity_label(text,uuid,jsonb,app.audit_viewer)', 'execute')
  and not has_function_privilege('authenticated', 'app.audit_public_details(jsonb)', 'execute')
  and not has_function_privilege('service_role', 'app.audit_entity_label(text,uuid,jsonb,app.audit_viewer)', 'execute'),
  'the label functions are the owner''s only'
);
select ok(
  has_function_privilege('service_role', 'public.operator_status()', 'execute')
  and not has_function_privilege('authenticated', 'public.operator_status()', 'execute')
  and not has_function_privilege('anon', 'public.operator_status()', 'execute'),
  'the operator''s status is the service role''s only'
);

-- ---------------------------------------------------------------------------------------
-- 2. The school's direction: `direction` and `direction_board` entries of their schools
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('principal_a');
select is(tests.visible_keys(),
  array['m_absence', 'm_ai_on_a1', 'm_alert_view', 'm_class_deleted', 'm_class_teacher',
    'm_confirmed', 'm_plan_view_dir', 'm_redeem_owner', 'm_revoked', 'm_role_a1',
    'm_student_alert', 'm_teacher_b_actor'],
  'the principal reads exactly the direction and direction-and-board entries of school a1');
select is(
  (select count(*)::int from public.list_audit_entries('{}', null, 1000) e
   where e.school_id is distinct from tests.id('school_a1')
      or e.action in ('library_item.approved', 'operator.access', 'retention.purged',
        'staff.invited', 'library_item.generated', 'class_session.ended', 'user.terms_accepted')),
  0, 'never another school, never board-only or operator-only entries');
select tests.clear_authentication();

select tests.authenticate_as('principal_a2');
select is(tests.visible_keys(), array['m_alert_a2', 'm_role_a2'],
  'the principal of a2 reads only school a2''s');
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- 3. Board admins: `direction_board` and `board` entries of their boards
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('board_admin_a');
select is(tests.visible_keys(),
  array['m_ai_on_a1', 'm_approved_private', 'm_approved_shared', 'm_operator_access',
    'm_retention', 'm_role_a1', 'm_role_a2', 'm_staff_invited_board', 'm_teacher_b_actor'],
  'the board admin reads exactly the direction-and-board and board entries of board A');
select is(
  (select count(*)::int from public.list_audit_entries('{}', null, 1000) e
   where e.action ~ '^(student_alert|sub_[a-z]+|absence|class_teacher|class|class_session|user)\.'
      or e.action = 'library_item.generated' or e.school_id = tests.id('school_b1')),
  0, 'never an alert, absence, substitute, class or operator-only entry, never board B (D-056)');
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- 4. Everyone else
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select throws_ok($$select * from public.list_audit_entries('{}')$$, '42501', null,
  'a teacher has no audit viewer');
select tests.clear_authentication();
select tests.authenticate_as('office_a');
select throws_ok($$select * from public.list_audit_entries('{}')$$, '42501', null,
  'nor has the office (Assumption, D-103)');
select tests.clear_authentication();
select tests.authenticate_as('outsider');
select throws_ok($$select * from public.list_audit_entries('{}')$$, '42501', null,
  'nor a person with no role');
select tests.clear_authentication();
update public.users set deactivated_at = now() where id = tests.id('principal_a2');
select tests.authenticate_as('principal_a2');
select throws_ok($$select * from public.list_audit_entries('{}')$$, '42501', null,
  'nor a principal whose access was removed');
select tests.clear_authentication();
update public.users set deactivated_at = null where id = tests.id('principal_a2');

select tests.authenticate_as('board_admin_a');
select ok(not ('m_unknown' = any (tests.visible_keys())), 'an action missing from the catalogue is shown to nobody');
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- 5. Labels per viewer
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('principal_a');
select is((select entity_label from tests.entry('m_student_alert')
  as (id bigint, actor_label text, issuer_label text, subject_label text, entity_label text,
    details jsonb, flags text[])), 'Class A',
  'a student is shown by their class, never by name');
select is((select entity_label from tests.entry('m_class_deleted')
  as (id bigint, actor_label text, issuer_label text, subject_label text, entity_label text,
    details jsonb, flags text[])), 'Classe disparue',
  'a deleted class by the name its deletion recorded');
select results_eq(
  $$select actor_label, subject_label, entity_label from tests.entry('m_class_teacher')
    as (id bigint, actor_label text, issuer_label text, subject_label text, entity_label text,
      details jsonb, flags text[])$$,
  $$values ('teacher_a'::text, 'subject_teacher'::text, 'Class A'::text)$$,
  'a class-team change names who did it, who was added and the class');
select results_eq(
  $$select actor_label, issuer_label from tests.entry('m_alert_view')
    as (id bigint, actor_label text, issuer_label text, subject_label text, entity_label text,
      details jsonb, flags text[])$$,
  $$values (null::text, 'office_a'::text)$$,
  'a substitute''s alert view names who issued the code');
select results_eq(
  $$select (select actor_label from tests.entry('m_role_a1')
      as (id bigint, actor_label text, issuer_label text, subject_label text, entity_label text,
        details jsonb, flags text[])),
    (select actor_label from tests.entry('m_teacher_b_actor')
      as (id bigint, actor_label text, issuer_label text, subject_label text, entity_label text,
        details jsonb, flags text[]))$$,
  $$values ('board_admin_a'::text, null::text)$$,
  'the board''s admin is named; a person from another board is not');
select is((select entity_label from tests.entry('m_absence')
  as (id bigint, actor_label text, issuer_label text, subject_label text, entity_label text,
    details jsonb, flags text[])), '2026-11-12–2026-11-13 · Mme teacher_a',
  'an absence shows its dates and the teacher''s formal name to the direction');
select is(
  (select count(*)::int from public.list_audit_entries('{}', null, 1000) e
   where e::text ~ '(Léa|Nathan|Zoé|Adam)'),
  0, 'no student''s first name in anything the principal reads');
select tests.clear_authentication();

select tests.authenticate_as('board_admin_a');
select results_eq(
  $$select (select entity_label from tests.entry('m_approved_private')
      as (id bigint, actor_label text, issuer_label text, subject_label text, entity_label text,
        details jsonb, flags text[])),
    (select entity_label from tests.entry('m_approved_shared')
      as (id bigint, actor_label text, issuer_label text, subject_label text, entity_label text,
        details jsonb, flags text[]))$$,
  $$values (null::text, 'Ressource approved_item'::text)$$,
  'a resource''s title only when the viewer may read the resource');
select is((select entity_label from tests.entry('m_staff_invited_board')
  as (id bigint, actor_label text, issuer_label text, subject_label text, entity_label text,
    details jsonb, flags text[])), 'Isabelle Nouvelle',
  'an invitation shows the invited person''s name to the board''s admins');
select is(
  (select count(*)::int from public.list_audit_entries('{}', null, 1000) e
   where e::text ~ '(Léa|Nathan|Zoé|Adam)'),
  0, 'no student''s first name in anything the board admin reads');
select tests.clear_authentication();

select tests.authenticate_as('principal_a2');
select is(
  (select count(*)::int from public.list_audit_entries('{}', null, 1000) e
   where e::text ~ '(Léa|Nathan|Zoé|Adam)'),
  0, 'nor in anything the other principal reads');
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- 6. The office-issued flag (D-056) and the details whitelist
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('principal_a');
select results_eq(
  $$select k.key, e.flags from public.list_audit_entries('{"actorType": "substitute"}', null, 100) e
    join tests.audit_keys k on k.id = e.id order by k.key$$,
  $$values ('m_alert_view', array['office_issued_code']), ('m_plan_view_dir', array[]::text[]),
      ('m_redeem_owner', array[]::text[])$$,
  'only a code the office issued is flagged « Code émis par le secrétariat »');
select results_eq(
  $$select k.key, e.details from public.list_audit_entries('{}', null, 1000) e
    join tests.audit_keys k on k.id = e.id
    where k.key in ('m_alert_view', 'm_class_teacher', 'm_absence', 'm_revoked', 'm_confirmed')
    order by k.key$$,
  $$values
    ('m_absence', '{"starts_on": "2026-11-12", "ends_on": "2026-11-13", "part": "full_day"}'::jsonb),
    ('m_alert_view', '{"alert_count": 2, "issued_by_role": "office"}'::jsonb),
    ('m_class_teacher', '{"role": "subject"}'::jsonb),
    ('m_confirmed', '{"completed": 3}'::jsonb),
    ('m_revoked', '{"all": true, "codes": 2, "sessions": 1, "role": "owner"}'::jsonb)$$,
  'details keep dates, counts and short codes, and drop ids (code, session, plan, alert, people)');

-- ---------------------------------------------------------------------------------------
-- 7. Filters and pages
-- ---------------------------------------------------------------------------------------

select ok(
  (select bool_and(e.category = 'alerts') and count(*) >= 2
   from public.list_audit_entries('{"category": "alerts"}', null, 1000) e)
  and (select tests.visible_keys('{"category": "alerts"}')) @> array['m_alert_view', 'm_student_alert'],
  'by category');
select is(
  tests.visible_keys(jsonb_build_object('actorUserId', tests.id('teacher_a'))),
  array['m_absence', 'm_class_deleted', 'm_class_teacher', 'm_confirmed', 'm_revoked',
    'm_student_alert'],
  'by person');
select is(tests.visible_keys('{"actorType": "substitute"}'),
  array['m_alert_view', 'm_plan_view_dir', 'm_redeem_owner'], 'by type of actor');
select is(tests.visible_keys(jsonb_build_object('entityId', tests.id('class_a'))),
  array['m_alert_view', 'm_class_teacher'], 'by what the entry is about');
select ok(
  not ('m_old' = any (tests.visible_keys()))
  and 'm_old' = any (tests.visible_keys(jsonb_build_object('from', now() - interval '60 days'))),
  'the last 30 days by default; older entries with a wider period');
select is(tests.error_of($$select * from public.list_audit_entries(
    jsonb_build_object('from', now() - interval '367 days'))$$), '22023',
  'a period longer than 366 days is refused');
select ok(
  tests.error_of($$select * from public.list_audit_entries('{}', null, 1001)$$) = '22023'
  and tests.error_of($$select * from public.list_audit_entries('{}', null, 0)$$) = '22023',
  'at most 1000 entries a page, at least 1');
select ok(
  tests.error_of($$select * from public.list_audit_entries('{"actorUserId": "x"}')$$) = '22023'
  and tests.error_of($$select * from public.list_audit_entries('{"category": "x"}')$$) = '22023'
  and tests.error_of($$select * from public.list_audit_entries('{"from": "hier"}')$$) = '22023'
  and tests.error_of($$select * from public.list_audit_entries('{"actorType": "x"}')$$) = '22023'
  and tests.error_of($$select * from public.list_audit_entries('[]')$$) = '22023',
  'malformed filters are refused');
select ok(
  (with page1 as (select e.id from public.list_audit_entries('{}', null, 4) e),
        page2 as (select e.id from public.list_audit_entries('{}',
          (select min(id) from page1), 4) e)
   select (select count(*) from page1) = 4 and (select count(*) from page2) = 4
     and (select max(id) from page2) < (select min(id) from page1)
     and not exists (select 1 from page1 join page2 using (id))),
  'pages follow each other with no entry twice');
select tests.clear_authentication();

select tests.authenticate_as('board_admin_a');
select is(tests.visible_keys(jsonb_build_object('schoolId', tests.id('school_a2'))),
  array['m_role_a2'], 'by school');
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- 8. The export is audited (`audit_log.exported`, direction and board admins)
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('principal_a');
select lives_ok($$select public.log_audit_export(null, tests.id('school_a1'),
    '{"category": "alerts"}', 12)$$, 'the direction records its export');
select is(
  (select e.details from public.list_audit_entries('{"category": "audit"}', null, 10) e
   where e.action = 'audit_log.exported' and e.school_id = tests.id('school_a1')),
  '{"rows": 12, "category": "alerts"}'::jsonb, 'and reads it in the log, with no person in it');
select ok(
  tests.error_of($$select public.log_audit_export(null, tests.id('school_a2'), '{}', 1)$$) = '42501'
  and tests.error_of($$select public.log_audit_export(tests.id('board_b'), tests.id('school_a1'), '{}', 1)$$) = '42501',
  'not for another school, nor with a board that is not the school''s');
select is(tests.error_of($$select public.log_audit_export(null, tests.id('school_a1'), '{}', 10001)$$),
  '22023', 'an export holds at most 10,000 rows');
select tests.clear_authentication();

select tests.authenticate_as('board_admin_a');
select is(
  (select count(*)::int from public.list_audit_entries('{"category": "audit"}', null, 10) e
   where e.action = 'audit_log.exported' and e.actor_label = 'principal_a'),
  1, 'the board''s admins read the direction''s export');
select ok(
  tests.error_of($$select public.log_audit_export(tests.id('board_a'), null, '{}', 3)$$) is null
  and tests.error_of($$select public.log_audit_export(tests.id('board_b'), null, '{}', 3)$$) = '42501',
  'a board admin records exports of their own board only');
select tests.clear_authentication();

select tests.authenticate_as('teacher_a');
select is(tests.error_of($$select public.log_audit_export(tests.id('board_a'), tests.id('school_a1'), '{}', 1)$$),
  '42501', 'a teacher has nothing to export');
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- 9. The guard: ids, dates, counts and short codes only (D-017)
-- ---------------------------------------------------------------------------------------

select is(tests.error_of($$select app.log_audit('class.deleted', null, null, 'class', null,
    '{"note": "x"}')$$), '22023', 'no note');
select is(tests.error_of($$select app.log_audit('class.deleted', null, null, 'class', null,
    '{"title": "x"}')$$), '22023', 'no title');
select ok(
  tests.error_of($$select app.log_audit('class.deleted', null, null, 'class', null,
    '{"first_name": "x"}')$$) = '22023'
  and tests.error_of($$select app.log_audit('class.deleted', null, null, 'class', null,
    '{"email": "x@y.ca"}')$$) = '22023',
  'no first name, no e-mail');
select is(tests.error_of(format($$select app.log_audit('class.deleted', null, null, 'class', null,
    jsonb_build_object('name', %L))$$, repeat('x', 121))), '22023',
  'no string longer than 120 characters');
select is(tests.error_of(format($$select app.log_audit('class.deleted', null, null, 'class', null,
    jsonb_build_object('name', %L))$$, repeat('é', 120))), null,
  'a string of 120 characters is fine');
select is(tests.error_of($$select app.log_audit('class.deleted', null, null, 'class', null,
    (select jsonb_object_agg('k' || i, 'abcdefgh') from generate_series(1, 200) i))$$), '22023',
  'no more than 2 KB of details');

-- ---------------------------------------------------------------------------------------
-- 10. The operator's changes are visible to the board (D-106)
-- ---------------------------------------------------------------------------------------

insert into tests.audit_keys (key, id) values ('marker_ops', (select max(id) from public.audit_log));
select tests.as_service();
update public.boards
set settings = jsonb_set(settings, '{ai}', '{"pooling": false}')
where id = tests.id('board_a');
update public.module_entitlements set enabled = false
where school_id = tests.id('school_a1') and module = 'library';
insert into public.ai_budgets (school_id, monthly_allowance_usd, monthly_ceiling_usd)
values (tests.id('school_a1'), 75, 150);
select tests.clear_authentication();
update public.boards
set settings = jsonb_set(settings, '{retention}', '{"auditDays": 1095}')
where id = tests.id('board_a');

select results_eq(
  $$select action, actor_type::text, details from public.audit_log
    where action in ('board.settings_changed', 'school.module_changed', 'school.ai_budget_changed')
      and board_id = tests.id('board_a') and id > tests.audit_id('marker_ops')
    order by id$$,
  $$values
    ('board.settings_changed', 'service', '{"keys": "ai"}'::jsonb),
    ('school.module_changed', 'service', '{"module": "library", "enabled": false}'::jsonb),
    ('school.ai_budget_changed', 'service', '{"monthly_allowance_usd": 75, "monthly_ceiling_usd": 150}'::jsonb),
    ('board.settings_changed', 'system', '{"keys": "retention"}'::jsonb)$$,
  'settings, modules and budgets are audited, as IP Lynx when the service role changes them');
select tests.authenticate_as('board_admin_a');
select is(
  (select count(*)::int from public.list_audit_entries('{"category": "settings"}', null, 100) e
   where e.action in ('board.settings_changed', 'school.module_changed', 'school.ai_budget_changed')
     and e.id > tests.audit_id('marker_ops')),
  4, 'the board''s admins read them');
select tests.clear_authentication();
select tests.authenticate_as('principal_a');
select is(
  (select count(*)::int from public.list_audit_entries('{"category": "settings"}', null, 100) e
   where e.action in ('board.settings_changed', 'school.module_changed', 'school.ai_budget_changed')),
  0, 'the direction does not');
select tests.clear_authentication();
update public.boards set settings = settings || '{"classModeResultsRetentionDays": 400}'
where id = tests.id('board_a');
select is(
  (select count(*)::int from public.audit_log
   where action = 'board.settings_changed' and board_id = tests.id('board_a')),
  2, 'a change of other board settings is not audited as the operator''s');

-- ---------------------------------------------------------------------------------------
-- 11. AI usage (D-104): rows are their author's; board admins get totals
-- ---------------------------------------------------------------------------------------

update public.schools set timezone = 'America/Toronto'
where id in (tests.id('school_a1'), tests.id('school_a2'));
update public.boards set default_timezone = 'America/Toronto' where id = tests.id('board_a');
insert into public.ai_generations (board_id, school_id, user_id, feature, prompt_version,
  provider, model, estimated_cost_usd, status, created_at)
values
  (tests.id('board_a'), tests.id('school_a1'), tests.id('teacher_a'), 'differentiate', 'v1', 'fake',
    'fake', 0.10, 'succeeded', '2026-10-15T12:00:00Z'),
  -- 23:00 on October 31 in Toronto: October.
  (tests.id('board_a'), tests.id('school_a1'), tests.id('principal_a'), 'differentiate', 'v1',
    'fake', 'fake', 0.20, 'failed', '2026-11-01T03:00:00Z'),
  -- 23:00 on September 30 in Toronto: September.
  (tests.id('board_a'), tests.id('school_a1'), tests.id('teacher_a'), 'differentiate', 'v1', 'fake',
    'fake', 0.40, 'succeeded', '2026-10-01T03:00:00Z'),
  (tests.id('board_a'), tests.id('school_a2'), tests.id('principal_a2'), 'differentiate', 'v1',
    'fake', 'fake', 0.05, 'invalid_output', '2026-10-20T12:00:00Z'),
  -- Bulk generation: the board's, no school, no person (D-096).
  (tests.id('board_a'), null, null, 'library_item', 'v1', 'fake', 'fake', 1.00, 'succeeded',
    '2026-10-10T12:00:00Z'),
  (tests.id('board_b'), tests.id('school_b1'), tests.id('teacher_b'), 'differentiate', 'v1', 'fake',
    'fake', 0.30, 'succeeded', '2026-10-10T12:00:00Z');

select tests.authenticate_as('teacher_a');
select is((select count(*)::int from public.ai_generations), 2, 'a teacher reads her own usage rows');
select tests.clear_authentication();
select tests.authenticate_as('principal_a');
select results_eq(
  $$select count(*)::int, count(*) filter (where user_id <> tests.id('principal_a'))::int
    from public.ai_generations$$,
  $$values (1, 0)$$, 'the principal reads only her own, no colleague''s');
select lives_ok($$select * from public.ai_usage_summary(tests.id('school_a1'))$$,
  'and keeps the school''s totals');
select is(tests.error_of($$select * from public.board_ai_usage(tests.id('board_a'), '2026-10')$$),
  '42501', 'the board''s totals are its admins''');
select tests.clear_authentication();

select tests.authenticate_as('board_admin_a');
select is((select count(*)::int from public.ai_generations), 0,
  'a board admin reads no one''s usage rows');
select results_eq(
  $$select school_id, requests::int, failed::int, cost_usd from public.board_ai_usage(tests.id('board_a'), '2026-10')$$,
  $$values (tests.id('school_a1'), 2, 1, 0.30::numeric), (tests.id('school_a2'), 1, 1, 0.05::numeric),
      (null::uuid, 1, 0, 1.00::numeric)$$,
  'per school in its own month, failures counted, and bulk generation on its own line');
select results_eq(
  $$select school_id, requests::int from public.board_ai_usage(tests.id('board_a'), '2026-09')$$,
  $$values (tests.id('school_a1'), 1), (tests.id('school_a2'), 0)$$,
  'every school of the board, and no bulk line without bulk generation');
select ok(
  tests.error_of($$select * from public.board_ai_usage(tests.id('board_b'), '2026-10')$$) = '42501'
  and tests.error_of($$select * from public.board_ai_usage(tests.id('board_a'), '2026-13')$$) = '22023',
  'not for another board; a month looks like 2026-10');
select tests.clear_authentication();

select * from finish();
rollback;
