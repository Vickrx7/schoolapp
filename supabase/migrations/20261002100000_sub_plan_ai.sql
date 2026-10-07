-- Phase 3b (substitute hand-off): « Consignes détaillées », AI-written steps for a plan.
--
-- The owner asks for them from the plan page, after checking in a preview exactly what would be
-- sent (D-038 as amended by D-052). The request is an ordinary AI job (feature 'sub_plan'), run
-- by the worker like every other (D-037): the same school switch, budget and per-person limits,
-- and the same de-identification with the whole roster of the requester's schools. Its answer
-- becomes the plan's AI layer (sub_plans.ai, D-048) through a trigger when the worker records it,
-- and only while no substitute has opened the plan: what a substitute reads never changes under
-- them because of AI. The teacher's own edits always come first, and the AI layer applies to a
-- block only while it has the lesson the request was written for.
--
-- Error codes the app translates: LXA01 AI off, LXA02 budget reached, LXA03 too many requests,
-- LXS12 a substitute already opened the plan, LXS14 the day is over, LXS15 the plan changed since
-- the preview.
-- DECISIONS: D-037, D-038, D-048, D-052, D-056.
-- Tests: supabase/tests/13_sub_plan_ai.test.sql

-- ---------------------------------------------------------------------------------------
-- 1. The feature and the plan's AI layer
-- ---------------------------------------------------------------------------------------

alter table public.ai_jobs drop constraint ai_jobs_feature_check,
  add constraint ai_jobs_feature_check check (feature in ('differentiate', 'sub_plan'));

-- {jobId, appliedAt, refs: [{key, ref: {blockKey, lessonId}}], faithRef, result}: written by
-- app.ai_jobs_apply_sub_plan only. The plan JSON rule holds (D-048): nothing here grants access.
alter table public.sub_plans
  add column ai jsonb check (ai is null or (jsonb_typeof(ai) = 'object' and pg_column_size(ai) <= 262144)),
  add column ai_job_id uuid references public.ai_jobs (id) on delete set null;

create index sub_plans_ai_job_id_idx on public.sub_plans (ai_job_id);

-- ---------------------------------------------------------------------------------------
-- 2. One place that queues an AI job. request_ai_job's body, unchanged, moves here so the
--    substitute plan request shares its checks: the school switch and the board's permission
--    (LXA01), the budget (LXA02), 3 open requests and 40 an hour per person (LXA03, counted in
--    ai_request_log under a per-person lock), the job and its ai.job_requested event.
--    Callers check who may ask first.
-- ---------------------------------------------------------------------------------------

create function app.enqueue_ai_job(
  p_user uuid,
  p_school_id uuid,
  p_feature text,
  p_input jsonb,
  p_max_input_bytes integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_board uuid;
  v_enabled boolean;
  v_job uuid;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object'
     or pg_column_size(p_input) > p_max_input_bytes then
    raise exception 'invalid AI input' using errcode = '22023';
  end if;

  select s.board_id, s.ai_enabled and a.allowed
    into v_board, v_enabled
  from public.schools s
  join public.boards b on b.id = s.board_id
  cross join app.board_ai_settings(b.settings) a
  where s.id = p_school_id;
  if not coalesce(v_enabled, false) then
    raise exception 'AI is turned off for this school' using errcode = 'LXA01';
  end if;
  if not coalesce((select b.available from app.ai_budget_status(p_school_id) b), false) then
    raise exception 'AI budget reached for this month' using errcode = 'LXA02';
  end if;

  -- One request at a time per person: parallel calls wait here, and the counts below (a new
  -- snapshot per statement) then see the previous call's job.
  perform pg_advisory_xact_lock(hashtextextended('ai_request:' || p_user::text, 0));
  if (
    select count(*) from public.ai_jobs j
    where j.user_id = p_user and j.status in ('queued', 'running')
  ) >= 3 or (
    select count(*) from public.ai_request_log r
    where r.user_id = p_user and r.created_at > now() - interval '1 hour'
  ) >= 40 then
    raise exception 'too many AI requests' using errcode = 'LXA03';
  end if;

  insert into public.ai_jobs (board_id, school_id, user_id, feature, input)
  values (v_board, p_school_id, p_user, p_feature, p_input)
  returning id into v_job;
  insert into public.ai_request_log (job_id, user_id) values (v_job, p_user);

  -- The payload carries no content; the worker reads the job itself.
  perform app.emit_event(
    'ai.job_requested', v_board, p_school_id, 'ai_job', v_job,
    jsonb_build_object('feature', p_feature)
  );
  return v_job;
end;
$$;

-- Same checks as before, in the same order. Substitute plans are not requested here: only
-- request_sub_plan_ai knows whose plan it is and whether a substitute already opened it.
create or replace function public.request_ai_job(p_school_id uuid, p_feature text, p_input jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.active_user_id();
begin
  if v_user is null or p_school_id is null or p_school_id not in (
    select app.my_school_ids(array['teacher', 'principal', 'vice_principal']::public.app_role[])
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_feature is null or p_feature not in ('differentiate') then
    raise exception 'unknown AI feature' using errcode = '22023';
  end if;
  return app.enqueue_ai_job(v_user, p_school_id, p_feature, p_input, 65536);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 3. « Ajouter des consignes détaillées (IA) » and « Retirer »: the owner only, while the day is
--    not over. A request needs the plan untouched since the preview (p_expected_version) and no
--    substitute session yet. The input is built and checked by the web server from the composed
--    plan (@lynx/ai subPlanAiInputSchema); the database keeps its size in check and never reads
--    anything else in it, apart from copying each block's key and ref into the AI layer.
-- ---------------------------------------------------------------------------------------

create function public.request_sub_plan_ai(
  p_plan_id uuid,
  p_input jsonb,
  p_expected_version integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.active_user_id();
  v_plan public.sub_plans;
  v_abs public.absences;
  v_open uuid;
  v_job uuid;
begin
  select * into v_plan from public.sub_plans where id = p_plan_id for update;
  select * into v_abs from public.absences where id = v_plan.absence_id;
  if v_user is null or v_plan.id is null or v_abs.teacher_id <> v_user
     or not exists (
       select 1 from app.my_school_ids(array['teacher']::public.app_role[]) s where s = v_abs.school_id)
     or not app.school_has_module(v_abs.school_id, 'teaching') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_abs.status <> 'published' then
    raise exception 'absence is not published' using errcode = '22023';
  end if;
  if v_plan.plan_date < app.school_local_today(v_abs.school_id) then
    raise exception 'the day is over' using errcode = 'LXS14';
  end if;
  if exists (select 1 from public.sub_sessions s where s.sub_plan_id = p_plan_id) then
    raise exception 'a substitute already opened this plan' using errcode = 'LXS12';
  end if;
  if p_expected_version is not null and p_expected_version <> v_plan.content_version then
    raise exception 'the plan changed since the preview' using errcode = 'LXS15';
  end if;

  -- A second tap while the first request runs: that request.
  select j.id into v_open from public.ai_jobs j
  where j.id = v_plan.ai_job_id and j.status in ('queued', 'running');
  if v_open is not null then
    return v_open;
  end if;

  if p_input is null or jsonb_typeof(p_input) <> 'object'
     or jsonb_typeof(p_input -> 'blocks') is distinct from 'array'
     or jsonb_array_length(p_input -> 'blocks') not between 1 and 10 then
    raise exception 'invalid AI input' using errcode = '22023';
  end if;

  v_job := app.enqueue_ai_job(v_user, v_abs.school_id, 'sub_plan', p_input, 98304);
  update public.sub_plans set ai_job_id = v_job where id = p_plan_id;
  return v_job;
end;
$$;

-- Removes the AI layer (and forgets a request still running, so its answer is not applied).
-- Allowed during the day, like the owner's edits: the teacher has the last word on her plan.
create function public.clear_sub_plan_ai(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.active_user_id();
  v_plan public.sub_plans;
  v_abs public.absences;
begin
  select * into v_plan from public.sub_plans where id = p_plan_id for update;
  select * into v_abs from public.absences where id = v_plan.absence_id;
  if v_user is null or v_plan.id is null or v_abs.teacher_id <> v_user then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_abs.status <> 'published' then
    raise exception 'absence is not published' using errcode = '22023';
  end if;
  if v_plan.plan_date < app.school_local_today(v_abs.school_id) then
    raise exception 'the day is over' using errcode = 'LXS14';
  end if;
  if v_plan.ai is null and v_plan.ai_job_id is null then
    return;
  end if;

  update public.sub_plans
  set ai = null,
      ai_job_id = null,
      -- A change to what the substitute reads: a new version (« Mis à jour ») by the teacher.
      content_version = content_version + case when v_plan.ai is null then 0 else 1 end,
      edited_by = case when v_plan.ai is null then edited_by else v_user end,
      edited_at = case when v_plan.ai is null then edited_at else now() end
  where id = p_plan_id;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 4. Applying the answer. Fires inside the worker's own update that records a finished job
--    (apps/worker/src/ai.ts finishJob), so the worker needs no code of its own. Only the plan's
--    current request is applied, and only while no substitute session exists for the plan.
--    The refs keep each block's key and ids, not the lesson text the request carried.
-- ---------------------------------------------------------------------------------------

create function app.ai_jobs_apply_sub_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ai jsonb;
begin
  if jsonb_typeof(new.result) is distinct from 'object' then
    return new;
  end if;
  v_ai := jsonb_build_object(
    'jobId', new.id,
    'appliedAt', now(),
    'refs', coalesce((
      select jsonb_agg(jsonb_build_object('key', b.value -> 'key', 'ref', b.value -> 'ref')
                       order by b.ordinality)
      from jsonb_array_elements(
        case when jsonb_typeof(new.input -> 'blocks') = 'array' then new.input -> 'blocks'
             else '[]'::jsonb end) with ordinality b
    ), '[]'::jsonb),
    'faithRef', new.input #> '{faith,ref}',
    'result', new.result
  );
  -- Too large to store: the job stays succeeded and the plan keeps what it had.
  if pg_column_size(v_ai) > 262144 then
    return new;
  end if;

  update public.sub_plans p
  set ai = v_ai,
      content_version = p.content_version + 1
  where p.ai_job_id = new.id
    and not exists (select 1 from public.sub_sessions s where s.sub_plan_id = p.id);
  return new;
end;
$$;

create trigger ai_jobs_apply_sub_plan after update of status on public.ai_jobs
  for each row
  when (new.feature = 'sub_plan' and new.status = 'succeeded'
        and old.status is distinct from 'succeeded')
  execute function app.ai_jobs_apply_sub_plan();

-- ---------------------------------------------------------------------------------------
-- 5. Readers of a released plan also get its AI layer: direction and office
--    (get_sub_plan_for_staff) and the substitute (sub_portal.load). Unchanged otherwise.
-- ---------------------------------------------------------------------------------------

create or replace function public.get_sub_plan_for_staff(p_plan_id uuid, p_purpose text default 'view')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.sub_plans;
  v_abs public.absences;
  v_school public.schools;
  v_teacher public.users;
  v_role text;
  v_content jsonb;
  v_roster jsonb;
  v_levels jsonb;
begin
  select * into v_plan from public.sub_plans where id = p_plan_id;
  select * into v_abs from public.absences where id = v_plan.absence_id;
  if app.active_user_id() is null or v_plan.id is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if exists (select 1 from app.my_direction_school_ids() s where s = v_abs.school_id) then
    v_role := 'direction';
  elsif exists (
    select 1 from app.my_school_ids(array['office_admin']::public.app_role[]) s where s = v_abs.school_id
  ) then
    v_role := 'office';
  else
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_purpose is null or p_purpose not in ('view', 'pdf') then
    raise exception 'invalid purpose' using errcode = '22023';
  end if;

  if v_abs.status <> 'published' or not app.sub_plan_released(v_plan.status, v_plan.review_deadline) then
    return jsonb_build_object('released', false, 'releaseAt', v_plan.review_deadline);
  end if;

  select * into v_school from public.schools where id = v_abs.school_id;
  select * into v_teacher from public.users where id = v_abs.teacher_id;

  v_content := v_plan.plan;
  if v_role = 'office' and jsonb_typeof(v_content -> 'classNotes') = 'array' then
    v_content := jsonb_set(v_content, '{classNotes}', coalesce((
      select jsonb_agg(case when jsonb_typeof(n.value) = 'object' then n.value - 'classManagement'
                            else n.value end order by n.ordinality)
      from jsonb_array_elements(v_content -> 'classNotes') with ordinality n
    ), '[]'::jsonb));
  end if;

  -- The roster comes from the classes the database recorded for the plan, never from its JSON.
  select coalesce(jsonb_agg(jsonb_build_object('id', st.id, 'classId', st.class_id,
      'firstName', st.first_name) order by st.first_name, st.id), '[]'::jsonb)
  into v_roster
  from public.students st
  join public.sub_plan_classes spc on spc.class_id = st.class_id
  where spc.sub_plan_id = p_plan_id and st.active;

  select coalesce(jsonb_agg(jsonb_build_object('id', ll.id, 'labelFr', ll.label_fr,
      'labelEn', ll.label_en, 'descriptionFr', ll.description_fr, 'sortOrder', ll.sort_order)
      order by ll.sort_order, ll.label_fr, ll.id), '[]'::jsonb)
  into v_levels
  from public.language_levels ll
  where ll.id in (
    select st.default_language_level_id
    from public.students st
    join public.sub_plan_classes spc on spc.class_id = st.class_id
    where spc.sub_plan_id = p_plan_id and st.active
  );

  perform app.log_audit(
    case when p_purpose = 'pdf' then 'sub_plan.printed' else 'sub_plan.viewed' end,
    v_school.board_id, v_school.id, 'sub_plan', p_plan_id, jsonb_build_object('role', v_role));

  return jsonb_build_object(
    'released', true,
    'planId', v_plan.id,
    'absenceId', v_abs.id,
    'planDate', v_plan.plan_date,
    'part', v_abs.part,
    'note', v_abs.note,
    'contentVersion', v_plan.content_version,
    'generatedAt', v_plan.generated_at,
    'plan', v_content,
    'edits', v_plan.edits,
    'ai', v_plan.ai,
    'school', jsonb_build_object(
      'name', v_school.name,
      'officePhone', v_school.settings #>> '{contact,officePhone}',
      'arrivalInstructions', v_school.settings #>> '{substitute,arrivalInstructions}',
      'emergencyInfo', v_school.settings #>> '{substitute,emergencyInfo}',
      'timezone', v_school.timezone
    ),
    'teacherName', app.formal_staff_name(v_teacher.display_name, v_teacher.honorific),
    'roster', v_roster,
    'levels', v_levels,
    'role', v_role
  );
end;
$$;

-- The substitute's day (D-049), as before, with the plan's AI layer; « Mis à jour à » also counts
-- the time the AI layer was applied.
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

-- ---------------------------------------------------------------------------------------
-- 6. Permissions: functions are opt-in, as everywhere else.
-- ---------------------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon;

grant execute on function
  public.request_sub_plan_ai(uuid, jsonb, integer),
  public.clear_sub_plan_ai(uuid)
to authenticated;
-- app.enqueue_ai_job and the trigger function are only reached through the functions above and
-- the worker's own update: no grants.
