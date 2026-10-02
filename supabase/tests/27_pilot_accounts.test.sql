-- Phase 6, slice S1 (supabase/migrations/20261201090100_pilot_accounts.sql): the pilot terms,
-- staff invitations, roles and access by board admins, the operator's deletions and support log,
-- sample classes kept out of substitute plans, school settings, library reviewers and feedback.
-- DECISIONS: D-064, D-106, D-107, D-108, D-109, D-110, D-116.
begin;
\ir _helpers.psql
select plan(149);
select tests.build_fixture();
select tests.build_library_fixture();

grant usage on schema tests to service_role;
grant select, insert on tests.ids to service_role;

-- The operator's connection (the admin CLI's service key).
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

-- A role of a person, remembered under a key (read as superuser: row level security aside).
create function tests.remember_role(p_key text, p_user text, p_role public.app_role,
  p_school text default null)
returns uuid
language sql
as $$
  select tests.remember(p_key, (
    select ur.id from public.user_roles ur
    where ur.user_id = tests.id(p_user) and ur.role = p_role
      and ur.school_id is not distinct from
        (case when p_school is null then null else tests.id(p_school) end)));
$$;

-- An Auth account without a profile (what the worker creates for a new address).
create function tests.auth_user(p_key text, p_email text)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', p_email,
    now(), '{}', '{}', now(), now());
  return tests.remember(p_key, v_id);
end;
$$;

-- A sample class as buildSampleClass makes it (shortened): 3 students, 2 blocks, one unit of 3
-- lessons with 2 taught.
create function tests.sample_payload(p_name text default 'Classe exemple (3e année)')
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'name', p_name, 'gradeCodes', jsonb_build_array('3'),
    'students', jsonb_build_array(
      jsonb_build_object('firstName', 'Maëlys', 'levelRank', 1),
      jsonb_build_object('firstName', 'Tiago', 'levelRank', 3),
      jsonb_build_object('firstName', 'Inaya', 'levelRank', 4)),
    'blocks', jsonb_build_array(
      jsonb_build_object('dayKey', 1, 'start', '08:45', 'end', '09:45', 'kind', 'subject',
        'subjectCode', 'fra', 'title', null),
      jsonb_build_object('dayKey', 1, 'start', '10:00', 'end', '10:20', 'kind', 'recess',
        'subjectCode', null, 'title', 'Récréation')),
    'units', jsonb_build_array(jsonb_build_object(
      'subjectCode', 'mat', 'title', 'Les fractions', 'description', 'Une unité exemple.',
      'lessons', jsonb_build_array(
        jsonb_build_object('title', 'Leçon 1', 'objectives', 'Nommer une fraction.',
          'materials', null, 'content', null, 'subNotes', null, 'durationMinutes', 45),
        jsonb_build_object('title', 'Leçon 2', 'objectives', null, 'materials', null,
          'content', null, 'subNotes', null, 'durationMinutes', 45),
        jsonb_build_object('title', 'Leçon 3', 'objectives', null, 'materials', null,
          'content', null, 'subNotes', 'Les cartes sont dans le bac bleu.', 'durationMinutes', 45)),
      'taughtOn', jsonb_build_array((current_date - 2)::text, (current_date - 1)::text))));
$$;

-- The SQLSTATE alone.
create function tests.code_of(p_sql text)
returns text
language sql
as $$
  select left(tests.error_of(p_sql), 5);
$$;

grant execute on all functions in schema tests to authenticated, service_role;

select tests.create_user('board_admin_b');
select tests.create_user('both_boards');
insert into public.user_roles (user_id, role, board_id, school_id) values
  (tests.id('board_admin_b'), 'board_admin', tests.id('board_b'), null),
  (tests.id('both_boards'), 'teacher', tests.id('board_a'), tests.id('school_a2')),
  (tests.id('both_boards'), 'teacher', tests.id('board_b'), tests.id('school_b1'));

select tests.remember_role('r_admin_a', 'board_admin_a', 'board_admin');
select tests.remember_role('r_teacher_a', 'teacher_a', 'teacher', 'school_a1');
select tests.remember_role('r_teacher_a_other', 'teacher_a_other', 'teacher', 'school_a1');
select tests.remember_role('r_subject_teacher', 'subject_teacher', 'teacher', 'school_a1');
select tests.remember_role('r_former', 'former_teacher', 'teacher', 'school_a1');
select tests.remember_role('r_both_a', 'both_boards', 'teacher', 'school_a2');
select tests.remember_role('r_teacher_b', 'teacher_b', 'teacher', 'school_b1');
select tests.remember_role('r_faith_a', 'faith_reviewer_a', 'teacher', 'school_a2');


-- ---------------------------------------------------------------------------------------
-- 1. Who may run what. No function signed-in users may run takes a user id (helpers that answer
--    about someone else are the service role's or the owner's); deleting accounts and boards is
--    the operator's only, and nothing in the API deletes a person or writes roles directly.
-- ---------------------------------------------------------------------------------------

select is_empty(
  $$select f from unnest(array['public.accept_terms(text)',
      'public.invite_staff(uuid,uuid,text,text,text,public.app_role)',
      'public.cancel_staff_invitation(uuid)', 'public.grant_staff_role(uuid,public.app_role,uuid)',
      'public.revoke_staff_role(uuid)', 'public.set_staff_active(uuid,boolean)',
      'public.board_staff_sign_ins(uuid)', 'public.create_sample_class(uuid,jsonb)',
      'public.merge_school_settings(uuid,jsonb)', 'public.set_library_reviewer(uuid,boolean,boolean)',
      'public.submit_feedback(uuid,uuid,text,text,text,text,text,text,text,boolean)',
      'app.mark_sample_class(uuid)']) f
    where not has_function_privilege('authenticated', f, 'execute')
       or has_function_privilege('anon', f, 'execute')$$,
  'signed-in staff run the terms, invitation, role, access, sample class, settings, reviewer and feedback functions; anon none'
);
select is_empty(
  $$select f from unnest(array['public.operator_account_id(text)',
      'public.operator_delete_staff_account(uuid,boolean)', 'public.operator_delete_board(uuid,text)',
      'public.log_operator_access(uuid,text)']) f
    where has_function_privilege('authenticated', f, 'execute')
       or has_function_privilege('anon', f, 'execute')
       or not has_function_privilege('service_role', f, 'execute')$$,
  'deleting accounts and boards, and the support log, are the operator''s only (service role)'
);
select is_empty(
  $$select f from unnest(array['app.staff_board_ids(uuid)', 'app.staff_beyond_boards(uuid,uuid[])',
      'app.complete_staff_invitation(uuid,uuid)', 'app.fail_staff_invitation(uuid,text)',
      'app.admin_target_role(uuid)', 'app.board_has_other_admin(uuid,uuid)',
      'app.lock_board_admins(uuid)', 'app.assert_staff_role(uuid,public.app_role,uuid)',
      'app.schools_guard_direction_settings()']) f
    where has_function_privilege('authenticated', f, 'execute')
       or has_function_privilege('service_role', f, 'execute')$$,
  'the worker''s invitation steps and the helpers that take a user run for the database owner only'
);
select set_eq(
  $$select p.oid::regprocedure::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app') and has_function_privilege('authenticated', p.oid, 'execute')
      and p.proargnames is not null
      and exists (
        select 1 from unnest(p.proargnames, coalesce(p.proargmodes, array_fill('i'::"char",
          array[cardinality(p.proargnames)]))) a (name, mode)
        where a.mode in ('i', 'b', 'v')
          and a.name ~ '(^|_)(user|users|person|people|teacher|teachers|staff|member|author|owner|reviewer|actor|invitee)(_ids?)?$')$$,
  $$values ('app.is_teacher_at_class_school(uuid,uuid)')$$,
  'signed-in users run no function that takes a user id (only Phase 1''s class-team check)'
);
select ok(
  not has_table_privilege('authenticated', 'public.users', 'delete')
  and not has_table_privilege('authenticated', 'public.user_roles', 'insert')
  and not has_any_column_privilege('authenticated', 'public.user_roles', 'insert')
  and not has_table_privilege('authenticated', 'public.user_roles', 'update')
  and not has_any_column_privilege('authenticated', 'public.user_roles', 'update')
  and not has_table_privilege('authenticated', 'public.user_roles', 'delete')
  and not has_any_column_privilege('authenticated', 'public.library_reviewers', 'insert'),
  'no account deletion and no direct role or reviewer writes through the API'
);

-- ---------------------------------------------------------------------------------------
-- 2. The pilot terms (D-109, D-110)
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a_other');
select throws_ok($$select public.accept_terms('version 2')$$, '22023', null,
  'a terms version has the pattern of CURRENT_TERMS_VERSION');
select lives_ok($$select public.accept_terms('2026-11-pilote-1')$$, 'a teacher accepts the terms');
select throws_ok(
  format($$update public.users set terms_version = '2027-01-x', terms_accepted_at = now() where id = %L$$,
    tests.id('teacher_a_other')),
  '42501', null, 'nobody writes the terms columns directly');
select tests.clear_authentication();
select results_eq(
  $$select terms_version, terms_accepted_at is not null from public.users
    where id = tests.id('teacher_a_other')$$,
  $$values ('2026-11-pilote-1', true)$$,
  'the version and the time are stored together'
);
select results_eq(
  $$select actor_user_id, board_id, school_id, entity_type, entity_id, details from public.audit_log
    where action = 'user.terms_accepted' and entity_id = tests.id('teacher_a_other')$$,
  $$values (tests.id('teacher_a_other'), null::uuid, null::uuid, 'user', tests.id('teacher_a_other'),
            '{"version": "2026-11-pilote-1"}'::jsonb)$$,
  'the acceptance is audited with its version, for no board (operator audience)'
);
select tests.authenticate_as('former_teacher');
select throws_ok($$select public.accept_terms('2026-11-pilote-1')$$, '42501', null,
  'a person whose access was removed cannot accept anything');
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- 3. Invitations (D-107)
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('principal_a');
select throws_ok(
  format($$select * from public.invite_staff(%L, %L, 'new@x.ca', 'Nouvelle', null, 'teacher')$$,
    tests.id('board_a'), tests.id('school_a1')),
  '42501', null, 'a principal does not invite');
select tests.authenticate_as('teacher_a');
select throws_ok(
  format($$select * from public.invite_staff(%L, %L, 'new@x.ca', 'Nouvelle', null, 'teacher')$$,
    tests.id('board_a'), tests.id('school_a1')),
  '42501', null, 'a teacher does not invite');
select tests.authenticate_as('outsider');
select throws_ok(
  format($$select * from public.invite_staff(%L, %L, 'new@x.ca', 'Nouvelle', null, 'teacher')$$,
    tests.id('board_a'), tests.id('school_a1')),
  '42501', null, 'someone with no role does not invite');
select tests.authenticate_as('board_admin_a');
select throws_ok(
  format($$select * from public.invite_staff(%L, %L, 'new@x.ca', 'Nouvelle', null, 'teacher')$$,
    tests.id('board_b'), tests.id('school_b1')),
  '42501', null, 'a board admin invites within their own board only');
select is(
  concat_ws(' ',
    tests.error_of(format($$select * from public.invite_staff(%L, %L, 'new@x.ca', 'N', null, 'board_admin')$$,
      tests.id('board_a'), tests.id('school_a1'))),
    tests.error_of(format($$select * from public.invite_staff(%L, null, 'new@x.ca', 'N', null, 'teacher')$$,
      tests.id('board_a'))),
    tests.error_of(format($$select * from public.invite_staff(%L, %L, 'new@x.ca', 'N', null, 'teacher')$$,
      tests.id('board_a'), tests.id('school_b1'))),
    tests.error_of(format($$select * from public.invite_staff(%L, %L, 'new@x.ca', 'N', null, 'facilities')$$,
      tests.id('board_a'), tests.id('school_a1')))),
  '22023 22023 22023 22023',
  'the role and the school must match: an admin has none, a school of this board otherwise'
);
select throws_ok(
  format($$select * from public.invite_staff(%L, null, ' Board.Admin.A@test.lynx.test ', 'Moi', null, 'board_admin')$$,
    tests.id('board_a')),
  'LXU07', null, 'inviting oneself is refused');

-- An active colleague of the board: the role at once.
select tests.remember('inv_vp', (select invitation_id from public.invite_staff(tests.id('board_a'),
  tests.id('school_a1'), 'Teacher.A.Other@test.lynx.test', 'Mme Autre', 'Mme', 'vice_principal')));
-- A new address: a pending invitation, for the worker.
select tests.remember('inv_new', (select invitation_id from public.invite_staff(tests.id('board_a'),
  tests.id('school_a1'), '  Isabelle.Nouvelle@Example.CA ', 'Isabelle Nouvelle', ' Mme ', 'teacher')));
select throws_ok(
  format($$select * from public.invite_staff(%L, %L, 'isabelle.nouvelle@example.ca', 'Isabelle', null, 'teacher')$$,
    tests.id('board_a'), tests.id('school_a1')),
  '23505', null, 'a second pending invitation for the same address, role and school is refused');
-- Someone of another board: refused at once, nothing copied, nothing granted.
select tests.remember('inv_b', (select invitation_id from public.invite_staff(tests.id('board_a'),
  tests.id('school_a1'), 'teacher.b@test.lynx.test', 'Nom tapé', null, 'teacher')));
-- A person whose access this board removed: through the worker, which restores it.
select tests.remember('inv_former', (select invitation_id from public.invite_staff(tests.id('board_a'),
  tests.id('school_a1'), 'former.teacher@test.lynx.test', 'Ancienne', null, 'teacher')));
select tests.clear_authentication();

select results_eq(
  $$select status, error_code, user_id from public.staff_invitations where id = tests.id('inv_vp')$$,
  $$values ('ready', null::text, tests.id('teacher_a_other'))$$,
  'an active colleague of the board gets the role at once'
);
select results_eq(
  $$select a.actor_user_id, a.details from public.audit_log a
    where a.action = 'user_role.granted' and a.entity_id = tests.id('teacher_a_other')
      and a.details ->> 'role' = 'vice_principal'$$,
  $$values (tests.id('board_admin_a'), '{"role": "vice_principal"}'::jsonb)$$,
  'the role exists and its grant is audited with the inviter as actor'
);
select results_eq(
  $$select email, display_name, honorific, status, processed_at is null from public.staff_invitations
    where id = tests.id('inv_new')$$,
  $$values ('isabelle.nouvelle@example.ca', 'Isabelle Nouvelle', 'Mme', 'pending', true)$$,
  'a new address is stored trimmed and in lower case, and waits for the worker'
);
select results_eq(
  $$select event_type, payload from public.event_outbox where aggregate_id = tests.id('inv_new')$$,
  $$values ('staff_invitation.created', jsonb_build_object('invitationId', tests.id('inv_new')))$$,
  'the worker is told the invitation id, and nothing else'
);
select results_eq(
  $$select status, error_code, display_name, user_id from public.staff_invitations
    where id = tests.id('inv_b')$$,
  $$values ('failed', 'emailConflict', 'Nom tapé', null::uuid)$$,
  'an address used in another board fails as emailConflict, with the typed name only'
);
select is_empty(
  $$select 1 from public.user_roles where user_id = tests.id('teacher_b') and board_id = tests.id('board_a')$$,
  'no role is granted to a person of another board'
);
select is(
  (select status from public.staff_invitations where id = tests.id('inv_former')),
  'pending',
  'a person whose access was removed is restored through the worker'
);
select is_empty(
  $$select 1 from public.event_outbox where aggregate_id in (tests.id('inv_vp'), tests.id('inv_b'))$$,
  'the worker is not called for a role granted at once or a refused address'
);
select results_eq(
  $$select count(*)::int, count(*) filter (where details = '{"role": "teacher"}'
      or details = '{"role": "vice_principal"}')::int
    from public.audit_log where action = 'staff.invited' and board_id = tests.id('board_a')$$,
  $$values (4, 4)$$,
  'every invitation is audited with its role only, never the address'
);

-- A person with a class team in another board (and roles here only) is someone else's too.
insert into public.class_teachers (class_id, user_id, role)
values (tests.id('class_b'), tests.id('subject_teacher'), 'subject');
select tests.authenticate_as('board_admin_a');
select is(
  (select error_code from public.invite_staff(tests.id('board_a'), tests.id('school_a2'),
    'subject.teacher@test.lynx.test', 'Prof', null, 'teacher')),
  'emailConflict',
  'a class team in another board counts as working there'
);
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- 4. The worker's steps (owner only)
-- ---------------------------------------------------------------------------------------

select tests.auth_user('auth_new', 'isabelle.nouvelle@example.ca');
select is(app.complete_staff_invitation(tests.id('inv_new'), tests.id('auth_new')), 'ready',
  'the worker completes an invitation once the Auth account exists');
select results_eq(
  $$select u.email, u.display_name, u.honorific, u.deactivated_at is null, ur.role::text,
      ur.school_id, ur.created_by
    from public.users u join public.user_roles ur on ur.user_id = u.id
    where u.id = tests.id('auth_new')$$,
  $$values ('isabelle.nouvelle@example.ca', 'Isabelle Nouvelle', 'Mme', true, 'teacher',
            tests.id('school_a1'), tests.id('board_admin_a'))$$,
  'the profile and the role are created, granted by the inviter'
);
select results_eq(
  $$select status, user_id from public.staff_invitations where id = tests.id('inv_new')$$,
  $$values ('ready', tests.id('auth_new'))$$,
  'the invitation is ready'
);
select is(app.complete_staff_invitation(tests.id('inv_new'), tests.id('auth_new')), 'ready',
  'a second delivery answers ready');
select is((select count(*)::int from public.user_roles where user_id = tests.id('auth_new')), 1,
  'and changes nothing');
select is(app.complete_staff_invitation(gen_random_uuid(), tests.id('auth_new')), 'gone',
  'an invitation that no longer exists is gone');

-- Cancelled while the worker was creating the account: no profile.
select tests.authenticate_as('board_admin_a');
select tests.remember('inv_cancel', (select invitation_id from public.invite_staff(tests.id('board_a'),
  null, 'annule@example.ca', 'Annulée', null, 'board_admin')));
select tests.clear_authentication();
select tests.authenticate_as('teacher_a');
select throws_ok(format($$select public.cancel_staff_invitation(%L)$$, tests.id('inv_cancel')),
  '42501', null, 'a teacher cannot cancel an invitation');
select tests.authenticate_as('board_admin_b');
select throws_ok(format($$select public.cancel_staff_invitation(%L)$$, tests.id('inv_cancel')),
  '42501', null, 'another board''s admin cannot cancel it');
select tests.authenticate_as('board_admin_a');
select lives_ok(format($$select public.cancel_staff_invitation(%L)$$, tests.id('inv_cancel')),
  'its board''s admin cancels a pending invitation');
select throws_ok(format($$select public.cancel_staff_invitation(%L)$$, tests.id('inv_cancel')),
  '22023', null, 'only a pending invitation can be cancelled');
select tests.clear_authentication();
select results_eq(
  $$select actor_user_id, details from public.audit_log
    where action = 'staff.invitation_cancelled' and entity_id = tests.id('inv_cancel')$$,
  $$values (tests.id('board_admin_a'), '{"role": "board_admin"}'::jsonb)$$,
  'the cancellation is audited'
);
select tests.auth_user('auth_cancel', 'annule@example.ca');
select is(app.complete_staff_invitation(tests.id('inv_cancel'), tests.id('auth_cancel')), 'cancelled',
  'the worker learns the invitation was cancelled');
select is_empty($$select 1 from public.users where id = tests.id('auth_cancel')$$,
  'and no profile is created');

-- The person whose access was removed comes back.
update public.users set deactivated_at = now() where id = tests.id('former_teacher');
select is(app.complete_staff_invitation(tests.id('inv_former'), tests.id('former_teacher')), 'ready',
  'a re-invited person whose access this board removed is restored');
select results_eq(
  $$select u.deactivated_at is null, u.display_name from public.users u
    where u.id = tests.id('former_teacher')$$,
  $$values (true, 'former_teacher')$$,
  'they are active again, under their own name'
);
select results_eq(
  $$select school_id, details from public.audit_log
    where action = 'staff.access_restored' and entity_id = tests.id('former_teacher')$$,
  $$values (tests.id('school_a1'), '{"via": "invitation"}'::jsonb)$$,
  'the restored access is audited'
);

-- A person who gained a role in another board meanwhile: a conflict for the operator.
select tests.create_user('left_teacher');
insert into public.user_roles (user_id, role, board_id, school_id)
values (tests.id('left_teacher'), 'teacher', tests.id('board_a'), tests.id('school_a2'));
update public.users set deactivated_at = now() where id = tests.id('left_teacher');
select tests.authenticate_as('board_admin_a');
select tests.remember('inv_left', (select invitation_id from public.invite_staff(tests.id('board_a'),
  tests.id('school_a2'), 'left.teacher@test.lynx.test', 'Partie', null, 'teacher')));
select tests.clear_authentication();
insert into public.user_roles (user_id, role, board_id, school_id)
values (tests.id('left_teacher'), 'teacher', tests.id('board_b'), tests.id('school_b1'));
select is(app.complete_staff_invitation(tests.id('inv_left'), tests.id('left_teacher')), 'conflict',
  'a person who joined another board meanwhile is a conflict');
select results_eq(
  $$select status, error_code, (select deactivated_at is not null from public.users
      where id = tests.id('left_teacher'))
    from public.staff_invitations where id = tests.id('inv_left')$$,
  $$values ('failed', 'emailConflict', true)$$,
  'the invitation fails and the access stays removed'
);

select tests.authenticate_as('board_admin_a');
select tests.remember('inv_fail', (select invitation_id from public.invite_staff(tests.id('board_a'),
  tests.id('school_a1'), 'sans-auth@example.ca', 'Sans Auth', null, 'office_admin')));
select tests.clear_authentication();
select is(
  concat_ws(' ', tests.error_of(format($$select app.fail_staff_invitation(%L, 'nope')$$, tests.id('inv_fail'))),
    app.fail_staff_invitation(tests.id('inv_fail'), 'authNotConfigured'),
    app.fail_staff_invitation(tests.id('inv_fail'), 'authRefused'),
    app.fail_staff_invitation(tests.id('inv_new'), 'expired')),
  '22023 failed failed ready',
  'the worker fails a pending invitation with a known code, and only a pending one'
);
select is((select error_code from public.staff_invitations where id = tests.id('inv_fail')),
  'authNotConfigured', 'the first failure is kept');

-- ---------------------------------------------------------------------------------------
-- 5. School settings (D-108)
-- ---------------------------------------------------------------------------------------

update public.schools set settings = '{"keep": 1, "contact": {"officeEmail": "old@x.ca"},
  "substitute": {"accessFrom": "05:00", "accessUntil": "18:00", "emergencyInfo": "Porte est."}}'
where id = tests.id('school_a1');
select tests.authenticate_as('principal_a');
select lives_ok(
  format($$select public.merge_school_settings(%L, '{"contact": {"officePhone": "(705) 555-0100"},
    "dayStart": "08:30", "substitute": {"accessFrom": "06:00", "arrivalInstructions": "Local 100"}}')$$,
    tests.id('school_a1')),
  'the direction sets the contact, the bell times and the substitute settings');
select tests.clear_authentication();
select is(
  (select settings from public.schools where id = tests.id('school_a1')),
  '{"keep": 1, "dayStart": "08:30", "contact": {"officeEmail": "old@x.ca", "officePhone": "(705) 555-0100"},
    "substitute": {"accessFrom": "06:00", "accessUntil": "18:00", "emergencyInfo": "Porte est.",
      "arrivalInstructions": "Local 100"}}'::jsonb,
  'the keys are merged: nothing else is lost'
);
select tests.authenticate_as('board_admin_a');
select lives_ok(
  format($$select public.merge_school_settings(%L, '{"contact": {"officeEmail": null}, "dayEnd": "15:00"}')$$,
    tests.id('school_a1')),
  'a board admin sets the contact details and bell times');
select throws_ok(
  format($$select public.merge_school_settings(%L, '{"substitute": {"accessFrom": "07:00"}}')$$,
    tests.id('school_a1')),
  '42501', null, 'but not the substitute settings, which are the direction''s');
select is(
  concat_ws(' ',
    tests.error_of(format($$select public.merge_school_settings(%L, '{"dayStart": "8h30"}')$$, tests.id('school_a1'))),
    tests.error_of(format($$select public.merge_school_settings(%L, '{"dayStart": "16:00"}')$$, tests.id('school_a1'))),
    tests.error_of(format($$select public.merge_school_settings(%L, '{"contact": {"officePhone": "appelez Julie"}}')$$, tests.id('school_a1'))),
    tests.error_of(format($$select public.merge_school_settings(%L, '{"contact": {"officeEmail": "pas un courriel"}}')$$, tests.id('school_a1'))),
    tests.error_of(format($$select public.merge_school_settings(%L, '{"contact": {"fax": "1"}}')$$, tests.id('school_a1'))),
    tests.error_of(format($$select public.merge_school_settings(%L, '{"ai": {"allowed": true}}')$$, tests.id('school_a1'))),
    tests.error_of(format($$select public.merge_school_settings(%L, '{}')$$, tests.id('school_a1')))),
  '22023 22023 22023 22023 22023 22023 22023',
  'times, the phone, the e-mail and the keys are checked; the first bell comes before dismissal'
);
select throws_ok(
  format($$select public.merge_school_settings(%L, '{"dayStart": "08:00"}')$$, tests.id('school_b1')),
  '42501', null, 'not in another board');
select tests.authenticate_as('teacher_a');
select throws_ok(
  format($$select public.merge_school_settings(%L, '{"dayStart": "08:00"}')$$, tests.id('school_a1')),
  '42501', null, 'a teacher changes no school settings');
select tests.clear_authentication();
select results_eq(
  $$select settings -> 'contact', settings ->> 'dayEnd', settings -> 'substitute' ->> 'accessFrom',
      (settings ->> 'keep')::int
    from public.schools where id = tests.id('school_a1')$$,
  $$values ('{"officePhone": "(705) 555-0100"}'::jsonb, '15:00', '06:00', 1)$$,
  'a contact change keeps the substitute settings and other keys; null clears a value'
);
select throws_ok(
  format($$select public.merge_school_settings(%L, '{"substitute": {"accessFrom": "6 h"}}')$$, tests.id('school_a1')),
  '42501', null, 'the superuser is no direction either: functions check who calls');

-- The alerts switch and the substitute settings stay the direction's, even through a direct
-- update that row level security allows a board admin.
select tests.authenticate_as('board_admin_a');
select throws_ok(
  format($$update public.schools set student_alerts_enabled = true where id = %L$$, tests.id('school_a2')),
  '42501', null, 'a board admin cannot turn alerts on');
select throws_ok(
  format($$update public.schools set settings = settings || '{"substitute": {"accessFrom": "04:00"}}' where id = %L$$,
    tests.id('school_a1')),
  '42501', null, 'nor change the substitute settings directly');
select lives_ok(
  format($$update public.schools set short_name = 'A2', student_alerts_enabled = false where id = %L$$,
    tests.id('school_a2')),
  'saving other settings with the switch unchanged is fine');
select tests.authenticate_as('principal_a');
select lives_ok(
  format($$update public.schools set student_alerts_enabled = false where id = %L$$, tests.id('school_a1')),
  'the principal switches alerts');
select tests.clear_authentication();
select lives_ok(
  format($$update public.schools set student_alerts_enabled = true where id = %L$$, tests.id('school_a1')),
  'so does the operator (superuser)');

-- ---------------------------------------------------------------------------------------
-- 6. Library reviewers (D-064)
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select throws_ok(format($$select public.set_library_reviewer(%L, true, false)$$, tests.id('r_teacher_a_other')),
  '42501', null, 'a teacher designates no reviewer');
select tests.authenticate_as('board_admin_b');
select throws_ok(format($$select public.set_library_reviewer(%L, true, false)$$, tests.id('r_teacher_a_other')),
  '42501', null, 'nor does another board''s admin');
select tests.authenticate_as('board_admin_a');
select throws_ok(format($$select public.set_library_reviewer(%L, true, false)$$, tests.id('r_teacher_b')),
  '42501', null, 'a board admin names people of their own board only');
select lives_ok(format($$select public.set_library_reviewer(%L, true, false)$$, tests.id('r_teacher_a_other')),
  'a board admin designates a colleague');
select lives_ok(format($$select public.set_library_reviewer(%L, true, false)$$, tests.id('r_teacher_a_other')),
  'saving the same values again');
select lives_ok(format($$select public.set_library_reviewer(%L, true, true)$$, tests.id('r_teacher_a_other')),
  'and changes the designation');
select lives_ok(format($$select public.set_library_reviewer(%L, false, false)$$, tests.id('r_teacher_a_other')),
  'and removes it');
select tests.clear_authentication();
select tests.create_user('parent_a');
insert into public.user_roles (user_id, role, board_id, school_id)
values (tests.id('parent_a'), 'parent', tests.id('board_a'), tests.id('school_a1'));
select tests.remember_role('r_parent_a', 'parent_a', 'parent', 'school_a1');
select tests.authenticate_as('board_admin_a');
select throws_ok(format($$select public.set_library_reviewer(%L, true, false)$$, tests.id('r_parent_a')),
  '22023', null, 'a reviewer is staff of the board (the Phase 4 guard)');
select tests.clear_authentication();
update public.users set deactivated_at = now() where id = tests.id('both_boards');
select tests.authenticate_as('board_admin_a');
select throws_ok(format($$select public.set_library_reviewer(%L, true, false)$$, tests.id('r_both_a')),
  '22023', null, 'a person whose access was removed is not designated');
select tests.clear_authentication();
update public.users set deactivated_at = null where id = tests.id('both_boards');
select results_eq(
  $$select action, actor_user_id, details from public.audit_log
    where action like 'library_reviewer.%' and entity_id = tests.id('teacher_a_other') order by id$$,
  $$values ('library_reviewer.designated', tests.id('board_admin_a'), '{"approves_content": true, "reviews_faith": false}'::jsonb),
           ('library_reviewer.changed', tests.id('board_admin_a'), '{"approves_content": true, "reviews_faith": true}'::jsonb),
           ('library_reviewer.removed', tests.id('board_admin_a'), '{"approves_content": true, "reviews_faith": true}'::jsonb)$$,
  'each designation, change and removal is audited once'
);

-- ---------------------------------------------------------------------------------------
-- 7. Pilot feedback (D-116)
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select tests.remember('fb_a', public.submit_feedback(tests.id('board_a'), tests.id('school_a1'),
  'problem', 'La page Aujourd’hui ne charge pas.', '/today', 'a1b2c3', '0.6.0', 'phone', 'fr-CA', true));
select is(
  concat_ws(' ',
    tests.code_of(format($$select public.submit_feedback(%L, null, 'idea', 'x', null, null, null, null, null, true)$$, tests.id('board_b'))),
    tests.code_of(format($$select public.submit_feedback(%L, %L, 'idea', 'x', null, null, null, null, null, true)$$, tests.id('board_a'), tests.id('school_b1'))),
    tests.code_of(format($$select public.submit_feedback(%L, %L, 'idea', 'x', null, null, null, null, null, true)$$, tests.id('board_a'), tests.id('school_a2'))),
    tests.code_of(format($$select public.submit_feedback(%L, null, 'rant', 'x', null, null, null, null, null, true)$$, tests.id('board_a'))),
    tests.code_of(format($$select public.submit_feedback(%L, null, 'idea', 'x', '/classes/7?x=1', null, null, null, null, true)$$, tests.id('board_a')))),
  '42501 42501 42501 23514 23514',
  'feedback comes from a member of the board, from a school where the sender works; the table checks the rest'
);
select tests.clear_authentication();
select results_eq(
  $$select board_id, school_id, user_id, kind, route, error_ref, app_release, device, locale, status
    from public.feedback where id = tests.id('fb_a')$$,
  $$values (tests.id('board_a'), tests.id('school_a1'), tests.id('teacher_a'), 'problem', '/today',
            'a1b2c3', '0.6.0', 'phone', 'fr-CA', 'new')$$,
  'the feedback is stored with its sender and context'
);
insert into public.feedback (board_id, user_id, kind, message, created_at)
select tests.id('board_a'), tests.id('teacher_a_other'), 'idea', 'Idée ' || g, now() - interval '1 hour'
from generate_series(1, 19) g;
insert into public.feedback (board_id, user_id, kind, message, created_at)
values (tests.id('board_a'), tests.id('teacher_a_other'), 'idea', 'Hier', now() - interval '25 hours');
select tests.authenticate_as('teacher_a_other');
select lives_ok(
  format($$select public.submit_feedback(%L, null, 'idea', 'La vingtième', null, null, null, 'desktop', 'en-CA', false)$$,
    tests.id('board_a')),
  'the 20th feedback of the day is accepted');
select throws_ok(
  format($$select public.submit_feedback(%L, null, 'idea', 'Une de trop', null, null, null, null, null, true)$$,
    tests.id('board_a')),
  'LXF01', null, 'the 21st within 24 hours is refused');
select is((select count(*)::int from public.feedback), 0, 'a teacher reads no feedback, not even her own');
select tests.authenticate_as('board_admin_b');
select is((select count(*)::int from public.feedback where board_id = tests.id('board_a')), 0,
  'another board''s admin reads none of it');
select tests.authenticate_as('board_admin_a');
select is((select count(*)::int from public.feedback where board_id = tests.id('board_a')), 22,
  'the board''s admin reads the board''s feedback');
select lives_ok(format($$update public.feedback set status = 'done' where id = %L$$, tests.id('fb_a')),
  'and marks it');
select throws_ok(format($$update public.feedback set message = 'x' where id = %L$$, tests.id('fb_a')),
  '42501', null, 'without changing what was written');
select tests.clear_authentication();
select is((select status from public.feedback where id = tests.id('fb_a')), 'done', 'the status is saved');

-- ---------------------------------------------------------------------------------------
-- 8. Sample classes (D-109): never in a substitute plan
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select tests.remember('sample', public.create_sample_class(tests.id('school_a1'), tests.sample_payload()));
select throws_ok(
  format($$select public.create_sample_class(%L, tests.sample_payload('Encore'))$$, tests.id('school_a1')),
  '23505', null, 'one sample class per teacher and school');
select throws_ok(
  format($$select public.create_sample_class(%L, '{"name": "x", "students": []}')$$, tests.id('school_a1')),
  '22023', null, 'the payload is checked');
select tests.authenticate_as('principal_a');
select throws_ok(
  format($$select public.create_sample_class(%L, tests.sample_payload())$$, tests.id('school_a1')),
  '42501', null, 'someone who does not teach at the school gets none');
select tests.clear_authentication();
select results_eq(
  $$select c.sample_owner_id, c.name, c.school_year_id, c.created_by,
      (select count(*)::int from public.students s where s.class_id = c.id),
      (select count(*)::int from public.students s where s.class_id = c.id and s.default_language_level_id is not null),
      (select count(*)::int from public.timetable_blocks b where b.class_id = c.id),
      (select count(*)::int from public.timetable_blocks b where b.class_id = c.id and b.subject_id is not null),
      (select count(*)::int from public.unit_lessons l join public.units u on u.id = l.unit_id where u.class_id = c.id),
      (select string_agg(p.taught_on::text, ',' order by p.taught_on) from public.lesson_progress p where p.class_id = c.id),
      (select ct.user_id from public.class_teachers ct where ct.class_id = c.id and ct.role = 'homeroom')
    from public.classes c where c.id = tests.id('sample')$$,
  $$values (tests.id('teacher_a'), 'Classe exemple (3e année)', tests.id('year_a'), tests.id('teacher_a'),
            3, 3, 2, 1, 3, (current_date - 2)::text || ',' || (current_date - 1)::text, tests.id('teacher_a'))$$,
  'the sample class is hers, in the current year, with its students, levels, timetable, unit and progress'
);

-- No school year in the board: LXO01.
select tests.remember('board_c', gen_random_uuid());
select tests.remember('school_c1', gen_random_uuid());
insert into public.boards (id, name, slug) values (tests.id('board_c'), 'Board C', 'board-c-' || substr(tests.id('board_c')::text, 1, 8));
select public.provision_board_defaults(tests.id('board_c'));
insert into public.schools (id, board_id, name, slug) values (tests.id('school_c1'), tests.id('board_c'), 'School C1', 'c1');
select tests.create_user('teacher_c');
insert into public.user_roles (user_id, role, board_id, school_id)
values (tests.id('teacher_c'), 'teacher', tests.id('board_c'), tests.id('school_c1'));
select tests.authenticate_as('teacher_c');
select throws_ok(
  format($$select public.create_sample_class(%L, tests.sample_payload())$$, tests.id('school_c1')),
  'LXO01', null, 'a board with no school year has no sample class');

-- Only the class she just made, without students, can become her sample.
select tests.authenticate_as('teacher_a_other');
select tests.remember('other_new', public.create_class(tests.id('school_a1'), tests.id('year_a'), 'Nouvelle', array['4'], null));
select tests.clear_authentication();
insert into public.user_roles (user_id, role, board_id, school_id)
values (tests.id('teacher_a'), 'teacher', tests.id('board_a'), tests.id('school_a2'));
select tests.authenticate_as('teacher_a');
select tests.remember('a_new', public.create_class(tests.id('school_a2'), tests.id('year_a'), 'Neuve', array['4'], null));
select tests.clear_authentication();
insert into public.classes (id, school_id, school_year_id, name, created_by, created_at) values
  (tests.remember('a_students', gen_random_uuid()), tests.id('school_a2'), tests.id('year_a'), 'Avec élèves', tests.id('teacher_a'), now()),
  (tests.remember('a_old', gen_random_uuid()), tests.id('school_a2'), tests.id('year_a'), 'Ancienne', tests.id('teacher_a'), now() - interval '11 minutes');
insert into public.students (class_id, first_name) values (tests.id('a_students'), 'Inès');
select tests.authenticate_as('teacher_a');
select is(
  concat_ws(' ',
    tests.error_of(format($$select app.mark_sample_class(%L)$$, tests.id('other_new'))),
    tests.error_of(format($$select app.mark_sample_class(%L)$$, tests.id('a_students'))),
    tests.error_of(format($$select app.mark_sample_class(%L)$$, tests.id('a_old'))),
    tests.error_of(format($$select app.mark_sample_class(%L)$$, tests.id('class_a')))),
  '42501 42501 42501 42501',
  'another teacher''s class, a class with students, one older than 10 minutes, a real class: refused'
);
select throws_ok(
  format($$update public.classes set sample_owner_id = %L where id = %L$$, tests.id('teacher_a'), tests.id('a_new')),
  '42501', null, 'nobody sets the sample flag directly');
select tests.clear_authentication();
delete from public.user_roles where user_id = tests.id('teacher_a') and school_id = tests.id('school_a2');

select ok(
  tests.id('sample') not in (select app.teacher_class_ids(tests.id('teacher_a'), tests.id('school_a1')))
  and tests.id('class_a') in (select app.teacher_class_ids(tests.id('teacher_a'), tests.id('school_a1'))),
  'the sample class is not among her classes for substitute plans'
);
select tests.authenticate_as('teacher_a');
select is_empty(
  format($$select 1 from jsonb_array_elements(public.get_sub_plan_sources(%L, %L, %L) -> 'classes') c
    where c ->> 'id' = %L$$, tests.id('school_a1'), tests.school_day(21), tests.school_day(21), tests.id('sample')),
  'the plan sources leave the sample class out'
);
select throws_ok(
  format($$select public.publish_absence(%L, %L, %L, 'full_day', null, true, %L, tests.plan_items(array[%L::date], array[%L::uuid]))$$,
    tests.id('school_a1'), tests.school_day(21), tests.school_day(21), gen_random_uuid(),
    tests.school_day(21), tests.id('sample')),
  '22023', null, 'a plan cannot cover the sample class');
select tests.remember('abs_a', public.publish_absence(tests.id('school_a1'), tests.school_day(21),
  tests.school_day(21), 'full_day', null, true, gen_random_uuid(),
  tests.plan_items(array[tests.school_day(21)], array[tests.id('class_a')])));
select tests.clear_authentication();
select tests.remember('plan_a', (select id from public.sub_plans where absence_id = tests.id('abs_a')));
update public.sub_plan_classes set class_id = tests.id('sample') where sub_plan_id = tests.id('plan_a');
select tests.authenticate_as('teacher_a');
select throws_ok(
  format($$select * from public.issue_sub_access_code(%L, %L)$$, tests.id('plan_a'), md5('a') || md5('b')),
  '42501', null, 'no code is issued for a plan of the sample class');
select tests.clear_authentication();
update public.sub_plan_classes set class_id = tests.id('class_a') where sub_plan_id = tests.id('plan_a');

-- ---------------------------------------------------------------------------------------
-- 9. Roles (D-107): a person is named by one of their roles in the caller's board
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select throws_ok(
  format($$select public.grant_staff_role(%L, 'principal', %L)$$, tests.id('r_teacher_a_other'), tests.id('school_a2')),
  '42501', null, 'a teacher grants no role');
select tests.authenticate_as('board_admin_b');
select throws_ok(
  format($$select public.grant_staff_role(%L, 'principal', %L)$$, tests.id('r_teacher_a'), tests.id('school_a2')),
  '42501', null, 'another board''s admin grants nothing here');
select tests.authenticate_as('board_admin_a');
select throws_ok(
  format($$select public.grant_staff_role(%L, 'principal', %L)$$, tests.id('r_admin_a'), tests.id('school_a1')),
  'LXU07', null, 'a board admin cannot give themselves a role (a principal reads alerts)');
select throws_ok(
  format($$select public.grant_staff_role(%L, 'teacher', %L)$$, tests.id('r_teacher_b'), tests.id('school_a1')),
  '42501', null, 'nor give a role to someone who has none in their board');
select is(
  concat_ws(' ',
    tests.code_of(format($$select public.grant_staff_role(%L, 'teacher', %L)$$, tests.id('r_teacher_a'), tests.id('school_b1'))),
    tests.code_of(format($$select public.grant_staff_role(%L, 'board_admin', %L)$$, tests.id('r_teacher_a'), tests.id('school_a1'))),
    tests.code_of(format($$select public.grant_staff_role(%L, 'principal', null)$$, tests.id('r_teacher_a'))),
    tests.code_of(format($$select public.grant_staff_role(%L, 'parent', %L)$$, tests.id('r_teacher_a'), tests.id('school_a1')))),
  '22023 22023 22023 22023',
  'the new role is a staff role at a school of the same board (an admin role has no school)'
);
select tests.remember('r_teacher_a_vp', public.grant_staff_role(tests.id('r_teacher_a'), 'vice_principal', tests.id('school_a2')));
select throws_ok(
  format($$select public.grant_staff_role(%L, 'vice_principal', %L)$$, tests.id('r_teacher_a'), tests.id('school_a2')),
  '23505', null, 'a role the person already holds');
select tests.clear_authentication();
select results_eq(
  $$select ur.user_id, ur.role::text, ur.board_id, ur.school_id, ur.created_by from public.user_roles ur
    where ur.id = tests.id('r_teacher_a_vp')$$,
  $$values (tests.id('teacher_a'), 'vice_principal', tests.id('board_a'), tests.id('school_a2'), tests.id('board_admin_a'))$$,
  'the role is granted in the board of the role that named the person, by the admin'
);
select is(
  (select count(*)::int from public.audit_log where action = 'user_role.granted'
     and entity_id = tests.id('teacher_a') and school_id = tests.id('school_a2')
     and actor_user_id = tests.id('board_admin_a') and details = '{"role": "vice_principal"}'),
  1, 'the grant is audited');

select tests.authenticate_as('teacher_a');
select throws_ok(format($$select public.revoke_staff_role(%L)$$, tests.id('r_teacher_a_vp')),
  '42501', null, 'a teacher revokes no role, not even her own');
select tests.authenticate_as('board_admin_b');
select throws_ok(format($$select public.revoke_staff_role(%L)$$, tests.id('r_teacher_a_vp')),
  '42501', null, 'another board''s admin revokes nothing here');
select tests.authenticate_as('board_admin_a');
select throws_ok(format($$select public.revoke_staff_role(%L)$$, tests.id('r_admin_a')),
  'LXU01', null, 'the board''s last admin keeps their admin role');
select tests.clear_authentication();
select tests.create_user('board_admin_a2');
insert into public.user_roles (user_id, role, board_id, school_id) values
  (tests.id('board_admin_a2'), 'board_admin', tests.id('board_a'), null),
  (tests.id('board_admin_a2'), 'teacher', tests.id('board_a'), tests.id('school_a2'));
select tests.remember_role('r_admin_a2', 'board_admin_a2', 'board_admin');
update public.users set deactivated_at = now() where id = tests.id('board_admin_a2');
select tests.authenticate_as('board_admin_a');
select throws_ok(format($$select public.revoke_staff_role(%L)$$, tests.id('r_admin_a')),
  'LXU01', null, 'an admin whose access was removed does not count');
select throws_ok(
  format($$select public.revoke_staff_role(%L)$$,
    (select id from public.staff_invitations where id = tests.id('inv_new'))),
  '42501', null, 'an id that is not a role names nobody');
select tests.clear_authentication();
select tests.remember_role('r_new', 'auth_new', 'teacher', 'school_a1');
select tests.authenticate_as('board_admin_a');
select throws_ok(format($$select public.revoke_staff_role(%L)$$, tests.id('r_new')),
  'LXU08', null, 'a person''s last role stays: remove their access instead');
select lives_ok(format($$select public.revoke_staff_role(%L)$$, tests.id('r_teacher_a_vp')),
  'a board admin revokes a role');
select tests.clear_authentication();
select is_empty($$select 1 from public.user_roles where id = tests.id('r_teacher_a_vp')$$, 'the role is gone');
select is(
  (select count(*)::int from public.audit_log where action = 'user_role.revoked'
     and entity_id = tests.id('teacher_a') and actor_user_id = tests.id('board_admin_a')),
  1, 'the revocation is audited');

-- Their last role in the board: the reviewer designation for the board goes with it.
insert into public.user_roles (user_id, role, board_id, school_id)
values (tests.id('faith_reviewer_a'), 'teacher', tests.id('board_b'), tests.id('school_b1'));
select tests.authenticate_as('board_admin_a');
select lives_ok(format($$select public.revoke_staff_role(%L)$$, tests.id('r_faith_a')),
  'a board admin revokes the last role a person has in the board');
select tests.clear_authentication();
select results_eq(
  $$select (select count(*)::int from public.library_reviewers
            where user_id = tests.id('faith_reviewer_a') and board_id = tests.id('board_a')),
           (select count(*)::int from public.audit_log where action = 'library_reviewer.removed'
            and entity_id = tests.id('faith_reviewer_a'))$$,
  $$values (0, 1)$$,
  'and their reviewer designation for the board is removed, audited'
);

update public.users set deactivated_at = null where id = tests.id('board_admin_a2');
select tests.authenticate_as('board_admin_a2');
select lives_ok(format($$select public.revoke_staff_role(%L)$$, tests.id('r_admin_a2')),
  'an admin may give up their own admin role while another active admin remains');
select tests.clear_authentication();
select results_eq(
  $$select app.board_has_other_admin(tests.id('board_a'), tests.id('board_admin_a')),
           app.board_has_other_admin(tests.id('board_a'), tests.id('teacher_a'))$$,
  $$values (false, true)$$,
  'board admin A is the board''s last active admin again'
);

-- ---------------------------------------------------------------------------------------
-- 10. Access (D-107)
-- ---------------------------------------------------------------------------------------

insert into public.user_roles (user_id, role, board_id, school_id)
values (tests.id('teacher_a'), 'vice_principal', tests.id('board_a'), tests.id('school_a2'));
update public.absences set sources_changed_at = null where id = tests.id('abs_a');
delete from public.event_outbox;

select tests.authenticate_as('teacher_a');
select throws_ok(format($$select public.set_staff_active(%L, false)$$, tests.id('r_teacher_a_other')),
  '42501', null, 'a teacher removes nobody''s access');
select tests.authenticate_as('board_admin_b');
select throws_ok(format($$select public.set_staff_active(%L, false)$$, tests.id('r_teacher_a')),
  '42501', null, 'another board''s admin removes nobody''s access here');
select tests.authenticate_as('board_admin_a');
select throws_ok(format($$select public.set_staff_active(%L, false)$$, tests.id('r_admin_a')),
  'LXU05', null, 'nobody removes their own access');
select throws_ok(format($$select public.set_staff_active(%L, false)$$, tests.id('r_both_a')),
  'LXU02', null, 'a person with a role in another board: the operator''s');
select throws_ok(format($$select public.set_staff_active(%L, false)$$, tests.id('r_subject_teacher')),
  'LXU02', null, 'a person with a class team in another board: the operator''s');
select lives_ok(format($$select public.set_staff_active(%L, false)$$, tests.id('r_teacher_a')),
  'a board admin removes a teacher''s access');
select lives_ok(format($$select public.set_staff_active(%L, false)$$, tests.id('r_teacher_a')),
  'removing it again changes nothing');
select tests.clear_authentication();
select results_eq(
  $$select school_id, actor_user_id from public.audit_log
    where action = 'staff.access_removed' and entity_id = tests.id('teacher_a') order by school_id = tests.id('school_a2')$$,
  $$values (tests.id('school_a1'), tests.id('board_admin_a')), (tests.id('school_a2'), tests.id('board_admin_a'))$$,
  'audited once for each school where the person has a role'
);
select results_eq(
  $$select event_type, payload from public.event_outbox where aggregate_id = tests.id('teacher_a')$$,
  $$values ('staff.access_changed', jsonb_build_object('userId', tests.id('teacher_a')))$$,
  'the worker is told whose access changed (once), and reads the state itself'
);
select ok((select sources_changed_at is not null from public.absences where id = tests.id('abs_a')),
  'her upcoming absence''s plans are refreshed');
select tests.authenticate_as('teacher_a');
select results_eq(
  $$select (select count(*)::int from public.classes), (select count(*)::int from public.students),
           (select count(*)::int from public.absences), (select count(*)::int from public.schools)$$,
  $$values (0, 0, 0, 0)$$,
  'the person sees nothing any more'
);
select tests.authenticate_as('board_admin_a');
select lives_ok(format($$select public.set_staff_active(%L, true)$$, tests.id('r_teacher_a')),
  'a board admin restores the access');
select tests.clear_authentication();
select results_eq(
  $$select (select deactivated_at is null from public.users where id = tests.id('teacher_a')),
           (select count(*)::int from public.audit_log where action = 'staff.access_restored'
            and entity_id = tests.id('teacher_a')),
           (select count(*)::int from public.event_outbox where aggregate_id = tests.id('teacher_a'))$$,
  $$values (true, 2, 2)$$,
  'restored, audited per school, and the worker told'
);

-- ---------------------------------------------------------------------------------------
-- 11. « Jamais connectée »
-- ---------------------------------------------------------------------------------------

update auth.users set last_sign_in_at = now() - interval '2 days' where id = tests.id('teacher_a');
select tests.authenticate_as('teacher_a');
select throws_ok(format($$select * from public.board_staff_sign_ins(%L)$$, tests.id('board_a')),
  '42501', null, 'a teacher cannot see who signed in');
select tests.authenticate_as('board_admin_b');
select throws_ok(format($$select * from public.board_staff_sign_ins(%L)$$, tests.id('board_a')),
  '42501', null, 'nor can another board''s admin');
select tests.authenticate_as('board_admin_a');
select results_eq(
  format($$select user_id, has_signed_in from public.board_staff_sign_ins(%L)
    where user_id in (%L, %L, %L) order by has_signed_in$$,
    tests.id('board_a'), tests.id('teacher_a'), tests.id('teacher_a_other'), tests.id('teacher_b')),
  format($$values (%L::uuid, false), (%L::uuid, true)$$, tests.id('teacher_a_other'), tests.id('teacher_a')),
  'whether each person of the board ever signed in (once each, never the time; nobody of another board)'
);
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- 12. The operator (service role): support log, deleting an account, deleting a board
-- ---------------------------------------------------------------------------------------

create table tests.results (key text primary key, val jsonb);
grant select, insert on tests.results to service_role;

select tests.as_service();
select throws_ok(format($$select public.log_operator_access(%L, 'curiosity')$$, tests.id('board_a')),
  '22023', null, 'a support access gives one of the four reasons');
select lives_ok(format($$select public.log_operator_access(%L, 'support')$$, tests.id('board_a')),
  'the operator records a support access');
select results_eq(
  $$select actor_type::text, actor_user_id, school_id, entity_type, entity_id, details from public.audit_log
    where action = 'operator.access' and board_id = tests.id('board_a')$$,
  $$values ('service', null::uuid, null::uuid, 'board', tests.id('board_a'), '{"reason": "support"}'::jsonb)$$,
  'recorded for the board, as IP Lynx'
);
select results_eq(
  $$select public.operator_account_id('  Teacher.A@test.lynx.test '), public.operator_account_id('annule@example.ca'),
           public.operator_account_id('personne@example.ca')$$,
  $$values (tests.id('teacher_a'), tests.id('auth_cancel'), null::uuid)$$,
  'the operator finds an account by address: a profile, else an Auth account alone'
);
select throws_ok(format($$select public.operator_delete_staff_account(%L)$$, tests.id('teacher_a')),
  'LXU06', null, 'an active account is not deleted');
select throws_ok(format($$select public.operator_delete_staff_account(%L)$$, tests.id('left_teacher')),
  'LXU02', null, 'a person of several boards needs --all-boards');
select tests.clear_authentication();

update public.users set deactivated_at = now() where id = tests.id('teacher_a');
insert into public.classes (id, school_id, school_year_id, name)
values (tests.remember('class_co', gen_random_uuid()), tests.id('school_a1'), tests.id('year_a'), 'Co-titulaires');
insert into public.class_teachers (class_id, user_id, role) values
  (tests.id('class_co'), tests.id('teacher_a'), 'homeroom'),
  (tests.id('class_co'), tests.id('teacher_a_other'), 'homeroom');
-- A past absence whose plan covered the shared class, with a report: one lesson awaiting her
-- confirmation, one confirmed.
insert into public.class_grades (class_id, grade_code) values (tests.id('class_co'), '3');
insert into public.units (id, class_id, subject_id, title, status)
values (tests.remember('unit_co', gen_random_uuid()), tests.id('class_co'),
  (select id from public.subjects where code = 'fra' and board_id is null), 'Unité partagée', 'active');
insert into public.unit_lessons (id, unit_id, sequence_number, title) values
  (tests.remember('lesson_co1', gen_random_uuid()), tests.id('unit_co'), 1, 'L1'),
  (tests.remember('lesson_co2', gen_random_uuid()), tests.id('unit_co'), 2, 'L2');
insert into public.absences (id, teacher_id, school_id, starts_on, ends_on, status, published_at)
values (tests.remember('abs_co', gen_random_uuid()), tests.id('teacher_a'), tests.id('school_a1'),
  current_date - 3, current_date - 3, 'published', now() - interval '4 days');
insert into public.sub_plans (id, absence_id, plan_date, plan, review_deadline)
values (tests.remember('plan_co', gen_random_uuid()), tests.id('abs_co'), current_date - 3,
  tests.plan_json(current_date - 3), now() - interval '3 days');
insert into public.sub_plan_classes (sub_plan_id, class_id) values (tests.id('plan_co'), tests.id('class_co'));
insert into public.sub_reports (id, sub_plan_id, content)
values (tests.remember('report_co', gen_random_uuid()), tests.id('plan_co'), '{"schemaVersion": 1}');
insert into public.lesson_progress (lesson_id, status, taught_on, source, sub_report_id) values
  (tests.id('lesson_co1'), 'pending_confirmation', current_date - 3, 'substitute_report', tests.id('report_co')),
  (tests.id('lesson_co2'), 'completed', current_date - 3, 'substitute_report', tests.id('report_co'));
select tests.library_item('ta_private', 'teacher_a', 'worksheet', 'draft', 'private', 'school_a1');
select tests.library_item('ta_shared', 'teacher_a', 'worksheet', 'teacher_reviewed', 'school', 'school_a1');

select tests.as_service();
insert into tests.results values ('del_a', public.operator_delete_staff_account(tests.id('teacher_a')));
insert into tests.results values ('del_left', public.operator_delete_staff_account(tests.id('left_teacher'), true));
select tests.clear_authentication();

select is(
  (select val from tests.results where key = 'del_a'),
  '{"profile": true, "boards": 1, "roles": 2, "classes": 3, "plans": 1, "libraryItems": 1, "feedback": 1,
    "invitations": 0}'::jsonb,
  'the deletion reports what it removed'
);
select results_eq(
  $$select (select count(*)::int from public.users where id = tests.id('teacher_a')),
           (select count(*)::int from public.user_roles where user_id = tests.id('teacher_a')),
           (select count(*)::int from public.classes where id in (tests.id('class_a'), tests.id('sample'), tests.id('a_new'))),
           (select count(*)::int from public.absences where id = tests.id('abs_a')),
           (select count(*)::int from public.feedback where id = tests.id('fb_a'))$$,
  $$values (0, 0, 0, 0, 0)$$,
  'the profile, roles, absences and feedback are gone, with the classes she alone led (her sample too)'
);
select results_eq(
  $$select ct.user_id, ct.role::text from public.class_teachers ct where ct.class_id = tests.id('class_co')$$,
  $$values (tests.id('teacher_a_other'), 'homeroom')$$,
  'a class she shared with another homeroom teacher stays'
);
select results_eq(
  $$select lp.lesson_id, lp.status::text, lp.sub_report_id from public.lesson_progress lp
    where lp.lesson_id in (tests.id('lesson_co1'), tests.id('lesson_co2'))$$,
  $$values (tests.id('lesson_co2'), 'completed', null::uuid)$$,
  'her plans go: the report''s unconfirmed lessons are no longer done, confirmed ones stay'
);
select results_eq(
  $$select actor_type::text, details ->> 'reason' from public.audit_log
    where action = 'sub_plan.deleted' and entity_id = tests.id('plan_co')$$,
  $$values ('service', 'account_deleted')$$,
  'the plan''s deletion is audited'
);
select results_eq(
  $$select (select count(*)::int from public.library_items where id = tests.id('ta_private')),
           (select author_id from public.library_items where id = tests.id('ta_shared'))$$,
  $$values (0, null::uuid)$$,
  'her private resources are deleted; a shared one stays, without an author'
);
select results_eq(
  $$select school_id, actor_type::text, actor_user_id from public.audit_log
    where action = 'staff.deleted' and entity_id = tests.id('teacher_a') order by school_id = tests.id('school_a2')$$,
  $$values (tests.id('school_a1'), 'service', null::uuid), (tests.id('school_a2'), 'service', null::uuid)$$,
  'the deletion is audited for each school where she worked, as IP Lynx'
);
select results_eq(
  $$select (val ->> 'boards')::int, (select count(*)::int from public.users where id = tests.id('left_teacher'))
    from tests.results where key = 'del_left'$$,
  $$values (2, 0)$$,
  'with --all-boards, a person of several boards is deleted'
);

select tests.as_service();
select throws_ok(format($$select public.operator_delete_board(%L, 'board-x')$$, tests.id('board_b')),
  '22023', null, 'deleting a board needs its slug typed again');
select tests.clear_authentication();
create table tests.counts as
  select (select count(*) from public.audit_log where board_id = tests.id('board_a')) as board_a,
         (select count(*) from public.audit_log where board_id = tests.id('board_b')) as board_b;
select ok((select board_b > 0 from tests.counts), 'board B has audit rows before');
select tests.as_service();
insert into tests.results
values ('del_b', public.operator_delete_board(tests.id('board_b'),
  (select slug from public.boards where id = tests.id('board_b'))));
select tests.clear_authentication();
select set_eq(
  $$select jsonb_array_elements_text(val -> 'userIds')::uuid from tests.results where key = 'del_b'$$,
  $$values (tests.id('teacher_b')), (tests.id('board_admin_b')), (tests.id('faith_reviewer_a'))$$,
  'the people who worked in that board only are returned for their Auth accounts'
);
select results_eq(
  $$select (select count(*)::int from public.boards where id = tests.id('board_b')),
           (select count(*)::int from public.schools where id = tests.id('school_b1')),
           (select count(*)::int from public.classes where id = tests.id('class_b')),
           (select count(*)::int from public.users where id in (tests.id('teacher_b'), tests.id('board_admin_b'))),
           (select count(*)::int from public.audit_log where board_id = tests.id('board_b'))$$,
  $$values (0, 0, 0, 0, 0)$$,
  'the board, its schools, classes, people and audit rows are gone'
);
select results_eq(
  $$select (select count(*)::int from public.users where id in (tests.id('both_boards'), tests.id('subject_teacher'))),
           (select count(*)::int from public.user_roles where user_id = tests.id('both_boards')),
           (select count(*) from public.audit_log where board_id = tests.id('board_a')) >= (select board_a from tests.counts)$$,
  $$values (2, 1, true)$$,
  'people of other boards stay with their other roles, and other boards keep their audit rows'
);

select * from finish();
rollback;
