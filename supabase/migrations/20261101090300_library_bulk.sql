-- Phase 5: bulk generation of board drafts (« Génération en lot »). The operator plans a run for
-- one board (`pnpm admin bulk-plan`: attentes × types, what the board already has left out), starts
-- it, and the worker sends it to the provider as one Message Batches API batch sized to the run's
-- hard cost cap. Each answer becomes a board-owned draft that the board's content reviewers review
-- in « Brouillons du conseil » and approve in one step (« Approuver pour le conseil »).
--
--  1. Runs and their requests (one per attente and type), and the drafts' run.
--  2. Phase 4 refactors, same behaviour: the AI input built for a board without a user (bulk
--     requests have no teacher), and the draft built from an answer for any author, the board
--     included. « Créer avec l'IA » calls them as before.
--  3. Planning: attentes × types, deduplicated against what the board has (D-097).
--  4. Starting and cancelling (the operator).
--  5. The worker's steps: submitting (the cap is applied by the worker, which counts tokens),
--     recording each answer (usage, cost, the draft, « titre semblable »), finishing a run.
--  6. « Approuver pour le conseil » for a board draft, in one step (content reviewers).
--  7. Daily clean-up.
--  8. Permissions.
--
-- Nothing personal is stored or sent: requests are built from ids (curriculum labels, board
-- levels, the operator's note and the titles of the board's own or board-wide items); the worker
-- de-identifies them with everyone of the board before sending (D-098). `sent_text` keeps exactly
-- what was sent for 30 days, then only its SHA-256.
--
-- Error codes the CLI translates: LXA01 the board does not allow AI, LXB01 the run is not in the
-- right state, LXB02 more than 500 requests in one run, LXB03 the board already has a planned or
-- running run. Worker failure codes (requests and runs): personalInfo, invalidInput, invalidOutput,
-- aiRefused, aiTooLong, batch_invalid_request, batch_server_error, batch_expired, batch_canceled,
-- batch_missing, redaction_changed, submitFailed, submitUnconfirmed, aiUnavailable, aiDisabled,
-- overLimit.
-- DECISIONS: D-095, D-096, D-097, D-098, D-101 (amending D-037, D-041 and D-091).
-- Tests: supabase/tests/24_library_bulk.test.sql

-- ---------------------------------------------------------------------------------------
-- 1. Runs and requests
-- ---------------------------------------------------------------------------------------

create table public.library_bulk_runs (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  status text not null default 'planned'
    check (status in ('planned', 'running', 'completed', 'cancelled', 'failed')),
  -- What the operator asked (grades, subject, types, filters, levels…): ids and codes only.
  params jsonb not null check (jsonb_typeof(params) = 'object' and pg_column_size(params) <= 16384),
  note text check (char_length(note) <= 1000),
  -- The hard cap (D-096): the worker sends only what fits, at its worst case.
  max_cost_usd numeric(10, 2) not null check (max_cost_usd > 0 and max_cost_usd <= 1000),
  worst_case_usd numeric(12, 6),
  spent_usd numeric(12, 6) not null default 0 check (spent_usd >= 0),
  -- Requests planned (to send) when the run was planned.
  request_count integer not null default 0 check (request_count >= 0),
  batch_id text check (char_length(batch_id) <= 120),
  submit_started_at timestamptz,
  cancel_requested_at timestamptz,
  cancel_sent_at timestamptz,
  report jsonb check (report is null or jsonb_typeof(report) = 'object'),
  error_code text check (char_length(error_code) <= 80),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);

create index library_bulk_runs_board_idx on public.library_bulk_runs (board_id, created_at desc);
-- One active run per board (D-097): two runs never claim the same attente and type.
create unique index library_bulk_runs_one_active on public.library_bulk_runs (board_id)
  where status in ('planned', 'running');
create trigger library_bulk_runs_touch before update on public.library_bulk_runs
  for each row execute function app.touch_updated_at();

create table public.library_bulk_requests (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.library_bulk_runs (id) on delete cascade,
  expectation_id uuid references public.curriculum_expectations (id) on delete set null,
  item_type public.library_item_type not null,
  -- `app.library_item_ai_input_for_board`'s input ('{}' for a pair already covered).
  input jsonb not null check (jsonb_typeof(input) = 'object' and pg_column_size(input) <= 65536),
  status text not null default 'planned'
    check (status in ('planned', 'skipped', 'submitted', 'created', 'failed')),
  -- covered | cost_cap | cancelled | a failure code.
  reason text check (char_length(reason) <= 80),
  worst_case_usd numeric(10, 6),
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  sent_sha256 text check (sent_sha256 ~ '^[0-9a-f]{64}$'),
  -- Exactly what was sent (de-identified); cleared after 30 days, the hash stays (D-098).
  sent_text text check (char_length(sent_text) <= 200000),
  -- Codes for the reviewer, e.g. similar_title, student_name; never content.
  problems text[] not null default '{}' check (cardinality(problems) <= 20),
  item_id uuid references public.library_items (id) on delete set null,
  ai_generation_id uuid references public.ai_generations (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, expectation_id, item_type)
);

create index library_bulk_requests_expectation_idx on public.library_bulk_requests (expectation_id);
create index library_bulk_requests_item_idx on public.library_bulk_requests (item_id);
create index library_bulk_requests_generation_idx on public.library_bulk_requests (ai_generation_id);
create trigger library_bulk_requests_touch before update on public.library_bulk_requests
  for each row execute function app.touch_updated_at();

-- The run a board draft came from (« Brouillons du conseil » groups them by run).
alter table public.library_items
  add column bulk_run_id uuid references public.library_bulk_runs (id) on delete set null;
create index library_items_bulk_run_id_idx on public.library_items (bulk_run_id);

-- The board's content reviewers see its runs and requests (not their inputs or what was sent);
-- only the operator (service role) and the worker write them.
alter table public.library_bulk_runs enable row level security;
alter table public.library_bulk_requests enable row level security;
revoke all on public.library_bulk_runs, public.library_bulk_requests from anon, authenticated;
create policy library_bulk_runs_select on public.library_bulk_runs
  for select to authenticated
  using (app.am_library_reviewer(board_id, 'content'));
create policy library_bulk_requests_select on public.library_bulk_requests
  for select to authenticated
  using (run_id in (select r.id from public.library_bulk_runs r));
grant select (id, board_id, status, max_cost_usd, spent_usd, request_count, report, created_at,
  started_at, finished_at) on public.library_bulk_runs to authenticated;
grant select (id, run_id, expectation_id, item_type, status, reason, problems, item_id)
  on public.library_bulk_requests to authenticated;

-- ---------------------------------------------------------------------------------------
-- 2. Phase 4 refactors (same behaviour; supabase/tests/18_library_ai.test.sql stays green)
-- ---------------------------------------------------------------------------------------

-- The input of « Créer avec l'IA » for a board (D-072), checks 2 to 9 of
-- app.library_item_ai_input: the request's shape (22023), the type (22P02 when it is not one),
-- then every choice (22023). Labels, attente texts, level descriptions and the reference come from
-- the tables. With `p_user` null (bulk generation, D-095) only the board's own levels are allowed.
-- Service role only.
create function app.library_item_ai_input_for_board(p_board_id uuid, p_user uuid, p_request jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_board uuid := p_board_id;
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
  if v_board is null or not exists (select 1 from public.boards b where b.id = v_board) then
    raise exception 'unknown board' using errcode = '22023';
  end if;
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

  -- 6. Levels, only for types that have them (the board's, and the user's own when there is one).
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

  -- 9. Duration and the note.
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

-- « Créer avec l'IA » (D-072): check 1 (the user may use the library's AI at the school), then the
-- board's checks. Same signature and results as Phase 4's.
create or replace function app.library_item_ai_input(p_user uuid, p_school_id uuid, p_request jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- 1. Who and where.
  if not app.library_ai_school_allowed(p_user, p_school_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return app.library_item_ai_input_for_board(
    (select s.board_id from public.schools s where s.id = p_school_id), p_user, p_request);
end;
$$;

-- The draft built from an answer of the `library_item` feature (D-072), for any author: a
-- teacher's private draft (« Créer avec l'IA »: her school, her id) or the board's own draft (bulk
-- generation: no school, no author, `board_owned`, its run). Private, `ai_generated`, with the
-- usage row's prompt version and model, the request's grades, attentes, subject and reference,
-- and the answer's base version and each level version whose key maps to a level the request
-- asked for. Returns the new item's id; raises when the answer cannot be stored. The caller
-- audits.
create function app.library_item_from_ai_result(
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
      and ll.board_id = p_board_id
    order by l.value ->> 'languageLevelId', r.n
  loop
    perform app.library_insert_version(v_item, v_level.level_id, v_level.content, v_level.answer_key);
  end loop;

  perform app.library_refresh_search(v_item);
  return v_item;
end;
$$;

-- The draft of « Créer avec l'IA »: the requester's (Phase 4's function, now a wrapper).
create or replace function app.library_item_from_job(p_job public.ai_jobs)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item uuid;
begin
  v_item := app.library_item_from_ai_result(p_job.board_id, p_job.school_id, p_job.user_id, false,
    p_job.input, p_job.result, p_job.ai_generation_id, null);
  perform app.log_audit('library_item.generated', p_job.board_id, p_job.school_id, 'library_item',
    v_item, jsonb_build_object('ai_job_id', p_job.id, 'author_id', p_job.user_id));
  return v_item;
end;
$$;

-- A title for comparing (D-097): lower case, without accents, punctuation or extra spaces.
create function app.library_norm_title(p text)
returns text
language sql
stable
set search_path = ''
as $$
  select btrim(regexp_replace(lower(extensions.unaccent('extensions.unaccent'::regdictionary,
    coalesce(p, ''))), '[^[:alnum:]]+', ' ', 'g'));
$$;

-- Whether the board allows AI (its settings, read the way request_ai_job reads them).
create function app.library_bulk_ai_allowed(p_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select a.allowed from public.boards b cross join app.board_ai_settings(b.settings) a
    where b.id = p_board_id), false);
$$;

-- Who is acting: the operator (the service role PostgREST switches to for the service key), or
-- the worker (recorded as the system).
create function app.library_bulk_actor()
returns public.audit_actor_type
language sql
stable
set search_path = ''
as $$
  select case when coalesce(current_setting('role', true), '') = 'service_role'
    then 'service'::public.audit_actor_type else 'user'::public.audit_actor_type end;
$$;

-- ---------------------------------------------------------------------------------------
-- 3. Planning (D-095, D-097)
-- ---------------------------------------------------------------------------------------

-- A run for a board: for each target attente and each type, a request, or the pair left out as
-- `skipped/covered` when the board already has at least `perExpectation` items of that type
-- linked directly to the attente (board-approved items, board-shared reviewed items and the
-- board's own drafts, archived ones left out; school-shared items do not count).
--
-- `p_params`: {gradeCodes: 1 or 2 grades, subjectId, types: 1 to 6 types, levels: 'all' | 'none'
-- (default 'none'), perExpectation: 1 to 3 (default 1), subFriendly (default false), durations:
-- {type: minutes} (the type's default, from the CLI), and at most one filter of strandCodes,
-- expectationCodes or fromCoverage: {minApproved: 1 to 5}}. The targets are the coverage units of
-- the grades and subject (specific attentes, and overall attentes without children, D-094),
-- filtered. Each request is for its attente's own grade.
--
-- Refuses 22023 for anything unexpected (Catholic reflections and the Enseignement religieux
-- subject included: faith content is generated one item at a time), LXA01 when the board does not
-- allow AI, LXB03 when it already has a planned or running run, 23514 for a cap outside 0 to 1,000,
-- and LXB02 for more than 500 requests to send. Returns {runId, planned, skipped: {covered},
-- byType: {type: {planned, covered}}}.
create function public.library_bulk_plan(
  p_board_id uuid,
  p_params jsonb,
  p_max_cost_usd numeric,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_board public.boards;
  v_subject public.subjects;
  v_grades text[];
  v_types public.library_item_type[];
  v_type public.library_item_type;
  v_levels text := coalesce(p_params ->> 'levels', 'none');
  v_per integer;
  v_sub boolean;
  v_strands text[];
  v_codes text[];
  v_min integer;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_board_levels jsonb;
  v_run uuid;
  v_target record;
  v_count integer;
  v_titles text[];
  v_title text;
  v_teacher_note text;
  v_existing text;
  v_duration jsonb;
  v_planned integer := 0;
  v_covered integer := 0;
  v_by_type jsonb := '{}'::jsonb;
  v_unknown text;
  v_targets uuid[];
  v_coverage jsonb;
begin
  -- 1. The board and the parameters.
  select * into v_board from public.boards where id = p_board_id;
  if v_board.id is null or p_params is null or jsonb_typeof(p_params) <> 'object'
    or coalesce(jsonb_typeof(p_params -> 'gradeCodes'), 'null') <> 'array'
    or coalesce(jsonb_typeof(p_params -> 'types'), 'null') <> 'array'
    or coalesce(jsonb_typeof(p_params -> 'durations'), 'null') <> 'object'
    or coalesce(jsonb_typeof(p_params -> 'strandCodes'), 'null') not in ('array', 'null')
    or coalesce(jsonb_typeof(p_params -> 'expectationCodes'), 'null') not in ('array', 'null')
    or coalesce(jsonb_typeof(p_params -> 'fromCoverage'), 'null') not in ('object', 'null')
    or coalesce(jsonb_typeof(p_params -> 'perExpectation'), 'null') not in ('number', 'null')
    or coalesce(jsonb_typeof(p_params -> 'subFriendly'), 'null') not in ('boolean', 'null')
    or v_levels not in ('all', 'none')
    or char_length(v_note) > 1000
    or pg_column_size(p_params) > 16384
  then
    raise exception 'invalid plan' using errcode = '22023';
  end if;

  v_grades := array(select distinct x from jsonb_array_elements_text(p_params -> 'gradeCodes') x);
  if cardinality(v_grades) not between 1 and 2
    or cardinality(v_grades) <> jsonb_array_length(p_params -> 'gradeCodes')
    or (select count(*) from public.grades g where g.code = any (v_grades)) <> cardinality(v_grades)
  then
    raise exception 'invalid grades' using errcode = '22023';
  end if;

  -- Types: 1 to 6 known types, never a Catholic reflection (checked before any cast).
  if jsonb_array_length(p_params -> 'types') not between 1 and 6
    or (select count(distinct x) from jsonb_array_elements_text(p_params -> 'types') x)
      <> jsonb_array_length(p_params -> 'types')
    or exists (
      select 1 from jsonb_array_elements_text(p_params -> 'types') x
      where x not in (select e::text from unnest(enum_range(null::public.library_item_type)) e)
        or x = 'catholic_reflection')
  then
    raise exception 'invalid types' using errcode = '22023';
  end if;
  v_types := array(
    select x::public.library_item_type
    from jsonb_array_elements_text(p_params -> 'types') with ordinality t (x, n) order by n);

  -- An active subject, standard or the board's; never Enseignement religieux (D-095).
  select * into v_subject from public.subjects s
  where s.id = case when (p_params ->> 'subjectId') ~ '^[0-9a-fA-F-]{36}$'
      then (p_params ->> 'subjectId')::uuid end
    and s.active and (s.board_id is null or s.board_id = p_board_id);
  if v_subject.id is null or v_subject.code = 'ere' then
    raise exception 'invalid subject' using errcode = '22023';
  end if;

  v_per := coalesce((p_params ->> 'perExpectation')::numeric, 1);
  if v_per not between 1 and 3 or v_per <> (p_params ->> 'perExpectation')::numeric then
    raise exception 'invalid perExpectation' using errcode = '22023';
  end if;
  v_sub := coalesce((p_params ->> 'subFriendly')::boolean, false);

  if p_params ? 'strandCodes' and jsonb_typeof(p_params -> 'strandCodes') = 'array' then
    v_strands := array(select x from jsonb_array_elements_text(p_params -> 'strandCodes') x);
  end if;
  if p_params ? 'expectationCodes' and jsonb_typeof(p_params -> 'expectationCodes') = 'array' then
    v_codes := array(select btrim(x) from jsonb_array_elements_text(p_params -> 'expectationCodes') x);
  end if;
  if jsonb_typeof(p_params -> 'fromCoverage') = 'object' then
    if coalesce(jsonb_typeof(p_params #> '{fromCoverage,minApproved}'), 'null') <> 'number' then
      raise exception 'invalid fromCoverage' using errcode = '22023';
    end if;
    v_min := (p_params #>> '{fromCoverage,minApproved}')::numeric;
    if v_min not between 1 and 5 or v_min <> (p_params #>> '{fromCoverage,minApproved}')::numeric then
      raise exception 'invalid fromCoverage' using errcode = '22023';
    end if;
  end if;
  if (v_codes is not null)::int + (v_strands is not null)::int + (v_min is not null)::int > 1
    or cardinality(v_codes) = 0 or cardinality(v_strands) = 0 or cardinality(v_codes) > 200
  then
    raise exception 'one filter at most' using errcode = '22023';
  end if;

  -- Every type's duration, from the CLI (the type's default).
  foreach v_type in array v_types loop
    v_duration := p_params #> array['durations', v_type::text];
    if coalesce(jsonb_typeof(v_duration), 'null') <> 'number' then
      raise exception 'missing duration' using errcode = '22023', detail = v_type::text;
    end if;
  end loop;

  -- 2. The board allows AI, and has no other active run.
  if not app.library_bulk_ai_allowed(p_board_id) then
    raise exception 'AI is off for this board' using errcode = 'LXA01';
  end if;
  if exists (
    select 1 from public.library_bulk_runs r
    where r.board_id = p_board_id and r.status in ('planned', 'running')
  ) then
    raise exception 'the board already has an active run' using errcode = 'LXB03';
  end if;

  -- 3. The run (the cap is checked by the table: 23514).
  insert into public.library_bulk_runs (board_id, params, note, max_cost_usd)
  values (p_board_id, p_params, v_note, p_max_cost_usd)
  returning id into v_run;

  -- The board's levels, when versions per level are asked for (the types that have them).
  select coalesce(jsonb_agg(ll.id order by ll.sort_order, ll.label_fr, ll.id), '[]'::jsonb)
  into v_board_levels
  from public.language_levels ll
  where ll.board_id = p_board_id and ll.owner_user_id is null and ll.active;

  -- 4. The targets: coverage units of the grades and subject (D-094), filtered, in curriculum
  --    order. With --from-coverage, those with fewer approved items than the threshold.
  if v_min is not null then
    select coalesce(jsonb_object_agg(c.expectation_id, c.approved_count), '{}'::jsonb)
    into v_coverage
    from app.library_coverage_rows(p_board_id, null, v_subject.id) c;
  end if;
  v_targets := array(
    select e.id
    from public.curriculum_expectations e
    join public.grades g on g.code = e.grade_code
    left join public.strands st on st.id = e.strand_id
    where e.subject_id = v_subject.id and e.grade_code = any (v_grades)
      and (e.kind = 'specific'
        or not exists (select 1 from public.curriculum_expectations c where c.parent_id = e.id))
      and (v_strands is null or st.code = any (v_strands))
      and (v_codes is null or e.code = any (v_codes))
      and (v_min is null or coalesce((v_coverage ->> e.id::text)::integer, 0) < v_min)
    order by g.ordinal, e.sort_order, e.code, e.id);

  if v_codes is not null then
    select c into v_unknown from unnest(v_codes) c
    where not exists (
      select 1 from public.curriculum_expectations e where e.id = any (v_targets) and e.code = c)
    limit 1;
    if v_unknown is not null then
      raise exception 'unknown attente' using errcode = '22023', detail = left(v_unknown, 40);
    end if;
  end if;
  if cardinality(v_targets) = 0 then
    raise exception 'no attente to target' using errcode = '22023', detail = 'no_targets';
  end if;

  -- 5. A request per attente and type, in curriculum order.
  for v_target in
    select e.id, e.code, e.grade_code
    from unnest(v_targets) with ordinality t (id, n)
    join public.curriculum_expectations e on e.id = t.id
    order by t.n
  loop
    foreach v_type in array v_types loop
      -- What the board already has for this attente and type: its titles go to the model.
      select count(*), coalesce(array_agg(i.title order by i.status = 'board_approved' desc,
          i.updated_at desc), '{}')
      into v_count, v_titles
      from public.library_item_expectations le
      join public.library_items i on i.id = le.item_id
      where le.expectation_id = v_target.id and i.board_id = p_board_id and i.type = v_type
        and i.status <> 'archived'
        and (i.status = 'board_approved' or (i.status = 'teacher_reviewed' and i.share_scope = 'board')
          or i.board_owned);
      if v_count >= v_per then
        insert into public.library_bulk_requests (run_id, expectation_id, item_type, input, status, reason)
        values (v_run, v_target.id, v_type, '{}'::jsonb, 'skipped', 'covered');
        v_covered := v_covered + 1;
        v_by_type := jsonb_set(v_by_type, array[v_type::text],
          coalesce(v_by_type -> v_type::text, '{"planned": 0, "covered": 0}'::jsonb)
            || jsonb_build_object('covered',
              coalesce((v_by_type #>> array[v_type::text, 'covered'])::integer, 0) + 1));
        continue;
      end if;

      -- The operator's note, then the existing titles, within 1,000 characters.
      v_teacher_note := coalesce(v_note, '');
      v_existing := null;
      foreach v_title in array v_titles loop
        if char_length(coalesce(v_existing, '') || '« ' || v_title || ' » ; ')
          + char_length(v_teacher_note) + 60 > 1000
        then
          exit;
        end if;
        v_existing := coalesce(v_existing || ' ; ', '') || '« ' || v_title || ' »';
      end loop;
      if v_existing is not null then
        v_teacher_note := concat_ws(E'\n', nullif(v_teacher_note, ''),
          'Ressources existantes à ne pas reprendre : ' || v_existing || '.');
      end if;

      insert into public.library_bulk_requests (run_id, expectation_id, item_type, input)
      values (v_run, v_target.id, v_type, app.library_item_ai_input_for_board(p_board_id, null,
        jsonb_build_object(
          'itemType', v_type,
          'gradeCodes', jsonb_build_array(v_target.grade_code),
          'subjectId', v_subject.id,
          'expectationIds', jsonb_build_array(v_target.id),
          'levelIds', case when v_levels = 'all' and app.library_type_levelable(v_type)
            then v_board_levels else '[]'::jsonb end,
          'catholicReferenceId', null,
          'durationMinutes', p_params #> array['durations', v_type::text],
          'subFriendly', v_sub and not app.library_type_never_sub_friendly(v_type),
          'teacherNote', v_teacher_note)));
      v_planned := v_planned + 1;
      v_by_type := jsonb_set(v_by_type, array[v_type::text],
        coalesce(v_by_type -> v_type::text, '{"planned": 0, "covered": 0}'::jsonb)
          || jsonb_build_object('planned',
            coalesce((v_by_type #>> array[v_type::text, 'planned'])::integer, 0) + 1));
    end loop;
  end loop;

  if v_planned > 500 then
    raise exception 'too many requests for one run' using errcode = 'LXB02',
      detail = v_planned::text;
  end if;
  update public.library_bulk_runs set request_count = v_planned where id = v_run;
  perform app.log_audit('library_bulk_run.planned', p_board_id, null, 'library_bulk_run', v_run,
    jsonb_build_object('max_cost_usd', p_max_cost_usd, 'request_count', v_planned,
      'covered', v_covered), app.library_bulk_actor());

  return jsonb_build_object('runId', v_run, 'planned', v_planned,
    'skipped', jsonb_build_object('covered', v_covered), 'byType', v_by_type);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 4. Starting and cancelling (the operator)
-- ---------------------------------------------------------------------------------------

-- planned → running. The event wakes the worker (D-101). 22023 for an unknown run, LXB01 for a run
-- that is not planned, LXA01 when the board no longer allows AI.
create function public.library_bulk_start(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.library_bulk_runs;
begin
  select * into v from public.library_bulk_runs where id = p_run_id for update;
  if v.id is null then
    raise exception 'unknown run' using errcode = '22023';
  end if;
  if v.status <> 'planned' then
    raise exception 'the run is not planned' using errcode = 'LXB01';
  end if;
  if not app.library_bulk_ai_allowed(v.board_id) then
    raise exception 'AI is off for this board' using errcode = 'LXA01';
  end if;
  update public.library_bulk_runs set status = 'running', started_at = now() where id = v.id;
  perform app.log_audit('library_bulk_run.started', v.board_id, null, 'library_bulk_run', v.id,
    jsonb_build_object('max_cost_usd', v.max_cost_usd, 'request_count', v.request_count),
    app.library_bulk_actor());
  perform app.emit_event('library_bulk_run.started', v.board_id, null, 'library_bulk_run', v.id,
    jsonb_build_object('runId', v.id));
end;
$$;

-- A planned run is cancelled at once (its requests `skipped/cancelled`). A running run is asked to
-- stop: the worker cancels its batch (answers already made are still recorded and billed), or,
-- before submission, cancels the run. LXB01 for a run that has ended.
create function public.library_bulk_cancel(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.library_bulk_runs;
begin
  select * into v from public.library_bulk_runs where id = p_run_id for update;
  if v.id is null then
    raise exception 'unknown run' using errcode = '22023';
  end if;
  if v.status = 'planned' then
    perform app.library_bulk_finish(v.id, 'cancelled');
  elsif v.status = 'running' then
    if v.cancel_requested_at is null then
      update public.library_bulk_runs set cancel_requested_at = now() where id = v.id;
      perform app.log_audit('library_bulk_run.cancel_requested', v.board_id, null,
        'library_bulk_run', v.id, '{}'::jsonb, app.library_bulk_actor());
      perform app.emit_event('library_bulk_run.cancel_requested', v.board_id, null,
        'library_bulk_run', v.id, jsonb_build_object('runId', v.id));
    end if;
  else
    raise exception 'the run has ended' using errcode = 'LXB01';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 5. The worker's steps (apps/worker/src/library-bulk.ts)
-- ---------------------------------------------------------------------------------------

-- Before the batch is sent, in one step: the requests the worker could not prepare fail
-- (`p_failed`: [{id, reason}]), those that fit the cap become `submitted` with their worst case
-- and exactly what is sent (`p_sent`: [{id, worstCaseUsd, sentSha256, sentText}]), and the rest
-- are `skipped/cost_cap`. Marks the run as being submitted: if the worker stops before it records
-- the batch id, the daily clean-up fails the run (`submitUnconfirmed`) and nothing is sent again.
-- Returns how many requests are submitted. LXB01 unless the run is running and not yet submitted.
create function app.library_bulk_mark_submitting(p_run_id uuid, p_sent jsonb, p_failed jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.library_bulk_runs;
  v_count integer;
begin
  select * into v from public.library_bulk_runs where id = p_run_id for update;
  if v.id is null or v.status <> 'running' or v.submit_started_at is not null
    or v.batch_id is not null
  then
    raise exception 'the run cannot be submitted' using errcode = 'LXB01';
  end if;
  update public.library_bulk_requests r
  set status = 'failed', reason = left(coalesce(f ->> 'reason', 'invalidInput'), 80)
  from jsonb_array_elements(app.jsonb_array_or_empty(p_failed)) f
  where r.run_id = p_run_id and r.status = 'planned' and r.id = (f ->> 'id')::uuid;
  update public.library_bulk_requests r
  set status = 'submitted', worst_case_usd = (s ->> 'worstCaseUsd')::numeric,
      sent_sha256 = s ->> 'sentSha256', sent_text = s ->> 'sentText'
  from jsonb_array_elements(app.jsonb_array_or_empty(p_sent)) s
  where r.run_id = p_run_id and r.status = 'planned' and r.id = (s ->> 'id')::uuid;
  get diagnostics v_count = row_count;
  update public.library_bulk_requests
  set status = 'skipped', reason = 'cost_cap'
  where run_id = p_run_id and status = 'planned';
  update public.library_bulk_runs
  set submit_started_at = now(),
      worst_case_usd = (select coalesce(sum(r.worst_case_usd), 0) from public.library_bulk_requests r
        where r.run_id = p_run_id and r.status = 'submitted')
  where id = p_run_id;
  return v_count;
end;
$$;

-- The board's draft for a bulk answer (D-095): `board_owned`, no author, no school, private, its
-- run, and provenance from the usage row. « Titre semblable » (D-097): a non-archived board-visible
-- item of the same type with the same normalized title keeps the draft (it was paid for) and flags
-- it for the reviewer. Raises when the answer cannot be stored.
create function app.library_item_from_bulk(p_request_id uuid, p_output jsonb, p_generation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.library_bulk_requests;
  v_run public.library_bulk_runs;
  v_item uuid;
  v_new public.library_items;
begin
  select * into v_req from public.library_bulk_requests where id = p_request_id;
  select * into v_run from public.library_bulk_runs where id = v_req.run_id;
  if v_req.id is null or v_run.id is null then
    raise exception 'unknown request' using errcode = '22023';
  end if;
  v_item := app.library_item_from_ai_result(v_run.board_id, null, null, true, v_req.input,
    p_output, p_generation_id, v_run.id);
  select * into v_new from public.library_items where id = v_item;
  if exists (
    select 1 from public.library_items i
    where i.board_id = v_run.board_id and i.id <> v_item and i.type = v_new.type
      and i.status <> 'archived' and (i.board_owned or i.share_scope = 'board')
      and app.library_norm_title(i.title) = app.library_norm_title(v_new.title)
  ) then
    update public.library_bulk_requests
    set problems = array_append(problems, 'similar_title')
    where id = p_request_id and not ('similar_title' = any (problems));
  end if;
  perform app.log_audit('library_item.generated', v_run.board_id, null, 'library_item', v_item,
    jsonb_build_object('bulk_run_id', v_run.id));
  return v_item;
end;
$$;

-- One answer of a batch, in one transaction and only while its request is `submitted` (else
-- 'already': a result read again after a restart). `p_generation` is the usage row ({provider,
-- model, promptVersion, inputTokens, outputTokens, cacheReadTokens, costUsd, status, latencyMs,
-- providerRequestId}; null when nothing came back): recorded for the board with no school or user
-- and the run's batch id, and its cost added to the run. With an output (already checked by the
-- worker), the board's draft → 'created'; otherwise, or when the draft cannot be stored
-- (`invalidOutput`), 'failed' with the code. `p_problems` adds codes for the reviewer.
create function app.library_bulk_record_result(
  p_request_id uuid,
  p_generation jsonb,
  p_output jsonb,
  p_error text,
  p_problems text[] default '{}'
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.library_bulk_requests;
  v_run public.library_bulk_runs;
  v_gen uuid;
  v_cost numeric := 0;
  v_item uuid;
  v_error text := nullif(btrim(coalesce(p_error, '')), '');
begin
  select * into v_req from public.library_bulk_requests where id = p_request_id for update;
  if v_req.id is null or v_req.status <> 'submitted' then
    return 'already';
  end if;
  select * into v_run from public.library_bulk_runs where id = v_req.run_id for update;

  if jsonb_typeof(p_generation) = 'object' then
    v_cost := greatest(coalesce((p_generation ->> 'costUsd')::numeric, 0), 0);
    insert into public.ai_generations (
      board_id, school_id, user_id, feature, prompt_version, provider, model, input_tokens,
      output_tokens, cache_read_tokens, latency_ms, estimated_cost_usd, status, error_code,
      batch_id, provider_request_id
    ) values (
      v_run.board_id, null, null, 'library_item',
      left(coalesce(p_generation ->> 'promptVersion', 'v1'), 40),
      left(coalesce(p_generation ->> 'provider', 'unknown'), 40),
      left(coalesce(p_generation ->> 'model', 'unknown'), 80),
      greatest(coalesce((p_generation ->> 'inputTokens')::integer, 0), 0),
      greatest(coalesce((p_generation ->> 'outputTokens')::integer, 0), 0),
      greatest(coalesce((p_generation ->> 'cacheReadTokens')::integer, 0), 0),
      case when jsonb_typeof(p_generation -> 'latencyMs') = 'number'
        then greatest((p_generation ->> 'latencyMs')::integer, 0) end,
      v_cost,
      coalesce(p_generation ->> 'status',
        case when p_output is null then 'failed' else 'succeeded' end)::public.ai_generation_status,
      left(v_error, 80), v_run.batch_id,
      left(p_generation ->> 'providerRequestId', 120)
    )
    returning id into v_gen;
    update public.library_bulk_runs set spent_usd = spent_usd + v_cost where id = v_run.id;
  end if;

  if jsonb_typeof(p_output) = 'object' and v_error is null then
    begin
      v_item := app.library_item_from_bulk(p_request_id, p_output, v_gen);
    exception when others then
      -- The code only: an error message could quote the answer.
      raise warning 'bulk answer not stored (request %, %)', p_request_id, sqlstate;
      v_item := null;
      v_error := 'invalidOutput';
      update public.ai_generations set status = 'invalid_output', error_code = 'invalidOutput'
      where id = v_gen;
    end;
  elsif v_error is null then
    v_error := 'aiError';
  end if;

  update public.library_bulk_requests r
  set status = case when v_item is not null then 'created' else 'failed' end,
      reason = case when v_item is not null then null else left(v_error, 80) end,
      item_id = v_item,
      ai_generation_id = v_gen,
      cost_usd = v_cost,
      problems = (select coalesce(array_agg(distinct p order by p), '{}')
        from unnest(r.problems || coalesce(p_problems, '{}')) p
        where p ~ '^[a-z_]{1,40}$')[1:20]
  where r.id = p_request_id;
  return case when v_item is not null then 'created' else 'failed' end;
end;
$$;

-- Ends a run (`completed`, `cancelled` or `failed` with a code): requests still planned are
-- `skipped/cancelled` (or `failed` with the run's code), requests still submitted `failed`
-- (`batch_missing`, or the run's code); the report is written. Event `library_bulk_run.completed`
-- ({runId}) and the audit. A run that has already ended keeps its report.
create function app.library_bulk_finish(p_run_id uuid, p_status text, p_error text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.library_bulk_runs;
  v_error text := nullif(left(btrim(coalesce(p_error, '')), 80), '');
  v_report jsonb;
begin
  if p_status is null or p_status not in ('completed', 'cancelled', 'failed') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  select * into v from public.library_bulk_runs where id = p_run_id for update;
  if v.id is null then
    raise exception 'unknown run' using errcode = '22023';
  end if;
  if v.status not in ('planned', 'running') then
    return v.report;
  end if;

  update public.library_bulk_requests
  set status = case when p_status = 'failed' then 'failed' else 'skipped' end,
      reason = case when p_status = 'failed' then coalesce(v_error, 'aiError') else 'cancelled' end
  where run_id = p_run_id and status = 'planned';
  update public.library_bulk_requests
  set status = 'failed', reason = coalesce(v_error, 'batch_missing')
  where run_id = p_run_id and status = 'submitted';

  select jsonb_build_object(
    'requests', count(*),
    'created', count(*) filter (where r.status = 'created'),
    'similarTitles', count(*) filter (where r.status = 'created' and 'similar_title' = any (r.problems)),
    'skipped', jsonb_build_object(
      'covered', count(*) filter (where r.status = 'skipped' and r.reason = 'covered'),
      'costCap', count(*) filter (where r.status = 'skipped' and r.reason = 'cost_cap'),
      'cancelled', count(*) filter (where r.status = 'skipped' and r.reason = 'cancelled')),
    'failed', coalesce((
      select jsonb_object_agg(f.reason, f.n)
      from (select coalesce(x.reason, 'aiError') as reason, count(*) as n
            from public.library_bulk_requests x
            where x.run_id = p_run_id and x.status = 'failed'
            group by 1) f), '{}'::jsonb),
    'spentUsd', v.spent_usd,
    'worstCaseUsd', coalesce(v.worst_case_usd, 0),
    'maxCostUsd', v.max_cost_usd)
  into v_report
  from public.library_bulk_requests r
  where r.run_id = p_run_id;

  update public.library_bulk_runs
  set status = p_status, error_code = v_error, report = v_report, finished_at = now()
  where id = p_run_id;
  perform app.log_audit('library_bulk_run.' || p_status, v.board_id, null, 'library_bulk_run',
    v.id, jsonb_build_object(
      'created', (v_report ->> 'created')::integer,
      'similar', (v_report ->> 'similarTitles')::integer,
      'skipped', (v_report #>> '{skipped,covered}')::integer
        + (v_report #>> '{skipped,costCap}')::integer
        + (v_report #>> '{skipped,cancelled}')::integer,
      'failed', coalesce((select sum(x.value::integer) from jsonb_each_text(v_report -> 'failed') x), 0),
      'spent_usd', v.spent_usd,
      'error_code', v_error), app.library_bulk_actor());
  perform app.emit_event('library_bulk_run.completed', v.board_id, null, 'library_bulk_run', v.id,
    jsonb_build_object('runId', v.id));
  return v_report;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 6. « Approuver pour le conseil » for a board draft, in one step (D-095)
-- ---------------------------------------------------------------------------------------

-- Phase 4's decision (public.library_decide, as S4 left it) for a given reviewer, with how the
-- approval came (`via` in the audit when it is not a plain decision).
create function app.library_decide_as(
  p_user uuid,
  p_item_id uuid,
  p_decision text,
  p_note text,
  p_expected_revision integer,
  p_via text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.library_items;
  v_note text := nullif(btrim(p_note), '');
begin
  select * into v from public.library_items where id = p_item_id for update;
  if p_user is null or v.id is null or not app.library_reviewer(p_user, v.board_id, 'content') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approve', 'reject')
    or coalesce(char_length(v_note), 0) > 1000
    or (p_decision = 'reject' and v_note is null)
  then
    raise exception 'invalid decision' using errcode = '22023';
  end if;
  if v.status <> 'teacher_reviewed' or v.review_requested_at is null then
    raise exception 'not awaiting approval' using errcode = 'LXL04';
  end if;
  if v.author_id = p_user then
    raise exception 'own item' using errcode = 'LXL05';
  end if;
  if v.content_revision is distinct from p_expected_revision then
    raise exception 'changed since it was opened' using errcode = 'LXL07';
  end if;

  if p_decision = 'approve' then
    perform app.library_assert_ready(v.id, true);
    if v.requires_faith_review and v.faith_reviewed_at is null then
      raise exception 'faith review pending' using errcode = 'LXL03';
    end if;
    update public.library_items
    set status = 'board_approved', share_scope = 'board',
        school_id = case when v.board_owned then null else v.school_id end,
        approved_at = now(), approved_by = p_user,
        review_requested_at = null, review_requested_by = null, review_note = null
    where id = v.id;
    perform app.log_audit('library_item.approved', v.board_id, v.school_id, 'library_item', v.id,
      jsonb_build_object('type', v.type, 'revision', v.content_revision,
        'faith_reviewed', v.requires_faith_review)
        || case when p_via is not null then jsonb_build_object('via', p_via) else '{}'::jsonb end);
    perform app.emit_event('library_item.approved', v.board_id, v.school_id, 'library_item', v.id,
      jsonb_build_object('itemId', v.id));
  else
    update public.library_items
    set status = 'rejected', share_scope = 'private', review_requested_at = null,
        review_requested_by = null, review_note = v_note, faith_reviewed_at = null,
        faith_reviewed_by = null
    where id = v.id;
    perform app.flag_absences_for_library_item(v.id);
    perform app.log_audit('library_item.rejected', v.board_id, v.school_id, 'library_item', v.id,
      jsonb_build_object('type', v.type, 'revision', v.content_revision));
    perform app.emit_event('library_item.rejected', v.board_id, v.school_id, 'library_item', v.id,
      jsonb_build_object('itemId', v.id));
  end if;
end;
$$;

-- A content reviewer approves a requested item for the whole board, or sends it back (Phase 4,
-- D-064, D-091): unchanged behaviour, through the shared decision.
create or replace function public.library_decide(
  p_item_id uuid,
  p_decision text,
  p_note text,
  p_expected_revision integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.library_decide_as(app.active_user_id(), p_item_id, p_decision, p_note,
    p_expected_revision, null);
end;
$$;

-- A board draft (bulk generation, or any board-owned item not yet proposed) approved by a content
-- reviewer in one step, on the revision she read: marked reviewed with the originality box (if a
-- draft or sent back), proposed, then approved, which makes it board-wide (D-091). Phase 4's checks
-- and codes apply at each step (LXL01 not ready, LXL07 changed…). Faith content stops after the
-- proposal (its faith review comes first): 'faith_review'; otherwise 'approved'. 42501 for an item
-- that is not the board's own, or a user who does not approve the board's content.
create function public.library_approve_board_draft(
  p_item_id uuid,
  p_expected_revision integer,
  p_originality_confirmed boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.active_user_id();
  v public.library_items;
begin
  select * into v from public.library_items where id = p_item_id for update;
  if v_user is null or v.id is null or not v.board_owned
    or not app.library_reviewer(v_user, v.board_id, 'content')
  then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_originality_confirmed is not true then
    raise exception 'originality not confirmed' using errcode = '22023';
  end if;
  if v.content_revision is distinct from p_expected_revision then
    raise exception 'changed since it was opened' using errcode = 'LXL07';
  end if;
  if v.status in ('draft', 'rejected') then
    perform public.library_mark_reviewed(v.id, true);
  elsif v.status <> 'teacher_reviewed' then
    raise exception 'not a draft' using errcode = 'LXL04';
  end if;
  if v.review_requested_at is null then
    perform public.library_request_approval(v.id);
  end if;
  select * into v from public.library_items where id = p_item_id;
  if v.requires_faith_review and v.faith_reviewed_at is null then
    return 'faith_review';
  end if;
  perform app.library_decide_as(v_user, v.id, 'approve', null, p_expected_revision, 'board_draft');
  return 'approved';
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 7. Daily clean-up (D-101)
-- ---------------------------------------------------------------------------------------

-- Runs planned but never started go after a day; ended runs (and their requests) after a year;
-- what was sent is cleared 30 days after it was sent (its SHA-256 stays); a run whose submission
-- was never confirmed (no batch id 15 minutes after it began) fails, and is never sent again.
-- Staged content pack imports go after a day too, through the packs' own clean-up when it exists
-- (app.content_pack_maintenance, created after this migration). Returns the counts.
create function app.library_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run record;
  v_planned integer;
  v_old integer;
  v_cleared integer;
  v_stuck integer := 0;
  v_packs integer;
begin
  for v_run in
    select r.id from public.library_bulk_runs r
    where r.status = 'running' and r.batch_id is null
      and r.submit_started_at < now() - interval '15 minutes'
  loop
    perform app.library_bulk_finish(v_run.id, 'failed', 'submitUnconfirmed');
    v_stuck := v_stuck + 1;
  end loop;
  delete from public.library_bulk_runs
  where status = 'planned' and created_at < now() - interval '1 day';
  get diagnostics v_planned = row_count;
  delete from public.library_bulk_runs
  where status in ('completed', 'cancelled', 'failed') and finished_at < now() - interval '1 year';
  get diagnostics v_old = row_count;
  update public.library_bulk_requests r
  set sent_text = null
  from public.library_bulk_runs u
  where u.id = r.run_id and r.sent_text is not null
    and u.submit_started_at < now() - interval '30 days';
  get diagnostics v_cleared = row_count;
  if to_regprocedure('app.content_pack_maintenance()') is not null then
    execute 'select app.content_pack_maintenance()' into v_packs;
  end if;
  return jsonb_build_object('stuckFailed', v_stuck, 'plannedDeleted', v_planned,
    'runsDeleted', v_old, 'sentTextCleared', v_cleared)
    || case when v_packs is not null then jsonb_build_object('packImportsDeleted', v_packs)
      else '{}'::jsonb end;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 8. Permissions: functions are opt-in, as everywhere else.
-- ---------------------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon;

-- The operator (admin CLI, service role). Explicitly not signed-in users, whatever the platform's
-- default privileges on new functions.
revoke execute on function
  public.library_bulk_plan(uuid, jsonb, numeric, text),
  public.library_bulk_start(uuid),
  public.library_bulk_cancel(uuid)
from authenticated;
grant execute on function
  public.library_bulk_plan(uuid, jsonb, numeric, text),
  public.library_bulk_start(uuid),
  public.library_bulk_cancel(uuid)
to service_role;
-- The worker connects as the database owner; the service role may run its steps too (tests,
-- the operator's tools). The input builder takes a user: service role only, as Phase 4's.
grant execute on function
  app.library_item_ai_input_for_board(uuid, uuid, jsonb),
  app.library_bulk_mark_submitting(uuid, jsonb, jsonb),
  app.library_item_from_bulk(uuid, jsonb, uuid),
  app.library_bulk_record_result(uuid, jsonb, jsonb, text, text[]),
  app.library_bulk_finish(uuid, text, text),
  app.library_maintenance()
to service_role;
-- Content reviewers.
grant execute on function public.library_approve_board_draft(uuid, integer, boolean)
to authenticated;
