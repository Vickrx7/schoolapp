-- Phase 6 (pilot readiness), slice S1: accounts, onboarding, settings and feedback in the
-- database. The tables and columns are in 20261201090000_pilot_schema.sql.
--
-- 1. Who belongs where: the boards a person works in (roles, class teams, absences), so a board
--    admin acts only on people entirely within their own boards (LXU02, D-107).
-- 2. The pilot terms (D-109, D-110): accepted once, audited for the operator only.
-- 3. Staff invitations (D-107): a board admin invites within their own board; the worker creates
--    the Auth account and completes the invitation; nobody is e-mailed by our servers.
-- 4. Roles and access (D-107): grant, revoke, remove and restore, by a board admin of the
--    person's board. A person is named by one of their roles in that board (`user_roles.id`),
--    never by a user id: no function `authenticated` may run takes a user id (the Phase 4 rule:
--    helpers that answer about someone else are the service role's only).
-- 5. The operator (service role, `pnpm admin`): deleting an account or a board on request, and
--    recording a support access to a board's data (D-106, D-107). No deletion in the web.
-- 6. Sample classes (D-109): never part of a substitute plan (amends D-055).
-- 7. School settings (D-108): contact details and bell times for direction and board admins,
--    merged atomically; the alerts switch and the substitute settings stay the direction's.
-- 8. Library reviewers designated by the board's admins (D-064, D-107).
-- 9. Pilot feedback (D-116).
-- 10. Permissions.
--
-- DECISIONS: D-064, D-106, D-107, D-108, D-109, D-110, D-116.
-- Tests: supabase/tests/27_pilot_accounts.test.sql

-- ---------------------------------------------------------------------------------------
-- 1. Who belongs where
-- ---------------------------------------------------------------------------------------

-- The boards a person works in: through a role, a class team or an absence (a class team or an
-- absence can outlive the role that came with it). Owner only: it answers about anyone.
create function app.staff_board_ids(p_user_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct b.board_id order by b.board_id), '{}')
  from (
    select ur.board_id from public.user_roles ur where ur.user_id = p_user_id
    union
    select s.board_id
    from public.class_teachers ct
    join public.classes c on c.id = ct.class_id
    join public.schools s on s.id = c.school_id
    where ct.user_id = p_user_id
    union
    select s.board_id
    from public.absences a
    join public.schools s on s.id = a.school_id
    where a.teacher_id = p_user_id
  ) b;
$$;

-- True when the person also exists outside the given boards (a role, a class team or an absence
-- elsewhere), or holds no role at all: board admins may not act on such accounts (LXU02), and an
-- invitation to such an address fails as `emailConflict` (the operator resolves it).
create function app.staff_beyond_boards(p_user_id uuid, p_board_ids uuid[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.user_roles ur where ur.user_id = p_user_id)
    or not (app.staff_board_ids(p_user_id) <@ coalesce(p_board_ids, '{}'));
$$;

-- Serializes changes to a board's administrators (revoking an admin role, removing an admin's
-- access), so two admins cannot remove each other at the same time and leave the board without
-- one (LXU01).
create function app.lock_board_admins(p_board_id uuid)
returns void
language sql
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('lynx.board_admins:' || p_board_id::text, 0));
$$;

-- Whether a board keeps an active administrator other than the given person.
create function app.board_has_other_admin(p_board_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.users u on u.id = ur.user_id
    where ur.board_id = p_board_id and ur.role = 'board_admin'
      and ur.user_id <> p_user_id and u.deactivated_at is null
  );
$$;

-- The role a board admin names a person by: a role in a board the caller administers. Raises
-- 42501 otherwise (a role of another board, an unknown id, or a caller without access).
create function app.admin_target_role(p_role_id uuid)
returns public.user_roles
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.user_roles;
begin
  select * into v_role from public.user_roles ur where ur.id = p_role_id;
  if app.active_user_id() is null or v_role.id is null
     or not exists (select 1 from app.my_admin_board_ids() b where b = v_role.board_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return v_role;
end;
$$;

-- The roles board admins hand out (not facilities or parent), and where: a board admin has no
-- school; any other role has a school of that board. 22023 otherwise.
create function app.assert_staff_role(p_board_id uuid, p_role public.app_role, p_school_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_role is null
     or p_role not in ('teacher', 'principal', 'vice_principal', 'office_admin', 'board_admin')
     or (p_role = 'board_admin') <> (p_school_id is null)
     or (p_school_id is not null and not exists (
       select 1 from public.schools s where s.id = p_school_id and s.board_id = p_board_id)) then
    raise exception 'invalid role or school' using errcode = '22023';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 2. The pilot terms (D-109, D-110)
-- ---------------------------------------------------------------------------------------

-- « J'ai lu et j'accepte les conditions du projet pilote »: the version shown
-- (`CURRENT_TERMS_VERSION`) and the time, audited for the operator only (`user.terms_accepted`).
create function public.accept_terms(p_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.active_user_id();
begin
  if v_user is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_version is null or p_version !~ '^[0-9]{4}-[0-9]{2}-[a-z0-9-]{1,24}$' then
    raise exception 'invalid terms version' using errcode = '22023';
  end if;
  update public.users set terms_version = p_version, terms_accepted_at = now() where id = v_user;
  perform app.log_audit('user.terms_accepted', null, null, 'user', v_user,
    jsonb_build_object('version', p_version));
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 3. Staff invitations (D-107)
-- ---------------------------------------------------------------------------------------

-- « Inviter une personne », by a board admin, within that board:
--   - an unknown address: a pending invitation; the worker creates the account
--     (`staff_invitation.created {invitationId}`);
--   - an active person entirely within the caller's admin boards: the role at once (`ready`);
--   - such a person whose access was removed: pending; the worker restores access;
--   - anyone with a role, class team or absence elsewhere, or with no role at all: `failed`
--     with `emailConflict` at once. Nothing is copied from the existing account (the row keeps
--     the name the inviter typed) and no role is granted: the operator resolves it.
-- Inviting oneself is LXU07; a second pending invitation for the same address, role and place is
-- 23505. The audit says `staff.invited {role}`, never the address.
create function public.invite_staff(
  p_board_id uuid,
  p_school_id uuid,
  p_email text,
  p_display_name text,
  p_honorific text,
  p_role public.app_role
)
returns table (invitation_id uuid, status text, error_code text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_caller uuid := app.active_user_id();
  v_admin uuid[] := array(select app.my_admin_board_ids());
  v_email text := lower(btrim(p_email));
  v_user public.users;
  v_status text := 'pending';
  v_error text;
  v_id uuid;
begin
  if v_caller is null or p_board_id is null or not (p_board_id = any (v_admin)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform app.assert_staff_role(p_board_id, p_role, p_school_id);

  select * into v_user from public.users u where lower(u.email) = v_email;
  if v_user.id = v_caller then
    raise exception 'no self invitation' using errcode = 'LXU07';
  end if;
  if v_user.id is not null and app.staff_beyond_boards(v_user.id, v_admin) then
    v_status := 'failed';
    v_error := 'emailConflict';
  elsif v_user.id is not null and v_user.deactivated_at is null then
    -- user_roles_audit records `user_role.granted` (actor: the inviter).
    insert into public.user_roles (user_id, role, board_id, school_id, created_by)
    values (v_user.id, p_role, p_board_id, p_school_id, v_caller)
    on conflict do nothing;
    v_status := 'ready';
  end if;
  -- Otherwise a new address, or a person whose access was removed: the worker provisions.

  insert into public.staff_invitations (board_id, school_id, email, display_name, honorific, role,
    status, error_code, user_id, invited_by, processed_at)
  values (p_board_id, p_school_id, v_email, btrim(p_display_name), nullif(btrim(p_honorific), ''),
    p_role, v_status, v_error, case when v_status = 'ready' then v_user.id end, v_caller,
    case when v_status <> 'pending' then now() end)
  returning id into v_id;

  if v_status = 'pending' then
    perform app.emit_event('staff_invitation.created', p_board_id, p_school_id, 'staff_invitation',
      v_id, jsonb_build_object('invitationId', v_id));
  end if;
  perform app.log_audit('staff.invited', p_board_id, p_school_id, 'staff_invitation', v_id,
    jsonb_build_object('role', p_role));
  return query select v_id, v_status, v_error;
end;
$$;

-- The worker's second step, once it has created or found the Auth account (owner only; the
-- worker connects as the database owner). Checks again for conflicts and cancellation, then
-- creates the profile (or restores the access this board removed) and the role. Idempotent: an
-- event can be delivered twice. Returns 'ready', 'cancelled', 'conflict', 'failed' or 'gone'
-- (the invitation no longer exists); the worker deletes an Auth account it created in this run
-- unless the result is 'ready', and unbans an existing one only on 'ready'.
create function app.complete_staff_invitation(p_invitation_id uuid, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.staff_invitations;
  v_by_id public.users;
  v_by_email public.users;
  v_boards uuid[];
begin
  if p_user_id is null then
    raise exception 'user id required' using errcode = '22023';
  end if;
  select * into v_inv from public.staff_invitations i where i.id = p_invitation_id for update;
  if v_inv.id is null then
    return 'gone';
  end if;
  if v_inv.status <> 'pending' then
    return v_inv.status;
  end if;

  -- The inviter's boards, as when the invitation was made, plus the invitation's own.
  v_boards := array(select ur.board_id from public.user_roles ur
                    where ur.user_id = v_inv.invited_by and ur.role = 'board_admin')
              || v_inv.board_id;
  select * into v_by_id from public.users u where u.id = p_user_id;
  select * into v_by_email from public.users u where lower(u.email) = v_inv.email;
  if (v_by_email.id is not null and v_by_email.id <> p_user_id)
     or (v_by_id.id is not null
         and (lower(v_by_id.email) <> v_inv.email or app.staff_beyond_boards(p_user_id, v_boards))) then
    update public.staff_invitations
    set status = 'failed', error_code = 'emailConflict', processed_at = now()
    where id = v_inv.id;
    return 'conflict';
  end if;

  insert into public.users (id, email, display_name, honorific)
  values (p_user_id, v_inv.email, v_inv.display_name, v_inv.honorific)
  on conflict (id) do update set deactivated_at = null;
  insert into public.user_roles (user_id, role, board_id, school_id, created_by)
  values (p_user_id, v_inv.role, v_inv.board_id, v_inv.school_id, v_inv.invited_by)
  on conflict do nothing;

  if v_by_id.deactivated_at is not null then
    -- Access removed by this board, restored by its invitation: once per board and school of the
    -- person's roles, as « Rétablir l'accès » does. The worker unbans the Auth account itself.
    perform app.log_audit('staff.access_restored', r.board_id, r.school_id, 'user', p_user_id,
      jsonb_build_object('via', 'invitation'))
    from (select distinct ur.board_id, ur.school_id from public.user_roles ur
          where ur.user_id = p_user_id) r;
    perform app.flag_absences(array[p_user_id], null, null, null);
  end if;

  update public.staff_invitations
  set status = 'ready', error_code = null, user_id = p_user_id, processed_at = now()
  where id = v_inv.id;
  return 'ready';
end;
$$;

-- The worker gives up on a pending invitation (owner only): 'authNotConfigured' (no Auth admin
-- settings on this server), 'authRefused' (Auth refused the address), 'emailConflict', or
-- 'expired' (the nightly job, after 14 days). Returns the invitation's status afterwards, or
-- 'gone'.
create function app.fail_staff_invitation(p_invitation_id uuid, p_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if p_code is null
     or p_code not in ('authNotConfigured', 'authRefused', 'emailConflict', 'expired') then
    raise exception 'invalid invitation error' using errcode = '22023';
  end if;
  update public.staff_invitations
  set status = 'failed', error_code = p_code, processed_at = now()
  where id = p_invitation_id and status = 'pending';
  if found then
    return 'failed';
  end if;
  select i.status into v_status from public.staff_invitations i where i.id = p_invitation_id;
  return coalesce(v_status, 'gone');
end;
$$;

-- « Annuler l'invitation », while it is pending, by a board admin of its board.
create function public.cancel_staff_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.staff_invitations;
begin
  select * into v_inv from public.staff_invitations i where i.id = p_invitation_id for update;
  if app.active_user_id() is null or v_inv.id is null
     or not exists (select 1 from app.my_admin_board_ids() b where b = v_inv.board_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'only a pending invitation can be cancelled' using errcode = '22023';
  end if;
  update public.staff_invitations
  set status = 'cancelled', processed_at = now()
  where id = v_inv.id;
  perform app.log_audit('staff.invitation_cancelled', v_inv.board_id, v_inv.school_id,
    'staff_invitation', v_inv.id, jsonb_build_object('role', v_inv.role));
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 4. Roles and access (D-107). The person is named by one of their roles in a board the caller
--    administers (`p_role_id`); a new role goes in that role's board.
-- ---------------------------------------------------------------------------------------

-- « Ajouter un rôle »: never to oneself (LXU07); the person already holds a role in the board.
-- user_roles_audit and user_roles_flag_absences apply. A role the person already has is 23505.
create function public.grant_staff_role(
  p_role_id uuid,
  p_role public.app_role,
  p_school_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.active_user_id();
  v_target public.user_roles := app.admin_target_role(p_role_id);
  v_id uuid;
begin
  if v_target.user_id = v_caller then
    raise exception 'no change to one''s own roles' using errcode = 'LXU07';
  end if;
  perform app.assert_staff_role(v_target.board_id, p_role, p_school_id);
  insert into public.user_roles (user_id, role, board_id, school_id, created_by)
  values (v_target.user_id, p_role, v_target.board_id, p_school_id, v_caller)
  returning id into v_id;
  return v_id;
end;
$$;

-- « Retirer ce rôle »: never the board's last active admin (LXU01: an admin may give up their
-- own admin role only while another active admin remains), never a person's last role anywhere
-- (LXU08: « Retirez plutôt l'accès de cette personne »). When it was the person's last role in
-- that board, their library reviewer designation for the board goes too (it would otherwise come
-- back with a later role, and no one could remove it: reviewers are named by a role in the board).
create function public.revoke_staff_role(p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.user_roles := app.admin_target_role(p_role_id);
begin
  if v_target.role = 'board_admin' then
    perform app.lock_board_admins(v_target.board_id);
    if not app.board_has_other_admin(v_target.board_id, v_target.user_id) then
      raise exception 'the board must keep an active administrator' using errcode = 'LXU01';
    end if;
  end if;
  if not exists (
    select 1 from public.user_roles ur
    where ur.user_id = v_target.user_id and ur.id <> v_target.id
  ) then
    raise exception 'a person keeps at least one role' using errcode = 'LXU08';
  end if;

  delete from public.user_roles where id = v_target.id;   -- audited by user_roles_audit
  if not exists (
    select 1 from public.user_roles ur
    where ur.user_id = v_target.user_id and ur.board_id = v_target.board_id and ur.role <> 'parent'
  ) then
    delete from public.library_reviewers r
    where r.board_id = v_target.board_id and r.user_id = v_target.user_id;
  end if;
end;
$$;

-- « Retirer l'accès » / « Rétablir l'accès »: never one's own (LXU05); never for someone with a
-- role, class team or absence outside the caller's admin boards (LXU02: « écrivez à IP Lynx »);
-- never the last active admin of a board (LXU01). Audited once per board and school of the
-- person's roles; upcoming plans are refreshed (D-047); the worker bans or unbans the Auth
-- account (`staff.access_changed {userId}`; it reads the current state). Nothing happens when the
-- person is already in the state asked for.
create function public.set_staff_active(p_role_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.active_user_id();
  v_target public.user_roles := app.admin_target_role(p_role_id);
  v_user uuid := v_target.user_id;
  v_board uuid;
begin
  if p_active is null then
    raise exception 'active or not' using errcode = '22023';
  end if;
  if v_user = v_caller then
    raise exception 'not one''s own access' using errcode = 'LXU05';
  end if;
  if app.staff_beyond_boards(v_user, array(select app.my_admin_board_ids())) then
    raise exception 'this person also works for another board' using errcode = 'LXU02';
  end if;
  if not p_active then
    for v_board in
      select distinct ur.board_id from public.user_roles ur
      where ur.user_id = v_user and ur.role = 'board_admin'
      order by ur.board_id
    loop
      perform app.lock_board_admins(v_board);
      if not app.board_has_other_admin(v_board, v_user) then
        raise exception 'the board must keep an active administrator' using errcode = 'LXU01';
      end if;
    end loop;
  end if;

  update public.users u
  set deactivated_at = case when p_active then null else now() end
  where u.id = v_user and (u.deactivated_at is null) = (not p_active);
  if not found then
    return;
  end if;

  perform app.log_audit(
    case when p_active then 'staff.access_restored' else 'staff.access_removed' end,
    r.board_id, r.school_id, 'user', v_user)
  from (select distinct ur.board_id, ur.school_id from public.user_roles ur
        where ur.user_id = v_user) r;
  perform app.flag_absences(array[v_user], null, null, null);
  perform app.emit_event('staff.access_changed', null, null, 'user', v_user,
    jsonb_build_object('userId', v_user));
end;
$$;

-- « Jamais connectée »: whether each person with a role in the board has ever signed in. The time
-- itself is never returned. Board admins of that board only.
create function public.board_staff_sign_ins(p_board_id uuid)
returns table (user_id uuid, has_signed_in boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if app.active_user_id() is null
     or not exists (select 1 from app.my_admin_board_ids() b where b = p_board_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
  select distinct ur.user_id, au.last_sign_in_at is not null
  from public.user_roles ur
  left join auth.users au on au.id = ur.user_id
  where ur.board_id = p_board_id;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 5. The operator (service role; `pnpm admin`, apps/admin/src/commands/staff.ts)
-- ---------------------------------------------------------------------------------------

-- The account an address belongs to: its profile, else an Auth account without one (an
-- interrupted invitation). The address travels in the request body, never in a URL (D-119).
create function public.operator_account_id(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select u.id from public.users u where lower(u.email) = lower(btrim(p_email))),
    (select au.id from auth.users au where lower(au.email) = lower(btrim(p_email))
     order by au.created_at limit 1));
$$;

-- `pnpm admin delete-user`, on the board's request, once access was removed (LXU06 while the
-- account is active). A person in several boards needs `--all-boards` (LXU02). Audited
-- (`staff.deleted`, actor `service`) per board and school of the person's roles before anything
-- is deleted. Then deletes: the classes where the person is the only homeroom teacher, with
-- everything in them (D-059), and their sample classes; the plans of the person's absences (the
-- report's pending progress first, as when a class is deleted); their private library resources
-- (shared and approved ones stay, without an author); their feedback; their profile, which takes
-- their roles, class teams, absences and personal levels with it. Returns counts; the CLI then
-- deletes the Auth account. Without a profile, returns {"profile": false}.
create function public.operator_delete_staff_account(p_user_id uuid, p_all_boards boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.users;
  v_boards uuid[];
  v_roles integer;
  v_classes integer;
  v_plans integer := 0;
  v_items integer;
  v_feedback integer;
  r record;
begin
  select * into v_user from public.users u where u.id = p_user_id for update;
  if v_user.id is null then
    return jsonb_build_object('profile', false);
  end if;
  if v_user.deactivated_at is null then
    raise exception 'remove the person''s access first' using errcode = 'LXU06';
  end if;
  v_boards := app.staff_board_ids(p_user_id);
  if cardinality(v_boards) > 1 and not coalesce(p_all_boards, false) then
    raise exception 'this person works in several boards' using errcode = 'LXU02';
  end if;

  select count(*) into v_roles from public.user_roles ur where ur.user_id = p_user_id;
  if v_roles > 0 then
    perform app.log_audit('staff.deleted', x.board_id, x.school_id, 'user', p_user_id, '{}',
      'service')
    from (select distinct ur.board_id, ur.school_id from public.user_roles ur
          where ur.user_id = p_user_id) x;
  else
    perform app.log_audit('staff.deleted', b, null, 'user', p_user_id, '{}', 'service')
    from unnest(v_boards) b;
  end if;

  delete from public.classes c
  where c.sample_owner_id = p_user_id
     or c.id in (
       select ct.class_id from public.class_teachers ct
       where ct.user_id = p_user_id and ct.role = 'homeroom'
         and not exists (
           select 1 from public.class_teachers o
           where o.class_id = ct.class_id and o.role = 'homeroom' and o.user_id <> p_user_id));
  get diagnostics v_classes = row_count;

  for r in
    select p.id, p.absence_id, p.plan_date, a.school_id, s.board_id
    from public.sub_plans p
    join public.absences a on a.id = p.absence_id
    join public.schools s on s.id = a.school_id
    where a.teacher_id = p_user_id
  loop
    delete from public.lesson_progress lp
    using public.sub_reports sr
    where sr.sub_plan_id = r.id and lp.sub_report_id = sr.id
      and lp.status = 'pending_confirmation';
    perform app.log_audit('sub_plan.deleted', r.board_id, r.school_id, 'sub_plan', r.id,
      jsonb_build_object('reason', 'account_deleted', 'absence_id', r.absence_id,
        'plan_date', r.plan_date), 'service');
    delete from public.sub_plans where id = r.id;   -- codes, sessions and report too
    v_plans := v_plans + 1;
  end loop;

  delete from public.library_items i where i.author_id = p_user_id and i.share_scope = 'private';
  get diagnostics v_items = row_count;
  delete from public.feedback f where f.user_id = p_user_id;
  get diagnostics v_feedback = row_count;
  delete from public.users u where u.id = p_user_id;

  return jsonb_build_object('profile', true, 'boards', cardinality(v_boards), 'roles', v_roles,
    'classes', v_classes, 'plans', v_plans, 'libraryItems', v_items, 'feedback', v_feedback);
end;
$$;

-- `pnpm admin delete-board`, at the end of a contract, once the board was offered its audit log
-- (CSV) and its library (the CLI's `--exported`). The slug must be typed again (22023). Deletes
-- the board's resources, classes and the board itself (schools, years, staff roles, invitations,
-- feedback... by cascade), the profiles of the people who worked in this board only, and the
-- board's audit rows. Returns those people's ids, for the CLI to delete their Auth accounts.
create function public.operator_delete_board(p_board_id uuid, p_confirm_slug text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_board public.boards;
  v_schools uuid[];
  v_users uuid[];
  v_items integer;
  v_classes integer;
  v_people integer;
  v_audit integer;
begin
  select * into v_board from public.boards b where b.id = p_board_id for update;
  if v_board.id is null or p_confirm_slug is distinct from v_board.slug then
    raise exception 'type the board''s slug to confirm' using errcode = '22023';
  end if;
  v_schools := array(select s.id from public.schools s where s.board_id = p_board_id);
  v_users := array(
    select m.user_id
    from (
      select ur.user_id from public.user_roles ur where ur.board_id = p_board_id
      union
      select ct.user_id from public.class_teachers ct
      join public.classes c on c.id = ct.class_id
      where c.school_id = any (v_schools)
      union
      select a.teacher_id from public.absences a where a.school_id = any (v_schools)
    ) m
    where app.staff_board_ids(m.user_id) <@ array[p_board_id]
    order by m.user_id);

  -- Resources and classes first: their subjects and school years go with the board, and those
  -- references are `restrict`.
  delete from public.library_items i where i.board_id = p_board_id;
  get diagnostics v_items = row_count;
  delete from public.classes c where c.school_id = any (v_schools);
  get diagnostics v_classes = row_count;
  delete from public.boards b where b.id = p_board_id;
  delete from public.users u where u.id = any (v_users);
  get diagnostics v_people = row_count;

  perform set_config('app.audit_retention_purge', 'on', true);
  delete from public.audit_log a where a.board_id = p_board_id or a.school_id = any (v_schools);
  get diagnostics v_audit = row_count;
  perform set_config('app.audit_retention_purge', 'off', true);

  return jsonb_build_object('userIds', to_jsonb(v_users), 'schools', cardinality(v_schools),
    'classes', v_classes, 'libraryItems', v_items, 'people', v_people, 'auditRows', v_audit);
end;
$$;

-- `pnpm admin log-operator-access`: recorded before any access to a board's production data, and
-- shown to the board's admins (`operator.access`, D-106).
create function public.log_operator_access(p_board_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_reason is null or p_reason not in ('support', 'incident', 'restore', 'migration') then
    raise exception 'reason: support, incident, restore or migration' using errcode = '22023';
  end if;
  if not exists (select 1 from public.boards b where b.id = p_board_id) then
    raise exception 'no such board' using errcode = '22023';
  end if;
  perform app.log_audit('operator.access', p_board_id, null, 'board', p_board_id,
    jsonb_build_object('reason', p_reason), 'service');
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 6. Sample classes (D-109; amends D-055)
-- ---------------------------------------------------------------------------------------

-- Phase 3's app.teacher_class_ids, without sample classes: they never reach a plan, a code or the
-- plan sources.
create or replace function app.teacher_class_ids(p_user_id uuid, p_school_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select ct.class_id
  from public.class_teachers ct
  join public.classes c on c.id = ct.class_id
  join public.users u on u.id = ct.user_id
  where ct.user_id = p_user_id
    and c.school_id = p_school_id
    and c.sample_owner_id is null
    and u.deactivated_at is null
    and exists (
      select 1 from public.user_roles ur
      where ur.user_id = p_user_id and ur.school_id = p_school_id and ur.role = 'teacher'
    );
$$;

-- Marks the class the current teacher just created, still without students, as her sample class.
-- The only way `classes.sample_owner_id` is set. A second sample class at the school is 23505
-- (classes_one_sample_idx).
create function app.mark_sample_class(p_class_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.active_user_id();
begin
  update public.classes c set sample_owner_id = v_user
  where c.id = p_class_id and v_user is not null and c.created_by = v_user
    and c.sample_owner_id is null
    and c.created_at > now() - interval '10 minutes'
    and not exists (select 1 from public.students s where s.class_id = c.id);
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;
end;
$$;

-- « Essayer avec une classe exemple »: the payload of buildSampleClass (@lynx/domain). Security
-- INVOKER: row level security and column grants check every row the teacher writes. The class goes
-- in the board's current school year (else the latest; none: LXO01).
create function public.create_sample_class(p_school_id uuid, p_sample jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_board uuid;
  v_year uuid;
  v_class uuid;
  v_unit jsonb;
  v_unit_id uuid;
  v_levels uuid[];
begin
  if not exists (
    select 1 from app.my_school_ids(array['teacher']::public.app_role[]) s where s = p_school_id
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_sample) is distinct from 'object'
     or jsonb_typeof(p_sample -> 'students') is distinct from 'array'
     or jsonb_array_length(p_sample -> 'students') not between 1 and 30
     or jsonb_typeof(p_sample -> 'gradeCodes') is distinct from 'array'
     or jsonb_typeof(coalesce(p_sample -> 'blocks', '[]')) <> 'array'
     or jsonb_array_length(coalesce(p_sample -> 'blocks', '[]')) > 80
     or jsonb_typeof(coalesce(p_sample -> 'units', '[]')) <> 'array'
     or jsonb_array_length(coalesce(p_sample -> 'units', '[]')) > 3
     or pg_column_size(p_sample) > 262144 then
    raise exception 'invalid sample class' using errcode = '22023';
  end if;
  select s.board_id into v_board from public.schools s where s.id = p_school_id;
  select y.id into v_year from public.school_years y
  where y.board_id = v_board
  order by (current_date between y.starts_on and y.ends_on) desc, y.starts_on desc
  limit 1;
  if v_year is null then
    raise exception 'no school year' using errcode = 'LXO01';
  end if;

  v_class := public.create_class(p_school_id, v_year, p_sample ->> 'name',
    array(select jsonb_array_elements_text(p_sample -> 'gradeCodes')), null);
  perform app.mark_sample_class(v_class);

  v_levels := array(select ll.id from public.language_levels ll
                    where ll.board_id = v_board and ll.owner_user_id is null and ll.active
                    order by ll.sort_order, ll.id);
  insert into public.students (class_id, first_name, default_language_level_id)
  select v_class, s ->> 'firstName', v_levels[(s ->> 'levelRank')::int]
  from jsonb_array_elements(p_sample -> 'students') s;

  insert into public.timetable_blocks (class_id, day_key, start_time, end_time, kind, subject_id,
    title)
  select v_class, (b ->> 'dayKey')::smallint, (b ->> 'start')::time, (b ->> 'end')::time,
    (b ->> 'kind')::public.block_kind, subj.id, nullif(b ->> 'title', '')
  from jsonb_array_elements(coalesce(p_sample -> 'blocks', '[]')) b
  left join lateral (
    select sj.id from public.subjects sj
    where sj.code = b ->> 'subjectCode' and (sj.board_id is null or sj.board_id = v_board)
    order by sj.board_id nulls last limit 1
  ) subj on true;

  for v_unit in select u.value from jsonb_array_elements(coalesce(p_sample -> 'units', '[]')) u loop
    insert into public.units (class_id, subject_id, title, description, status, sort_order)
    values (v_class,
      (select sj.id from public.subjects sj
       where sj.code = v_unit ->> 'subjectCode' and (sj.board_id is null or sj.board_id = v_board)
       order by sj.board_id nulls last limit 1),
      v_unit ->> 'title', v_unit ->> 'description', 'active', 0)
    returning id into v_unit_id;
    insert into public.unit_lessons (unit_id, sequence_number, title, objectives, materials,
      content, sub_notes, duration_minutes)
    select v_unit_id, l.ord::int, l.value ->> 'title', l.value ->> 'objectives',
      l.value ->> 'materials', l.value ->> 'content', l.value ->> 'subNotes',
      (l.value ->> 'durationMinutes')::smallint
    from jsonb_array_elements(coalesce(v_unit -> 'lessons', '[]')) with ordinality l (value, ord);
    insert into public.lesson_progress (lesson_id, status, taught_on, source)
    select ul.id, 'completed', (d.value #>> '{}')::date, 'teacher'
    from jsonb_array_elements(coalesce(v_unit -> 'taughtOn', '[]')) with ordinality d (value, ord)
    join public.unit_lessons ul on ul.unit_id = v_unit_id and ul.sequence_number = d.ord;
  end loop;
  return v_class;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 7. School settings (D-108)
-- ---------------------------------------------------------------------------------------

-- « Coordonnées et heures » (direction and the board's admins) and the substitute settings (the
-- direction only), merged into schools.settings in one locked update: other keys are never lost,
-- and two saves cannot overwrite each other. Keys: `contact` {officePhone, officeEmail} (strings,
-- or null to clear), `dayStart`, `dayEnd` ('HH:MM', start before end), `substitute` (an object of
-- at most 8 KB whose values are short strings or null; the app checks it with its form schema).
-- schools_flag_absences refreshes upcoming plans as before.
create function public.merge_school_settings(p_school_id uuid, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school public.schools;
  v_direction boolean;
  v_settings jsonb;
  v_contact jsonb;
  v_key text;
  v_value jsonb;
  v_start text;
  v_end text;
  c_hhmm constant text := '^([01][0-9]|2[0-3]):[0-5][0-9]$';
begin
  select * into v_school from public.schools s where s.id = p_school_id for update;
  v_direction := exists (select 1 from app.my_direction_school_ids() d where d = p_school_id);
  if app.active_user_id() is null or v_school.id is null
     or not (v_direction
             or exists (select 1 from app.my_admin_board_ids() b where b = v_school.board_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_patch) is distinct from 'object' or p_patch = '{}'::jsonb
     or exists (select 1 from jsonb_object_keys(p_patch) k
                where k not in ('contact', 'dayStart', 'dayEnd', 'substitute')) then
    raise exception 'invalid settings' using errcode = '22023';
  end if;
  if p_patch ? 'substitute' and not v_direction then
    raise exception 'the substitute settings are the direction''s' using errcode = '42501';
  end if;

  v_settings := case when jsonb_typeof(v_school.settings) = 'object' then v_school.settings
                     else '{}'::jsonb end;

  if p_patch ? 'contact' then
    if jsonb_typeof(p_patch -> 'contact') is distinct from 'object'
       or exists (select 1 from jsonb_object_keys(p_patch -> 'contact') k
                  where k not in ('officePhone', 'officeEmail')) then
      raise exception 'invalid contact' using errcode = '22023';
    end if;
    for v_key, v_value in select e.key, e.value from jsonb_each(p_patch -> 'contact') e loop
      if jsonb_typeof(v_value) not in ('string', 'null')
         or (v_key = 'officePhone' and jsonb_typeof(v_value) = 'string'
             and (char_length(v_value #>> '{}') > 40 or (v_value #>> '{}') !~ '^[0-9 +().-]*$'))
         or (v_key = 'officeEmail' and jsonb_typeof(v_value) = 'string'
             and btrim(v_value #>> '{}') <> ''
             and (char_length(v_value #>> '{}') > 320
                  or (v_value #>> '{}') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')) then
        raise exception 'invalid contact' using errcode = '22023';
      end if;
    end loop;
    -- Blank or null clears a value.
    v_contact := (case when jsonb_typeof(v_settings -> 'contact') = 'object'
                       then v_settings -> 'contact' else '{}'::jsonb end)
      || (select coalesce(jsonb_object_agg(e.key,
                   case when btrim(coalesce(e.value #>> '{}', '')) = '' then 'null'::jsonb
                        else to_jsonb(btrim(e.value #>> '{}')) end), '{}'::jsonb)
          from jsonb_each(p_patch -> 'contact') e);
    v_settings := v_settings || jsonb_build_object('contact', jsonb_strip_nulls(v_contact));
  end if;

  foreach v_key in array array['dayStart', 'dayEnd'] loop
    if p_patch ? v_key then
      if jsonb_typeof(p_patch -> v_key) is distinct from 'string'
         or (p_patch ->> v_key) !~ c_hhmm then
        raise exception 'invalid time' using errcode = '22023';
      end if;
      v_settings := v_settings || jsonb_build_object(v_key, p_patch ->> v_key);
    end if;
  end loop;
  if p_patch ? 'dayStart' or p_patch ? 'dayEnd' then
    -- As the app reads them: a missing or malformed value is the default (08:45, 15:20).
    v_start := case when (v_settings ->> 'dayStart') ~ c_hhmm then v_settings ->> 'dayStart'
                    else '08:45' end;
    v_end := case when (v_settings ->> 'dayEnd') ~ c_hhmm then v_settings ->> 'dayEnd'
                  else '15:20' end;
    if v_start >= v_end then
      raise exception 'the first bell comes before dismissal' using errcode = '22023';
    end if;
  end if;

  if p_patch ? 'substitute' then
    if jsonb_typeof(p_patch -> 'substitute') is distinct from 'object'
       or pg_column_size(p_patch -> 'substitute') > 8192
       or exists (
         select 1 from jsonb_each(p_patch -> 'substitute') e
         where jsonb_typeof(e.value) not in ('string', 'null')
            or char_length(coalesce(e.value #>> '{}', '')) > 500
            or (e.key in ('accessFrom', 'accessUntil') and jsonb_typeof(e.value) <> 'string')
            or (e.key in ('accessFrom', 'accessUntil', 'halfDaySplit')
                and jsonb_typeof(e.value) = 'string' and (e.value #>> '{}') !~ c_hhmm)) then
      raise exception 'invalid substitute settings' using errcode = '22023';
    end if;
    v_settings := v_settings || jsonb_build_object('substitute',
      (case when jsonb_typeof(v_settings -> 'substitute') = 'object'
            then v_settings -> 'substitute' else '{}'::jsonb end) || (p_patch -> 'substitute'));
  end if;

  update public.schools s set settings = v_settings where s.id = p_school_id;
end;
$$;

-- The alerts switch and the substitute settings are the school's direction's (D-108): an API
-- user who does not direct the school cannot change them, whatever row level security allows
-- (board admins may update other school columns). Plain trigger, as boards_guard_ai_settings:
-- definer functions that write schools (merge_school_settings) check for themselves, and the
-- operator (service role) is not concerned.
create function app.schools_guard_direction_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.student_alerts_enabled is distinct from old.student_alerts_enabled
          or new.settings -> 'substitute' is distinct from old.settings -> 'substitute')
     and not exists (select 1 from app.my_direction_school_ids() d where d = new.id) then
    raise exception 'only the school''s direction may change this' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger schools_guard_direction_settings
  before update of student_alerts_enabled, settings on public.schools
  for each row execute function app.schools_guard_direction_settings();

-- ---------------------------------------------------------------------------------------
-- 8. Library reviewers (D-064, D-107): « Approbation des ressources »
-- ---------------------------------------------------------------------------------------

-- Designates, changes or (both false) removes the person who holds the given role, for that
-- role's board. Board admins of the board only. library_reviewers_guard (active staff of the
-- board, else 22023) and library_reviewers_audit apply; saving the same values writes nothing.
create function public.set_library_reviewer(
  p_role_id uuid,
  p_approves_content boolean,
  p_reviews_faith boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.user_roles := app.admin_target_role(p_role_id);
begin
  if coalesce(p_approves_content, false) or coalesce(p_reviews_faith, false) then
    insert into public.library_reviewers (board_id, user_id, approves_content, reviews_faith)
    values (v_target.board_id, v_target.user_id, coalesce(p_approves_content, false),
      coalesce(p_reviews_faith, false))
    on conflict (board_id, user_id) do update
      set approves_content = excluded.approves_content, reviews_faith = excluded.reviews_faith
      where (public.library_reviewers.approves_content, public.library_reviewers.reviews_faith)
        is distinct from (excluded.approves_content, excluded.reviews_faith);
  else
    delete from public.library_reviewers r
    where r.board_id = v_target.board_id and r.user_id = v_target.user_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 9. Pilot feedback (D-116)
-- ---------------------------------------------------------------------------------------

-- « Commentaires »: from a member of the board (and, when given, a school where the sender works
-- in that board); at most 20 a person in 24 hours (LXF01). The table's checks validate the rest
-- (the route's template, the error reference, the device and the locale).
create function public.submit_feedback(
  p_board_id uuid,
  p_school_id uuid,
  p_kind text,
  p_message text,
  p_route text,
  p_error_ref text,
  p_release text,
  p_device text,
  p_locale text,
  p_may_contact boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.active_user_id();
  v_id uuid;
begin
  if v_user is null
     or not exists (select 1 from app.my_board_ids() b where b = p_board_id)
     or (p_school_id is not null and not exists (
           select 1 from app.my_staff_school_ids() s
           join public.schools sc on sc.id = s
           where s = p_school_id and sc.board_id = p_board_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('lynx.feedback:' || v_user::text, 0));
  if (select count(*) from public.feedback f
      where f.user_id = v_user and f.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'feedback limit reached' using errcode = 'LXF01';
  end if;
  insert into public.feedback (board_id, school_id, user_id, kind, message, route, error_ref,
    app_release, device, locale, may_contact)
  values (p_board_id, p_school_id, v_user, p_kind, p_message, nullif(p_route, ''),
    nullif(p_error_ref, ''), nullif(p_release, ''), p_device, p_locale,
    coalesce(p_may_contact, true))
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 10. Permissions. Functions are opt-in, as everywhere else; explicit revokes as well, whatever
--     the platform's default privileges on new functions.
-- ---------------------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon;

-- Signed-in staff; each function checks who is calling.
grant execute on function
  public.accept_terms(text),
  public.invite_staff(uuid, uuid, text, text, text, public.app_role),
  public.cancel_staff_invitation(uuid),
  public.grant_staff_role(uuid, public.app_role, uuid),
  public.revoke_staff_role(uuid),
  public.set_staff_active(uuid, boolean),
  public.board_staff_sign_ins(uuid),
  public.create_sample_class(uuid, jsonb),
  public.merge_school_settings(uuid, jsonb),
  public.set_library_reviewer(uuid, boolean, boolean),
  public.submit_feedback(uuid, uuid, text, text, text, text, text, text, text, boolean),
  -- Called by create_sample_class (security invoker), as the teacher.
  app.mark_sample_class(uuid)
to authenticated;
revoke execute on function
  public.accept_terms(text),
  public.invite_staff(uuid, uuid, text, text, text, public.app_role),
  public.cancel_staff_invitation(uuid),
  public.grant_staff_role(uuid, public.app_role, uuid),
  public.revoke_staff_role(uuid),
  public.set_staff_active(uuid, boolean),
  public.board_staff_sign_ins(uuid),
  public.create_sample_class(uuid, jsonb),
  public.merge_school_settings(uuid, jsonb),
  public.set_library_reviewer(uuid, boolean, boolean),
  public.submit_feedback(uuid, uuid, text, text, text, text, text, text, text, boolean),
  app.mark_sample_class(uuid)
from service_role;

-- The operator only (admin CLI): never a signed-in user. No account deletion in the web.
revoke execute on function
  public.operator_account_id(text),
  public.operator_delete_staff_account(uuid, boolean),
  public.operator_delete_board(uuid, text),
  public.log_operator_access(uuid, text)
from authenticated;
grant execute on function
  public.operator_account_id(text),
  public.operator_delete_staff_account(uuid, boolean),
  public.operator_delete_board(uuid, text),
  public.log_operator_access(uuid, text)
to service_role;

-- The database owner only (the worker's connection, and the functions above): helpers that take
-- a user, the worker's steps, and the trigger function.
revoke execute on function
  app.staff_board_ids(uuid),
  app.staff_beyond_boards(uuid, uuid[]),
  app.lock_board_admins(uuid),
  app.board_has_other_admin(uuid, uuid),
  app.admin_target_role(uuid),
  app.assert_staff_role(uuid, public.app_role, uuid),
  app.complete_staff_invitation(uuid, uuid),
  app.fail_staff_invitation(uuid, text),
  app.schools_guard_direction_settings()
from authenticated, service_role;
