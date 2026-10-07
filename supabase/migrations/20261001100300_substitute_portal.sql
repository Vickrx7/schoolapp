-- Phase 3 (substitute hand-off): the substitute portal and access codes.
--
-- Substitutes have no account. They type a code that the office or the teacher gives them, and
-- the web server talks to the database for them over its own connection, as the dedicated role
-- lynx_sub_portal (D-049). That role can execute the functions in schema sub_portal and nothing
-- else: no table privileges, no public or app function, and it is never granted to
-- authenticator, so no API request can become it. PostgREST does not expose the schema. Every
-- portal call re-checks, in order: the session, its code, the day's window, revocation, the
-- absence's status and the Teaching module.
--
-- Codes (D-050): the web server sends HMAC(key, code) and the database stores sha256 of that
-- MAC, so a database dump cannot be brute-forced offline. At most 2 active codes per plan and 2
-- devices per code. Throttling (D-051) records each attempt with keyed device and network
-- hashes, and answers with a wait (no attempt recorded) rather than a lockout.
--
-- Error codes the app translates: LXS13 two codes already active, LXS14 the day is over.
-- DECISIONS: D-049, D-050, D-051, D-056, D-060.
-- Tests: supabase/tests/00_schema_invariants.test.sql,
--        supabase/tests/11_substitute_codes_portal.test.sql

-- ---------------------------------------------------------------------------------------
-- 1. The portal role and its schema (D-049)
-- ---------------------------------------------------------------------------------------

-- Roles belong to the cluster, not the database: the local lite stack keeps them across resets,
-- so the role is created only once.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'lynx_sub_portal') then
    -- LOGIN and a password are set by the operator (docs/phase-3.md), and by supabase/seed.sql
    -- for local development and CI only.
    create role lynx_sub_portal nologin noinherit;
  end if;
end;
$$;

-- Portal calls are short; a stuck one must not hold one of the web server's few connections.
alter role lynx_sub_portal set statement_timeout = '5s';

-- The migration owner may act as the portal role (pgTAP does, and so can a local connection
-- with `options=-c role=lynx_sub_portal`). The reverse is never granted, and neither is
-- membership for authenticator.
grant lynx_sub_portal to postgres;

-- Not exposed through the API: supabase/config.toml lists only public and graphql_public.
create schema sub_portal;
revoke all on schema sub_portal from public;
grant usage on schema sub_portal to lynx_sub_portal;

-- ---------------------------------------------------------------------------------------
-- 2. Sessions. A substitute's browser holds a random 43-character token (base64url of 32
--    bytes) in an HttpOnly cookie; the database keeps only its sha256.
-- ---------------------------------------------------------------------------------------

-- The valid session behind a raw token, or no row: the token matches, neither the session nor
-- its code was revoked, the code's window is open, the absence is still published and the
-- school still has the Teaching module (D-060). Every portal function starts here.
create function app.sub_session(p_token text)
returns table (
  session_id uuid,
  code_id uuid,
  sub_plan_id uuid,
  absence_id uuid,
  school_id uuid,
  board_id uuid,
  plan_date date,
  expires_at timestamptz,
  device_key text
)
language sql
stable
security definer
set search_path = ''
as $$
  select ss.id, c.id, p.id, a.id, a.school_id, s.board_id, p.plan_date,
    least(ss.expires_at, c.expires_at), ss.device_key
  from public.sub_sessions ss
  join public.sub_access_codes c on c.id = ss.access_code_id and c.sub_plan_id = ss.sub_plan_id
  join public.sub_plans p on p.id = ss.sub_plan_id
  join public.absences a on a.id = p.absence_id
  join public.schools s on s.id = a.school_id
  where p_token is not null
    and char_length(p_token) = 43
    and ss.session_token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and ss.revoked_at is null
    and c.revoked_at is null
    and a.status = 'published'
    and now() >= c.valid_from
    and now() < least(ss.expires_at, c.expires_at)
    and app.school_has_module(a.school_id, 'teaching');
$$;

-- ---------------------------------------------------------------------------------------
-- 3. Redeeming a code (D-050, D-051)
-- ---------------------------------------------------------------------------------------

-- Signs a device in with a code. p_code_macs holds one HMAC of the typed code per key of the
-- web server's key ring (the current key and, during a rotation, the previous one); the device
-- and network keys are HMACs of the device cookie and the client address. Outcomes:
--   ok        a new session; its token is returned once (only its hash is stored)
--   invalid   no such code, or not usable now (revoked, outside its window, absence cancelled,
--             no Teaching module): the failed attempt is recorded
--   wait      too many recent failures from this device or network: nothing is recorded
--   used_up   the code is already used on its maximum number of devices
--   revoked   the office or the teacher cut this device's access: it needs a new code
-- Never raises after recording an attempt: an exception would roll the attempt back.
create function sub_portal.redeem(p_code_macs text[], p_device_key text, p_ip_key text)
returns table (outcome text, session_token text, expires_at timestamptz, retry_after integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_dev_fails integer;
  v_dev_last timestamptz;
  v_ip_fails integer;
  v_ip_last timestamptz;
  v_wait numeric := 0;
  v_code record;
  v_devices integer;
  v_token text;
  v_session uuid;
begin
  if p_device_key is null or p_device_key !~ '^[0-9a-f]{64}$'
    or p_ip_key is null or p_ip_key !~ '^[0-9a-f]{64}$'
    or coalesce(cardinality(p_code_macs), 0) not between 1 and 2
    or exists (select 1 from unnest(p_code_macs) m where m is null or m !~ '^[0-9a-f]{64}$')
  then
    return query select 'invalid'::text, null::text, null::timestamptz, null::integer;
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
    return query select 'wait'::text, null::text, null::timestamptz, ceil(v_wait)::integer;
    return;
  end if;

  select c.id, c.sub_plan_id, c.expires_at as code_expires_at, c.max_devices, a.school_id,
    s.board_id
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
    and now() >= c.valid_from
    and now() < c.expires_at
    and app.school_has_module(a.school_id, 'teaching')
  limit 1
  for update of c;

  if not found then
    insert into public.sub_code_attempts (device_key, ip_key, succeeded)
    values (p_device_key, p_ip_key, false);
    return query select 'invalid'::text, null::text, null::timestamptz, null::integer;
    return;
  end if;

  -- A device that was cut stays out: otherwise « Couper » would last until the code is typed
  -- again. (A session the substitute ended herself has no revoked_by and does not count.)
  if exists (
    select 1 from public.sub_sessions x
    where x.access_code_id = v_code.id and x.device_key = p_device_key and x.revoked_by is not null
  ) then
    return query select 'revoked'::text, null::text, null::timestamptz, null::integer;
    return;
  end if;

  -- At most max_devices devices per code; the same device may sign in again.
  select count(distinct x.device_key)::integer into v_devices
  from public.sub_sessions x where x.access_code_id = v_code.id;
  if not exists (
      select 1 from public.sub_sessions x
      where x.access_code_id = v_code.id and x.device_key = p_device_key
    )
    and v_devices >= v_code.max_devices
  then
    return query select 'used_up'::text, null::text, null::timestamptz, null::integer;
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
    v_code.sub_plan_id, jsonb_build_object('code_id', v_code.id, 'sub_session_id', v_session),
    'substitute');
  perform app.emit_event('sub_session.started', v_code.board_id, v_code.school_id, 'sub_plan',
    v_code.sub_plan_id, jsonb_build_object('subPlanId', v_code.sub_plan_id, 'sessionId', v_session));
  return query select 'ok'::text, v_token, v_code.code_expires_at, null::integer;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 4. Reading the plan (D-056: a released plan is a hand-off document; the substitute sees it
--    on the plan date, with first names, audited once per content version)
-- ---------------------------------------------------------------------------------------

-- The day for a session: {status: 'expired'} without a valid session, else {status: 'ok',
-- context, plan, roster, levels, report}.
--   p_purpose     'view' (the plan page: audits sub_plan.viewed once per content version),
--                 'poll' (the page checking for changes: never audited) or 'pdf' (always
--                 audits sub_plan.printed).
--   p_known_version  the content_version the page already shows: `plan` is then "unchanged".
-- `plan`, `roster` and `levels` are null until the plan is released. The roster is the active
-- students of the classes the database recorded for the plan, never read from its JSON (D-048).
create function sub_portal.load(
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

  if v_session.last_seen_at is null or v_session.last_seen_at < now() - interval '1 minute' then
    update public.sub_sessions set last_seen_at = now() where id = v_session.id;
  end if;

  if v_released then
    if v_unchanged then
      v_plan_out := to_jsonb('unchanged'::text);
    else
      v_plan_out := jsonb_build_object('plan', v_plan.plan, 'edits', v_plan.edits);

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
          jsonb_build_object('sub_session_id', v_session.id, 'content_version', v_plan.content_version),
          'substitute');
        update public.sub_sessions set last_viewed_version = v_plan.content_version
        where id = v_session.id;
      end if;
    end if;

    if p_purpose = 'pdf' then
      perform app.log_audit('sub_plan.printed', v_s.board_id, v_s.school_id, 'sub_plan', v_plan.id,
        jsonb_build_object('sub_session_id', v_session.id, 'content_version', v_plan.content_version),
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
      'updatedAt', greatest(v_plan.generated_at, v_plan.edited_at),
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

-- ---------------------------------------------------------------------------------------
-- 5. Safety and medical alerts (D-016 as amended by D-056): on screen only, hidden until
--    tapped, every reveal audited, never in a PDF. The web server decrypts them.
-- ---------------------------------------------------------------------------------------

-- The alerts of the active students of the plan's classes, for classes whose school has alerts
-- on. Only for a valid session and a released plan (no rows otherwise). Writes one
-- student_alert.viewed per class on every call.
create function sub_portal.alerts(p_token text)
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
        'sub_plan_id', v_plan.id),
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
-- 6. Ending the day
-- ---------------------------------------------------------------------------------------

-- « Terminer ma journée »: ends this session only. Nothing happens without a valid session.
create function sub_portal.end_session(p_token text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_s record;
begin
  select * into v_s from app.sub_session(p_token);
  if not found then
    return;
  end if;
  update public.sub_sessions set revoked_at = now() where id = v_s.session_id;
  perform app.log_audit('sub_session.ended', v_s.board_id, v_s.school_id, 'sub_plan',
    v_s.sub_plan_id, jsonb_build_object('sub_session_id', v_s.session_id), 'substitute');
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 7. Codes for staff (D-050, D-056): the owner, direction and office issue, list and cut
--    codes and devices. Metadata only: nobody can look a code up after it was shown.
-- ---------------------------------------------------------------------------------------

-- A new code for a plan. The web server generates the code, shows it once, and sends only its
-- HMAC. Its window is the plan date's access hours in the school's time zone.
create function public.issue_sub_access_code(p_plan_id uuid, p_code_mac text)
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
    max_devices, created_by)
  values (p_plan_id, encode(extensions.digest(p_code_mac, 'sha256'), 'hex'), v_plan.plan_date,
    v_from, v_until, 2, v_user)
  returning id into v_code_id;

  select s.board_id into v_board_id from public.schools s where s.id = v_abs.school_id;
  perform app.log_audit('sub_code.issued', v_board_id, v_abs.school_id, 'sub_plan', p_plan_id,
    jsonb_build_object('code_id', v_code_id, 'role', v_role, 'plan_date', v_plan.plan_date));
  return query select v_code_id, v_from, v_until;
end;
$$;

-- « Couper » a code: its sessions end with it.
create function public.revoke_sub_access_code(p_code_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.active_user_id();
  v_code public.sub_access_codes;
  v_role text;
  v_school_id uuid;
  v_board_id uuid;
begin
  select * into v_code from public.sub_access_codes where id = p_code_id for update;
  v_role := app.sub_plan_role(v_code.sub_plan_id);
  if v_user is null or v_code.id is null or v_role is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_code.revoked_at is not null then
    return;
  end if;

  update public.sub_access_codes set revoked_at = now(), revoked_by = v_user where id = p_code_id;
  update public.sub_sessions set revoked_at = now(), revoked_by = v_user
  where access_code_id = p_code_id and revoked_at is null;

  select a.school_id, s.board_id into v_school_id, v_board_id
  from public.sub_plans p
  join public.absences a on a.id = p.absence_id
  join public.schools s on s.id = a.school_id
  where p.id = v_code.sub_plan_id;
  perform app.log_audit('sub_code.revoked', v_board_id, v_school_id, 'sub_plan', v_code.sub_plan_id,
    jsonb_build_object('code_id', p_code_id, 'role', v_role));
end;
$$;

-- « Couper » one device: that device cannot sign in with the same code again (sub_portal.redeem).
create function public.revoke_sub_session(p_session_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.active_user_id();
  v_session public.sub_sessions;
  v_role text;
  v_school_id uuid;
  v_board_id uuid;
begin
  select * into v_session from public.sub_sessions where id = p_session_id for update;
  v_role := app.sub_plan_role(v_session.sub_plan_id);
  if v_user is null or v_session.id is null or v_role is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_session.revoked_by is not null then
    return;   -- already cut
  end if;

  -- Also the device's other sessions (it may have signed in again), so « Couper » cuts the
  -- device, not one of its visits.
  update public.sub_sessions
  set revoked_at = coalesce(revoked_at, now()), revoked_by = v_user
  where access_code_id = v_session.access_code_id and device_key = v_session.device_key
    and revoked_by is null;

  select a.school_id, s.board_id into v_school_id, v_board_id
  from public.sub_plans p
  join public.absences a on a.id = p.absence_id
  join public.schools s on s.id = a.school_id
  where p.id = v_session.sub_plan_id;
  perform app.log_audit('sub_session.revoked', v_board_id, v_school_id, 'sub_plan',
    v_session.sub_plan_id,
    jsonb_build_object('sub_session_id', p_session_id, 'code_id', v_session.access_code_id,
      'role', v_role));
end;
$$;

-- « Couper tout l'accès »: every code of the plan and every session.
create function public.revoke_sub_plan_access(p_plan_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.active_user_id();
  v_role text := app.sub_plan_role(p_plan_id);
  v_codes integer;
  v_sessions integer;
  v_school_id uuid;
  v_board_id uuid;
begin
  if v_user is null or v_role is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform 1 from public.sub_plans where id = p_plan_id for update;

  update public.sub_access_codes set revoked_at = now(), revoked_by = v_user
  where sub_plan_id = p_plan_id and revoked_at is null;
  get diagnostics v_codes = row_count;
  update public.sub_sessions
  set revoked_at = coalesce(revoked_at, now()), revoked_by = v_user
  where sub_plan_id = p_plan_id and revoked_by is null;
  get diagnostics v_sessions = row_count;

  select a.school_id, s.board_id into v_school_id, v_board_id
  from public.sub_plans p
  join public.absences a on a.id = p.absence_id
  join public.schools s on s.id = a.school_id
  where p.id = p_plan_id;
  perform app.log_audit('sub_code.revoked', v_board_id, v_school_id, 'sub_plan', p_plan_id,
    jsonb_build_object('all', true, 'codes', v_codes, 'sessions', v_sessions, 'role', v_role));
end;
$$;

-- The plan's codes and devices, for the codes panel and the office board. Metadata only:
-- {codes: [{codeId, createdAt, createdByName, validFrom, expiresAt, revokedAt, deviceCount}],
--  sessions: [{sessionId, codeId, deviceNumber, startedAt, lastSeenAt, expiresAt, revokedAt,
--  cut}]}. Devices are numbered in the order they first signed in; `cut` marks a session staff
-- revoked (a session the substitute ended, or replaced by signing in again, is not cut).
create function public.list_sub_plan_access(p_plan_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_codes jsonb;
  v_sessions jsonb;
begin
  if app.active_user_id() is null or app.sub_plan_role(p_plan_id) is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'codeId', c.id,
      'createdAt', c.created_at,
      'createdByName', case when u.id is not null
        then app.formal_staff_name(u.display_name, u.honorific) end,
      'validFrom', c.valid_from,
      'expiresAt', c.expires_at,
      'revokedAt', c.revoked_at,
      'deviceCount', (select count(distinct ss.device_key) from public.sub_sessions ss
                      where ss.access_code_id = c.id)
    ) order by c.created_at, c.id), '[]'::jsonb)
  into v_codes
  from public.sub_access_codes c
  left join public.users u on u.id = c.created_by
  where c.sub_plan_id = p_plan_id;

  with devices as (
    select ss.device_key,
      row_number() over (order by min(ss.created_at), ss.device_key) as n
    from public.sub_sessions ss
    where ss.sub_plan_id = p_plan_id
    group by ss.device_key
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'sessionId', ss.id,
      'codeId', ss.access_code_id,
      'deviceNumber', d.n,
      'startedAt', ss.created_at,
      'lastSeenAt', ss.last_seen_at,
      'expiresAt', ss.expires_at,
      'revokedAt', ss.revoked_at,
      'cut', ss.revoked_by is not null
    ) order by ss.created_at, ss.id), '[]'::jsonb)
  into v_sessions
  from public.sub_sessions ss
  join devices d on d.device_key = ss.device_key
  where ss.sub_plan_id = p_plan_id;

  return jsonb_build_object('codes', v_codes, 'sessions', v_sessions);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 8. Permissions: the portal role executes the portal functions and nothing else; staff get
--    the code functions. (Default privileges would give PUBLIC execute on new functions, and
--    per-schema default privileges cannot take a global default away, so revoke explicitly.)
-- ---------------------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon;
revoke execute on all functions in schema sub_portal from public, anon, authenticated, service_role;

grant execute on function
  sub_portal.redeem(text[], text, text),
  sub_portal.load(text, integer, text),
  sub_portal.alerts(text),
  sub_portal.end_session(text)
to lynx_sub_portal;

grant execute on function
  public.issue_sub_access_code(uuid, text),
  public.revoke_sub_access_code(uuid),
  public.revoke_sub_session(uuid),
  public.revoke_sub_plan_access(uuid),
  public.list_sub_plan_access(uuid)
to authenticated;
