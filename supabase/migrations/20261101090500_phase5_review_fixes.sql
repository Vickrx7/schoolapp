-- Phase 5 hardening: fixes from the review of the Phase 5 build.
--
-- 1. Option ids are per session (D-086). The snapshot devices receive kept the content's option
--    ids, and those can carry the answer: the Phase 4 editor numbers ordering items (i1, i2…) and
--    matching pairs (l1↔r1, l2↔r2…) in the answer's order and scrambles only their positions, and
--    the AI path does the same. Sorting the ids gave the order and l_n paired with r_n. A session
--    now names each option by its list and its place on screen only (choices a, b, c…; matching
--    columns l1…, r1…; ordering items i1…) and writes its key with those ids.
-- 2. « Montrer la bonne réponse » off: the projector no longer gets how many answered right
--    (`correctCount`) during the reveal. Beside the per-choice counts it named the right choice.
-- 3. Opinions (D-093): the average and count a person sees leave out her own opinion, and count
--    only opinions unchanged for a day. Changing one's own stars and watching the average let
--    anyone work out the others' exact stars from 5 opinions on.
-- 4. Deleting a board item (D-091) is audited (`library_item.deleted`, with its status, pack key,
--    usage and whether it was ever approved), and deleting an item a content pack wrote leaves a
--    tombstone (board, pack slug, key), so a later version of the pack never brings it back: it
--    is reported as `skipped_deleted_locally` (D-100).
--
-- DECISIONS: D-086, D-091, D-093, D-100 (amended in Phase 5's hardening).
-- Tests: supabase/tests/26_phase5_review_fixes.test.sql (and 20, 21, 22, 25 follow the changes)

-- ---------------------------------------------------------------------------------------
-- 1. Per-session option ids (D-086)
-- ---------------------------------------------------------------------------------------

-- An option's id in a session: its list and its place on screen (1 to 8), nothing else.
-- Choices take the letter devices show (a, b, c…), so choice ids sort like the screen does.
create function app.class_mode_option_id(p_list text, p_position integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_position is null or p_position not between 1 and 8 then null
    when p_list = 'choices' then chr(96 + p_position)
    when p_list = 'left' then 'l' || p_position
    when p_list = 'right' then 'r' || p_position
    when p_list = 'items' then 'i' || p_position
  end;
$$;

-- A list of options ({id, text}, as app.class_mode_options builds it) with its session ids, in
-- the same order.
create function app.class_mode_session_options(p_options jsonb, p_list text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', app.class_mode_option_id(p_list, t.n::integer), 'text', t.o -> 'text') order by t.n),
    '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(p_options) = 'array' then p_options
                                 else '[]'::jsonb end) with ordinality t (o, n);
$$;

-- The session id of the content option p_id in one of a snapshot question's lists.
create function app.class_mode_session_option_id(p_options jsonb, p_list text, p_id text)
returns text
language sql
immutable
set search_path = ''
as $$
  select app.class_mode_option_id(p_list, t.n::integer)
  from jsonb_array_elements(case when jsonb_typeof(p_options) = 'array' then p_options
                                 else '[]'::jsonb end) with ordinality t (o, n)
  where t.o ->> 'id' = p_id
  order by t.n
  limit 1;
$$;

-- A snapshot question (app.class_mode_question) with its options renamed for the session.
create function app.class_mode_session_question(p_q jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select p_q
    || case when p_q ? 'choices'
            then jsonb_build_object('choices', app.class_mode_session_options(p_q -> 'choices', 'choices'))
            else '{}'::jsonb end
    || case when p_q ? 'left'
            then jsonb_build_object('left', app.class_mode_session_options(p_q -> 'left', 'left'))
            else '{}'::jsonb end
    || case when p_q ? 'right'
            then jsonb_build_object('right', app.class_mode_session_options(p_q -> 'right', 'right'))
            else '{}'::jsonb end
    || case when p_q ? 'items'
            then jsonb_build_object('items', app.class_mode_session_options(p_q -> 'items', 'items'))
            else '{}'::jsonb end;
$$;

-- A key entry (app.class_mode_key_entry, built against the content's ids of p_q) with the
-- session's ids: right choices sorted again (grading compares sorted lists), pairs by left id,
-- the expected order kept. What it displays (a sample answer, an explanation) and the normalized
-- short answers do not change.
create function app.class_mode_session_key_entry(p_q jsonb, p_entry jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select p_entry
    || case when p_entry ? 'choiceIds' then jsonb_build_object('choiceIds', (
         select coalesce(jsonb_agg(x.id order by x.id), '[]'::jsonb)
         from (select app.class_mode_session_option_id(p_q -> 'choices', 'choices', e #>> '{}') as id
               from jsonb_array_elements(p_entry -> 'choiceIds') e) x))
       else '{}'::jsonb end
    || case when p_entry ? 'pairs' then jsonb_build_object('pairs', (
         select coalesce(jsonb_object_agg(
             app.class_mode_session_option_id(p_q -> 'left', 'left', p.key),
             app.class_mode_session_option_id(p_q -> 'right', 'right', p.value #>> '{}')), '{}'::jsonb)
         from jsonb_each(p_entry -> 'pairs') p))
       else '{}'::jsonb end
    || case when p_entry ? 'orderedIds' then jsonb_build_object('orderedIds', (
         select coalesce(jsonb_agg(
             app.class_mode_session_option_id(p_q -> 'items', 'items', e.v #>> '{}') order by e.n), '[]'::jsonb)
         from jsonb_array_elements(p_entry -> 'orderedIds') with ordinality e (v, n)))
       else '{}'::jsonb end;
$$;

-- « Lancer un quiz sur les appareils », as in 20261101090000_class_mode.sql, with the options
-- renamed for the session before the snapshot and the key are stored.
create or replace function public.start_class_session(
  p_class_id uuid,
  p_item_id uuid,
  p_version_id uuid,
  p_mode text,
  p_team_count smallint default 4,
  p_team_choice text default 'random',
  p_seconds_per_question smallint default null,
  p_reveal_answers boolean default true,
  p_score_short_answers boolean default false,
  p_replace_open boolean default false
)
returns table (session_id uuid, join_code text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user uuid := app.active_user_id();
  v_school uuid;
  v_item public.library_items;
  v_version uuid;
  v_content jsonb;
  v_key jsonb;
  v_questions jsonb;
  v_answers jsonb;
  v_subject text;
  v_open public.class_sessions;
  v_code text;
  v_id uuid;
begin
  select c.school_id into v_school
  from public.classes c
  where c.id = p_class_id and c.id in (select app.my_class_ids());
  if v_user is null or v_school is null or not app.school_has_module(v_school, 'library')
    or p_item_id is null or not app.can_use_library_item(p_item_id)
  then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in ('teams', 'solo')
    or coalesce(p_team_choice, 'random') not in ('random', 'device')
    or (p_mode = 'teams' and coalesce(p_team_count, 0) not between 2 and 6)
    or (p_seconds_per_question is not null and p_seconds_per_question not between 10 and 300)
  then
    raise exception 'invalid options' using errcode = '22023';
  end if;

  select * into v_item from public.library_items i where i.id = p_item_id;
  select v.id, v.content, k.answer_key into v_version, v_content, v_key
  from public.library_item_versions v
  left join public.library_item_answer_keys k on k.version_id = v.id
  where v.item_id = p_item_id
    and (v.id = p_version_id or (p_version_id is null and v.language_level_id is null));
  if v_version is null then
    raise exception 'unknown version' using errcode = '22023';
  end if;
  if v_item.status = 'archived' or v_item.type not in ('quiz', 'game') then
    raise exception 'not playable on devices' using errcode = 'LXC04';
  end if;

  v_questions := app.class_mode_questions(v_item.type, v_content);
  if jsonb_array_length(v_questions) = 0 then
    raise exception 'no question to play' using errcode = 'LXC04';
  end if;
  v_answers := app.class_mode_key(v_questions, v_key, coalesce(p_score_short_answers, false));
  -- Per-session option ids (D-086): the key is written with them first (from the content's
  -- ids), then the snapshot devices see. An option's id is then its place on screen and nothing
  -- else, whatever ids the author's editor or the AI gave (they can follow the answer's order).
  select coalesce(jsonb_object_agg(t.q ->> 'id',
      app.class_mode_session_key_entry(t.q, v_answers -> (t.q ->> 'id'))), '{}'::jsonb)
  into v_answers
  from jsonb_array_elements(v_questions) t (q)
  where v_answers ? (t.q ->> 'id');
  select jsonb_agg(app.class_mode_session_question(t.q) || jsonb_build_object('scorable', coalesce(
      (v_answers -> (t.q ->> 'id')) ?| array['choiceIds', 'value', 'pairs', 'orderedIds', 'accepted'],
      false)) order by t.n)
  into v_questions
  from jsonb_array_elements(v_questions) with ordinality t (q, n);
  select sj.code into v_subject from public.subjects sj where sj.id = v_item.subject_id;

  -- One start at a time per class, so a second one sees the first's session (LXC01).
  perform pg_advisory_xact_lock(hashtextextended('class_mode:' || p_class_id::text, 0));
  perform app.class_close_expired(p_class_id);
  select * into v_open from public.class_sessions s
  where s.class_id = p_class_id and s.status = 'open'
  for update;
  if v_open.id is not null then
    if not coalesce(p_replace_open, false) then
      raise exception 'a session is already open for this class' using errcode = 'LXC01';
    end if;
    perform app.class_session_close(v_open.id, v_open.keep_aggregate_results);
  end if;

  v_code := app.class_join_code();
  -- app.class_sessions_before_write stamps created_by and checks the item is usable.
  insert into public.class_sessions (class_id, library_item_id, version_id, item_title,
    content_lang, join_code, mode, team_count, team_choice, seconds_per_question, reveal_answers,
    score_short_answers, questions, expires_at, joining_closes_at)
  values (p_class_id, p_item_id, v_version, left(v_item.title, 200),
    case when v_subject = 'ang' then 'en-CA' else 'fr-CA' end, v_code, p_mode,
    case when p_mode = 'teams' then p_team_count end,
    case when p_mode = 'teams' then coalesce(p_team_choice, 'random') else 'random' end,
    p_seconds_per_question, coalesce(p_reveal_answers, true), coalesce(p_score_short_answers, false),
    v_questions, now() + interval '2 hours', now() + interval '20 minutes')
  returning id into v_id;
  insert into public.class_session_keys (session_id, answers) values (v_id, v_answers);
  return query select v_id, v_code;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 2. Answers hidden: no « N bonnes réponses » on the projector (D-086)
-- ---------------------------------------------------------------------------------------

-- The current question's answers for the projector, from the reveal on: answers per choice (or
-- per true / false) always; how many were right and the key entry with what to display only
-- when answers are shown (never the normalized forms short answers are graded against). With
-- answers hidden, the number right beside the per-choice counts would name the right choice.
create or replace function app.class_reveal(s public.class_sessions)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with q as (
    select s.questions -> s.question_index as q
  ), r as (
    select r.response, r.is_correct
    from public.session_responses r
    where r.session_id = s.id and r.question_index = s.question_index
  )
  select case when (select q.q from q) is not null then jsonb_build_object(
    'distribution', case (select q.q ->> 'kind' from q)
      when 'multiple_choice' then (
        select coalesce(jsonb_object_agg(c ->> 'id',
          (select count(*) from r where r.response -> 'choiceIds' ? (c ->> 'id'))), '{}'::jsonb)
        from jsonb_array_elements((select q.q -> 'choices' from q)) c)
      when 'true_false' then jsonb_build_object(
        'true', (select count(*) from r where r.response -> 'value' = 'true'::jsonb),
        'false', (select count(*) from r where r.response -> 'value' = 'false'::jsonb))
      else '{}'::jsonb
    end,
    'correctCount', case when s.reveal_answers
                           and (select q.q -> 'scorable' = 'true'::jsonb from q)
                         then (select count(*) filter (where r.is_correct) from r) end,
    'answer', case when s.reveal_answers then (
      select (k.answers -> (select q.q ->> 'id' from q)) - 'accepted'
      from public.class_session_keys k where k.session_id = s.id) end
  ) end;
$$;

-- ---------------------------------------------------------------------------------------
-- 3. Opinions (D-093): what a person sees never includes her own opinion, and counts only
--    opinions unchanged for a day
-- ---------------------------------------------------------------------------------------

-- Opinions and usage of up to 50 items (a page of results, or one item page), for the items the
-- user can use. The average (rounded to the half star, from 5 opinions; null below) and the
-- number of opinions are her colleagues': her own never counts in what she sees, and an opinion
-- counts once unchanged for a day, so changing her own stars (or a colleague's, on request) and
-- watching the average says nothing about anyone's stars. Her own opinion comes apart. All for
-- board-approved items only (null otherwise); usage is the number of units whose lessons link
-- the item.
create or replace function public.library_item_stats(p_item_ids uuid[])
returns table (
  item_id uuid,
  rating_average numeric,
  rating_count integer,
  my_rating smallint,
  usage_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user uuid := app.active_user_id();
begin
  if v_user is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_item_ids), 0) > 50 then
    raise exception 'too many items' using errcode = '22023';
  end if;
  return query
    select i.id,
      case when i.status = 'board_approved' and r.n >= 5
        then (round(r.average * 2) / 2)::numeric(2, 1) end,
      case when i.status = 'board_approved' then r.n end,
      case when i.status = 'board_approved' then (
        select x.rating from public.library_item_ratings x
        where x.item_id = i.id and x.rater_id = v_user) end,
      i.usage_count
    from public.library_items i
    cross join lateral (
      select count(*)::integer as n, avg(x.rating) as average
      from public.library_item_ratings x
      where x.item_id = i.id
        and x.rater_id <> v_user
        and x.updated_at <= now() - interval '1 day'
    ) r
    where i.id = any (coalesce(p_item_ids, '{}'::uuid[]))
      and app.library_item_usable_by(v_user, i.id)
    order by i.id;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 4. Deleting board items and pack items (D-091, D-100)
-- ---------------------------------------------------------------------------------------

-- Keys of pack items deleted here: a later version of the same pack never creates them again
-- (`skipped_deleted_locally`). Holds no content and no person: the board, the pack's slug and
-- the item's key. Kept as long as the board; the operator can remove a row to get an item back
-- from the next version (docs/content-packs.md).
create table public.content_pack_removed_items (
  board_id uuid not null references public.boards (id) on delete cascade,
  pack_slug text not null check (pack_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  pack_item_key text not null check (pack_item_key ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  removed_at timestamptz not null default now(),
  primary key (board_id, pack_slug, pack_item_key)
);
alter table public.content_pack_removed_items enable row level security;
revoke all on public.content_pack_removed_items from anon, authenticated;

-- After a library item is deleted by a statement (not by a cascade from its board or school):
-- a board item's deletion is audited (`library_item.deleted`: its status, pack key, usage, and
-- whether it was ever approved, which archiving no longer shows), and a pack item leaves its
-- tombstone. Whoever deleted it: the board's content reviewer (« Supprimer le brouillon »), an
-- author, or the operator.
create function app.library_items_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  if old.pack_item_key is not null and old.pack_slug is not null then
    insert into public.content_pack_removed_items (board_id, pack_slug, pack_item_key)
    values (old.board_id, old.pack_slug, old.pack_item_key)
    on conflict do nothing;
  end if;
  if old.board_owned then
    perform app.log_audit('library_item.deleted', old.board_id, old.school_id, 'library_item',
      old.id, jsonb_strip_nulls(jsonb_build_object(
        'status', old.status,
        'type', old.type,
        'pack_slug', old.pack_slug,
        'pack_item_key', old.pack_item_key,
        'bulk_run_id', old.bulk_run_id,
        'usage_count', old.usage_count,
        'ever_approved', old.approved_at is not null or exists (
          select 1 from public.audit_log a
          where a.entity_type = 'library_item' and a.entity_id = old.id
            and a.action = 'library_item.approved'))));
  end if;
  return old;
end;
$$;

create trigger library_items_after_delete after delete on public.library_items
  for each row execute function app.library_items_after_delete();


-- ---------------------------------------------------------------------------------------
-- 5. Applying a pack (D-100): as in 20261101090400_content_packs.sql, with one more outcome,
--      skipped_deleted_locally  deleted here since an earlier version wrote it (a tombstone in
--                               content_pack_removed_items): never created again
--    counted and listed by key in the report, and in the audit's `skipped`.
-- ---------------------------------------------------------------------------------------

create or replace function app.content_pack_run(p_import_id uuid, p_options jsonb, p_dry_run boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_import public.content_pack_imports;
  v_options jsonb := coalesce(p_options, '{}'::jsonb);
  v_level_map jsonb;
  v_approve boolean;
  v_approver uuid;
  v_approver_ok boolean;
  v_header jsonb;
  v_board uuid;
  v_pack_no_derivatives boolean;
  v_pack_id uuid := gen_random_uuid();
  v_count integer;
  v_checksum text;
  r record;
  x record;
  v_item jsonb;
  v_existing public.library_items;
  v_outcome text;
  v_warnings text[];
  v_type public.library_item_type;
  v_subject uuid;
  v_title text;
  v_grades text[];
  v_exps uuid[];
  v_exp uuid;
  v_tags uuid[];
  v_tag uuid;
  v_label text;
  v_ref uuid;
  v_ref_count integer;
  v_versions jsonb[];
  v_version_keys text[];
  v_level uuid;
  v_has_base boolean;
  v_version_id uuid;
  v_faith boolean;
  v_source public.library_source;
  v_id uuid;
  v_ready boolean;
  v_detail text;
  v_queued boolean;
  v_approved boolean;
  v_status public.library_item_status;
  v_requires_faith boolean;
  v_tag_ids jsonb := '{}'::jsonb;
  v_new_tags text[] := '{}';
  v_dropped_tags text[] := '{}';
  v_report_items jsonb[] := '{}';
  v_items jsonb;
  v_not_in_pack jsonb;
  v_counts jsonb;
  v_keys_by_outcome jsonb;
begin
  -- Options
  if jsonb_typeof(v_options) <> 'object'
    or coalesce(jsonb_typeof(v_options -> 'levelMap'), 'null') not in ('object', 'null')
    or coalesce(jsonb_typeof(v_options -> 'approve'), 'null') not in ('boolean', 'null')
    or coalesce(jsonb_typeof(v_options -> 'approverId'), 'null') not in ('string', 'null')
    or coalesce(v_options ->> 'approverId', '00000000-0000-0000-0000-000000000000')
      !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or exists (
      select 1 from jsonb_each(coalesce(nullif(v_options -> 'levelMap', 'null'::jsonb), '{}'::jsonb)) m
      where m.key !~ '^[a-z0-9_]{2,32}$' or jsonb_typeof(m.value) <> 'string'
        or (m.value #>> '{}') !~ '^[a-z0-9_]{2,32}$')
  then
    raise exception 'invalid options' using errcode = '22023';
  end if;
  v_level_map := coalesce(nullif(v_options -> 'levelMap', 'null'::jsonb), '{}'::jsonb);
  v_approve := coalesce((v_options ->> 'approve')::boolean, false);
  v_approver := (v_options ->> 'approverId')::uuid;

  -- The import, one apply at a time per pack and board.
  select * into v_import from public.content_pack_imports where id = p_import_id for update;
  if v_import.id is null then
    raise exception 'unknown import' using errcode = '22023';
  end if;
  if v_import.status <> 'staged' then
    raise exception 'the import is no longer staged' using errcode = 'LXP03';
  end if;
  v_board := v_import.board_id;
  v_header := v_import.header;
  v_pack_no_derivatives := coalesce((v_header #>> '{pack,noDerivatives}')::boolean, false);
  perform pg_advisory_xact_lock(hashtextextended('content_pack:' || v_board || ':' || v_import.slug, 0));
  perform app.content_pack_check_version(v_board, v_import.slug, v_import.version);

  -- Every item of the file is staged, and nothing else (the same sorted « key hash » lines as
  -- packChecksum in @lynx/content).
  select count(*)::integer,
    encode(sha256(convert_to(coalesce(string_agg(ii.key || ' ' || (ii.item ->> 'hash'), E'\n'
      order by (ii.key || ' ' || (ii.item ->> 'hash')) collate "C"), ''), 'UTF8')), 'hex')
  into v_count, v_checksum
  from public.content_pack_import_items ii where ii.import_id = v_import.id;
  if v_count = 0 or v_checksum is distinct from v_header ->> 'checksum' then
    raise exception 'the staged items differ from the pack''s checksum' using errcode = 'LXP05';
  end if;

  if v_approve then
    v_approver_ok := v_approver is not null and app.library_reviewer(v_approver, v_board, 'content');
    if not v_approver_ok and not p_dry_run then
      raise exception 'the approver is not a content reviewer of the board' using errcode = 'LXP04';
    end if;
  end if;

  insert into public.content_packs (id, board_id, slug, version, title, publisher, manifest,
    format_version, file_sha256, licence, item_count, approved_by)
  values (v_pack_id, v_board, v_import.slug, v_import.version,
    left(btrim(v_header #>> '{pack,title}'), 160), left(btrim(v_header #>> '{pack,publisher}'), 120),
    v_header, 1, v_import.file_sha256, nullif(btrim(v_header #>> '{pack,licence}'), ''), v_count,
    case when v_approve and v_approver_ok then v_approver end);

  for r in
    select ii.key, ii.item, ii.faith_suggested
    from public.content_pack_import_items ii
    where ii.import_id = v_import.id
    order by ii.key collate "C"
  loop
    v_item := r.item;
    v_warnings := '{}';
    v_outcome := null;
    v_id := null;
    v_queued := false;
    v_approved := false;
    v_existing := null;

    -- What to do with it.
    if not exists (
      select 1 from unnest(enum_range(null::public.library_item_type)) t
      where t::text = v_item ->> 'type'
    ) then
      v_outcome := 'skipped_unresolved';
      v_warnings := v_warnings || 'typeUnknown'::text;
    else
      v_type := (v_item ->> 'type')::public.library_item_type;
      select * into v_existing from public.library_items i
      where i.board_id = v_board and i.pack_slug = v_import.slug and i.pack_item_key = r.key
      for update;
      if v_existing.id is null then
        -- Deleted here since an earlier version wrote it: never created again (D-100).
        v_outcome := case when exists (
            select 1 from public.content_pack_removed_items d
            where d.board_id = v_board and d.pack_slug = v_import.slug and d.pack_item_key = r.key)
          then 'skipped_deleted_locally' else 'create' end;
      elsif v_existing.type <> v_type then
        v_outcome := 'skipped_unresolved';
        v_warnings := v_warnings || 'typeChanged'::text;
      elsif v_existing.pack_content_hash = v_item ->> 'hash' then
        v_outcome := 'unchanged';
      elsif v_existing.content_revision is distinct from v_existing.pack_revision then
        v_outcome := 'skipped_modified_locally';
      elsif v_existing.status in ('board_approved', 'archived') or not v_existing.board_owned then
        v_outcome := 'changed_not_applied';
      else
        v_outcome := 'update';
      end if;
    end if;

    -- Resolve and check what a create or an update writes.
    if v_outcome in ('create', 'update') then
      v_title := btrim(coalesce(v_item ->> 'title', ''));
      if char_length(v_title) not between 1 and 200
        or char_length(coalesce(v_item ->> 'summary', '')) > 1000
        or char_length(coalesce(v_item ->> 'materials', '')) > 4000
        or char_length(coalesce(v_item ->> 'keywords', '')) > 300
        or char_length(coalesce(v_item #>> '{faith,catholicConnection}', '')) > 2000
        or char_length(coalesce(v_item ->> 'licence', '')) > 200
        or char_length(coalesce(v_item #>> '{provenance,promptVersion}', '')) > 40
        or char_length(coalesce(v_item #>> '{provenance,model}', '')) > 80
        or coalesce(v_item #>> '{provenance,source}', '')
          not in ('board_created', 'teacher_created', 'ai_generated')
        or jsonb_typeof(v_item -> 'formats') is distinct from 'object'
        or coalesce(jsonb_typeof(v_item -> 'safetyNotes'), 'null') not in ('object', 'null')
        or coalesce(jsonb_typeof(v_item -> 'durationMinutes'), 'null') not in ('number', 'null')
        or (jsonb_typeof(v_item -> 'durationMinutes') = 'number' and (
          (v_item ->> 'durationMinutes')::numeric not between 1 and 600
          or (v_item ->> 'durationMinutes')::numeric <> trunc((v_item ->> 'durationMinutes')::numeric)))
        or jsonb_typeof(v_item -> 'versions') is distinct from 'array'
        or exists (
          select 1 from jsonb_array_elements(app.jsonb_array_or_empty(v_item -> 'versions')) v
          where jsonb_typeof(v) <> 'object'
            or jsonb_typeof(v -> 'content') is distinct from 'object'
            or pg_column_size(v -> 'content') > 131072
            or coalesce(jsonb_typeof(v -> 'answerKey'), 'null') not in ('object', 'null')
            or pg_column_size(v -> 'answerKey') > 65536
            or coalesce(jsonb_typeof(v -> 'level'), 'null') not in ('string', 'null'))
      then
        v_outcome := 'skipped_unresolved';
        v_warnings := v_warnings || 'invalid'::text;
      end if;
    end if;

    if v_outcome in ('create', 'update') then
      select s.id into v_subject from public.subjects s
      where s.code = v_item ->> 'subjectCode' and s.active
        and (s.board_id = v_board or s.board_id is null)
      order by s.board_id nulls last
      limit 1;
      if v_subject is null then
        v_outcome := 'skipped_unresolved';
        v_warnings := v_warnings || ('subjectUnknown:' || coalesce(v_item ->> 'subjectCode', ''));
      end if;
    end if;

    if v_outcome in ('create', 'update') then
      -- Versions: the base one is required; each board level once.
      v_versions := '{}';
      v_version_keys := '{}';
      v_has_base := false;
      for x in
        select v.value as version
        from jsonb_array_elements(v_item -> 'versions') with ordinality v (value, n)
        order by v.n
      loop
        if x.version ->> 'level' is null then
          if v_has_base then
            continue;
          end if;
          v_has_base := true;
          v_level := null;
        else
          v_level := null;
          select ll.id into v_level from public.language_levels ll
          where ll.board_id = v_board and ll.owner_user_id is null
            and ll.code = coalesce(v_level_map ->> (x.version ->> 'level'), x.version ->> 'level');
          if v_level is null or not app.library_type_levelable(v_type)
            or v_level::text = any (v_version_keys)
          then
            v_warnings := v_warnings || ('levelSkipped:' || (x.version ->> 'level'));
            continue;
          end if;
        end if;
        v_version_keys := v_version_keys || coalesce(v_level::text, 'base');
        v_versions := v_versions || jsonb_build_object('levelId', v_level,
          'content', x.version -> 'content', 'answerKey', x.version -> 'answerKey');
      end loop;
      if not v_has_base then
        v_outcome := 'skipped_unresolved';
        v_warnings := v_warnings || 'baseMissing'::text;
      end if;
    end if;

    if v_outcome in ('create', 'update') then
      -- Grades, attentes, tags and the Catholic reference, by code.
      v_grades := array(
        select g.code from public.grades g
        where g.code in (select jsonb_array_elements_text(app.jsonb_array_or_empty(v_item -> 'gradeCodes')))
        order by g.ordinal);
      v_warnings := v_warnings || array(
        select 'gradeUnknown:' || c
        from jsonb_array_elements_text(app.jsonb_array_or_empty(v_item -> 'gradeCodes')) c
        where c <> all (v_grades));

      v_exps := '{}';
      for x in
        select e.value as e
        from jsonb_array_elements(app.jsonb_array_or_empty(v_item -> 'expectations')) with ordinality e (value, n)
        order by e.n
      loop
        v_exp := null;
        select ce.id into v_exp from public.curriculum_expectations ce
        where ce.subject_id = v_subject and ce.curriculum_version = x.e ->> 'curriculumVersion'
          and ce.grade_code = x.e ->> 'gradeCode' and ce.code = x.e ->> 'code'
          and ce.grade_code = any (v_grades);
        if v_exp is null then
          v_warnings := v_warnings || ('expectationUnknown:' || concat_ws(' ',
            x.e ->> 'curriculumVersion', x.e ->> 'gradeCode', x.e ->> 'code'));
        elsif v_exp <> all (v_exps) then
          v_exps := v_exps || v_exp;
        end if;
      end loop;

      v_tags := '{}';
      for x in
        select t.value #>> '{}' as slug
        from jsonb_array_elements(app.jsonb_array_or_empty(v_item -> 'tags')) with ordinality t (value, n)
        order by t.n
      loop
        if not (v_tag_ids ? x.slug) then
          v_tag := null;
          select t.id into v_tag from public.tags t
          where t.slug = x.slug and (t.board_id = v_board or t.board_id is null)
          order by t.board_id nulls last
          limit 1;
          if v_tag is null then
            select btrim(d ->> 'labelFr') into v_label
            from jsonb_array_elements(v_header -> 'tags') d
            where d ->> 'slug' = x.slug
            limit 1;
            if coalesce(x.slug, '') ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and coalesce(v_label, '') <> ''
              and cardinality(v_new_tags) < 30
            then
              insert into public.tags (board_id, slug, label_fr)
              values (v_board, x.slug, left(v_label, 60))
              returning id into v_tag;
              v_new_tags := v_new_tags || x.slug;
            else
              v_dropped_tags := v_dropped_tags || x.slug;
            end if;
          end if;
          v_tag_ids := v_tag_ids || jsonb_build_object(x.slug, v_tag);
        end if;
        v_tag := (v_tag_ids ->> x.slug)::uuid;
        if v_tag is null then
          v_warnings := v_warnings || ('tagDropped:' || x.slug);
        elsif v_tag <> all (v_tags) then
          v_tags := v_tags || v_tag;
        end if;
      end loop;

      v_ref := null;
      if jsonb_typeof(v_item #> '{faith,reference}') = 'object' then
        select count(*)::integer, (array_agg(cr.id))[1] into v_ref_count, v_ref
        from public.catholic_references cr
        where cr.board_id = v_board and cr.active
          and cr.type::text = v_item #>> '{faith,reference,type}'
          and cr.title = v_item #>> '{faith,reference,title}';
        if v_ref_count = 0 then
          select count(*)::integer, (array_agg(cr.id))[1] into v_ref_count, v_ref
          from public.catholic_references cr
          where cr.board_id is null and cr.active
            and cr.type::text = v_item #>> '{faith,reference,type}'
            and cr.title = v_item #>> '{faith,reference,title}';
        end if;
        if v_ref_count <> 1 then
          v_ref := null;
          v_warnings := v_warnings
            || case when v_ref_count = 0 then 'referenceUnknown' else 'referenceAmbiguous' end;
        end if;
      end if;

      -- Faith content: the pack's flag, faith words the CLI found, or a named Catholic
      -- reference (the items trigger adds reflections and Enseignement religieux).
      v_faith := coalesce((v_item #>> '{faith,faithContent}')::boolean, false) or r.faith_suggested
        or jsonb_typeof(v_item #> '{faith,reference}') = 'object';
      v_source := case when v_item #>> '{provenance,source}' = 'ai_generated'
        then 'ai_generated' else 'board_created' end::public.library_source;

      -- Write it.
      if v_outcome = 'create' then
        v_id := gen_random_uuid();
        insert into public.library_items (id, board_id, school_id, type, title, summary, status,
          share_scope, source, author_id, board_owned, licence, content_pack_id, pack_slug,
          pack_item_key, pack_content_hash, subject_id, duration_minutes, materials, keywords,
          is_printable, is_projectable, is_interactive, sub_friendly, safety_notes, faith_content,
          faith_on_student_sheet, catholic_connection, catholic_reference_id, prompt_version,
          model, no_derivatives)
        values (v_id, v_board, null, v_type, v_title, nullif(btrim(v_item ->> 'summary'), ''),
          'draft', 'private', v_source, null, true, nullif(btrim(v_item ->> 'licence'), ''),
          v_pack_id, v_import.slug, r.key, v_item ->> 'hash', v_subject,
          (v_item ->> 'durationMinutes')::smallint, nullif(btrim(v_item ->> 'materials'), ''),
          nullif(btrim(v_item ->> 'keywords'), ''),
          coalesce((v_item #>> '{formats,printable}')::boolean, true),
          coalesce((v_item #>> '{formats,projectable}')::boolean, false),
          coalesce((v_item #>> '{formats,interactive}')::boolean, false),
          false,
          case when jsonb_typeof(v_item -> 'safetyNotes') = 'object' then v_item -> 'safetyNotes' end,
          v_faith, coalesce((v_item #>> '{faith,onStudentSheet}')::boolean, false),
          nullif(btrim(v_item #>> '{faith,catholicConnection}'), ''), v_ref,
          nullif(btrim(v_item #>> '{provenance,promptVersion}'), ''),
          nullif(btrim(v_item #>> '{provenance,model}'), ''),
          coalesce((v_item ->> 'noDerivatives')::boolean, false) or v_pack_no_derivatives);
      else
        v_id := v_existing.id;
        update public.library_items i set
          title = v_title,
          summary = nullif(btrim(v_item ->> 'summary'), ''),
          source = v_source,
          licence = nullif(btrim(v_item ->> 'licence'), ''),
          content_pack_id = v_pack_id,
          pack_content_hash = v_item ->> 'hash',
          subject_id = v_subject,
          duration_minutes = (v_item ->> 'durationMinutes')::smallint,
          materials = nullif(btrim(v_item ->> 'materials'), ''),
          keywords = nullif(btrim(v_item ->> 'keywords'), ''),
          is_printable = coalesce((v_item #>> '{formats,printable}')::boolean, true),
          is_projectable = coalesce((v_item #>> '{formats,projectable}')::boolean, false),
          is_interactive = coalesce((v_item #>> '{formats,interactive}')::boolean, false),
          sub_friendly = false,
          safety_notes = case when jsonb_typeof(v_item -> 'safetyNotes') = 'object'
            then v_item -> 'safetyNotes' end,
          -- A reviewer's faith flag stays (D-064).
          faith_content = v_faith or i.faith_flagged_by is not null,
          faith_on_student_sheet = coalesce((v_item #>> '{faith,onStudentSheet}')::boolean, false),
          catholic_connection = nullif(btrim(v_item #>> '{faith,catholicConnection}'), ''),
          catholic_reference_id = v_ref,
          prompt_version = nullif(btrim(v_item #>> '{provenance,promptVersion}'), ''),
          model = nullif(btrim(v_item #>> '{provenance,model}'), ''),
          no_derivatives = coalesce((v_item ->> 'noDerivatives')::boolean, false) or v_pack_no_derivatives,
          review_note = null
        where i.id = v_id;
        delete from public.library_item_grades g where g.item_id = v_id;
        delete from public.library_item_expectations e where e.item_id = v_id;
        delete from public.library_item_tags t where t.item_id = v_id;
        delete from public.library_item_versions lv
        where lv.item_id = v_id and coalesce(lv.language_level_id::text, 'base') <> all (v_version_keys);
      end if;

      insert into public.library_item_grades (item_id, grade_code)
      select v_id, g from unnest(v_grades) g;
      insert into public.library_item_expectations (item_id, expectation_id)
      select v_id, e from unnest(v_exps) e;
      insert into public.library_item_tags (item_id, tag_id)
      select v_id, t from unnest(v_tags) t;
      for x in select v.value as version from unnest(v_versions) v (value) loop
        v_level := nullif(x.version ->> 'levelId', '')::uuid;
        v_version_id := null;
        select lv.id into v_version_id from public.library_item_versions lv
        where lv.item_id = v_id and lv.language_level_id is not distinct from v_level;
        if v_version_id is null then
          perform app.library_insert_version(v_id, v_level, x.version -> 'content',
            x.version -> 'answerKey');
        else
          update public.library_item_versions
          set content = x.version -> 'content', schema_version = 1
          where id = v_version_id;
          if jsonb_typeof(x.version -> 'answerKey') = 'object' then
            insert into public.library_item_answer_keys (version_id, answer_key)
            values (v_version_id, x.version -> 'answerKey')
            on conflict (version_id) do update
              set answer_key = excluded.answer_key, updated_at = now();
          else
            delete from public.library_item_answer_keys where version_id = v_version_id;
          end if;
        end if;
      end loop;

      if v_outcome = 'create' then
        perform app.library_refresh_search(v_id);
      else
        -- A new revision; the request and any faith review no longer apply (D-063).
        perform app.library_content_changed(v_id);
      end if;
      update public.library_items set pack_revision = content_revision where id = v_id;

      -- Ready for approval: into the reviewers' queue. Otherwise a draft.
      begin
        perform app.library_assert_ready(v_id, true);
        v_ready := true;
      exception when sqlstate 'LXL01' or sqlstate 'LXL02' then
        get stacked diagnostics v_detail = pg_exception_detail;
        v_ready := false;
        v_warnings := v_warnings || ('notReady:' || coalesce(nullif(v_detail, ''), 'safetyNotes'));
      end;
      if v_ready then
        update public.library_items
        set status = 'teacher_reviewed', review_requested_at = now(), review_requested_by = null,
            review_note = null
        where id = v_id;
        v_queued := true;
      else
        update public.library_items
        set status = 'draft', share_scope = 'private', review_requested_at = null,
            review_requested_by = null
        where id = v_id;
      end if;

      if v_queued and v_approve and v_approver_ok then
        select i.requires_faith_review into v_requires_faith from public.library_items i
        where i.id = v_id;
        if v_requires_faith then
          v_warnings := v_warnings || 'approvalFaithReview'::text;
        elsif v_type in ('experiment', 'stem_challenge', 'outdoor_activity') then
          v_warnings := v_warnings || 'approvalByReviewer'::text;
        else
          perform app.content_pack_approve_item(v_id, v_approver, v_pack_id);
          v_approved := true;
        end if;
      end if;
    end if;

    select i.status into v_status from public.library_items i
    where i.id = coalesce(v_id, v_existing.id);
    v_report_items := v_report_items || jsonb_build_object(
      'key', r.key,
      'type', v_item ->> 'type',
      'title', left(v_item ->> 'title', 200),
      'outcome', v_outcome,
      'status', v_status,
      'queued', v_queued,
      'approved', v_approved,
      'warnings', to_jsonb(v_warnings));
  end loop;

  v_items := to_jsonb(v_report_items);

  -- Items of earlier versions that this one no longer has (reported, never removed).
  select coalesce(jsonb_agg(i.pack_item_key order by i.pack_item_key collate "C"), '[]'::jsonb)
  into v_not_in_pack
  from public.library_items i
  where i.board_id = v_board and i.pack_slug = v_import.slug and i.status <> 'archived'
    and not exists (
      select 1 from public.content_pack_import_items ii
      where ii.import_id = v_import.id and ii.key = i.pack_item_key);

  select jsonb_build_object(
      'created', count(*) filter (where e ->> 'outcome' = 'create'),
      'updated', count(*) filter (where e ->> 'outcome' = 'update'),
      'unchanged', count(*) filter (where e ->> 'outcome' = 'unchanged'),
      'changedNotApplied', count(*) filter (where e ->> 'outcome' = 'changed_not_applied'),
      'skippedModifiedLocally', count(*) filter (where e ->> 'outcome' = 'skipped_modified_locally'),
      'skippedDeletedLocally', count(*) filter (where e ->> 'outcome' = 'skipped_deleted_locally'),
      'skippedUnresolved', count(*) filter (where e ->> 'outcome' = 'skipped_unresolved'),
      'queued', count(*) filter (where (e ->> 'queued')::boolean),
      'approved', count(*) filter (where (e ->> 'approved')::boolean),
      'drafts', count(*) filter (where e ->> 'outcome' in ('create', 'update')
        and not (e ->> 'queued')::boolean),
      'notInPack', jsonb_array_length(v_not_in_pack)),
    jsonb_build_object(
      'changedNotApplied', coalesce(jsonb_agg(e -> 'key') filter (
        where e ->> 'outcome' = 'changed_not_applied'), '[]'::jsonb),
      'skippedModifiedLocally', coalesce(jsonb_agg(e -> 'key') filter (
        where e ->> 'outcome' = 'skipped_modified_locally'), '[]'::jsonb),
      'skippedDeletedLocally', coalesce(jsonb_agg(e -> 'key') filter (
        where e ->> 'outcome' = 'skipped_deleted_locally'), '[]'::jsonb),
      'skippedUnresolved', coalesce(jsonb_agg(e -> 'key') filter (
        where e ->> 'outcome' = 'skipped_unresolved'), '[]'::jsonb))
  into v_counts, v_keys_by_outcome
  from jsonb_array_elements(v_items) e;

  update public.content_packs
  set report = jsonb_build_object('counts', v_counts, 'notInPack', v_not_in_pack,
      'newTags', to_jsonb(v_new_tags), 'droppedTags', to_jsonb(v_dropped_tags)) || v_keys_by_outcome
  where id = v_pack_id;

  update public.content_pack_imports set status = 'applied', applied_at = now()
  where id = v_import.id;
  delete from public.content_pack_import_items where import_id = v_import.id;

  perform app.log_audit('content_pack.imported', v_board, null, 'content_pack', v_pack_id,
    jsonb_build_object('slug', v_import.slug, 'version', v_import.version,
      'created', v_counts -> 'created', 'updated', v_counts -> 'updated',
      'unchanged', v_counts -> 'unchanged',
      'skipped', (v_counts ->> 'changedNotApplied')::integer
        + (v_counts ->> 'skippedModifiedLocally')::integer
        + (v_counts ->> 'skippedDeletedLocally')::integer
        + (v_counts ->> 'skippedUnresolved')::integer,
      'approved', v_counts -> 'approved', 'file_sha256', v_import.file_sha256),
    'service');
  perform app.emit_event('content_pack.imported', v_board, null, 'content_pack', v_pack_id,
    jsonb_build_object('packId', v_pack_id));

  return jsonb_build_object(
    'packId', v_pack_id,
    'pack', jsonb_build_object('slug', v_import.slug, 'version', v_import.version,
      'title', v_header #>> '{pack,title}', 'publisher', v_header #>> '{pack,publisher}'),
    'fileSha256', v_import.file_sha256,
    'approverOk', v_approver_ok,
    'counts', v_counts,
    'items', v_items,
    'notInPack', v_not_in_pack,
    'newTags', to_jsonb(v_new_tags),
    'droppedTags', to_jsonb(v_dropped_tags));
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 6. Permissions: nothing new for the API. The helpers of section 1 run inside
--    start_class_session (a definer function); the trigger function is never called directly.
-- ---------------------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon;
revoke execute on function app.library_items_after_delete() from authenticated, service_role;
