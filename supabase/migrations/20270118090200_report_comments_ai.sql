-- « Commentaires de bulletin », slice S2: « Créer une banque avec l'IA » (DECISIONS D-132, amending
-- D-072 and D-080). The AI writes a comment bank (« Banque de commentaires de bulletin », library
-- type `report_comments`, D-129) from curriculum labels only; the answer becomes a private draft of
-- the teacher who asked, as « Créer avec l'IA » does. Modelled on 20261015090200_library_ai.sql.
--
--  1. The feature `report_comment_bank`.
--  2. The request, built by the database from ids: the teacher sends ids and choices only (the
--     scope, the report, one grade, the subject, up to 12 attentes, the length of the entries and
--     a note), and every label and text sent is read from the tables here; the preview returns
--     exactly this. No student, class, school or id reaches the message (the keys E1… do).
--  3. Asking: the same school switch, budget and limits per person as every AI request
--     (app.enqueue_ai_job), plus the Library module (app.library_ai_school_allowed). A second tap
--     with the same input while that request is open returns it.
--  4. Applying the answer: inside the worker's own update that records a finished job, through
--     the library's `app.library_item_from_ai_result` (here made to keep a missing duration null:
--     a bank has none, D-129), audited as `library_item.generated`.
--  5. Permissions.
--
-- Error codes: 42501 not allowed (no Library module, not a teacher or direction there, a
-- deactivated account); 22023 a request the app never sends; LXA01 AI off, LXA02 budget reached,
-- LXA03 too many requests (app.enqueue_ai_job). A job whose answer cannot be stored fails with
-- 'invalidOutput'. No new audit action: `library_item.generated` (D-079).
-- Tests: supabase/tests/35_report_comments.test.sql (S2 part)

-- ---------------------------------------------------------------------------------------
-- 1. The feature. request_ai_job keeps its list (« Texte différencié » only): banks come only
--    through the functions below, which build their input themselves.
-- ---------------------------------------------------------------------------------------

alter table public.ai_jobs drop constraint ai_jobs_feature_check,
  add constraint ai_jobs_feature_check
    check (feature in ('differentiate', 'sub_plan', 'library_item', 'library_levels',
      'report_comment_bank'));

-- ---------------------------------------------------------------------------------------
-- 2. Building the request
-- ---------------------------------------------------------------------------------------

-- The input of « Créer une banque avec l'IA » for a request `{scope, period, gradeCode,
-- subjectId, expectationIds, length, teacherNote}` (D-132). Checks, in order: the user and school
-- (42501), the shape, the scope (subject, learning_skills, religion), the report (progress, term),
-- the length (short, medium), one grade from 1re to 8e année, the subject that fits the scope (an
-- active subject of the grade, standard or the board's, other than Enseignement religieux; that
-- one for religion; none for the learning skills), 0 to 12 distinct attentes of that subject and
-- grade (none for the learning skills) and a note of at most 500 characters (22023). Labels and
-- attente texts come from the tables, never from the request. Service role only: it takes a user.
create function app.report_comment_bank_ai_input(p_user uuid, p_school_id uuid, p_request jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_board uuid;
  v_scope text;
  v_period text;
  v_length text;
  v_grade public.grades;
  v_subject public.subjects;
  v_exp_ids uuid[];
  v_expectations jsonb;
  v_note text;
begin
  -- 1. Who and where.
  if not app.library_ai_school_allowed(p_user, p_school_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select s.board_id into v_board from public.schools s where s.id = p_school_id;

  -- 2. The shape: ids and choices only.
  if p_request is null or jsonb_typeof(p_request) <> 'object'
    or coalesce(jsonb_typeof(p_request -> 'scope'), 'null') <> 'string'
    or coalesce(jsonb_typeof(p_request -> 'period'), 'null') <> 'string'
    or coalesce(jsonb_typeof(p_request -> 'length'), 'null') <> 'string'
    or coalesce(jsonb_typeof(p_request -> 'gradeCode'), 'null') <> 'string'
    or coalesce(jsonb_typeof(p_request -> 'subjectId'), 'null') not in ('string', 'null')
    or coalesce(jsonb_typeof(p_request -> 'expectationIds'), 'null') not in ('array', 'null')
    or coalesce(jsonb_typeof(p_request -> 'teacherNote'), 'null') not in ('string', 'null')
  then
    raise exception 'invalid request' using errcode = '22023';
  end if;

  -- 3 to 5. The scope, the report and the length of the entries.
  v_scope := p_request ->> 'scope';
  v_period := p_request ->> 'period';
  v_length := p_request ->> 'length';
  if v_scope not in ('subject', 'learning_skills', 'religion') then
    raise exception 'invalid scope' using errcode = '22023';
  end if;
  if v_period not in ('progress', 'term') then
    raise exception 'invalid report' using errcode = '22023';
  end if;
  if v_length not in ('short', 'medium') then
    raise exception 'invalid length' using errcode = '22023';
  end if;

  -- 6. One grade, 1re to 8e année (kindergarten has no report card comments, D-008).
  select * into v_grade from public.grades g
  where g.code = p_request ->> 'gradeCode' and g.ordinal between 1 and 8;
  if v_grade.code is null then
    raise exception 'invalid grade' using errcode = '22023';
  end if;

  -- 7. The subject, by scope: none for the learning skills; Enseignement religieux for religion;
  --    another active subject of the grade, standard or the board's, for a subject.
  if v_scope = 'learning_skills' then
    if nullif(p_request ->> 'subjectId', '') is not null then
      raise exception 'the learning skills have no subject' using errcode = '22023';
    end if;
  else
    select * into v_subject from public.subjects s
    where s.id = nullif(p_request ->> 'subjectId', '')::uuid and s.active
      and (s.board_id is null or s.board_id = v_board)
      and s.grade_min <= v_grade.ordinal and s.grade_max >= v_grade.ordinal
      and (s.code = 'ere') = (v_scope = 'religion');
    if v_subject.id is null then
      raise exception 'invalid subject' using errcode = '22023';
    end if;
  end if;

  -- 8. Up to 12 distinct attentes of that subject and grade, in the order chosen (E1…); none is
  --    fine (« commentaires généraux », D-030), and none for the learning skills.
  v_exp_ids := array(
    select x::uuid
    from jsonb_array_elements_text(app.jsonb_array_or_empty(p_request -> 'expectationIds'))
      with ordinality t (x, n)
    order by n);
  if cardinality(v_exp_ids) > 12
    or (select count(distinct x) from unnest(v_exp_ids) x) <> cardinality(v_exp_ids)
    or (v_scope = 'learning_skills' and cardinality(v_exp_ids) > 0)
    or exists (
      select 1 from unnest(v_exp_ids) e
      where not exists (
        select 1 from public.curriculum_expectations ce
        where ce.id = e and ce.subject_id = v_subject.id and ce.grade_code = v_grade.code))
  then
    raise exception 'invalid attentes' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'key', 'E' || t.n, 'expectationId', ce.id, 'code', ce.code, 'text', ce.text_fr,
      'kind', ce.kind, 'strandLabel', st.label_fr) order by t.n), '[]'::jsonb)
  into v_expectations
  from unnest(v_exp_ids) with ordinality t (id, n)
  join public.curriculum_expectations ce on ce.id = t.id
  left join public.strands st on st.id = ce.strand_id;

  -- 9. The teacher's note (« Précisions »), the only text she types.
  v_note := btrim(coalesce(p_request ->> 'teacherNote', ''));
  if char_length(v_note) > 500 then
    raise exception 'note too long' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'itemType', 'report_comments',
    'scope', v_scope,
    'period', v_period,
    'length', v_length,
    'gradeCodes', jsonb_build_array(v_grade.code),
    'gradeLabels', jsonb_build_array(v_grade.label_fr),
    'subjectId', v_subject.id,
    'subjectLabel', v_subject.label_fr,
    'expectations', v_expectations,
    'teacherNote', v_note
  );
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 3. Preview and request (never automatic, always previewed; the preview is exactly what the
--    request stores). The school switch, budget and limits are app.enqueue_ai_job's.
-- ---------------------------------------------------------------------------------------

create function public.report_comment_bank_ai_preview(p_school_id uuid, p_request jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app.report_comment_bank_ai_input(app.active_user_id(), p_school_id, p_request);
$$;

create function public.request_report_comment_bank(p_school_id uuid, p_request jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.active_user_id();
  v_input jsonb := app.report_comment_bank_ai_input(v_user, p_school_id, p_request);
  v_open uuid;
begin
  -- A second tap while the same request runs: that request.
  select j.id into v_open from public.ai_jobs j
  where j.user_id = v_user and j.school_id = p_school_id and j.feature = 'report_comment_bank'
    and j.status in ('queued', 'running') and j.input = v_input
  order by j.created_at desc
  limit 1;
  if v_open is not null then
    return v_open;
  end if;
  return app.enqueue_ai_job(v_user, p_school_id, 'report_comment_bank', v_input, 65536);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 4. Applying the answer (D-132). The worker records a succeeded job with one update
--    (apps/worker/src/ai.ts finishJob); this trigger runs inside it. An answer that cannot be
--    stored turns the job into 'invalidOutput' and leaves nothing behind.
-- ---------------------------------------------------------------------------------------

-- The library's draft from an AI answer (20261101090300_library_bulk.sql), copied whole with one
-- change: an answer without a duration keeps the duration null (a comment bank has none, D-129;
-- `greatest` ignores a null and gave 1 minute). Every other answer has one, checked by the app.
create or replace function app.library_item_from_ai_result(
  p_board_id uuid,
  p_school_id uuid,
  p_author_id uuid,
  p_board_owned boolean,
  p_input jsonb,
  p_result jsonb,
  p_generation_id uuid,
  p_bulk_run_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb := p_result;
  v_input jsonb := p_input;
  v_type public.library_item_type := (p_input ->> 'itemType')::public.library_item_type;
  v_gen public.ai_generations;
  v_item uuid := gen_random_uuid();
  v_safety jsonb;
  v_level record;
begin
  if jsonb_typeof(v_result) is distinct from 'object'
    or jsonb_typeof(v_result #> '{base,content}') is distinct from 'object'
    or pg_column_size(v_result) > 600000
  then
    raise exception 'unusable answer' using errcode = '22023';
  end if;
  select * into v_gen from public.ai_generations where id = p_generation_id;
  v_safety := case when v_type in ('experiment', 'stem_challenge')
    and jsonb_typeof(v_result -> 'safetyNotes') = 'object' then v_result -> 'safetyNotes' end;

  insert into public.library_items (
    id, board_id, school_id, type, title, summary, status, share_scope, source, author_id,
    board_owned, bulk_run_id, subject_id, duration_minutes, materials, keywords, is_printable,
    is_projectable, is_interactive, sub_friendly, safety_notes, catholic_connection,
    catholic_reference_id, faith_content, prompt_version, model, ai_generation_id
  ) values (
    v_item, p_board_id, p_school_id, v_type,
    left(btrim(v_result ->> 'title'), 200),
    nullif(left(btrim(v_result ->> 'summary'), 1000), ''),
    'draft', 'private', 'ai_generated', p_author_id,
    coalesce(p_board_owned, false), p_bulk_run_id,
    (v_input ->> 'subjectId')::uuid,
    case when jsonb_typeof(v_result -> 'durationMinutes') = 'number' then
      least(greatest(round((v_result ->> 'durationMinutes')::numeric), 1), 600)::smallint
    end,
    nullif(left(btrim(v_result ->> 'materials'), 4000), ''),
    nullif(left(btrim(v_result ->> 'keywords'), 300), ''),
    coalesce((v_result #>> '{formats,printable}')::boolean, true),
    coalesce((v_result #>> '{formats,projectable}')::boolean, false),
    coalesce((v_result #>> '{formats,interactive}')::boolean, false),
    -- For a substitute only when asked, allowed for the type, and for experiments and STEM
    -- challenges only under standard supervision (D-077).
    coalesce((v_input ->> 'subFriendly')::boolean, false)
      and not app.library_type_never_sub_friendly(v_type)
      and (v_type not in ('experiment', 'stem_challenge') or v_safety ->> 'supervision' = 'standard'),
    v_safety,
    nullif(left(btrim(v_result ->> 'catholicConnection'), 2000), ''),
    (v_input #>> '{catholic,referenceId}')::uuid,
    coalesce((v_result ->> 'faithContent')::boolean, false),
    v_gen.prompt_version, v_gen.model, v_gen.id
  );

  insert into public.library_item_grades (item_id, grade_code)
  select v_item, g from jsonb_array_elements_text(v_input -> 'gradeCodes') g
  on conflict do nothing;
  -- Attentes that still exist (one removed by a curriculum import since is left out).
  insert into public.library_item_expectations (item_id, expectation_id)
  select v_item, ce.id
  from jsonb_array_elements(app.jsonb_array_or_empty(v_input -> 'expectations')) e
  join public.curriculum_expectations ce on ce.id = (e ->> 'expectationId')::uuid
  on conflict do nothing;

  perform app.library_insert_version(v_item, null, v_result #> '{base,content}',
    v_result #> '{base,answerKey}');
  -- Each level asked for once, if it still exists; other keys are skipped.
  for v_level in
    select distinct on (l.value ->> 'languageLevelId') (l.value ->> 'languageLevelId')::uuid as level_id,
      r.value -> 'content' as content, r.value -> 'answerKey' as answer_key
    from jsonb_array_elements(app.jsonb_array_or_empty(v_result -> 'levels')) with ordinality r (value, n)
    join jsonb_array_elements(app.jsonb_array_or_empty(v_input -> 'levels')) l
      on l.value ->> 'key' = btrim(r.value ->> 'level')
    join public.language_levels ll on ll.id = (l.value ->> 'languageLevelId')::uuid
      and ll.board_id = p_board_id
    order by l.value ->> 'languageLevelId', r.n
  loop
    perform app.library_insert_version(v_item, v_level.level_id, v_level.content, v_level.answer_key);
  end loop;

  perform app.library_refresh_search(v_item);
  return v_item;
end;
$$;

-- The draft of « Créer une banque avec l'IA »: the requester's, private, `ai_generated`, with the
-- usage row's prompt version and model, the request's grade, subject and attentes, no duration,
-- materials or formats but printable, and one base version: the bank's scope and report from the
-- request and the answer's entries, each with the keys the library stores and nothing else (the
-- answer's `expectationKey` stays behind; its code is in `expectationCodes`). A religion bank
-- contains faith content (and needs the faith review, D-064). Returns the new item's id; raises
-- when the answer cannot be stored.
create function app.report_comment_bank_from_job(p_job public.ai_jobs)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb := p_job.result;
  v_input jsonb := p_job.input;
  v_entries jsonb;
  v_item uuid;
begin
  if jsonb_typeof(v_result) is distinct from 'object'
    or jsonb_typeof(v_result -> 'entries') is distinct from 'array'
    or jsonb_array_length(v_result -> 'entries') not between 1 and 160
    or nullif(btrim(v_result ->> 'title'), '') is null
    or exists (
      select 1 from jsonb_array_elements(v_result -> 'entries') e
      where jsonb_typeof(e) is distinct from 'object')
  then
    raise exception 'unusable answer' using errcode = '22023';
  end if;
  select jsonb_agg(jsonb_build_object(
      'kind', e -> 'kind',
      'skill', e -> 'skill',
      'level', e -> 'level',
      'progress', e -> 'progress',
      'rating', e -> 'rating',
      'category', e -> 'category',
      'expectationCodes', coalesce(e -> 'expectationCodes', '[]'::jsonb),
      'neutral', e -> 'neutral',
      'feminine', coalesce(e -> 'feminine', '""'::jsonb),
      'masculine', coalesce(e -> 'masculine', '""'::jsonb)) order by t.n)
  into v_entries
  from jsonb_array_elements(v_result -> 'entries') with ordinality t (e, n);

  v_item := app.library_item_from_ai_result(p_job.board_id, p_job.school_id, p_job.user_id, false,
    v_input,
    jsonb_build_object(
      'title', v_result -> 'title',
      'summary', v_result -> 'summary',
      'keywords', v_result -> 'keywords',
      'faithContent', v_input ->> 'scope' = 'religion',
      'base', jsonb_build_object(
        'content', jsonb_build_object('title', '', 'objective', '', 'teacherNote', '',
          'scope', v_input -> 'scope', 'period', v_input -> 'period', 'entries', v_entries),
        'answerKey', null),
      'levels', '[]'::jsonb),
    p_job.ai_generation_id, null);
  perform app.log_audit('library_item.generated', p_job.board_id, p_job.school_id, 'library_item',
    v_item, jsonb_build_object('ai_job_id', p_job.id, 'author_id', p_job.user_id));
  return v_item;
end;
$$;

-- The job's result keeps the answer and gains the bank's id (`itemId`), where the job page goes
-- next.
create function app.ai_jobs_apply_report_comment_bank()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item uuid;
begin
  begin
    v_item := app.report_comment_bank_from_job(new);
    new.result := new.result || jsonb_build_object('itemId', v_item);
  exception when others then
    -- The code only: an error message could quote the answer.
    raise warning 'comment bank answer not stored (job %, %)', new.id, sqlstate;
    new.status := 'failed';
    new.error_code := 'invalidOutput';
    new.result := null;
  end;
  return new;
end;
$$;

create trigger ai_jobs_apply_report_comment_bank before update of status on public.ai_jobs
  for each row
  when (new.feature = 'report_comment_bank' and new.status = 'succeeded'
        and old.status is distinct from 'succeeded')
  execute function app.ai_jobs_apply_report_comment_bank();

-- ---------------------------------------------------------------------------------------
-- 5. Permissions: functions are opt-in, as everywhere else (named one by one: anon keeps the
--    sign-in throttle, D-121). Replacing app.library_item_from_ai_result keeps its grants.
-- ---------------------------------------------------------------------------------------

revoke execute on function
  app.report_comment_bank_ai_input(uuid, uuid, jsonb),
  public.report_comment_bank_ai_preview(uuid, jsonb),
  public.request_report_comment_bank(uuid, jsonb),
  app.library_item_from_ai_result(uuid, uuid, uuid, boolean, jsonb, jsonb, uuid, uuid),
  app.report_comment_bank_from_job(public.ai_jobs),
  app.ai_jobs_apply_report_comment_bank()
from public, anon;

grant execute on function
  public.report_comment_bank_ai_preview(uuid, jsonb),
  public.request_report_comment_bank(uuid, jsonb)
to authenticated;
-- The input builder takes a user: the operator and tests only (service role). The trigger's
-- helpers are reached only through the worker's update of a job: no grants.
grant execute on function app.report_comment_bank_ai_input(uuid, uuid, jsonb) to service_role;
