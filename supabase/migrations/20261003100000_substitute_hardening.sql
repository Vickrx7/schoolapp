-- Phase 3 hardening (substitute hand-off): fixes from the review of the Phase 3 build.
--
-- 1. Codes record who issued them (owner, direction, office), and the portal's audit entries
--    (sub_code.redeemed, sub_plan.viewed, sub_plan.printed, student_alert.viewed) name the
--    issuer, so a session opened with a code the office issued is visible as such (D-056).
-- 2. The absent teacher issues codes only while she still teaches at the school, and only for
--    classes she still teaches; a change to her roles marks her absences for a rebuild.
-- 3. Redeeming: « Couper » one device closes the code to new devices; a code typed before its
--    day answers « pas encore » instead of counting as a wrong guess; a cap on failed attempts
--    across all devices and networks that no client can influence (D-051).
-- 4. The day's access ends with the codes actually issued, not with today's settings.
-- 5. Plans: the teacher's absence that ends just before another one counts for sequencing
--    (lessons it assigned are assumed taught until its report says otherwise); the web server's
--    rebuilds say which sources they were built from, and a plan built from sources that changed
--    meanwhile stays marked for the worker (D-047).
-- 6. Publishing: a request id sent again with other dates is refused (LXS23) instead of
--    returning the absence it was first used for.
-- 7. Confirming a report: refused when the report changed since the page was shown (LXS16);
--    « Pas terminée » removes the report's record whatever its status; the teacher's later
--    absences are rebuilt from what she confirmed.
--
-- Error codes the app translates: LXS16 the report changed since it was shown, LXS23 a request
-- id reused for another absence.
-- DECISIONS: D-047, D-050, D-051, D-054, D-055, D-056.
-- Tests: supabase/tests/14_substitute_hardening.test.sql

-- ---------------------------------------------------------------------------------------
-- 1. Who issued a code
-- ---------------------------------------------------------------------------------------

-- The issuer's relation to the plan when the code was made (app.sub_plan_role). Null only for
-- codes made before this column existed.
alter table public.sub_access_codes
  add column issued_by_role text check (issued_by_role in ('owner', 'direction', 'office'));

-- The cap on failed attempts across every device and network (section 3).
create index sub_code_attempts_failed_idx on public.sub_code_attempts (attempted_at)
  where not succeeded;

-- ---------------------------------------------------------------------------------------
-- 2. The owner is the absent teacher while she teaches at the school
-- ---------------------------------------------------------------------------------------

create or replace function app.sub_plan_role(p_plan_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when a.teacher_id = (select app.active_user_id())
      and a.school_id in (select app.my_school_ids(array['teacher']::public.app_role[]))
      then 'owner'
    when a.school_id in (select app.my_direction_school_ids()) then 'direction'
    when a.school_id in (select app.my_school_ids(array['office_admin']::public.app_role[])) then 'office'
  end
  from public.sub_plans p
  join public.absences a on a.id = p.absence_id
  where p.id = p_plan_id;
$$;

-- A teacher role added or removed changes which classes a teacher's plans may cover
-- (app.teacher_class_ids): her refreshable plans are rebuilt without them.
create function app.user_roles_flag_absences()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.role = 'teacher' then
    perform app.flag_absences(array[old.user_id], null, null, null);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.role = 'teacher' then
    perform app.flag_absences(array[new.user_id], null, null, null);
  end if;
  return null;
end;
$$;

create trigger user_roles_flag_absences after insert or update or delete on public.user_roles
  for each row execute function app.user_roles_flag_absences();

-- A new code: as before (D-050), plus the issuer's role, and the owner only for classes she
-- still teaches (a plan in use keeps the classes it was built for, even after a transfer).
create or replace function public.issue_sub_access_code(p_plan_id uuid, p_code_mac text)
returns table (code_id uuid, valid_from timestamptz, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user uuid := app.active_user_id();
  v_role text := app.sub_plan_role(p_plan_id);
  v_plan public.sub_plans;
  v_abs public.absences;
  v_board_id uuid;
  v_from timestamptz;
  v_until timestamptz;
  v_code_id uuid;
begin
  if v_user is null or v_role is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- One issuer at a time per plan: the two-code limit cannot race.
  select * into v_plan from public.sub_plans where id = p_plan_id for update;
  select * into v_abs from public.absences where id = v_plan.absence_id;
  if not app.school_has_module(v_abs.school_id, 'teaching') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_role = 'owner' and exists (
    select 1 from public.sub_plan_classes spc
    where spc.sub_plan_id = p_plan_id
      and spc.class_id not in (select app.teacher_class_ids(v_user, v_abs.school_id))
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_abs.status <> 'published' then
    raise exception 'absence is not published' using errcode = '22023';
  end if;
  if p_code_mac is null or p_code_mac !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid code' using errcode = '22023';
  end if;

  select w.valid_from, w.expires_at into v_from, v_until
  from app.sub_access_window(v_abs.school_id, v_plan.plan_date) w;
  if v_until <= now() then
    raise exception 'the day is over' using errcode = 'LXS14';
  end if;
  if (
    select count(*) from public.sub_access_codes c
    where c.sub_plan_id = p_plan_id and c.revoked_at is null and c.expires_at > now()
  ) >= 2 then
    raise exception 'two codes are already active' using errcode = 'LXS13';
  end if;

  insert into public.sub_access_codes (sub_plan_id, code_hash, valid_on, valid_from, expires_at,
    max_devices, created_by, issued_by_role)
  values (p_plan_id, encode(extensions.digest(p_code_mac, 'sha256'), 'hex'), v_plan.plan_date,
    v_from, v_until, 2, v_user, v_role)
  returning id into v_code_id;

  select s.board_id into v_board_id from public.schools s where s.id = v_abs.school_id;
  perform app.log_audit('sub_code.issued', v_board_id, v_abs.school_id, 'sub_plan', p_plan_id,
    jsonb_build_object('code_id', v_code_id, 'role', v_role, 'plan_date', v_plan.plan_date));
  return query select v_code_id, v_from, v_until;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 3. Redeeming a code (D-050, D-051). Outcomes, as before:
--      ok, invalid, wait, used_up, revoked (this device was cut)
--    and now:
--      closed    staff cut a device of this code: it takes no new device (a private window or
--                cleared cookies would otherwise get a fresh device in the free slot)
--      not_yet   the code is valid, but its day or hours have not started: valid_on and the
--                local start time (valid_from_time, 'HH:MM') are returned; no attempt is
--                recorded, since the code is right
--    Besides the per-device and per-network delays, which depend on what the client sends (its
--    cookie, and its address as forwarded by the proxy), at most 300 failed attempts a minute
--    are checked across all devices and networks: past that, everyone waits a minute and nothing
--    is recorded, so neither guessing nor the attempts table is unbounded.
--    Never raises after recording an attempt: an exception would roll the attempt back.
-- ---------------------------------------------------------------------------------------

drop function sub_portal.redeem(text[], text, text);

create function sub_portal.redeem(p_code_macs text[], p_device_key text, p_ip_key text)
returns table (
  outcome text,
  session_token text,
  expires_at timestamptz,
  retry_after integer,
  valid_on date,
  valid_from_time text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  c_failures_per_minute constant integer := 300;
  v_dev_fails integer;
  v_dev_last timestamptz;
  v_ip_fails integer;
  v_ip_last timestamptz;
  v_all_fails integer;
  v_wait numeric := 0;
  v_code record;
  v_known_device boolean;
  v_devices integer;
  v_token text;
  v_session uuid;
begin
  if p_device_key is null or p_device_key !~ '^[0-9a-f]{64}$'
    or p_ip_key is null or p_ip_key !~ '^[0-9a-f]{64}$'
    or coalesce(cardinality(p_code_macs), 0) not between 1 and 2
    or exists (select 1 from unnest(p_code_macs) m where m is null or m !~ '^[0-9a-f]{64}$')
  then
    return query select 'invalid'::text, null::text, null::timestamptz, null::integer, null::date,
      null::text;
    return;
  end if;

  -- Progressive delays instead of a lockout: per device after 5 failures in 15 minutes
  -- (30 s doubling, at most 15 minutes), per network after 50 (5 s doubling, at most 60 s, so
  -- one student cannot lock out a school's shared Wi-Fi for long).
  select count(*)::integer, max(t.attempted_at) into v_dev_fails, v_dev_last
  from public.sub_code_attempts t
  where t.device_key = p_device_key and not t.succeeded
    and t.attempted_at > now() - interval '15 minutes';
  select count(*)::integer, max(t.attempted_at) into v_ip_fails, v_ip_last
  from public.sub_code_attempts t
  where t.ip_key = p_ip_key and not t.succeeded
    and t.attempted_at > now() - interval '15 minutes';
  if v_dev_fails >= 5 then
    v_wait := greatest(v_wait, extract(epoch from v_dev_last - now())
      + least(30 * power(2::numeric, v_dev_fails - 5), 900));
  end if;
  if v_ip_fails >= 50 then
    v_wait := greatest(v_wait, extract(epoch from v_ip_last - now())
      + least(5 * power(2::numeric, v_ip_fails - 50), 60));
  end if;
  if v_wait > 0 then
    return query select 'wait'::text, null::text, null::timestamptz, ceil(v_wait)::integer,
      null::date, null::text;
    return;
  end if;

  -- The cap no client can influence (counted up to the cap only).
  select count(*)::integer into v_all_fails
  from (
    select 1 from public.sub_code_attempts t
    where not t.succeeded and t.attempted_at > now() - interval '1 minute'
    limit c_failures_per_minute
  ) f;
  if v_all_fails >= c_failures_per_minute then
    return query select 'wait'::text, null::text, null::timestamptz, 60, null::date, null::text;
    return;
  end if;

  select c.id, c.sub_plan_id, c.valid_on as code_valid_on, c.valid_from as code_valid_from,
    c.expires_at as code_expires_at, c.max_devices, c.created_by, c.issued_by_role,
    a.school_id, s.board_id, s.timezone
  into v_code
  from public.sub_access_codes c
  join public.sub_plans p on p.id = c.sub_plan_id
  join public.absences a on a.id = p.absence_id
  join public.schools s on s.id = a.school_id
  where c.code_hash in (
      select encode(extensions.digest(m, 'sha256'), 'hex') from unnest(p_code_macs) m
    )
    and c.revoked_at is null
    and a.status = 'published'
    and now() < c.expires_at
    and app.school_has_module(a.school_id, 'teaching')
  limit 1
  for update of c;

  if not found then
    insert into public.sub_code_attempts (device_key, ip_key, succeeded)
    values (p_device_key, p_ip_key, false);
    return query select 'invalid'::text, null::text, null::timestamptz, null::integer, null::date,
      null::text;
    return;
  end if;

  if now() < v_code.code_valid_from then
    return query select 'not_yet'::text, null::text, null::timestamptz, null::integer,
      v_code.code_valid_on,
      to_char(v_code.code_valid_from at time zone v_code.timezone, 'HH24:MI');
    return;
  end if;

  -- A device that was cut stays out: otherwise « Couper » would last until the code is typed
  -- again. (A session the substitute ended herself has no revoked_by and does not count.)
  if exists (
    select 1 from public.sub_sessions x
    where x.access_code_id = v_code.id and x.device_key = p_device_key and x.revoked_by is not null
  ) then
    return query select 'revoked'::text, null::text, null::timestamptz, null::integer, null::date,
      null::text;
    return;
  end if;

  v_known_device := exists (
    select 1 from public.sub_sessions x
    where x.access_code_id = v_code.id and x.device_key = p_device_key
  );
  -- Once staff cut one of its devices, the code takes no new device.
  if not v_known_device and exists (
    select 1 from public.sub_sessions x
    where x.access_code_id = v_code.id and x.revoked_by is not null
  ) then
    return query select 'closed'::text, null::text, null::timestamptz, null::integer, null::date,
      null::text;
    return;
  end if;

  -- At most max_devices devices per code; the same device may sign in again.
  select count(distinct x.device_key)::integer into v_devices
  from public.sub_sessions x where x.access_code_id = v_code.id;
  if not v_known_device and v_devices >= v_code.max_devices then
    return query select 'used_up'::text, null::text, null::timestamptz, null::integer, null::date,
      null::text;
    return;
  end if;

  -- Signing in again replaces the device's earlier session (one live session per device).
  update public.sub_sessions x set revoked_at = now()
  where x.access_code_id = v_code.id and x.device_key = p_device_key and x.revoked_at is null;

  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  insert into public.sub_sessions (access_code_id, sub_plan_id, session_token_hash, expires_at,
    device_key)
  values (v_code.id, v_code.sub_plan_id, encode(extensions.digest(v_token, 'sha256'), 'hex'),
    v_code.code_expires_at, p_device_key)
  returning id into v_session;
  update public.sub_access_codes set last_used_at = now() where id = v_code.id;
  insert into public.sub_code_attempts (device_key, ip_key, succeeded)
  values (p_device_key, p_ip_key, true);

  perform app.log_audit('sub_code.redeemed', v_code.board_id, v_code.school_id, 'sub_plan',
    v_code.sub_plan_id,
    jsonb_build_object('code_id', v_code.id, 'sub_session_id', v_session,
      'issued_by', v_code.created_by, 'issued_by_role', v_code.issued_by_role),
    'substitute');
  perform app.emit_event('sub_session.started', v_code.board_id, v_code.school_id, 'sub_plan',
    v_code.sub_plan_id, jsonb_build_object('subPlanId', v_code.sub_plan_id, 'sessionId', v_session));
  return query select 'ok'::text, v_token, v_code.code_expires_at, null::integer, null::date,
    null::text;
end;
$$;

-- The issuer of the code behind a portal session, for audit details.
create function app.sub_session_issuer(p_code_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('code_id', c.id, 'issued_by', c.created_by,
    'issued_by_role', c.issued_by_role)
  from public.sub_access_codes c
  where c.id = p_code_id;
$$;

-- The substitute's day (D-049), unchanged apart from naming the code's issuer in the audit
-- entries it writes.
create or replace function sub_portal.load(
  p_token text,
  p_known_version integer default null,
  p_purpose text default 'view'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_s record;
  v_session public.sub_sessions;
  v_plan public.sub_plans;
  v_abs public.absences;
  v_school public.schools;
  v_teacher public.users;
  v_report public.sub_reports;
  v_issuer jsonb;
  v_released boolean;
  v_unchanged boolean;
  v_locked boolean;
  v_plan_out jsonb := null;
  v_roster jsonb := null;
  v_levels jsonb := null;
  v_report_out jsonb := null;
begin
  if p_purpose is null or p_purpose not in ('view', 'poll', 'pdf') then
    raise exception 'invalid purpose' using errcode = '22023';
  end if;

  select * into v_s from app.sub_session(p_token);
  if not found then
    return jsonb_build_object('status', 'expired');
  end if;

  -- Locked so two tabs loading at once audit a version once.
  select * into v_session from public.sub_sessions where id = v_s.session_id for update;
  select * into v_plan from public.sub_plans where id = v_s.sub_plan_id;
  select * into v_abs from public.absences where id = v_s.absence_id;
  select * into v_school from public.schools where id = v_s.school_id;
  select * into v_teacher from public.users where id = v_abs.teacher_id;
  select * into v_report from public.sub_reports where sub_plan_id = v_plan.id;
  v_released := app.sub_plan_released(v_plan.status, v_plan.review_deadline);
  v_unchanged := p_known_version is not null and p_known_version = v_plan.content_version;
  v_issuer := coalesce(app.sub_session_issuer(v_s.code_id), '{}'::jsonb);

  if v_session.last_seen_at is null or v_session.last_seen_at < now() - interval '1 minute' then
    update public.sub_sessions set last_seen_at = now() where id = v_session.id;
  end if;

  if v_released then
    if v_unchanged then
      v_plan_out := to_jsonb('unchanged'::text);
    else
      v_plan_out := jsonb_build_object('plan', v_plan.plan, 'edits', v_plan.edits, 'ai', v_plan.ai);

      select coalesce(jsonb_agg(jsonb_build_object('id', st.id, 'classId', st.class_id,
          'firstName', st.first_name) order by st.first_name, st.id), '[]'::jsonb)
      into v_roster
      from public.students st
      join public.sub_plan_classes spc on spc.class_id = st.class_id
      where spc.sub_plan_id = v_plan.id and st.active;

      select coalesce(jsonb_agg(jsonb_build_object('id', ll.id, 'labelFr', ll.label_fr,
          'labelEn', ll.label_en, 'descriptionFr', ll.description_fr, 'sortOrder', ll.sort_order)
          order by ll.sort_order, ll.label_fr, ll.id), '[]'::jsonb)
      into v_levels
      from public.language_levels ll
      where ll.id in (
        select st.default_language_level_id
        from public.students st
        join public.sub_plan_classes spc on spc.class_id = st.class_id
        where spc.sub_plan_id = v_plan.id and st.active
      );

      if p_purpose = 'view' and v_session.last_viewed_version is distinct from v_plan.content_version
      then
        perform app.log_audit('sub_plan.viewed', v_s.board_id, v_s.school_id, 'sub_plan', v_plan.id,
          jsonb_build_object('sub_session_id', v_session.id, 'content_version', v_plan.content_version)
            || v_issuer,
          'substitute');
        update public.sub_sessions set last_viewed_version = v_plan.content_version
        where id = v_session.id;
      end if;
    end if;

    if p_purpose = 'pdf' then
      perform app.log_audit('sub_plan.printed', v_s.board_id, v_s.school_id, 'sub_plan', v_plan.id,
        jsonb_build_object('sub_session_id', v_session.id, 'content_version', v_plan.content_version)
          || v_issuer,
        'substitute');
    end if;
  end if;

  -- The day's report, as far as this session may see it: a report being written on another
  -- device (whose session is still valid) is locked and its content withheld (D-054).
  if v_report.id is not null then
    v_locked := v_report.session_id is not null and v_report.session_id <> v_session.id
      and exists (
        select 1
        from public.sub_sessions o
        join public.sub_access_codes oc on oc.id = o.access_code_id
        where o.id = v_report.session_id
          and o.revoked_at is null
          and oc.revoked_at is null
          and now() < least(o.expires_at, oc.expires_at)
      );
    v_report_out := jsonb_build_object(
      'status', v_report.status,
      'content', case when v_locked then null else v_report.content end,
      'notesCiphertext', case when v_locked then null else v_report.notes_ciphertext end,
      'notesKeyVersion', case when v_locked then null else v_report.notes_key_version end,
      'updatedAt', v_report.updated_at,
      'lockedToOtherDevice', v_locked
    );
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'context', jsonb_build_object(
      'planId', v_plan.id,
      'planDate', v_plan.plan_date,
      'part', v_abs.part,
      'released', v_released,
      'releaseAt', case when v_plan.status = 'released' then v_plan.released_at
                        else v_plan.review_deadline end,
      'contentVersion', v_plan.content_version,
      'updatedAt', greatest(v_plan.generated_at, v_plan.edited_at,
                            (v_plan.ai ->> 'appliedAt')::timestamptz),
      'expiresAt', v_s.expires_at,
      'schoolName', v_school.name,
      'schoolTimezone', v_school.timezone,
      'officePhone', nullif(btrim(v_school.settings #>> '{contact,officePhone}'), ''),
      'arrivalInstructions', v_school.settings #>> '{substitute,arrivalInstructions}',
      'emergencyInfo', v_school.settings #>> '{substitute,emergencyInfo}',
      'teacherName', app.formal_staff_name(v_teacher.display_name, v_teacher.honorific),
      -- The teacher's note is part of the hand-off: shown once the plan is released.
      'absenceNote', case when v_released then v_abs.note end,
      'alertsAvailable', v_released and exists (
        select 1 from public.sub_plan_classes spc
        where spc.sub_plan_id = v_plan.id and app.alerts_enabled_for_class(spc.class_id)
      ),
      'reportStatus', coalesce(v_report.status::text, 'none')
    ),
    'plan', v_plan_out,
    'roster', v_roster,
    'levels', v_levels,
    'report', v_report_out
  );
end;
$$;

-- Alerts for the substitute (D-016 as amended by D-056), unchanged apart from naming the code's
-- issuer in each student_alert.viewed entry.
create or replace function sub_portal.alerts(p_token text)
returns table (
  alert_id uuid,
  student_id uuid,
  class_id uuid,
  category public.alert_category,
  body_ciphertext text,
  key_version smallint
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_s record;
  v_plan public.sub_plans;
  v_issuer jsonb;
  r record;
begin
  select * into v_s from app.sub_session(p_token);
  if not found then
    return;
  end if;
  select * into v_plan from public.sub_plans where id = v_s.sub_plan_id;
  if not app.sub_plan_released(v_plan.status, v_plan.review_deadline) then
    return;
  end if;
  v_issuer := coalesce(app.sub_session_issuer(v_s.code_id), '{}'::jsonb);

  for r in
    select spc.class_id,
      (select count(*)::integer
       from public.student_alerts sa
       join public.students st on st.id = sa.student_id
       where sa.class_id = spc.class_id and st.class_id = spc.class_id and st.active) as n
    from public.sub_plan_classes spc
    where spc.sub_plan_id = v_plan.id and app.alerts_enabled_for_class(spc.class_id)
    order by spc.class_id
  loop
    perform app.log_audit('student_alert.viewed', v_s.board_id, v_s.school_id, 'class', r.class_id,
      jsonb_build_object('alert_count', r.n, 'sub_session_id', v_s.session_id,
        'sub_plan_id', v_plan.id) || v_issuer,
      'substitute');
  end loop;

  return query
    select sa.id, sa.student_id, sa.class_id, sa.category, sa.body_ciphertext, sa.key_version
    from public.student_alerts sa
    join public.students st on st.id = sa.student_id
    join public.sub_plan_classes spc on spc.class_id = sa.class_id and spc.sub_plan_id = v_plan.id
    where st.class_id = sa.class_id
      and st.active
      and app.alerts_enabled_for_class(sa.class_id)
    order by sa.class_id, sa.created_at, sa.id;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 4. The day's access ends when the last code issued for it expires, or at the end of the
--    access hours when no code was issued, whichever is later. (Codes keep the window they
--    were issued with, so a change to the settings during the day does not move it.)
-- ---------------------------------------------------------------------------------------

create or replace function app.sub_plan_window_ended(p_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select now() >= greatest(
      w.expires_at,
      (select max(c.expires_at) from public.sub_access_codes c where c.sub_plan_id = p.id)
    )
    from public.sub_plans p
    join public.absences a on a.id = p.absence_id
    cross join lateral app.sub_access_window(a.school_id, p.plan_date) w
    where p.id = p_plan_id
  ), false);
$$;

-- ---------------------------------------------------------------------------------------
-- 5. Plan sources and writing plans (D-047, D-055)
-- ---------------------------------------------------------------------------------------

-- The loader, as before, with `earlierPlans`: the days of the teacher's other published
-- absences at the school in the week before `p_from`: [{planDate, part, reportStatus,
-- assignedLessonIds}]. Lessons they assigned count as taught for this absence until their
-- report arrives, as for the absence's own fixed days, so back-to-back absences continue the
-- sequence instead of repeating it. (A morning absence before an afternoon one needs nothing:
-- a half day already sequences the other half's blocks.)
create or replace function app.sub_plan_sources(
  p_teacher_id uuid,
  p_school_id uuid,
  p_from date,
  p_to date,
  p_absence_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_board_id uuid;
  v_class_ids uuid[];
  v_events_from date;
  v_student_level_ids uuid[];
  v_result jsonb;
begin
  select s.board_id into v_board_id from public.schools s where s.id = p_school_id;
  v_class_ids := array(select app.teacher_class_ids(p_teacher_id, p_school_id));
  -- A rotating-day school counts school days from its latest anchor.
  select coalesce(max(an.anchor_date), p_from) into v_events_from
  from public.school_cycle_anchors an
  where an.school_id = p_school_id and an.anchor_date <= p_from;
  v_student_level_ids := array(
    select distinct st.default_language_level_id from public.students st
    where st.class_id = any (v_class_ids) and st.default_language_level_id is not null
  );

  select jsonb_build_object(
    'today', app.school_local_today(p_school_id),
    'teacher', (
      select jsonb_build_object('id', u.id, 'displayName', u.display_name, 'honorific', u.honorific)
      from public.users u where u.id = p_teacher_id
    ),
    'school', (
      select jsonb_build_object('id', s.id, 'boardId', s.board_id, 'timezone', s.timezone,
        'scheduleType', s.schedule_type, 'cycleLength', s.cycle_length, 'settings', s.settings)
      from public.schools s where s.id = p_school_id
    ),
    'classes', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', c.id, 'name', c.name, 'roomId', c.room_id, 'role', ct.role,
          'grades', coalesce((
            select jsonb_agg(jsonb_build_object('code', g.code, 'ordinal', g.ordinal, 'labelFr', g.label_fr)
              order by g.ordinal)
            from public.class_grades cg join public.grades g on g.code = cg.grade_code
            where cg.class_id = c.id
          ), '[]'::jsonb)
        ) order by c.name, c.id)
      from public.classes c
      join public.class_teachers ct on ct.class_id = c.id and ct.user_id = p_teacher_id
      where c.id = any (v_class_ids)
    ), '[]'::jsonb),
    'team', coalesce((
      select jsonb_agg(jsonb_build_object('classId', ct.class_id, 'userId', u.id,
          'displayName', u.display_name, 'honorific', u.honorific, 'role', ct.role)
        order by ct.class_id, ct.role, u.display_name)
      from public.class_teachers ct
      join public.users u on u.id = ct.user_id
      where ct.class_id = any (v_class_ids) and u.deactivated_at is null
    ), '[]'::jsonb),
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'classId', b.class_id, 'dayKey', b.day_key,
          'startTime', to_char(b.start_time, 'HH24:MI'), 'endTime', to_char(b.end_time, 'HH24:MI'),
          'kind', b.kind, 'subjectId', b.subject_id, 'title', b.title, 'teacherId', b.teacher_id,
          'roomId', b.room_id, 'notes', b.notes)
        order by b.class_id, b.day_key, b.start_time, b.id)
      from public.timetable_blocks b
      where b.class_id = any (v_class_ids)
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'eventType', e.event_type, 'title', e.title,
          'notes', e.notes, 'startsOn', e.starts_on, 'endsOn', e.ends_on,
          'startTime', to_char(e.start_time, 'HH24:MI'), 'endTime', to_char(e.end_time, 'HH24:MI'),
          'affectsSchedule', e.affects_schedule, 'classId', e.class_id)
        order by e.starts_on, e.start_time nulls first, e.id)
      from public.school_calendar_events e
      where (
          (e.school_id is null and e.board_id = v_board_id)
          or (e.school_id = p_school_id and (e.class_id is null or e.class_id = any (v_class_ids)))
        )
        and e.starts_on <= p_to
        and e.ends_on >= v_events_from
    ), '[]'::jsonb),
    'anchors', coalesce((
      select jsonb_agg(jsonb_build_object('anchorDate', an.anchor_date, 'cycleDay', an.cycle_day)
        order by an.anchor_date)
      from public.school_cycle_anchors an
      where an.school_id = p_school_id
    ), '[]'::jsonb),
    'rooms', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name) order by r.name)
      from public.rooms r where r.school_id = p_school_id
    ), '[]'::jsonb),
    'subjects', coalesce((
      select jsonb_agg(jsonb_build_object('id', sub.id, 'labelFr', sub.label_fr)
        order by sub.sort_order, sub.label_fr)
      from public.subjects sub
      where sub.board_id is null or sub.board_id = v_board_id
    ), '[]'::jsonb),
    'units', coalesce((
      select jsonb_agg(jsonb_build_object('id', un.id, 'classId', un.class_id,
          'subjectId', un.subject_id, 'title', un.title,
          'lessons', coalesce((
            select jsonb_agg(jsonb_build_object('id', l.id, 'sequenceNumber', l.sequence_number,
                'title', l.title, 'objectives', l.objectives, 'materials', l.materials,
                'content', l.content, 'subNotes', l.sub_notes, 'durationMinutes', l.duration_minutes)
              order by l.sequence_number)
            from public.unit_lessons l where l.unit_id = un.id
          ), '[]'::jsonb))
        order by un.class_id, un.subject_id, un.id)
      from public.units un
      where un.class_id = any (v_class_ids) and un.status = 'active'
    ), '[]'::jsonb),
    'progress', coalesce((
      select jsonb_agg(jsonb_build_object('lessonId', lp.lesson_id, 'status', lp.status,
          'taughtOn', lp.taught_on)
        order by lp.lesson_id)
      from public.lesson_progress lp
      where lp.class_id = any (v_class_ids)
    ), '[]'::jsonb),
    -- No names: the builder works with ids; names are added when a plan is displayed.
    'students', coalesce((
      select jsonb_agg(jsonb_build_object('id', st.id, 'classId', st.class_id,
          'levelId', st.default_language_level_id, 'active', st.active)
        order by st.class_id, st.id)
      from public.students st
      where st.class_id = any (v_class_ids)
    ), '[]'::jsonb),
    'levels', coalesce((
      select jsonb_agg(jsonb_build_object('id', ll.id, 'labelFr', ll.label_fr, 'labelEn', ll.label_en,
          'descriptionFr', ll.description_fr, 'sortOrder', ll.sort_order)
        order by ll.sort_order, ll.label_fr, ll.id)
      from public.language_levels ll
      where (
          ll.board_id = v_board_id and ll.active
          and (ll.owner_user_id is null or ll.owner_user_id = p_teacher_id)
        )
        or ll.id = any (v_student_level_ids)
    ), '[]'::jsonb),
    'profiles', coalesce((
      select jsonb_agg(jsonb_build_object('classId', sp.class_id,
          'arrivalNotes', sp.arrival_notes, 'routinesNotes', sp.routines_notes,
          'classroomManagementNotes', sp.classroom_management_notes,
          'dismissalNotes', sp.dismissal_notes, 'fallbackActivities', sp.fallback_activities,
          'neighbourNote', sp.neighbour_note,
          'neighbour', (
            select jsonb_build_object('displayName', nu.display_name, 'honorific', nu.honorific)
            from public.users nu
            where nu.id = sp.neighbour_teacher_id
              and app.is_active_teacher_at_class_school(nu.id, sp.class_id)
          ))
        order by sp.class_id)
      from public.class_sub_profiles sp
      where sp.class_id = any (v_class_ids)
    ), '[]'::jsonb),
    'catholicReferences', coalesce((
      select jsonb_agg(jsonb_build_object('id', cr.id, 'boardId', cr.board_id, 'type', cr.type,
          'title', cr.title, 'textFr', cr.text_fr, 'gradeMin', cr.grade_min, 'gradeMax', cr.grade_max,
          'liturgicalSeason', cr.liturgical_season, 'tags', to_jsonb(cr.tags))
        order by cr.id)
      from public.catholic_references cr
      where cr.active and (cr.board_id is null or cr.board_id = v_board_id)
    ), '[]'::jsonb),
    -- The absence's other days, so a rebuild continues from days that are already fixed.
    'siblings', case when p_absence_id is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
          'planDate', p.plan_date,
          'refreshable', app.sub_plan_refreshable(p.id),
          'hasSession', exists (select 1 from public.sub_sessions ss where ss.sub_plan_id = p.id),
          'reportStatus', coalesce(
            (select sr.status::text from public.sub_reports sr where sr.sub_plan_id = p.id), 'none'),
          'assignedLessonIds', jsonb_path_query_array(
            p.plan, '$.blocks[*].lesson ? (@.assignment == "assigned").lessonId'))
        order by p.plan_date)
      from public.sub_plans p
      where p.absence_id = p_absence_id
    ), '[]'::jsonb) end,
    -- The days of the teacher's other absences just before this one.
    'earlierPlans', coalesce((
      select jsonb_agg(jsonb_build_object(
          'planDate', p.plan_date,
          'part', oa.part,
          'reportStatus', coalesce(
            (select sr.status::text from public.sub_reports sr where sr.sub_plan_id = p.id), 'none'),
          'assignedLessonIds', jsonb_path_query_array(
            p.plan, '$.blocks[*].lesson ? (@.assignment == "assigned").lessonId'))
        order by p.plan_date, oa.part, p.id)
      from public.absences oa
      join public.sub_plans p on p.absence_id = oa.id
      where oa.teacher_id = p_teacher_id
        and oa.school_id = p_school_id
        and oa.status = 'published'
        and oa.id is distinct from p_absence_id
        and p.plan_date between p_from - 7 and p_from - 1
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

-- What the loader returns, summed up: the web server sends it back with the plans it built, so
-- the database can tell whether they were built from sources that changed in the meantime.
create function app.sub_plan_sources_fingerprint(
  p_teacher_id uuid,
  p_school_id uuid,
  p_from date,
  p_to date,
  p_absence_id uuid default null
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select md5(app.sub_plan_sources(p_teacher_id, p_school_id, p_from, p_to, p_absence_id)::text);
$$;

-- The plan sources for the signed-in teacher, as before, with their `fingerprint`.
create or replace function public.get_sub_plan_sources(
  p_school_id uuid,
  p_from date,
  p_to date,
  p_absence_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.active_user_id();
  v_sources jsonb;
begin
  if v_user is null or p_school_id is null
     or not exists (select 1 from app.my_school_ids(array['teacher']::public.app_role[]) s where s = p_school_id)
     or not app.school_has_module(p_school_id, 'teaching') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_absence_id is not null and not exists (
    select 1 from public.absences a
    where a.id = p_absence_id and a.teacher_id = v_user and a.school_id = p_school_id
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 13 then
    raise exception 'invalid date range' using errcode = '22023';
  end if;
  v_sources := app.sub_plan_sources(v_user, p_school_id, p_from, p_to, p_absence_id);
  return v_sources || jsonb_build_object('fingerprint', md5(v_sources::text));
end;
$$;

-- Marks one absence as built from stale sources and wakes the worker (the first time).
create function app.mark_absence_stale(p_absence_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  select a.id, a.school_id, s.board_id, a.sources_changed_at is null as was_clear
  into r
  from public.absences a
  join public.schools s on s.id = a.school_id
  where a.id = p_absence_id and a.status = 'published'
  for update of a;
  if not found then
    return;
  end if;
  update public.absences set sources_changed_at = now() where id = p_absence_id;
  if r.was_clear then
    perform app.emit_event('absence.sources_changed', r.board_id, r.school_id, 'absence', r.id,
      jsonb_build_object('absenceId', r.id));
  end if;
end;
$$;

-- The one writer of plans, as before (D-047), plus: when the lessons this absence's plans
-- assign change, the teacher's absences that start in the week after it are rebuilt, since
-- they continue from those lessons (earlierPlans). They are woken with an event rather than
-- marked: marking would lock their rows while this one is locked, and a worker or a check-off
-- marking them in another order could deadlock. The worker rebuilds on that event even when
-- the absence is not marked (apps/worker/src/sub-plans/refresh.ts).
create or replace function app.write_absence_plans(
  p_absence_id uuid,
  p_plans jsonb,
  p_seen_flag timestamptz default null,
  p_check_flag boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_abs public.absences;
  v_board_id uuid;
  v_today date;
  v_allowed uuid[];
  v_item jsonb;
  v_date date;
  v_dates date[] := '{}';
  v_class_ids uuid[];
  v_plan_id uuid;
  v_before jsonb;
  v_changed boolean := false;
  v_deleted integer;
  r record;
begin
  select * into v_abs from public.absences where id = p_absence_id for update;
  if v_abs.id is null then
    raise exception 'absence not found' using errcode = 'P0002';
  end if;
  if v_abs.status <> 'published'
     or (p_check_flag and v_abs.sources_changed_at is distinct from p_seen_flag) then
    return false;
  end if;

  -- Check every item first: anything malformed refuses the whole call.
  if p_plans is null or jsonb_typeof(p_plans) <> 'array' or jsonb_array_length(p_plans) > 14 then
    raise exception 'invalid plans' using errcode = '22023';
  end if;
  v_allowed := array(select app.teacher_class_ids(v_abs.teacher_id, v_abs.school_id));
  for v_item in select e.value from jsonb_array_elements(p_plans) e loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or jsonb_typeof(v_item -> 'date') is distinct from 'string'
       or jsonb_typeof(v_item -> 'plan') is distinct from 'object'
       or jsonb_typeof(v_item -> 'classIds') is distinct from 'array' then
      raise exception 'invalid plan' using errcode = '22023';
    end if;
    if (v_item ->> 'date') !~ '^\d{4}-\d{2}-\d{2}$'
       or not pg_input_is_valid(v_item ->> 'date', 'date')
       or (v_item -> 'plan' ->> 'schemaVersion') is distinct from '1'
       or (v_item -> 'plan' ->> 'date') is distinct from (v_item ->> 'date')
       or pg_column_size(v_item -> 'plan') > 262144
       or jsonb_array_length(v_item -> 'classIds') > 12 then
      raise exception 'invalid plan' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_item -> 'classIds') c
      where jsonb_typeof(c) <> 'string' or not pg_input_is_valid(c #>> '{}', 'uuid')
    ) then
      raise exception 'invalid class id' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements_text(v_item -> 'classIds') c
      where c::uuid <> all (v_allowed)
    ) then
      raise exception 'a plan can only cover the teacher''s own classes' using errcode = '22023';
    end if;
  end loop;

  select s.board_id into v_board_id from public.schools s where s.id = v_abs.school_id;
  v_today := app.school_local_today(v_abs.school_id);

  for v_item in select e.value from jsonb_array_elements(p_plans) e loop
    v_date := (v_item ->> 'date')::date;
    if v_date < v_abs.starts_on or v_date > v_abs.ends_on or v_date < v_today
       or v_date = any (v_dates) then
      continue;
    end if;
    v_dates := v_dates || v_date;
    v_class_ids := array(select distinct c::uuid from jsonb_array_elements_text(v_item -> 'classIds') c);

    -- Locking the row also waits for a substitute signing in at this moment (the session's
    -- foreign key), so a plan in use is never rewritten.
    v_plan_id := null;
    select p.id, jsonb_path_query_array(
        p.plan, '$.blocks[*].lesson ? (@.assignment == "assigned").lessonId')
    into v_plan_id, v_before
    from public.sub_plans p
    where p.absence_id = p_absence_id and p.plan_date = v_date
    for update;

    if v_plan_id is null then
      insert into public.sub_plans (absence_id, plan_date, plan, status, review_deadline)
      values (p_absence_id, v_date, v_item -> 'plan', 'ready',
        app.sub_plan_review_deadline(v_abs.school_id, v_date))
      returning id into v_plan_id;
      insert into public.sub_plan_classes (sub_plan_id, class_id)
      select v_plan_id, c from unnest(v_class_ids) c;
      perform app.emit_event('sub_plan.ready', v_board_id, v_abs.school_id, 'sub_plan', v_plan_id,
        jsonb_build_object('subPlanId', v_plan_id, 'absenceId', p_absence_id, 'planDate', v_date));
      v_changed := true;
    elsif app.sub_plan_refreshable(v_plan_id) then
      update public.sub_plans p
      set plan = v_item -> 'plan',
          generated_at = now(),
          content_version = p.content_version + 1,
          review_deadline = case when p.status = 'ready'
            then app.sub_plan_review_deadline(v_abs.school_id, v_date) else p.review_deadline end
      where p.id = v_plan_id;
      delete from public.sub_plan_classes
      where sub_plan_id = v_plan_id and class_id <> all (v_class_ids);
      insert into public.sub_plan_classes (sub_plan_id, class_id)
      select v_plan_id, c from unnest(v_class_ids) c
      on conflict do nothing;
      if v_before is distinct from jsonb_path_query_array(
          v_item -> 'plan', '$.blocks[*].lesson ? (@.assignment == "assigned").lessonId') then
        v_changed := true;
      end if;
    end if;
  end loop;

  -- Days no longer in the list (no longer a school day, or outside a shortened absence) go,
  -- unless they can no longer change: a plan in use or already fixed stays.
  delete from public.sub_plans p
  where p.absence_id = p_absence_id
    and p.plan_date >= v_today
    and p.plan_date <> all (v_dates)
    and app.sub_plan_refreshable(p.id)
    and not exists (select 1 from public.sub_reports sr where sr.sub_plan_id = p.id);
  get diagnostics v_deleted = row_count;
  if v_deleted > 0 then
    v_changed := true;
  end if;

  update public.absences set sources_changed_at = null where id = p_absence_id;

  if v_changed then
    for r in
      select a.id
      from public.absences a
      where a.teacher_id = v_abs.teacher_id
        and a.school_id = v_abs.school_id
        and a.status = 'published'
        and a.id <> v_abs.id
        and a.ends_on >= v_today
        and a.starts_on > v_abs.ends_on
        and a.starts_on <= v_abs.ends_on + 7
      order by a.id
    loop
      perform app.emit_event('absence.sources_changed', v_board_id, v_abs.school_id, 'absence',
        r.id, jsonb_build_object('absenceId', r.id, 'cause', 'earlier_absence'));
    end loop;
  end if;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 6. Absences: publishing, changing and rebuilding now say which sources the plans were built
--    from (`p_sources_fingerprint`, from get_sub_plan_sources). When the sources changed in
--    between, the plans are saved all the same (6 a.m. never waits) and the absence stays
--    marked, so the worker builds it again. Without a fingerprint nothing is checked.
-- ---------------------------------------------------------------------------------------

drop function public.publish_absence(uuid, date, date, public.absence_part, text, boolean, uuid, jsonb);

-- As before (D-047), and a request id sent again is the same absence only when it names the
-- same school, dates and part: an id kept in a draft that was used for another absence (a
-- publish whose answer was lost) is refused with LXS23, and the form asks for a new tap.
create function public.publish_absence(
  p_school_id uuid,
  p_starts_on date,
  p_ends_on date,
  p_part public.absence_part,
  p_note text,
  p_catholic_connection boolean,
  p_client_request_id uuid,
  p_plans jsonb,
  p_sources_fingerprint text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.active_user_id();
  v_board_id uuid;
  v_part public.absence_part := coalesce(p_part, 'full_day');
  v_existing public.absences;
  v_fresh boolean;
  v_id uuid;
begin
  if v_user is null or p_school_id is null
     or not exists (select 1 from app.my_school_ids(array['teacher']::public.app_role[]) s where s = p_school_id)
     or not app.school_has_module(p_school_id, 'teaching') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_client_request_id is null then
    raise exception 'client request id required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('absence:' || v_user::text, 0));
  select * into v_existing from public.absences a
  where a.teacher_id = v_user and a.client_request_id = p_client_request_id;
  if v_existing.id is not null then
    if v_existing.status = 'published'
       and v_existing.school_id = p_school_id
       and v_existing.starts_on = p_starts_on
       and v_existing.ends_on = p_ends_on
       and v_existing.part = v_part then
      return v_existing.id;   -- a retried tap
    end if;
    raise exception 'this request id was used for another absence' using errcode = 'LXS23';
  end if;

  if p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on
     or (v_part <> 'full_day' and p_ends_on <> p_starts_on)
     or char_length(p_note) > 1000 then
    raise exception 'invalid absence' using errcode = '22023';
  end if;
  if p_starts_on < app.school_local_today(p_school_id) then
    raise exception 'absence in the past' using errcode = 'LXS20';
  end if;
  if p_ends_on - p_starts_on > 13 then
    raise exception 'absence too long' using errcode = 'LXS21';
  end if;
  -- A morning and an afternoon absence on the same day may coexist.
  if exists (
    select 1 from public.absences a
    where a.teacher_id = v_user and a.status = 'published'
      and daterange(a.starts_on, a.ends_on, '[]') && daterange(p_starts_on, p_ends_on, '[]')
      and not (a.starts_on = a.ends_on and p_starts_on = p_ends_on
               and a.part <> 'full_day' and v_part <> 'full_day' and a.part <> v_part)
  ) then
    raise exception 'overlapping absence' using errcode = 'LXS22';
  end if;

  -- Before the new absence exists: its own plans would then be among the sources.
  v_fresh := p_sources_fingerprint is null or p_sources_fingerprint
    = app.sub_plan_sources_fingerprint(v_user, p_school_id, p_starts_on, p_ends_on, null);

  select s.board_id into v_board_id from public.schools s where s.id = p_school_id;
  insert into public.absences (teacher_id, school_id, starts_on, ends_on, part, note, status,
    published_at, catholic_connection, client_request_id)
  values (v_user, p_school_id, p_starts_on, p_ends_on, v_part, nullif(btrim(p_note), ''),
    'published', now(), coalesce(p_catholic_connection, true), p_client_request_id)
  returning id into v_id;

  perform app.log_audit('absence.published', v_board_id, p_school_id, 'absence', v_id,
    jsonb_build_object('starts_on', p_starts_on, 'ends_on', p_ends_on, 'part', v_part));
  perform app.emit_event('absence.published', v_board_id, p_school_id, 'absence', v_id,
    jsonb_build_object('absenceId', v_id, 'startsOn', p_starts_on, 'endsOn', p_ends_on, 'part', v_part));
  perform app.write_absence_plans(v_id, p_plans);
  if not v_fresh then
    perform app.mark_absence_stale(v_id);
  end if;
  return v_id;
end;
$$;

drop function public.update_absence(uuid, date, public.absence_part, text, boolean, jsonb);

-- « Modifier / Je reviens plus tôt », as before.
create function public.update_absence(
  p_absence_id uuid,
  p_ends_on date,
  p_part public.absence_part,
  p_note text,
  p_catholic_connection boolean,
  p_plans jsonb,
  p_sources_fingerprint text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.active_user_id();
  v_abs public.absences;
  v_board_id uuid;
  v_part public.absence_part;
  v_fresh boolean;
begin
  if v_user is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('absence:' || v_user::text, 0));
  select * into v_abs from public.absences where id = p_absence_id for update;
  if v_abs.id is null or v_abs.teacher_id <> v_user then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_abs.status <> 'published' then
    raise exception 'absence is not published' using errcode = '22023';
  end if;

  v_part := coalesce(p_part, v_abs.part);
  if p_ends_on is null or p_ends_on < v_abs.starts_on
     or (v_part <> 'full_day' and p_ends_on <> v_abs.starts_on)
     or char_length(p_note) > 1000 then
    raise exception 'invalid absence' using errcode = '22023';
  end if;
  if p_ends_on < app.school_local_today(v_abs.school_id) then
    raise exception 'absence in the past' using errcode = 'LXS20';
  end if;
  if p_ends_on - v_abs.starts_on > 13 then
    raise exception 'absence too long' using errcode = 'LXS21';
  end if;
  if exists (
    select 1 from public.absences a
    where a.teacher_id = v_user and a.status = 'published' and a.id <> p_absence_id
      and daterange(a.starts_on, a.ends_on, '[]') && daterange(v_abs.starts_on, p_ends_on, '[]')
      and not (a.starts_on = a.ends_on and v_abs.starts_on = p_ends_on
               and a.part <> 'full_day' and v_part <> 'full_day' and a.part <> v_part)
  ) then
    raise exception 'overlapping absence' using errcode = 'LXS22';
  end if;
  if exists (
    select 1 from public.sub_plans p
    where p.absence_id = p_absence_id and p.plan_date > p_ends_on
      and (
        exists (select 1 from public.sub_sessions ss where ss.sub_plan_id = p.id)
        or exists (select 1 from public.sub_reports sr where sr.sub_plan_id = p.id)
      )
  ) then
    raise exception 'a day that would be removed is in use' using errcode = 'LXS12';
  end if;
  if v_part <> v_abs.part and exists (
    select 1 from public.sub_plans p
    where p.absence_id = p_absence_id and p.plan_date = v_abs.starts_on
      and not app.sub_plan_refreshable(p.id)
  ) then
    raise exception 'the plan for that day can no longer change' using errcode = 'LXS12';
  end if;

  -- Before anything changes: the plans themselves are among the sources (siblings).
  v_fresh := p_sources_fingerprint is null or p_sources_fingerprint
    = app.sub_plan_sources_fingerprint(v_user, v_abs.school_id, v_abs.starts_on, p_ends_on,
        p_absence_id);

  update public.absences
  set ends_on = p_ends_on,
      part = v_part,
      note = nullif(btrim(p_note), ''),
      catholic_connection = coalesce(p_catholic_connection, catholic_connection)
  where id = p_absence_id;

  select s.board_id into v_board_id from public.schools s where s.id = v_abs.school_id;
  perform app.log_audit('absence.updated', v_board_id, v_abs.school_id, 'absence', p_absence_id,
    jsonb_build_object('starts_on', v_abs.starts_on, 'ends_on', p_ends_on, 'part', v_part,
      'previous_ends_on', v_abs.ends_on, 'previous_part', v_abs.part));
  perform app.emit_event('absence.updated', v_board_id, v_abs.school_id, 'absence', p_absence_id,
    jsonb_build_object('absenceId', p_absence_id));
  perform app.write_absence_plans(p_absence_id, p_plans);
  if not v_fresh then
    perform app.mark_absence_stale(p_absence_id);
  end if;
end;
$$;

drop function public.refresh_sub_plans(uuid, jsonb);

-- « Mettre à jour le plan »: the owner rebuilds now.
create function public.refresh_sub_plans(
  p_absence_id uuid,
  p_plans jsonb,
  p_sources_fingerprint text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.active_user_id();
  v_abs public.absences;
  v_fresh boolean;
begin
  select * into v_abs from public.absences where id = p_absence_id for update;
  if v_user is null or v_abs.id is null or v_abs.teacher_id <> v_user then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_abs.status <> 'published' then
    raise exception 'absence is not published' using errcode = '22023';
  end if;
  v_fresh := p_sources_fingerprint is null or p_sources_fingerprint
    = app.sub_plan_sources_fingerprint(v_user, v_abs.school_id, v_abs.starts_on, v_abs.ends_on,
        p_absence_id);
  perform app.write_absence_plans(p_absence_id, p_plans);
  if not v_fresh then
    perform app.mark_absence_stale(p_absence_id);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 7. Confirming a report (D-054)
-- ---------------------------------------------------------------------------------------

drop function public.confirm_sub_report(uuid, jsonb);

-- « Confirmer le suivi », as before, and:
--   p_expected_updated_at  the report's updated_at as the page showed it: when the substitute
--                          sent the report again since, nothing is confirmed (LXS16) and the
--                          page shows the new version, so no lesson is confirmed unseen.
--   not_completed          removes this report's record of the lesson whatever its status (a
--                          lesson checked off from Planification while it was pending included).
-- The teacher's upcoming absences are then rebuilt from what she confirmed: a lesson not done
-- comes back, which matters most for a draft (confirming it deletes no pending row).
create function public.confirm_sub_report(
  p_report_id uuid,
  p_decisions jsonb,
  p_expected_updated_at timestamptz default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.active_user_id();
  v_report public.sub_reports;
  v_plan public.sub_plans;
  v_abs public.absences;
  v_board_id uuid;
  v_item jsonb;
  v_lesson uuid;
  v_decision public.lesson_progress_status;
  v_class uuid;
  v_seen uuid[] := '{}';
  v_completed integer := 0;
  v_not_completed integer := 0;
  v_skipped integer := 0;
  v_rest integer;
begin
  select * into v_report from public.sub_reports where id = p_report_id for update;
  select * into v_plan from public.sub_plans where id = v_report.sub_plan_id;
  select * into v_abs from public.absences where id = v_plan.absence_id;
  if v_user is null or v_report.id is null or v_abs.teacher_id is distinct from v_user then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_report.status = 'confirmed' then
    return;   -- a retried tap
  end if;
  if v_report.status = 'draft' and not app.sub_plan_window_ended(v_plan.id) then
    raise exception 'the report is still being written' using errcode = '22023';
  end if;
  if p_expected_updated_at is not null and p_expected_updated_at <> v_report.updated_at then
    raise exception 'the report changed since it was shown' using errcode = 'LXS16';
  end if;
  if p_decisions is null or jsonb_typeof(p_decisions) <> 'array'
     or jsonb_array_length(p_decisions) > 40 then
    raise exception 'invalid decisions' using errcode = '22023';
  end if;

  for v_item in select e.value from jsonb_array_elements(p_decisions) e loop
    if jsonb_typeof(v_item) <> 'object'
       or jsonb_typeof(v_item -> 'lessonId') is distinct from 'string'
       or not pg_input_is_valid(v_item ->> 'lessonId', 'uuid')
       or coalesce(v_item ->> 'decision', '') not in ('completed', 'not_completed', 'skipped') then
      raise exception 'invalid decision' using errcode = '22023';
    end if;
    v_lesson := (v_item ->> 'lessonId')::uuid;
    if v_lesson = any (v_seen) then
      raise exception 'a lesson is decided twice' using errcode = '22023';
    end if;
    v_seen := v_seen || v_lesson;
    if not (
      exists (
        select 1 from jsonb_array_elements(coalesce(v_report.content -> 'lessons', '[]')) l
        where l.value ->> 'lessonId' = v_lesson::text
      )
      or exists (
        select 1 from public.lesson_progress lp
        where lp.lesson_id = v_lesson and lp.sub_report_id = p_report_id
          and lp.status = 'pending_confirmation'
      )
    ) then
      raise exception 'the lesson is not in this report' using errcode = '22023';
    end if;
    select u.class_id into v_class
    from public.unit_lessons ul join public.units u on u.id = ul.unit_id
    where ul.id = v_lesson;
    if v_class is null then
      raise exception 'the lesson no longer exists' using errcode = '22023';
    end if;
    if not app.is_class_teacher(v_class) then
      raise exception 'not allowed' using errcode = '42501';
    end if;

    if v_item ->> 'decision' = 'not_completed' then
      delete from public.lesson_progress lp
      where lp.lesson_id = v_lesson and lp.sub_report_id = p_report_id;
      v_not_completed := v_not_completed + 1;
    else
      v_decision := (v_item ->> 'decision')::public.lesson_progress_status;
      update public.lesson_progress lp
      set status = v_decision, completed_by = v_user, completed_at = now()
      where lp.lesson_id = v_lesson and lp.sub_report_id = p_report_id
        and lp.status = 'pending_confirmation';
      if not found then
        insert into public.lesson_progress (lesson_id, class_id, status, taught_on, source,
          sub_report_id, completed_by)
        values (v_lesson, v_class, v_decision, v_plan.plan_date, 'substitute_report', p_report_id,
          v_user)
        on conflict (lesson_id) do nothing;
      end if;
      if v_decision = 'completed' then
        v_completed := v_completed + 1;
      else
        v_skipped := v_skipped + 1;
      end if;
    end if;
  end loop;

  -- What the substitute marked done and the teacher did not mention is confirmed as done (the
  -- page showed it: the report has not changed since, p_expected_updated_at).
  update public.lesson_progress lp
  set status = 'completed', completed_by = v_user, completed_at = now()
  where lp.sub_report_id = p_report_id and lp.status = 'pending_confirmation'
    and lp.lesson_id <> all (v_seen);
  get diagnostics v_rest = row_count;
  v_completed := v_completed + v_rest;

  -- A draft confirmed after the day counts as handed in when it was last saved.
  update public.sub_reports
  set status = 'confirmed',
      confirmed_by = v_user,
      confirmed_at = now(),
      submitted_at = coalesce(submitted_at, updated_at)
  where id = p_report_id;

  -- Later days assumed this day's lessons were taught until its report came (D-047).
  perform app.flag_absences(array[v_abs.teacher_id], null, null, null);

  select s.board_id into v_board_id from public.schools s where s.id = v_abs.school_id;
  perform app.log_audit('sub_report.confirmed', v_board_id, v_abs.school_id, 'sub_report',
    p_report_id,
    jsonb_build_object('sub_plan_id', v_plan.id, 'completed', v_completed,
      'not_completed', v_not_completed, 'skipped', v_skipped,
      'was_draft', v_report.status = 'draft'));
  perform app.emit_event('sub_report.confirmed', v_board_id, v_abs.school_id, 'sub_report',
    p_report_id,
    jsonb_build_object('subReportId', p_report_id, 'subPlanId', v_plan.id, 'absenceId', v_abs.id,
      'planDate', v_plan.plan_date));
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 8. Permissions: functions are opt-in, as everywhere else.
-- ---------------------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon;
revoke execute on all functions in schema sub_portal from public, anon, authenticated, service_role;

grant execute on function sub_portal.redeem(text[], text, text) to lynx_sub_portal;

grant execute on function
  public.publish_absence(uuid, date, date, public.absence_part, text, boolean, uuid, jsonb, text),
  public.update_absence(uuid, date, public.absence_part, text, boolean, jsonb, text),
  public.refresh_sub_plans(uuid, jsonb, text),
  public.confirm_sub_report(uuid, jsonb, timestamptz)
to authenticated;
