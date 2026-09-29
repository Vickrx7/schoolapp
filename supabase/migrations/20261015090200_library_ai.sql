-- Phase 4: AI for the library (« Banque de ressources »). « Créer avec l'IA » writes a new
-- resource as a private draft of the teacher who asked; « Créer les versions manquantes avec
-- l'IA » adds versions for language levels to a resource she may edit.
--
--  1. The two features.
--  2. The request, built by the database from ids: the teacher sends ids and choices only, and
--     every label and text sent is read from the tables here (the preview returns exactly this).
--  3. Asking: the same school switch, budget and limits per person as every AI request
--     (app.enqueue_ai_job), plus the Library module, which the database checks because it spends.
--  4. Applying the answer: inside the worker's own update that records a finished job (like the
--     substitute plan's), so the worker needs no code of its own.
--  5. Permissions.
--
-- Error codes the app translates: LXA01 AI off, LXA02 budget reached, LXA03 too many requests,
-- LXL01 no base version (detail 'base'), LXL08 too large for the AI, LXL09 a level the resource
-- already has, LXL10 a personal level on a shared resource. A job whose answer cannot be applied
-- fails with 'invalidOutput', and a levels job whose resource changed since with 'libraryChanged'.
-- DECISIONS: D-072, D-073, D-074, D-078, D-079 (amending D-038 and D-042).
-- Tests: supabase/tests/18_library_ai.test.sql

-- ---------------------------------------------------------------------------------------
-- 1. The features. request_ai_job keeps its list (« Texte différencié » only): library jobs come
--    only through the functions below, which build their input themselves.
-- ---------------------------------------------------------------------------------------

alter table public.ai_jobs drop constraint ai_jobs_feature_check,
  add constraint ai_jobs_feature_check
    check (feature in ('differentiate', 'sub_plan', 'library_item', 'library_levels'));

-- An open levels request is found by its resource (a second tap returns it).
create index ai_jobs_library_levels_open_idx on public.ai_jobs (user_id, ((input ->> 'itemId')))
  where feature = 'library_levels' and status in ('queued', 'running');

-- ---------------------------------------------------------------------------------------
-- 2. Building the request
-- ---------------------------------------------------------------------------------------

-- Types that have versions per language level (@lynx/content TYPE_INFO.levelable).
create function app.library_type_levelable(p_type public.library_item_type)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_type not in ('lesson_plan', 'teacher_guide', 'rubric', 'brain_break', 'song',
    'parent_guide');
$$;

-- Types that are never used by a substitute (the library_items_sub_friendly_allowed check).
create function app.library_type_never_sub_friendly(p_type public.library_item_type)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_type in ('unit_test', 'diagnostic', 'rubric', 'parent_guide', 'teacher_guide', 'project');
$$;

-- Whether the user may spend AI on the library at a school: an active teacher, principal or
-- vice-principal there, where the Library module is licensed (D-078).
create function app.library_ai_school_allowed(p_user uuid, p_school_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null and p_school_id is not null
    and exists (
      select 1
      from public.user_roles ur
      join public.users u on u.id = ur.user_id and u.deactivated_at is null
      where ur.user_id = p_user and ur.school_id = p_school_id
        and ur.role in ('teacher', 'principal', 'vice_principal')
    )
    and app.school_has_module(p_school_id, 'library');
$$;

-- The levels asked for, as the AI input gives them: 0 to 6 (1 to 6 when `p_min` is 1) distinct
-- active levels of the board, board-wide or the user's own, board levels first, each in its
-- order, with keys L1…; `mostAccessible` marks the board's own most accessible level (its lowest
-- order), and no level when that one is not asked for. Raises 22023 for anything else.
create function app.library_ai_levels(p_user uuid, p_board_id uuid, p_level_ids uuid[], p_min integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_count integer := coalesce(cardinality(p_level_ids), 0);
  v_found integer;
  v_levels jsonb;
begin
  if v_count not between p_min and 6
    or (select count(distinct x) from unnest(coalesce(p_level_ids, '{}')) x) <> v_count
    or exists (select 1 from unnest(coalesce(p_level_ids, '{}')) x where x is null)
  then
    raise exception 'invalid levels' using errcode = '22023';
  end if;
  if v_count = 0 then
    return '[]'::jsonb;
  end if;

  select count(*),
    jsonb_agg(jsonb_build_object(
      'key', 'L' || t.n,
      'languageLevelId', t.id,
      'label', t.label_fr,
      'description', t.description_fr,
      'mostAccessible', t.most_accessible) order by t.n)
  into v_found, v_levels
  from (
    select ll.id, ll.label_fr, ll.description_fr,
      ll.owner_user_id is null and ll.sort_order = (
        select min(b.sort_order) from public.language_levels b
        where b.board_id = p_board_id and b.owner_user_id is null and b.active
      ) as most_accessible,
      row_number() over (order by ll.owner_user_id is not null, ll.sort_order, ll.label_fr, ll.id) as n
    from public.language_levels ll
    where ll.id = any (p_level_ids) and ll.board_id = p_board_id and ll.active
      and (ll.owner_user_id is null or ll.owner_user_id = p_user)
  ) t;
  if v_found <> v_count then
    raise exception 'invalid levels' using errcode = '22023';
  end if;
  return v_levels;
end;
$$;

-- The input of « Créer avec l'IA » for a request `{itemType, gradeCodes, subjectId,
-- expectationIds, levelIds, catholicReferenceId, durationMinutes, subFriendly, teacherNote}`
-- (D-072). Checks, in order: the user and school (42501), the type (22P02 when it is not one),
-- then every choice (22023). Labels, attente texts, level descriptions and the reference come
-- from the tables, never from the request. Service role only: it takes a user.
create function app.library_item_ai_input(p_user uuid, p_school_id uuid, p_request jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_board uuid;
  v_type public.library_item_type;
  v_grades text[];
  v_grade_labels jsonb;
  v_min_ordinal smallint;
  v_max_ordinal smallint;
  v_subject public.subjects;
  v_exp_ids uuid[];
  v_expectations jsonb;
  v_strand text;
  v_level_ids uuid[];
  v_levels jsonb;
  v_ref public.catholic_references;
  v_duration numeric;
  v_sub boolean;
  v_note text;
begin
  -- 1. Who and where.
  if not app.library_ai_school_allowed(p_user, p_school_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select s.board_id into v_board from public.schools s where s.id = p_school_id;
  if p_request is null or jsonb_typeof(p_request) <> 'object'
    or coalesce(jsonb_typeof(p_request -> 'gradeCodes'), 'null') <> 'array'
    or coalesce(jsonb_typeof(p_request -> 'expectationIds'), 'null') not in ('array', 'null')
    or coalesce(jsonb_typeof(p_request -> 'levelIds'), 'null') not in ('array', 'null')
    or coalesce(jsonb_typeof(p_request -> 'durationMinutes'), 'null') <> 'number'
    or coalesce(jsonb_typeof(p_request -> 'subFriendly'), 'null') not in ('boolean', 'null')
    or coalesce(jsonb_typeof(p_request -> 'teacherNote'), 'null') not in ('string', 'null')
    or nullif(p_request ->> 'itemType', '') is null
  then
    raise exception 'invalid request' using errcode = '22023';
  end if;

  -- 2. The type (an unknown one raises 22P02).
  v_type := (p_request ->> 'itemType')::public.library_item_type;

  -- 3. One or two existing grades.
  v_grades := array(select distinct x from jsonb_array_elements_text(p_request -> 'gradeCodes') x);
  if cardinality(v_grades) not between 1 and 2
    or cardinality(v_grades) <> jsonb_array_length(p_request -> 'gradeCodes')
    or (select count(*) from public.grades g where g.code = any (v_grades)) <> cardinality(v_grades)
  then
    raise exception 'invalid grades' using errcode = '22023';
  end if;
  -- In grade order, with their French labels (the content is French).
  select array_agg(g.code order by g.ordinal), jsonb_agg(g.label_fr order by g.ordinal),
    min(g.ordinal), max(g.ordinal)
  into v_grades, v_grade_labels, v_min_ordinal, v_max_ordinal
  from public.grades g where g.code = any (v_grades);

  -- 4. An active subject, standard or the board's, taught in those grades.
  select * into v_subject from public.subjects s
  where s.id = nullif(p_request ->> 'subjectId', '')::uuid and s.active
    and (s.board_id is null or s.board_id = v_board)
    and s.grade_min <= v_min_ordinal and s.grade_max >= v_max_ordinal;
  if v_subject.id is null then
    raise exception 'invalid subject' using errcode = '22023';
  end if;

  -- 5. Up to five attentes of that subject and those grades, in the order chosen (E1…); at
  --    least one, except for the types that may have none (D-067).
  v_exp_ids := array(
    select x::uuid from jsonb_array_elements_text(app.jsonb_array_or_empty(p_request -> 'expectationIds'))
      with ordinality t (x, n) order by n);
  if cardinality(v_exp_ids) > 5
    or (select count(distinct x) from unnest(v_exp_ids) x) <> cardinality(v_exp_ids)
    or (cardinality(v_exp_ids) = 0
      and v_type not in ('brain_break', 'catholic_reflection', 'culture_hook', 'song'))
    or exists (
      select 1 from unnest(v_exp_ids) e
      where not exists (
        select 1 from public.curriculum_expectations ce
        where ce.id = e and ce.subject_id = v_subject.id and ce.grade_code = any (v_grades)))
  then
    raise exception 'invalid attentes' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'key', 'E' || t.n, 'expectationId', ce.id, 'code', ce.code, 'text', ce.text_fr) order by t.n),
    '[]'::jsonb)
  into v_expectations
  from unnest(v_exp_ids) with ordinality t (id, n)
  join public.curriculum_expectations ce on ce.id = t.id;
  select st.label_fr into v_strand
  from public.curriculum_expectations ce
  join public.strands st on st.id = ce.strand_id
  where ce.id = v_exp_ids[1];

  -- 6. Levels, only for types that have them.
  v_level_ids := array(
    select x::uuid from jsonb_array_elements_text(app.jsonb_array_or_empty(p_request -> 'levelIds')) x);
  if cardinality(v_level_ids) > 0 and not app.library_type_levelable(v_type) then
    raise exception 'this type has no levels' using errcode = '22023';
  end if;
  v_levels := app.library_ai_levels(p_user, v_board, v_level_ids, 0);

  -- 7. The Catholic reference: global or the board's, active; required for a reflection.
  if nullif(p_request ->> 'catholicReferenceId', '') is not null then
    select * into v_ref from public.catholic_references r
    where r.id = (p_request ->> 'catholicReferenceId')::uuid and r.active
      and (r.board_id is null or r.board_id = v_board);
    if v_ref.id is null then
      raise exception 'invalid Catholic reference' using errcode = '22023';
    end if;
  elsif v_type = 'catholic_reflection' then
    raise exception 'a reflection needs a Catholic reference' using errcode = '22023';
  end if;

  -- 8. For a substitute: never assessments, rubrics, guides and projects.
  v_sub := coalesce((p_request ->> 'subFriendly')::boolean, false);
  if v_sub and app.library_type_never_sub_friendly(v_type) then
    raise exception 'never for a substitute' using errcode = '22023';
  end if;

  -- 9. Duration and the teacher's note.
  v_duration := (p_request ->> 'durationMinutes')::numeric;
  v_note := btrim(coalesce(p_request ->> 'teacherNote', ''));
  if v_duration not between 5 and 240 or v_duration <> trunc(v_duration)
    or char_length(v_note) > 1000
  then
    raise exception 'invalid duration or note' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'itemType', v_type,
    'gradeCodes', to_jsonb(v_grades),
    'gradeLabels', v_grade_labels,
    'subjectId', v_subject.id,
    'subjectLabel', v_subject.label_fr,
    'strandLabel', v_strand,
    'expectations', v_expectations,
    'levels', v_levels,
    'catholic', case when v_ref.id is not null then jsonb_build_object(
      'key', 'R1', 'referenceId', v_ref.id, 'type', v_ref.type, 'title', v_ref.title,
      'text', v_ref.text_fr) end,
    'durationMinutes', v_duration::integer,
    'subFriendly', v_sub,
    'teacherNote', v_note
  );
end;
$$;

-- The input of « Créer les versions manquantes avec l'IA » (D-073): for a resource the user may
-- edit, from a school where she may use the library's AI in its board, a type that has levels,
-- 1 to 6 levels it does not have yet (LXL09), and its base version (LXL01 'base'). Personal
-- levels keep a resource private (D-066): not on a shared one (LXL10). The base version is sent
-- with its key; one that would make the answer too long is refused (LXL08). Service role only.
create function app.library_levels_ai_input(
  p_user uuid,
  p_item_id uuid,
  p_school_id uuid,
  p_level_ids uuid[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_item public.library_items;
  v_levels jsonb;
  v_base public.library_item_versions;
  v_key jsonb;
  v_input jsonb;
begin
  select * into v_item from public.library_items where id = p_item_id;
  if v_item.id is null or not app.library_item_editable_by(p_user, v_item.id)
    or not app.library_ai_school_allowed(p_user, p_school_id)
    or not exists (select 1 from public.schools s where s.id = p_school_id and s.board_id = v_item.board_id)
  then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not app.library_type_levelable(v_item.type) then
    raise exception 'this type has no levels' using errcode = '22023';
  end if;
  v_levels := app.library_ai_levels(p_user, v_item.board_id, p_level_ids, 1);
  if exists (
    select 1 from public.library_item_versions lv
    where lv.item_id = v_item.id and lv.language_level_id = any (p_level_ids)
  ) then
    raise exception 'the resource already has a version for this level' using errcode = 'LXL09';
  end if;
  if v_item.share_scope <> 'private' and exists (
    select 1 from public.language_levels ll
    where ll.id = any (p_level_ids) and ll.owner_user_id is not null
  ) then
    raise exception 'personal levels on a shared item' using errcode = 'LXL10';
  end if;

  select * into v_base from public.library_item_versions lv
  where lv.item_id = v_item.id and lv.language_level_id is null;
  if v_base.id is null then
    raise exception 'not ready' using errcode = 'LXL01', detail = 'base';
  end if;
  select k.answer_key into v_key from public.library_item_answer_keys k where k.version_id = v_base.id;

  -- Each version is about the size of the base: 120,000 characters for all of them keeps the
  -- answer well inside the feature's max_tokens and the job's 13 minutes.
  if octet_length(jsonb_build_array(v_base.content, v_key)::text) * cardinality(p_level_ids) > 120000
  then
    raise exception 'too large for the AI' using errcode = 'LXL08';
  end if;

  v_input := jsonb_build_object(
    'itemId', v_item.id,
    'baseRevision', v_item.content_revision,
    'itemType', v_item.type,
    'gradeLabels', coalesce((
      select jsonb_agg(g.label_fr order by g.ordinal)
      from public.library_item_grades ig join public.grades g on g.code = ig.grade_code
      where ig.item_id = v_item.id), '[]'::jsonb),
    'subjectLabel', (select s.label_fr from public.subjects s where s.id = v_item.subject_id),
    'levels', v_levels,
    'base', jsonb_build_object('content', v_base.content, 'answerKey', v_key)
  );
  if pg_column_size(v_input) > 98304 then
    raise exception 'too large for the AI' using errcode = 'LXL08';
  end if;
  return v_input;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 3. Previews and requests (D-072: never automatic, always previewed; the preview is exactly
--    what the request stores). The school switch, budget and limits are app.enqueue_ai_job's.
-- ---------------------------------------------------------------------------------------

create function public.library_item_ai_preview(p_school_id uuid, p_request jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app.library_item_ai_input(app.active_user_id(), p_school_id, p_request);
$$;

create function public.request_library_item(p_school_id uuid, p_request jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.active_user_id();
  v_input jsonb := app.library_item_ai_input(v_user, p_school_id, p_request);
begin
  return app.enqueue_ai_job(v_user, p_school_id, 'library_item', v_input, 65536);
end;
$$;

create function public.library_levels_ai_preview(p_item_id uuid, p_school_id uuid, p_level_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app.library_levels_ai_input(app.active_user_id(), p_item_id, p_school_id, p_level_ids);
$$;

create function public.request_library_levels(p_item_id uuid, p_school_id uuid, p_level_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.active_user_id();
  v_input jsonb := app.library_levels_ai_input(v_user, p_item_id, p_school_id, p_level_ids);
  v_open uuid;
begin
  -- A second tap while the same request for this resource runs: that request.
  select j.id into v_open from public.ai_jobs j
  where j.user_id = v_user and j.feature = 'library_levels' and j.status in ('queued', 'running')
    and j.input ->> 'itemId' = p_item_id::text and j.input -> 'levels' = v_input -> 'levels'
  order by j.created_at desc
  limit 1;
  if v_open is not null then
    return v_open;
  end if;
  return app.enqueue_ai_job(v_user, p_school_id, 'library_levels', v_input, 98304);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 4. Applying the answer (D-072, D-073). The worker records a succeeded job with one update
--    (apps/worker/src/ai.ts finishJob: status, result, sent text, usage row); this trigger runs
--    inside it. An answer that cannot be stored turns the job into 'invalidOutput' and leaves
--    nothing behind; levels for a resource that changed since the request, 'libraryChanged'.
-- ---------------------------------------------------------------------------------------

-- A version and its key, for an item (the key only when it is an object).
create function app.library_insert_version(
  p_item_id uuid,
  p_level_id uuid,
  p_content jsonb,
  p_key jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version uuid;
begin
  if jsonb_typeof(p_content) is distinct from 'object' then
    raise exception 'invalid version content' using errcode = '22023';
  end if;
  insert into public.library_item_versions (item_id, language_level_id, schema_version, content)
  values (p_item_id, p_level_id, 1, p_content)
  returning id into v_version;
  if jsonb_typeof(p_key) = 'object' then
    insert into public.library_item_answer_keys (version_id, answer_key) values (v_version, p_key);
  end if;
end;
$$;

-- The draft of « Créer avec l'IA »: the requester's, private, `ai_generated`, with the usage
-- row's prompt version and model, the grades, attentes, subject and reference of the request,
-- and the answer's content (its base version, and each level version whose key maps to a level
-- the request asked for). Returns the new item's id; raises when the answer cannot be stored.
create function app.library_item_from_job(p_job public.ai_jobs)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb := p_job.result;
  v_input jsonb := p_job.input;
  v_type public.library_item_type := (p_job.input ->> 'itemType')::public.library_item_type;
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
  select * into v_gen from public.ai_generations where id = p_job.ai_generation_id;
  v_safety := case when v_type in ('experiment', 'stem_challenge')
    and jsonb_typeof(v_result -> 'safetyNotes') = 'object' then v_result -> 'safetyNotes' end;

  insert into public.library_items (
    id, board_id, school_id, type, title, summary, status, share_scope, source, author_id,
    subject_id, duration_minutes, materials, keywords, is_printable, is_projectable,
    is_interactive, sub_friendly, safety_notes, catholic_connection, catholic_reference_id,
    faith_content, prompt_version, model, ai_generation_id
  ) values (
    v_item, p_job.board_id, p_job.school_id, v_type,
    left(btrim(v_result ->> 'title'), 200),
    nullif(left(btrim(v_result ->> 'summary'), 1000), ''),
    'draft', 'private', 'ai_generated', p_job.user_id,
    (v_input ->> 'subjectId')::uuid,
    least(greatest(round((v_result ->> 'durationMinutes')::numeric), 1), 600)::smallint,
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
      and ll.board_id = p_job.board_id
    order by l.value ->> 'languageLevelId', r.n
  loop
    perform app.library_insert_version(v_item, v_level.level_id, v_level.content, v_level.answer_key);
  end loop;

  perform app.library_refresh_search(v_item);
  perform app.log_audit('library_item.generated', p_job.board_id, p_job.school_id, 'library_item',
    v_item, jsonb_build_object('ai_job_id', p_job.id, 'author_id', p_job.user_id));
  return v_item;
end;
$$;

-- The versions of « Créer les versions manquantes avec l'IA »: only while the requester may
-- still edit the resource and it has not changed since the request (its revision); levels it
-- has since received are skipped, and so are personal levels once it is shared. Returns how
-- many versions were added, or null when the resource changed; raises when the answer cannot be
-- stored.
create function app.library_levels_from_job(p_job public.ai_jobs)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.library_items;
  v_level record;
  v_count integer := 0;
begin
  if jsonb_typeof(p_job.result -> 'levels') is distinct from 'array' then
    raise exception 'unusable answer' using errcode = '22023';
  end if;
  select * into v_item from public.library_items
  where id = (p_job.input ->> 'itemId')::uuid
  for update;
  if v_item.id is null or not app.library_item_editable_by(p_job.user_id, v_item.id)
    or v_item.content_revision is distinct from (p_job.input ->> 'baseRevision')::integer
  then
    return null;
  end if;

  for v_level in
    select distinct on (l.value ->> 'languageLevelId') (l.value ->> 'languageLevelId')::uuid as level_id,
      r.value -> 'content' as content, r.value -> 'answerKey' as answer_key
    from jsonb_array_elements(p_job.result -> 'levels') with ordinality r (value, n)
    join jsonb_array_elements(app.jsonb_array_or_empty(p_job.input -> 'levels')) l
      on l.value ->> 'key' = btrim(r.value ->> 'level')
    join public.language_levels ll on ll.id = (l.value ->> 'languageLevelId')::uuid
      and ll.board_id = v_item.board_id
      and (ll.owner_user_id is null or (ll.owner_user_id = p_job.user_id and v_item.share_scope = 'private'))
    where not exists (
      select 1 from public.library_item_versions lv
      where lv.item_id = v_item.id and lv.language_level_id = ll.id
    )
    order by l.value ->> 'languageLevelId', r.n
  loop
    perform app.library_insert_version(v_item.id, v_level.level_id, v_level.content,
      v_level.answer_key);
    v_count := v_count + 1;
  end loop;

  if v_count > 0 then
    perform app.library_content_changed(v_item.id);
  end if;
  perform app.log_audit('library_item.levels_generated', v_item.board_id, p_job.school_id,
    'library_item', v_item.id, jsonb_build_object('ai_job_id', p_job.id, 'count', v_count));
  return v_count;
end;
$$;

-- The job's result keeps the answer and gains the resource's id (`itemId`), where the job page
-- goes next; a levels job also says how many versions were added (`levelsAdded`).
create function app.ai_jobs_apply_library()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item uuid;
  v_count integer;
begin
  begin
    if new.feature = 'library_item' then
      v_item := app.library_item_from_job(new);
      new.result := new.result || jsonb_build_object('itemId', v_item);
    else
      v_count := app.library_levels_from_job(new);
      if v_count is null then
        new.status := 'failed';
        new.error_code := 'libraryChanged';
      else
        new.result := new.result || jsonb_build_object('itemId', new.input ->> 'itemId',
          'levelsAdded', v_count);
      end if;
    end if;
  exception when others then
    -- The code only: an error message could quote the answer.
    raise warning 'library AI answer not stored (job %, %)', new.id, sqlstate;
    new.status := 'failed';
    new.error_code := 'invalidOutput';
    if new.feature = 'library_item' then
      new.result := null;
    end if;
  end;
  return new;
end;
$$;

create trigger ai_jobs_apply_library before update of status on public.ai_jobs
  for each row
  when (new.feature in ('library_item', 'library_levels') and new.status = 'succeeded'
        and old.status is distinct from 'succeeded')
  execute function app.ai_jobs_apply_library();

-- ---------------------------------------------------------------------------------------
-- 5. Permissions: functions are opt-in, as everywhere else.
-- ---------------------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon;

grant execute on function
  public.library_item_ai_preview(uuid, jsonb),
  public.request_library_item(uuid, jsonb),
  public.library_levels_ai_preview(uuid, uuid, uuid[]),
  public.request_library_levels(uuid, uuid, uuid[])
to authenticated;
-- The input builders take a user: the operator and tests only (service role). The trigger's
-- helpers are reached only through the worker's update of a job: no grants.
grant execute on function
  app.library_item_ai_input(uuid, uuid, jsonb),
  app.library_levels_ai_input(uuid, uuid, uuid, uuid[])
to service_role;
