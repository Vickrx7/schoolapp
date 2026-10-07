-- Phase 6, slice S7: findings of the Phase 6 security review that need the database.
-- DECISIONS D-106, D-107, D-109. Tests: supabase/tests/31_phase6_security_review.test.sql
--
-- 1. Colleagues read each other's names and addresses, never when someone accepted the pilot
--    terms or hid their checklist. The terms' time is about when a person first signed in, which
--    « Personnel » deliberately never shows (board_staff_sign_ins says whether, not when).
-- 2. The operator's `pnpm admin deactivate` (and `invite`, which restores a removed access) goes
--    through the same steps as « Retirer l'accès » and « Rétablir l'accès »: audited for the
--    board and the school with the operator as the actor (D-106), upcoming plans refreshed, the
--    worker told to sync the sign-in ban. It used to update the profile directly, unaudited.


-- ---------------------------------------------------------------------------------------
-- 1. What a colleague reads of a profile (D-107, D-109)
-- ---------------------------------------------------------------------------------------

-- `users_select` lets a person read their colleagues' rows. The table-level grant gave every
-- column; it becomes the columns the app shows about people. `created_at` and `updated_at` go
-- too: accepting the terms or hiding the checklist moves `updated_at`.
revoke select on public.users from authenticated;
grant select (id, email, display_name, honorific, preferred_locale, deactivated_at)
  on public.users to authenticated;

-- A person's own terms and checklist state (the session reads it on every request; D-109).
create function public.my_onboarding_state()
returns table (terms_version text, terms_accepted_at timestamptz,
  onboarding_dismissed_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select u.terms_version, u.terms_accepted_at, u.onboarding_dismissed_at
  from public.users u
  where u.id = auth.uid();
$$;

-- ---------------------------------------------------------------------------------------
-- 2. The operator removes or restores access as board admins do (D-106, D-107)
-- ---------------------------------------------------------------------------------------

-- `pnpm admin deactivate --email …` and `pnpm admin invite` for a person whose access was
-- removed. As set_staff_active, for any account (the operator acts on a board's request, also
-- for the last admin of a board), with actor `service`: one entry per board and school of the
-- person's roles, upcoming plans refreshed (D-047), `staff.access_changed {userId}` for the
-- worker (the CLI also bans or unbans at once). False when the person was already in that state;
-- P0002 without a profile.
create function public.operator_set_staff_active(p_user_id uuid, p_active boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_active is null then
    raise exception 'a person and a state' using errcode = '22023';
  end if;
  if not exists (select 1 from public.users u where u.id = p_user_id) then
    raise exception 'no profile for this account' using errcode = 'P0002';
  end if;

  update public.users u
  set deactivated_at = case when p_active then null else now() end
  where u.id = p_user_id and (u.deactivated_at is null) = (not p_active);
  if not found then
    return false;
  end if;

  perform app.log_audit(
    case when p_active then 'staff.access_restored' else 'staff.access_removed' end,
    r.board_id, r.school_id, 'user', p_user_id, '{}', 'service')
  from (select distinct ur.board_id, ur.school_id from public.user_roles ur
        where ur.user_id = p_user_id) r;
  perform app.flag_absences(array[p_user_id], null, null, null);
  perform app.emit_event('staff.access_changed', null, null, 'user', p_user_id,
    jsonb_build_object('userId', p_user_id));
  return true;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 3. Permissions, as everywhere else
-- ---------------------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon;

grant execute on function public.my_onboarding_state() to authenticated;
revoke execute on function public.my_onboarding_state() from service_role;

revoke execute on function public.operator_set_staff_active(uuid, boolean) from authenticated;
grant execute on function public.operator_set_staff_active(uuid, boolean) to service_role;
