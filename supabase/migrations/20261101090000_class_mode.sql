-- Phase 5: class mode (« Mode classe »). « Présenter à la classe » needs no database session.
-- « Quiz sur les appareils » stores a session, its anonymous devices and their answers until the
-- session ends, then deletes them; only the class aggregates the teacher asks to keep survive.
--
-- Student devices reach the database only through schema class_portal, executed by the role
-- lynx_class_portal from the web server's own pool (D-083). Answer keys are copied at start into
-- class_session_keys, which no API role and not the portal role can read, and answers are graded
-- here when they arrive (D-086, D-087). Nothing a student types is stored (D-088).
--
-- Error codes the app translates: LXC01 a session is already open for the class, LXC02 the
-- session changed (stale version or wrong phase), LXC03 no question left, LXC04 not playable on
-- devices, LXC05 the session has ended.
-- DECISIONS: D-082 to D-090, D-101.
-- Tests: supabase/tests/00_schema_invariants.test.sql, 20_class_mode.test.sql,
--        21_class_mode_privacy.test.sql

-- ---------------------------------------------------------------------------------------
-- 1. The portal role and its schema (D-083)
-- ---------------------------------------------------------------------------------------

-- Roles belong to the cluster, not the database: the local lite stack keeps them across resets,
-- so the role is created only once.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'lynx_class_portal') then
    -- LOGIN and a password are set by the operator (docs/phase-5.md), and by supabase/seed.sql
    -- for local development and CI only.
    create role lynx_class_portal nologin noinherit;
  end if;
end;
$$;

-- For password logins. The web server's pool also sets statement_timeout on every connection,
-- so the limit holds under the CI fallback (`postgres` with `-c role=lynx_class_portal`) too.
alter role lynx_class_portal set statement_timeout = '3s';

-- The migration owner may act as the portal role (pgTAP does, and so can a local connection
-- with `options=-c role=lynx_class_portal`). The reverse is never granted, and neither is
-- membership for authenticator. Kept apart from lynx_sub_portal on purpose: that role reads
-- alerts, and student devices must never share its path.
grant lynx_class_portal to postgres;

-- Not exposed through the API: supabase/config.toml lists only public and graphql_public.
create schema class_portal;
revoke all on schema class_portal from public;
grant usage on schema class_portal to lynx_class_portal;

-- ---------------------------------------------------------------------------------------
-- 2. Sessions, devices, answers. No code wrote these tables before Phase 5, and old rows would
--    break the new invariants; raw answers must never outlive a session anyway.
-- ---------------------------------------------------------------------------------------

delete from public.session_responses;
delete from public.session_participants;
delete from public.class_sessions;

alter table public.class_sessions
  -- The version played (one per session, D-090) and what devices need about the item.
  add column version_id uuid references public.library_item_versions (id) on delete set null,
  add column item_title text check (char_length(item_title) <= 200),
  add column content_lang text not null default 'fr-CA' check (content_lang in ('fr-CA', 'en-CA')),
  -- The teacher's options (A1.3).
  add column mode text not null default 'solo' check (mode in ('teams', 'solo')),
  add column team_count smallint check (team_count between 2 and 6),
  add column team_choice text not null default 'random' check (team_choice in ('random', 'device')),
  add column seconds_per_question smallint check (seconds_per_question between 10 and 300),
  add column reveal_answers boolean not null default true,
  add column score_short_answers boolean not null default false,
  -- The question snapshot devices see: a whitelist of the version's questions, never a key
  -- (app.class_mode_questions). Emptied when the session closes.
  add column questions jsonb not null default '[]'
    check (jsonb_typeof(questions) = 'array' and pg_column_size(questions) <= 1048576),
  -- Where the class is.
  add column phase text not null default 'lobby'
    check (phase in ('lobby', 'question', 'reveal', 'leaderboard', 'finished')),
  add column question_index smallint not null default -1 check (question_index between -1 and 79),
  add column question_closes_at timestamptz,
  add column joining_open boolean not null default true,
  add column joining_closes_at timestamptz,
  -- Bumped by every teacher action; devices poll with it and the projector sends it back.
  add column state_version integer not null default 1,
  add column device_seq smallint not null default 0 check (device_seq between 0 and 120),
  add constraint class_sessions_join_code_alphabet check (join_code ~ '^[ACDEFHJKMNPRTUVWXY3479]{6}$'),
  add constraint class_sessions_team_count check ((mode = 'teams') = (team_count is not null)),
  add constraint class_sessions_max_length check (expires_at <= created_at + interval '4 hours'),
  add constraint class_sessions_ended check ((status = 'closed') = (ended_at is not null));

create index class_sessions_version_id_idx on public.class_sessions (version_id);
create index class_sessions_created_by_idx on public.class_sessions (created_by);
create unique index class_sessions_one_open_per_class on public.class_sessions (class_id)
  where status = 'open';
create index class_sessions_open_expiry_idx on public.class_sessions (expires_at)
  where status = 'open';

-- Devices: generated numbers and fixed team keys, never a name (D-088). `nickname` stays NOT NULL
-- and holds the device number as text.
alter table public.session_participants
  drop constraint session_participants_team_check,
  add column device_number smallint not null check (device_number between 1 and 120),
  -- sha256 of the device's token (HttpOnly cookie); null once the device left.
  add column token_hash text unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- HMAC of the device cookie (lynx_jouer_device), never a raw value.
  add column device_key text not null check (device_key ~ '^[0-9a-f]{64}$'),
  add column last_seen_at timestamptz not null default now(),
  add column left_at timestamptz,
  add constraint session_participants_team_key
    check (team is null or team in ('huards', 'castors', 'orignaux', 'ours', 'loups', 'renards')),
  add constraint session_participants_device_number_key unique (session_id, device_number),
  add constraint session_participants_left check ((left_at is null) = (token_hash is not null));

-- One answer per device and question. `response` holds only ids or a boolean: a short answer is
-- stored as {} (D-088).
alter table public.session_responses
  add column question_index smallint not null check (question_index between 0 and 79),
  add column score smallint check (score between 0 and 100),                 -- null: not scored
  add constraint session_responses_size check (pg_column_size(response) <= 1024),
  add constraint session_responses_one_per_question unique (participant_id, question_index);
create index session_responses_session_question_idx
  on public.session_responses (session_id, question_index);

-- Grading data for one session (D-086): never readable by any API role or by the portal role.
create table public.class_session_keys (
  session_id uuid primary key references public.class_sessions (id) on delete cascade,
  answers jsonb not null
    check (jsonb_typeof(answers) = 'object' and pg_column_size(answers) <= 1048576)
);

-- Failed joins only (D-084), as HMAC keys: never a raw address. network_key is null for class
-- link failures (they count against the device only).
create table public.class_join_failures (
  id bigint generated always as identity primary key,
  device_key text not null check (device_key ~ '^[0-9a-f]{64}$'),
  network_key text check (network_key ~ '^[0-9a-f]{64}$'),
  failed_at timestamptz not null default now()
);
create index class_join_failures_device_idx on public.class_join_failures (device_key, failed_at desc);
create index class_join_failures_network_idx on public.class_join_failures (network_key, failed_at desc)
  where network_key is not null;

-- « Lien de la classe » (D-084). Stored in plain text on purpose: teachers must be able to show
-- it again. On its own it grants nothing: it lets a device into that class's lobby while joining
-- is open.
create table public.class_mode_links (
  class_id uuid primary key references public.classes (id) on delete cascade,
  token text not null unique check (token ~ '^[A-Za-z0-9_-]{43}$'),
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index class_mode_links_created_by_idx on public.class_mode_links (created_by);

alter table public.class_session_keys enable row level security;
alter table public.class_join_failures enable row level security;
alter table public.class_mode_links enable row level security;
revoke all on public.class_session_keys, public.class_join_failures, public.class_mode_links
  from anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 3. Access. Sessions change only through functions, so ending one always deletes its answers
--    and is audited. The class team reads its sessions and kept results, and deletes a closed
--    session (« Supprimer » on kept results). Devices and answers are not readable at all.
-- ---------------------------------------------------------------------------------------

drop policy class_sessions_all on public.class_sessions;
-- Also drops the column-level insert and update grants of the security review migration.
revoke insert, update, delete on public.class_sessions from authenticated;
create policy class_sessions_select on public.class_sessions for select to authenticated
  using (class_id in (select app.my_class_ids()));
create policy class_sessions_delete on public.class_sessions for delete to authenticated
  using (status = 'closed' and class_id in (select app.my_class_ids()));
grant delete on public.class_sessions to authenticated;

drop policy session_participants_teacher on public.session_participants;
drop policy session_participants_teacher_delete on public.session_participants;
revoke all on public.session_participants from anon, authenticated;

drop policy session_responses_teacher on public.session_responses;
drop policy session_responses_teacher_delete on public.session_responses;
revoke all on public.session_responses from anon, authenticated;

drop policy class_session_results_all on public.class_session_results;
revoke insert, update, delete on public.class_session_results from authenticated;
create policy class_session_results_select on public.class_session_results for select
  to authenticated
  using (session_id in (select s.id from public.class_sessions s));

-- ---------------------------------------------------------------------------------------
-- 4. The question snapshot devices see is a whitelist (D-086): id, kind, prompt, hint,
--    multipleAnswers and the options as {id, text}. Everything else in the content, and the
--    answer key, never goes into it. Ids follow the content's pattern (ID_PATTERN).
-- ---------------------------------------------------------------------------------------

-- Options as {id, text}: well-formed ids only, each id once, at most 8.
create function app.class_mode_options(p_options jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'text', x.text) order by x.n), '[]'::jsonb)
  from (
    select d.id, d.text, d.n
    from (
      select t.o ->> 'id' as id, left(t.o ->> 'text', 300) as text, t.n,
        row_number() over (partition by t.o ->> 'id' order by t.n) as dup
      from jsonb_array_elements(case when jsonb_typeof(p_options) = 'array' then p_options
                                     else '[]'::jsonb end) with ordinality t (o, n)
      where jsonb_typeof(t.o) = 'object'
        and t.o ->> 'id' ~ '^[a-z][a-z0-9]{0,7}$'
        and jsonb_typeof(t.o -> 'text') = 'string'
    ) d
    where d.dup = 1
    order by d.n
    limit 8
  ) x;
$$;

create function app.class_mode_question(p_q jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', p_q ->> 'id',
    'kind', p_q ->> 'kind',
    'prompt', case when jsonb_typeof(p_q -> 'prompt') = 'string' then left(p_q ->> 'prompt', 1000)
                   else '' end,
    'hint', case when jsonb_typeof(p_q -> 'hint') = 'string'
                 then nullif(btrim(left(p_q ->> 'hint', 300)), '') end,
    'multipleAnswers', case when p_q ->> 'kind' = 'multiple_choice'
                            then coalesce(p_q -> 'multipleAnswers' = 'true'::jsonb, false) end,
    'choices', case when p_q ->> 'kind' = 'multiple_choice' then app.class_mode_options(p_q -> 'choices') end,
    'left', case when p_q ->> 'kind' = 'matching' then app.class_mode_options(p_q -> 'left') end,
    'right', case when p_q ->> 'kind' = 'matching' then app.class_mode_options(p_q -> 'right') end,
    'items', case when p_q ->> 'kind' = 'ordering' then app.class_mode_options(p_q -> 'items') end
  ));
$$;

-- A snapshot question a device can answer: a prompt, and enough options for its kind.
create function app.class_mode_playable(p_q jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(btrim(p_q ->> 'prompt'), '') <> '' and case p_q ->> 'kind'
    when 'multiple_choice' then jsonb_array_length(p_q -> 'choices') >= 2
    when 'matching' then jsonb_array_length(p_q -> 'left') >= 1 and jsonb_array_length(p_q -> 'right') >= 1
    when 'ordering' then jsonb_array_length(p_q -> 'items') >= 2
    when 'true_false' then true
    when 'short_answer' then true
    else false
  end;
$$;

-- Tablet play: quiz, and game with questions (D-082). Exit tickets, tests and diagnostics are
-- excluded. At most 80 questions, each id once, in content order.
create function app.class_mode_questions(p_type public.library_item_type, p_content jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(x.q order by x.n), '[]'::jsonb)
  from (
    select d.q, d.n
    from (
      select app.class_mode_question(t.q) as q, t.n,
        row_number() over (partition by t.q ->> 'id' order by t.n) as dup
      from jsonb_array_elements(case when p_type in ('quiz', 'game')
                                       and jsonb_typeof(p_content -> 'questions') = 'array'
                                     then p_content -> 'questions' else '[]'::jsonb end)
        with ordinality t (q, n)
      where jsonb_typeof(t.q) = 'object'
        and t.q ->> 'id' ~ '^[a-z][a-z0-9]{0,7}$'
        and t.q ->> 'kind' in ('multiple_choice', 'true_false', 'matching', 'ordering', 'short_answer')
    ) d
    where d.dup = 1 and app.class_mode_playable(d.q)
    order by d.n
    limit 80
  ) x;
$$;

-- ---------------------------------------------------------------------------------------
-- 5. Normalizing short answers (D-087; SQL only, there is no TypeScript mirror). Case, accents,
--    apostrophes, quotes, special spaces, spaces in numbers (« 1 000 »), the decimal comma and
--    end punctuation. Quotes are removed before unaccent, which would turn « into <<.
-- ---------------------------------------------------------------------------------------

create function app.normalize_answer(p_text text)
returns text
language sql
stable
set search_path = ''
as $$
  select btrim(regexp_replace(regexp_replace(regexp_replace(
    extensions.unaccent('extensions.unaccent'::regdictionary,
      replace(replace(
        regexp_replace(regexp_replace(lower(left(coalesce(p_text, ''), 200)),
          E'[’‘ʼ`´]', '''', 'g'),                                         -- apostrophes
          E'[«»“”„"‹›    ]', ' ', 'g'), -- quotes, spaces
        E'…', ' '), E'⁄', '/')),
    '([0-9]) (?=[0-9]{3}([^0-9]|$))', E'\\1', 'g'),          -- « 1 000 » → 1000 (groups of three)
    '([0-9]),(?=[0-9])', E'\\1.', 'g'),                      -- « 0,5 » → 0.5
    '[[:space:]]+', ' ', 'g'),
  E' .!?;:,''');
$$;

-- ---------------------------------------------------------------------------------------
-- 6. Keys and grading (D-086, D-087). The key of a session is built once, at start, from the
--    Phase 4 answer key ({answers: [{questionId, kind, …}], solution}). A question is scored
--    only when its key entry is complete and consistent with the snapshot; otherwise answers
--    are recorded and not scored. `display` is what the projector may show after the reveal.
-- ---------------------------------------------------------------------------------------

create function app.class_mode_key_entry(p_q jsonb, p_a jsonb, p_score_short boolean)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_kind text := p_q ->> 'kind';
  v_entry jsonb := jsonb_build_object('kind', p_q ->> 'kind');
  v_display jsonb;
  v_ids text[];
  v_all text[];
  v_pairs jsonb;
begin
  v_display := jsonb_strip_nulls(jsonb_build_object(
    'sampleAnswer', case when v_kind = 'short_answer' and jsonb_typeof(p_a -> 'sampleAnswer') = 'string'
                         then nullif(left(p_a ->> 'sampleAnswer', 1000), '') end,
    'acceptable', case when v_kind = 'short_answer' and jsonb_typeof(p_a -> 'acceptableAnswers') = 'array'
                       then (select jsonb_agg(left(x.v, 100) order by x.n)
                             from (select e.v #>> '{}' as v, e.n
                                   from jsonb_array_elements(p_a -> 'acceptableAnswers') with ordinality e (v, n)
                                   where jsonb_typeof(e.v) = 'string' and btrim(e.v #>> '{}') <> ''
                                   order by e.n limit 10) x) end,
    'explanation', case when jsonb_typeof(p_a -> 'explanation') = 'string'
                        then nullif(left(p_a ->> 'explanation', 500), '') end
  ));
  if v_display <> '{}'::jsonb then
    v_entry := v_entry || jsonb_build_object('display', v_display);
  end if;

  if v_kind = 'multiple_choice' and jsonb_typeof(p_a -> 'correctChoiceIds') = 'array' then
    -- Sorted and distinct, all among the choices; a single-answer question has exactly one.
    select array_agg(distinct e #>> '{}' order by e #>> '{}') into v_ids
    from jsonb_array_elements(p_a -> 'correctChoiceIds') e
    where jsonb_typeof(e) = 'string';
    select coalesce(array_agg(c ->> 'id'), '{}') into v_all
    from jsonb_array_elements(p_q -> 'choices') c;
    if coalesce(cardinality(v_ids), 0) between 1 and 6 and v_ids <@ v_all
      and (cardinality(v_ids) = 1 or p_q -> 'multipleAnswers' = 'true'::jsonb)
    then
      v_entry := v_entry || jsonb_build_object('choiceIds', to_jsonb(v_ids));
    end if;

  elsif v_kind = 'true_false' and jsonb_typeof(p_a -> 'correct') = 'boolean' then
    v_entry := v_entry || jsonb_build_object('value', p_a -> 'correct');

  elsif v_kind = 'matching' and jsonb_typeof(p_a -> 'pairs') = 'array' then
    -- Every left id exactly once, each paired with a right id of the question.
    with pairs as (
      select e ->> 'leftId' as l, e ->> 'rightId' as r
      from jsonb_array_elements(p_a -> 'pairs') e
      where jsonb_typeof(e) = 'object' and jsonb_typeof(e -> 'leftId') = 'string'
        and jsonb_typeof(e -> 'rightId') = 'string'
    )
    select case
      when (select count(*) from pairs) = jsonb_array_length(p_a -> 'pairs')
        and (select count(distinct l) from pairs) = (select count(*) from pairs)
        and (select array_agg(l order by l) from pairs)
          = (select array_agg(o ->> 'id' order by o ->> 'id')
             from jsonb_array_elements(p_q -> 'left') o)
        and not exists (
          select 1 from pairs
          where pairs.r not in (select o ->> 'id' from jsonb_array_elements(p_q -> 'right') o))
      then (select jsonb_object_agg(l, r) from pairs)
    end into v_pairs;
    if v_pairs is not null then
      v_entry := v_entry || jsonb_build_object('pairs', v_pairs);
    end if;

  elsif v_kind = 'ordering' and jsonb_typeof(p_a -> 'orderedIds') = 'array' then
    -- A permutation of the question's items.
    select array_agg(e.v #>> '{}' order by e.n) into v_ids
    from jsonb_array_elements(p_a -> 'orderedIds') with ordinality e (v, n)
    where jsonb_typeof(e.v) = 'string';
    select coalesce(array_agg(o ->> 'id' order by o ->> 'id'), '{}') into v_all
    from jsonb_array_elements(p_q -> 'items') o;
    if cardinality(v_ids) = jsonb_array_length(p_a -> 'orderedIds')
      and cardinality(v_ids) = cardinality(v_all)
      and (select array_agg(x order by x) from unnest(v_ids) x) = v_all
    then
      v_entry := v_entry || jsonb_build_object('orderedIds', to_jsonb(v_ids));
    end if;

  elsif v_kind = 'short_answer' and coalesce(p_score_short, false)
    and jsonb_typeof(p_a -> 'acceptableAnswers') = 'array'
  then
    -- Scored only on request (« Noter les réponses courtes »), against normalized forms.
    select array_agg(distinct x.v order by x.v) into v_ids
    from (
      select app.normalize_answer(e #>> '{}') as v
      from jsonb_array_elements(p_a -> 'acceptableAnswers') e
      where jsonb_typeof(e) = 'string'
    ) x
    where x.v <> '';
    if coalesce(cardinality(v_ids), 0) >= 1 then
      v_entry := v_entry || jsonb_build_object('accepted', to_jsonb(v_ids));
    end if;
  end if;

  return v_entry;
end;
$$;

-- {questionId: entry} for every snapshot question whose Phase 4 key entry has the same kind.
create function app.class_mode_key(p_questions jsonb, p_answer_key jsonb, p_score_short boolean)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(q.q ->> 'id',
    app.class_mode_key_entry(q.q, a.entry, coalesce(p_score_short, false))), '{}'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(p_questions) = 'array' then p_questions
                                 else '[]'::jsonb end) q (q)
  cross join lateral (
    select k.e as entry
    from jsonb_array_elements(case when jsonb_typeof(p_answer_key -> 'answers') = 'array'
                                   then p_answer_key -> 'answers' else '[]'::jsonb end)
      with ordinality k (e, n)
    where jsonb_typeof(k.e) = 'object'
      and k.e ->> 'questionId' = q.q ->> 'id'
      and k.e ->> 'kind' = q.q ->> 'kind'
    order by k.n
    limit 1
  ) a;
$$;

-- Grades one answer. A response whose shape does not fit the question (other keys, unknown ids,
-- a wrong count) returns no row: the caller treats it as invalid. A valid answer to a question
-- that is not scored returns (null, null). `stored` is what session_responses keeps: only ids or
-- a boolean, and {} for a short answer, so nothing typed is ever stored (D-088).
create function app.class_grade(p_question jsonb, p_key jsonb, p_response jsonb)
returns table (score smallint, correct boolean, stored jsonb)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_kind text := p_question ->> 'kind';
  v_fields text[];
  v_ids text[];
  v_all text[];
  v_n integer;
  v_hits integer;
  v_text text;
  v_score smallint;
  v_correct boolean;
  v_stored jsonb;
begin
  if jsonb_typeof(p_response) is distinct from 'object' then
    return;
  end if;
  select coalesce(array_agg(k order by k), '{}') into v_fields
  from jsonb_object_keys(p_response) k;

  if v_kind = 'multiple_choice' then
    if v_fields <> array['choiceIds'] or jsonb_typeof(p_response -> 'choiceIds') <> 'array'
      or jsonb_array_length(p_response -> 'choiceIds') not between 1 and 6
      or exists (select 1 from jsonb_array_elements(p_response -> 'choiceIds') e
                 where jsonb_typeof(e) <> 'string')
    then
      return;
    end if;
    select array_agg(distinct e #>> '{}' order by e #>> '{}') into v_ids
    from jsonb_array_elements(p_response -> 'choiceIds') e;
    select coalesce(array_agg(c ->> 'id'), '{}') into v_all
    from jsonb_array_elements(p_question -> 'choices') c;
    if not v_ids <@ v_all
      or (cardinality(v_ids) > 1 and p_question -> 'multipleAnswers' is distinct from 'true'::jsonb)
    then
      return;
    end if;
    v_stored := jsonb_build_object('choiceIds', to_jsonb(v_ids));
    if p_key ? 'choiceIds' then
      v_correct := to_jsonb(v_ids) = p_key -> 'choiceIds';
      v_score := case when v_correct then 100 else 0 end;
    end if;

  elsif v_kind = 'true_false' then
    if v_fields <> array['value'] or jsonb_typeof(p_response -> 'value') <> 'boolean' then
      return;
    end if;
    v_stored := jsonb_build_object('value', p_response -> 'value');
    if p_key ? 'value' then
      v_correct := p_response -> 'value' = p_key -> 'value';
      v_score := case when v_correct then 100 else 0 end;
    end if;

  elsif v_kind = 'matching' then
    -- Every left id once, each paired with one of the right ids.
    if v_fields <> array['pairs'] or jsonb_typeof(p_response -> 'pairs') <> 'object' then
      return;
    end if;
    select coalesce(array_agg(o ->> 'id' order by o ->> 'id'), '{}') into v_all
    from jsonb_array_elements(p_question -> 'left') o;
    if (select coalesce(array_agg(k order by k), '{}')
        from jsonb_object_keys(p_response -> 'pairs') k) <> v_all
      or exists (
        select 1 from jsonb_each(p_response -> 'pairs') p
        where jsonb_typeof(p.value) <> 'string'
          or p.value #>> '{}' not in (select o ->> 'id' from jsonb_array_elements(p_question -> 'right') o))
    then
      return;
    end if;
    v_stored := jsonb_build_object('pairs', p_response -> 'pairs');
    if p_key ? 'pairs' then
      v_n := cardinality(v_all);
      select count(*) into v_hits
      from jsonb_each_text(p_response -> 'pairs') p
      where p_key -> 'pairs' ->> p.key = p.value;
      v_score := round(100.0 * v_hits / v_n)::smallint;
      v_correct := v_hits = v_n;
    end if;

  elsif v_kind = 'ordering' then
    -- A permutation of the items.
    if v_fields <> array['orderedIds'] or jsonb_typeof(p_response -> 'orderedIds') <> 'array'
      or exists (select 1 from jsonb_array_elements(p_response -> 'orderedIds') e
                 where jsonb_typeof(e) <> 'string')
    then
      return;
    end if;
    select coalesce(array_agg(e #>> '{}' order by e #>> '{}'), '{}') into v_ids
    from jsonb_array_elements(p_response -> 'orderedIds') e;
    select coalesce(array_agg(o ->> 'id' order by o ->> 'id'), '{}') into v_all
    from jsonb_array_elements(p_question -> 'items') o;
    if v_ids <> v_all then
      return;
    end if;
    v_stored := jsonb_build_object('orderedIds', p_response -> 'orderedIds');
    if p_key ? 'orderedIds' then
      v_correct := p_response -> 'orderedIds' = p_key -> 'orderedIds';
      v_score := case when v_correct then 100 else 0 end;
    end if;

  elsif v_kind = 'short_answer' then
    if v_fields <> array['text'] or jsonb_typeof(p_response -> 'text') <> 'string' then
      return;
    end if;
    v_text := p_response ->> 'text';
    if btrim(v_text) = '' or char_length(v_text) > 100 then
      return;
    end if;
    v_stored := '{}'::jsonb;
    if p_key ? 'accepted' then
      v_correct := p_key -> 'accepted' ? app.normalize_answer(v_text);
      v_score := case when v_correct then 100 else 0 end;
    end if;

  else
    return;
  end if;

  return query select v_score, v_correct, v_stored;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 7. Small helpers: teams, codes, retention
-- ---------------------------------------------------------------------------------------

-- The session's teams, in list order (the same keys as CLASS_TEAMS and the messages, D-088).
create function app.class_team_keys(p_count integer)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select (array['huards', 'castors', 'orignaux', 'ours', 'loups', 'renards'])
    [1:least(greatest(coalesce(p_count, 0), 0), 6)];
$$;

-- 6 characters from 22 without look-alikes (D-084), unique among open sessions. Rejection
-- sampling keeps every character equally likely (bytes of 242 and more are dropped).
create function app.class_join_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ACDEFHJKMNPRTUVWXY3479';
  v_code text;
  v_bytes bytea;
  v_byte integer;
  i integer;
begin
  loop
    v_code := '';
    while char_length(v_code) < 6 loop
      v_bytes := extensions.gen_random_bytes(12);
      for i in 0 .. 11 loop
        v_byte := get_byte(v_bytes, i);
        if v_byte < 242 and char_length(v_code) < 6 then
          v_code := v_code || substr(v_alphabet, v_byte % 22 + 1, 1);
        end if;
      end loop;
    end loop;
    exit when not exists (
      select 1 from public.class_sessions s where s.join_code = v_code and s.status = 'open'
    );
  end loop;
  return v_code;
end;
$$;

-- boards.settings.classModeResultsRetentionDays read the way the app reads it
-- (packages/domain/src/settings.ts): an integer from 1 to 3650, else 365.
create function app.class_results_retention_days(p_settings jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select coalesce((
    select v::integer
    from (select app.json_number_between(p_settings -> 'classModeResultsRetentionDays', 1, 3650) as v) t
    where t.v = trunc(t.v)
  ), 365);
$$;

-- A team for a device: the one with the fewest active devices, ties at random.
create function app.class_assign_team(p_session_id uuid)
returns text
language sql
volatile
set search_path = ''
as $$
  select k.key
  from public.class_sessions s
  cross join lateral unnest(app.class_team_keys(s.team_count)) with ordinality k (key, n)
  where s.id = p_session_id and s.mode = 'teams'
  order by (select count(*) from public.session_participants p
            where p.session_id = s.id and p.team = k.key and p.left_at is null),
    random()
  limit 1;
$$;

-- ---------------------------------------------------------------------------------------
-- 8. Scores (D-087) and the kept aggregate (D-089)
-- ---------------------------------------------------------------------------------------

-- [{team, members, score}], best first, then list order. A team's score is the sum, over the
-- scored questions played, of its average score among its devices that answered; a question
-- nobody on the team answered counts 0. `members` counts the team's devices (one that left still
-- counts: its answers stay until the end); a team without any has no score (« — », last).
-- Null in « Chacun pour soi ».
create function app.class_team_scores(p_session_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with teams as (
    select k.key, k.n
    from public.class_sessions s
    cross join lateral unnest(app.class_team_keys(s.team_count)) with ordinality k (key, n)
    where s.id = p_session_id and s.mode = 'teams'
  ), members as (
    select p.team, count(*)::integer as members
    from public.session_participants p
    where p.session_id = p_session_id and p.team is not null
    group by p.team
  ), per_question as (
    select p.team, r.question_index, avg(r.score) as average
    from public.session_responses r
    join public.session_participants p on p.id = r.participant_id
    where r.session_id = p_session_id and r.score is not null and p.team is not null
    group by p.team, r.question_index
  ), totals as (
    select pq.team, sum(pq.average) as total from per_question pq group by pq.team
  ), scored as (
    select t.key, t.n, coalesce(m.members, 0) as members,
      case when coalesce(m.members, 0) > 0 then round(coalesce(tt.total, 0))::integer end as score
    from teams t
    left join members m on m.team = t.key
    left join totals tt on tt.team = t.key
  )
  select jsonb_agg(jsonb_build_object('team', sc.key, 'members', sc.members, 'score', sc.score)
    order by sc.score desc nulls last, sc.n)
  from scored sc;
$$;

-- One played question for the kept results: counts only, never who answered what.
create function app.class_question_stats(
  p_session_id uuid,
  p_index integer,
  p_question jsonb,
  p_key jsonb
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with r as (
    select r.response, r.score, r.is_correct
    from public.session_responses r
    where r.session_id = p_session_id and r.question_index = p_index
  ), q as (
    select coalesce(p_question -> 'scorable' = 'true'::jsonb, false) as scorable
  )
  select jsonb_strip_nulls(jsonb_build_object(
    'index', p_index,
    'id', p_question ->> 'id',
    'kind', p_question ->> 'kind',
    'prompt', left(coalesce(p_question ->> 'prompt', ''), 300),
    'scorable', (select q.scorable from q),
    'answered', (select count(*) from r),
    'correct', case when (select q.scorable from q)
                    then (select count(*) filter (where r.is_correct) from r) end,
    'averageScore', case when (select q.scorable from q)
                         then (select round(avg(r.score), 1) from r where r.score is not null) end,
    'choices', case when p_question ->> 'kind' = 'multiple_choice' then (
      select jsonb_agg(jsonb_build_object(
          'id', c.c ->> 'id',
          'text', c.c ->> 'text',
          'count', (select count(*) from r where r.response -> 'choiceIds' ? (c.c ->> 'id')),
          'correct', case when p_key ? 'choiceIds' then p_key -> 'choiceIds' ? (c.c ->> 'id') end)
        order by c.n)
      from jsonb_array_elements(p_question -> 'choices') with ordinality c (c, n)) end,
    'trueFalse', case when p_question ->> 'kind' = 'true_false' then jsonb_build_object(
      'trueCount', (select count(*) from r where r.response -> 'value' = 'true'::jsonb),
      'falseCount', (select count(*) from r where r.response -> 'value' = 'false'::jsonb),
      'correct', case when p_key ? 'value' then (p_key -> 'value')::boolean end) end
  ));
$$;

-- `class_session_results.aggregate` (schemaVersion 1; apps/web/src/server/class-mode/aggregate.ts
-- reads it). Class figures only: never device numbers, participant ids or anything typed.
create function app.class_session_aggregate(s public.class_sessions)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'schemaVersion', 1,
    'itemId', s.library_item_id,
    'itemTitle', s.item_title,
    'mode', s.mode,
    'revealAnswers', s.reveal_answers,
    'startedAt', s.created_at,
    'endedAt', now(),
    'deviceCount', (select count(*) from public.session_participants p where p.session_id = s.id),
    'questionsPlayed', least(greatest(s.question_index + 1, 0), jsonb_array_length(s.questions)),
    'teams', app.class_team_scores(s.id),
    'questions', coalesce((
      select jsonb_agg(app.class_question_stats(s.id, (q.n - 1)::integer, q.q,
                         k.answers -> (q.q ->> 'id')) order by q.n)
      from jsonb_array_elements(s.questions) with ordinality q (q, n)
      left join public.class_session_keys k on k.session_id = s.id
      where q.n - 1 <= s.question_index
    ), '[]'::jsonb)
  ));
$$;

-- ---------------------------------------------------------------------------------------
-- 9. Closing (D-089). Ending a session, or its expiry, deletes in one transaction every answer
--    and device of the session, its key and its question snapshot, after writing the class
--    aggregate when the teacher asked to keep it. Audited with counts only.
-- ---------------------------------------------------------------------------------------

create function app.class_session_close(p_session_id uuid, p_keep boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_s public.class_sessions;
  v_keep boolean := coalesce(p_keep, false);
  v_school uuid;
  v_board uuid;
  v_responses integer;
  v_participants integer;
begin
  select * into v_s from public.class_sessions where id = p_session_id for update;
  if v_s.id is null or v_s.status = 'closed' then
    return jsonb_build_object('alreadyClosed', true);
  end if;
  select c.school_id, sc.board_id into v_school, v_board
  from public.classes c join public.schools sc on sc.id = c.school_id
  where c.id = v_s.class_id;

  if v_keep then
    insert into public.class_session_results (session_id, aggregate)
    values (v_s.id, app.class_session_aggregate(v_s))
    on conflict (session_id) do update set aggregate = excluded.aggregate, saved_at = now();
  end if;

  delete from public.session_responses where session_id = v_s.id;
  get diagnostics v_responses = row_count;
  delete from public.session_participants where session_id = v_s.id;
  get diagnostics v_participants = row_count;
  delete from public.class_session_keys where session_id = v_s.id;

  update public.class_sessions
  set status = 'closed', phase = 'finished', ended_at = now(), joining_open = false,
    question_closes_at = null, keep_aggregate_results = v_keep, questions = '[]'::jsonb,
    state_version = state_version + 1
  where id = v_s.id;

  -- The actor is the teacher, or 'system' when no one is signed in (the worker, a device).
  perform app.log_audit('class_session.ended', v_board, v_school, 'class_session', v_s.id,
    jsonb_build_object('responses_deleted', v_responses, 'participants_deleted', v_participants,
      'results_kept', v_keep));
  return jsonb_build_object('responsesDeleted', v_responses, 'participantsDeleted', v_participants,
    'resultsKept', v_keep);
end;
$$;

-- Closes the open sessions that have expired (of one class, or all), with the teacher's keep
-- choice. Sessions another transaction is working on are left for the next call.
create function app.class_close_expired(p_class_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r record;
  v_result jsonb;
  v_sessions integer := 0;
  v_responses integer := 0;
  v_participants integer := 0;
begin
  for r in
    select s.id, s.keep_aggregate_results
    from public.class_sessions s
    where s.status = 'open' and s.expires_at <= now()
      and (p_class_id is null or s.class_id = p_class_id)
    order by s.expires_at
    for update skip locked
  loop
    v_result := app.class_session_close(r.id, r.keep_aggregate_results);
    if not coalesce((v_result ->> 'alreadyClosed')::boolean, false) then
      v_sessions := v_sessions + 1;
      v_responses := v_responses + (v_result ->> 'responsesDeleted')::integer;
      v_participants := v_participants + (v_result ->> 'participantsDeleted')::integer;
    end if;
  end loop;
  return jsonb_build_object('sessionsClosed', v_sessions, 'responsesDeleted', v_responses,
    'participantsDeleted', v_participants);
end;
$$;

-- The worker's sweep every 5 minutes (class_mode_maintenance, D-101): expired sessions, join
-- failures after a day, closed sessions without results after 30 days, kept results after the
-- board's classModeResultsRetentionDays (the session goes, its results cascade). Counts only.
create function app.class_sessions_maintenance()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_closed jsonb;
  v_failures integer;
  v_sessions integer;
  v_results integer;
begin
  v_closed := app.class_close_expired(null);

  delete from public.class_join_failures where failed_at < now() - interval '1 day';
  get diagnostics v_failures = row_count;

  delete from public.class_sessions s
  where s.status = 'closed' and s.ended_at < now() - interval '30 days'
    and not exists (select 1 from public.class_session_results r where r.session_id = s.id);
  get diagnostics v_sessions = row_count;

  delete from public.class_sessions s
  using public.class_session_results r, public.classes c, public.schools sc, public.boards b
  where r.session_id = s.id and c.id = s.class_id and sc.id = c.school_id and b.id = sc.board_id
    and s.status = 'closed'
    and r.saved_at < now() - make_interval(days => app.class_results_retention_days(b.settings));
  get diagnostics v_results = row_count;

  return v_closed || jsonb_build_object('joinFailuresDeleted', v_failures,
    'sessionsDeleted', v_sessions, 'resultsDeleted', v_results);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 10. What a device sees, and what the projector sees
-- ---------------------------------------------------------------------------------------

-- A device's view (D-086): the session, its own number and team, the current question from the
-- snapshot, whether it answered, and its own result only after the reveal and only when answers
-- are shown. The team ranking in the leaderboard and at the end; its own total when answers are
-- shown, else only at the end. Never another device, never a key.
create function app.class_device_state(s public.class_sessions, p public.session_participants)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'status', 'ok',
    'version', s.state_version,
    'serverNow', now(),
    'session', jsonb_build_object(
      'title', s.item_title,
      'lang', s.content_lang,
      'mode', s.mode,
      'phase', s.phase,
      'index', s.question_index,
      'total', jsonb_array_length(s.questions),
      'closesAt', s.question_closes_at,
      'joiningOpen', s.joining_open and (s.joining_closes_at is null or now() < s.joining_closes_at),
      'teamChoice', s.team_choice,
      'teams', case when s.mode = 'teams' then to_jsonb(app.class_team_keys(s.team_count)) end),
    'me', jsonb_build_object('device', p.device_number, 'team', p.team),
    'question', case when s.phase in ('question', 'reveal', 'leaderboard')
                     then s.questions -> s.question_index end,
    'myAnswer', (
      select jsonb_build_object('answered', true, 'result',
        case when s.reveal_answers and s.phase <> 'question' and r.score is not null
             then jsonb_build_object('correct', r.is_correct, 'points', r.score) end)
      from public.session_responses r
      where r.participant_id = p.id and r.question_index = s.question_index),
    'leaderboard', case when s.mode = 'teams' and s.phase in ('leaderboard', 'finished')
                        then app.class_team_scores(s.id) end,
    'myTotal', case when s.phase = 'finished' or (s.phase = 'leaderboard' and s.reveal_answers) then (
      select coalesce(sum(r.score), 0)::integer
      from public.session_responses r where r.participant_id = p.id) end
  ));
$$;

-- The current question's answers for the projector, from the reveal on: answers per choice (or
-- per true / false), how many were right, and the key entry with what to display, only when
-- answers are shown (never the normalized forms short answers are graded against).
create function app.class_reveal(s public.class_sessions)
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
    'correctCount', case when (select q.q -> 'scorable' = 'true'::jsonb from q)
                         then (select count(*) filter (where r.is_correct) from r) end,
    'answer', case when s.reveal_answers then (
      select (k.answers -> (select q.q ->> 'id' from q)) - 'accepted'
      from public.class_session_keys k where k.session_id = s.id) end
  ) end;
$$;

-- What the projector polls (`class_session_live`) and what every teacher action returns. There
-- is never a key before the reveal, and none at all when answers are hidden.
create function app.class_live_state(s public.class_sessions)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'status', s.status,
    'version', s.state_version,
    'title', s.item_title,
    'itemId', s.library_item_id,
    'phase', s.phase,
    'index', s.question_index,
    'total', jsonb_array_length(s.questions),
    'mode', s.mode,
    'teams', case when s.mode = 'teams' then to_jsonb(app.class_team_keys(s.team_count)) end,
    'teamChoice', s.team_choice,
    'lang', s.content_lang,
    'secondsPerQuestion', s.seconds_per_question,
    'joinCode', s.join_code,
    'joiningOpen', s.status = 'open' and s.joining_open
      and (s.joining_closes_at is null or now() < s.joining_closes_at),
    'joiningClosesAt', s.joining_closes_at,
    'expiresAt', s.expires_at,
    'closesAt', s.question_closes_at,
    'serverNow', now(),
    'keep', s.keep_aggregate_results,
    'revealAnswers', s.reveal_answers,
    'scoreShortAnswers', s.score_short_answers,
    'question', case when s.phase in ('question', 'reveal', 'leaderboard')
                     then s.questions -> s.question_index end,
    'answered', (select count(*) from public.session_responses r
                 where r.session_id = s.id and r.question_index = s.question_index),
    'devices', (
      select jsonb_build_object(
        'count', count(*) filter (where p.left_at is null),
        'connected', count(*) filter (where p.left_at is null
                                        and p.last_seen_at >= now() - interval '20 seconds'),
        'byTeam', coalesce((
          select jsonb_agg(jsonb_build_object('team', k.key, 'members', (
              select count(*) from public.session_participants x
              where x.session_id = s.id and x.team = k.key and x.left_at is null)) order by k.n)
          from unnest(case when s.mode = 'teams' then app.class_team_keys(s.team_count)
                           else '{}'::text[] end) with ordinality k (key, n)), '[]'::jsonb),
        'list', coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'device', p.device_number,
          'team', p.team, 'left', p.left_at is not null) order by p.device_number), '[]'::jsonb))
      from public.session_participants p
      where p.session_id = s.id),
    'reveal', case when s.status = 'open' and s.question_index >= 0
                    and s.phase in ('reveal', 'leaderboard', 'finished')
                   then app.class_reveal(s) end,
    'leaderboard', case when s.mode = 'teams' and s.phase in ('leaderboard', 'finished')
                        then app.class_team_scores(s.id) end,
    'classStats', case when s.phase in ('leaderboard', 'finished') then jsonb_build_object(
      'percentCorrect', (
        select round(100.0 * count(*) filter (where r.is_correct) / nullif(count(*), 0))
        from public.session_responses r where r.session_id = s.id and r.score is not null)) end
  ));
$$;

-- ---------------------------------------------------------------------------------------
-- 11. Teacher functions: the class team with a teacher role (app.my_class_ids(), D-090)
-- ---------------------------------------------------------------------------------------

-- « Lancer un quiz sur les appareils ». Plays one version of a quiz, or of a game with
-- questions, that the teacher can use, in a class of hers at a school with the Library module.
-- The snapshot and the key are built here; the join code is new. An expired session of the
-- class is closed first; an open one gives LXC01 unless p_replace_open (« Terminer cette séance
-- et lancer »). A null version is the base version.
create function public.start_class_session(
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
  select jsonb_agg(t.q || jsonb_build_object('scorable', coalesce(
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

-- The projector's controls. p_expected_version is the state_version the projector shows: a
-- double click or another tab gives LXC02 instead of skipping a question.
--   next         lobby, reveal or leaderboard → the next question (LXC03 after the last). From
--                the lobby it closes joining and gives devices without a team one.
--   reveal       question → reveal (closes answers).
--   leaderboard  reveal → leaderboard, when answers are shown or on the last question.
--   finish       any phase → finished (closes answers); the session stays open for the end
--                screen until end_class_session.
--   lock/unlock  closes or reopens joining (for 20 minutes).
--   move         puts a device in another team of the session.
--   remove       removes a device and its answers.
-- A closed or expired session gives LXC05 (the next poll of class_session_live, or the worker,
-- closes an expired one: raising after writing would undo the deletion).
create function public.class_session_control(
  p_session_id uuid,
  p_action text,
  p_expected_version integer,
  p_participant_id uuid default null,
  p_team text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_s public.class_sessions;
  v_total integer;
  v_count integer;
  r record;
begin
  select * into v_s from public.class_sessions s
  where s.id = p_session_id and s.class_id in (select app.my_class_ids())
  for update;
  if v_s.id is null or app.active_user_id() is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_s.status = 'closed' or v_s.expires_at <= now() then
    raise exception 'the session has ended' using errcode = 'LXC05';
  end if;
  if p_expected_version is distinct from v_s.state_version then
    raise exception 'the session changed' using errcode = 'LXC02';
  end if;
  v_total := jsonb_array_length(v_s.questions);

  case p_action
    when 'next' then
      if v_s.phase not in ('lobby', 'reveal', 'leaderboard') then
        raise exception 'wrong phase' using errcode = 'LXC02';
      end if;
      if v_s.question_index + 1 >= v_total then
        raise exception 'no question left' using errcode = 'LXC03';
      end if;
      if v_s.phase = 'lobby' then
        update public.class_sessions set joining_open = false where id = v_s.id;
        if v_s.mode = 'teams' then
          for r in
            select p.id from public.session_participants p
            where p.session_id = v_s.id and p.team is null and p.left_at is null
            order by p.device_number
          loop
            update public.session_participants set team = app.class_assign_team(v_s.id)
            where id = r.id;
          end loop;
        end if;
      end if;
      update public.class_sessions
      set phase = 'question', question_index = question_index + 1,
        question_closes_at = case when seconds_per_question is not null
                                  then now() + make_interval(secs => seconds_per_question) end
      where id = v_s.id;

    when 'reveal' then
      if v_s.phase <> 'question' then
        raise exception 'wrong phase' using errcode = 'LXC02';
      end if;
      update public.class_sessions
      set phase = 'reveal', question_closes_at = least(coalesce(question_closes_at, now()), now())
      where id = v_s.id;

    when 'leaderboard' then
      if v_s.phase <> 'reveal' or not (v_s.reveal_answers or v_s.question_index = v_total - 1) then
        raise exception 'wrong phase' using errcode = 'LXC02';
      end if;
      update public.class_sessions set phase = 'leaderboard' where id = v_s.id;

    when 'finish' then
      if v_s.phase = 'finished' then
        raise exception 'wrong phase' using errcode = 'LXC02';
      end if;
      update public.class_sessions
      set phase = 'finished', joining_open = false,
        question_closes_at = case when question_closes_at is not null
                                  then least(question_closes_at, now()) end
      where id = v_s.id;

    when 'lock' then
      if v_s.phase = 'finished' then
        raise exception 'wrong phase' using errcode = 'LXC02';
      end if;
      update public.class_sessions set joining_open = false where id = v_s.id;

    when 'unlock' then
      if v_s.phase = 'finished' then
        raise exception 'wrong phase' using errcode = 'LXC02';
      end if;
      update public.class_sessions
      set joining_open = true, joining_closes_at = least(now() + interval '20 minutes', expires_at)
      where id = v_s.id;

    when 'move' then
      if v_s.mode <> 'teams' or p_team is null
        or not (p_team = any (app.class_team_keys(v_s.team_count)))
      then
        raise exception 'invalid team' using errcode = '22023';
      end if;
      update public.session_participants set team = p_team
      where id = p_participant_id and session_id = v_s.id;
      get diagnostics v_count = row_count;
      if v_count = 0 then
        raise exception 'unknown device' using errcode = '22023';
      end if;

    when 'remove' then
      -- Its answers go with it (cascade); it gets « gone » at its next call.
      delete from public.session_participants where id = p_participant_id and session_id = v_s.id;
      get diagnostics v_count = row_count;
      if v_count = 0 then
        raise exception 'unknown device' using errcode = '22023';
      end if;

    else
      raise exception 'unknown action' using errcode = '22023';
  end case;

  update public.class_sessions set state_version = state_version + 1 where id = v_s.id
  returning * into v_s;
  return app.class_live_state(v_s);
end;
$$;

-- What the projector polls every second. Closes the session first if it has expired (D-089).
create function public.class_session_live(p_session_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_s public.class_sessions;
begin
  select * into v_s from public.class_sessions s
  where s.id = p_session_id and s.class_id in (select app.my_class_ids());
  if v_s.id is null or app.active_user_id() is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_s.status = 'open' and v_s.expires_at <= now() then
    perform app.class_session_close(v_s.id, v_s.keep_aggregate_results);
    select * into v_s from public.class_sessions s where s.id = p_session_id;
  end if;
  return app.class_live_state(v_s);
end;
$$;

-- « Garder les résultats de la classe (sans noms) », while the session is open. The choice also
-- applies when the session expires. Not a state change for devices (no version bump).
create function public.set_class_session_keep(p_session_id uuid, p_keep boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_s public.class_sessions;
begin
  select * into v_s from public.class_sessions s
  where s.id = p_session_id and s.class_id in (select app.my_class_ids())
  for update;
  if v_s.id is null or app.active_user_id() is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_s.status = 'closed' or v_s.expires_at <= now() then
    raise exception 'the session has ended' using errcode = 'LXC05';
  end if;
  update public.class_sessions set keep_aggregate_results = coalesce(p_keep, false)
  where id = v_s.id;
end;
$$;

-- « Terminer la séance ». Idempotent: a closed session returns {alreadyClosed: true}.
create function public.end_class_session(p_session_id uuid, p_keep boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if app.active_user_id() is null or not exists (
    select 1 from public.class_sessions s
    where s.id = p_session_id and s.class_id in (select app.my_class_ids())
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return app.class_session_close(p_session_id, coalesce(p_keep, false));
end;
$$;

-- « Lien de la classe » (D-084): created on first use; p_replace gives a new one (« Remplacer le
-- lien », audited) and the old one stops working.
create function public.class_mode_link(p_class_id uuid, p_replace boolean default false)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.active_user_id();
  v_school uuid;
  v_board uuid;
  v_token text;
begin
  select c.school_id, sc.board_id into v_school, v_board
  from public.classes c join public.schools sc on sc.id = c.school_id
  where c.id = p_class_id and c.id in (select app.my_class_ids());
  if v_user is null or v_school is null or not app.school_has_module(v_school, 'library') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  if coalesce(p_replace, false) then
    insert into public.class_mode_links (class_id, token, created_by)
    values (p_class_id, v_token, v_user)
    on conflict (class_id) do update
      set token = excluded.token, created_by = excluded.created_by, created_at = now();
    perform app.log_audit('class_mode_link.replaced', v_board, v_school, 'class', p_class_id,
      jsonb_build_object('class_id', p_class_id));
  else
    insert into public.class_mode_links (class_id, token, created_by)
    values (p_class_id, v_token, v_user)
    on conflict (class_id) do nothing;
  end if;
  return (select l.token from public.class_mode_links l where l.class_id = p_class_id);
end;
$$;

-- The class tab « Mode classe »: the open session (« Séance en cours », possibly a colleague's)
-- and the kept results. Closes an expired session of the class first (D-089).
create function public.class_mode_overview(p_class_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_school uuid;
  v_settings jsonb;
begin
  select c.school_id, b.settings into v_school, v_settings
  from public.classes c
  join public.schools sc on sc.id = c.school_id
  join public.boards b on b.id = sc.board_id
  where c.id = p_class_id and c.id in (select app.my_class_ids());
  if app.active_user_id() is null or v_school is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform app.class_close_expired(p_class_id);
  return jsonb_build_object(
    'open', (
      select jsonb_build_object('id', s.id, 'itemId', s.library_item_id, 'itemTitle', s.item_title,
        'phase', s.phase, 'mode', s.mode, 'startedAt', s.created_at, 'expiresAt', s.expires_at,
        'startedByName', case when u.id is not null
                              then app.formal_staff_name(u.display_name, u.honorific) end,
        'mine', s.created_by is not distinct from app.active_user_id())
      from public.class_sessions s
      left join public.users u on u.id = s.created_by
      where s.class_id = p_class_id and s.status = 'open'),
    'results', coalesce((
      select jsonb_agg(x.o order by x.saved_at desc)
      from (
        select r.saved_at, jsonb_build_object('sessionId', s.id, 'itemTitle', s.item_title,
          'mode', s.mode, 'savedAt', r.saved_at,
          'participantCount', coalesce((r.aggregate ->> 'deviceCount')::integer, 0),
          'questionsPlayed', coalesce((r.aggregate ->> 'questionsPlayed')::integer, 0)) as o
        from public.class_session_results r
        join public.class_sessions s on s.id = r.session_id
        where s.class_id = p_class_id
        order by r.saved_at desc
        limit 50
      ) x), '[]'::jsonb),
    'hasLink', exists (select 1 from public.class_mode_links l where l.class_id = p_class_id),
    'library', app.school_has_module(v_school, 'library'),
    'retentionDays', app.class_results_retention_days(v_settings));
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 12. Portal functions (schema class_portal, executed only by lynx_class_portal, D-083). Every
--     function finds the device by the sha256 of its token, closes the session first if it has
--     expired, and never raises after writing (an exception would undo the write).
-- ---------------------------------------------------------------------------------------

-- Joins a device with a typed code or the class link. p_device_key and p_network_key are HMACs
-- made by the web server (the device cookie; the address, IPv6 by /64). Outcomes:
--   ok            a device token (returned once; only its hash is stored) and the expiry
--   invalid       malformed arguments, or no open session with this code (a failure is recorded)
--   invalid_link  unknown class link (a failure is recorded, against the device only)
--   waiting       a valid class link, but no session is open: not a failure, the device retries
--   wait          throttled (D-084): retry_after seconds; nothing is recorded
--   locked        joining is closed (the teacher, 20 minutes, the end) or no Library module
--   full          60 devices, or 120 device numbers used
-- A device that already joined this session (same device key) gets its number and team back.
create function class_portal.join(p_code text, p_link text, p_device_key text, p_network_key text)
returns table (outcome text, token text, expires_at timestamptz, retry_after integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_by_code boolean;
  v_dev_fails integer;
  v_dev_last timestamptz;
  v_net_fails integer;
  v_net_last timestamptz;
  v_wait numeric := 0;
  v_class uuid;
  v_s public.class_sessions;
  v_school uuid;
  v_seat public.session_participants;
  v_active integer;
  v_token text;
  v_number integer;
begin
  if p_device_key is null or p_device_key !~ '^[0-9a-f]{64}$'
    or p_network_key is null or p_network_key !~ '^[0-9a-f]{64}$'
    or (p_code is null) = (p_link is null)
    or (p_code is not null and p_code !~ '^[ACDEFHJKMNPRTUVWXY3479]{6}$')
    or (p_link is not null and p_link !~ '^[A-Za-z0-9_-]{43}$')
  then
    return query select 'invalid'::text, null::text, null::timestamptz, null::integer;
    return;
  end if;
  v_by_code := p_code is not null;

  -- Progressive waits instead of a lockout (D-084): per device after 10 failures in 15 minutes
  -- (15 s doubling, at most 5 minutes); per network, for typed codes only, after 100 (2 s
  -- doubling, at most 10 s: a board's schools can share one address).
  select count(*)::integer, max(f.failed_at) into v_dev_fails, v_dev_last
  from public.class_join_failures f
  where f.device_key = p_device_key and f.failed_at > now() - interval '15 minutes';
  if v_dev_fails >= 10 then
    v_wait := greatest(v_wait, extract(epoch from v_dev_last - now())
      + least(15 * power(2::numeric, least(v_dev_fails - 10, 10)), 300));
  end if;
  if v_by_code then
    select count(*)::integer, max(f.failed_at) into v_net_fails, v_net_last
    from public.class_join_failures f
    where f.network_key = p_network_key and f.failed_at > now() - interval '15 minutes';
    if v_net_fails >= 100 then
      v_wait := greatest(v_wait, extract(epoch from v_net_last - now())
        + least(2 * power(2::numeric, least(v_net_fails - 100, 10)), 10));
    end if;
  end if;
  if v_wait > 0 then
    return query select 'wait'::text, null::text, null::timestamptz, ceil(v_wait)::integer;
    return;
  end if;

  if v_by_code then
    select s.* into v_s from public.class_sessions s
    where s.join_code = p_code and s.status = 'open'
    for update;
    if v_s.id is null then
      insert into public.class_join_failures (device_key, network_key)
      values (p_device_key, p_network_key);
      return query select 'invalid'::text, null::text, null::timestamptz, null::integer;
      return;
    end if;
  else
    select l.class_id into v_class from public.class_mode_links l where l.token = p_link;
    if v_class is null then
      insert into public.class_join_failures (device_key, network_key) values (p_device_key, null);
      return query select 'invalid_link'::text, null::text, null::timestamptz, null::integer;
      return;
    end if;
    select s.* into v_s from public.class_sessions s
    where s.class_id = v_class and s.status = 'open'
    for update;
    if v_s.id is null then
      return query select 'waiting'::text, null::text, null::timestamptz, null::integer;
      return;
    end if;
  end if;

  if v_s.expires_at <= now() then
    perform app.class_session_close(v_s.id, v_s.keep_aggregate_results);
    return query select case when v_by_code then 'locked' else 'waiting' end,
      null::text, null::timestamptz, null::integer;
    return;
  end if;

  select c.school_id into v_school from public.classes c where c.id = v_s.class_id;
  if not app.school_has_module(v_school, 'library') or v_s.phase = 'finished'
    or not v_s.joining_open
    or (v_s.joining_closes_at is not null and now() >= v_s.joining_closes_at)
  then
    return query select 'locked'::text, null::text, null::timestamptz, null::integer;
    return;
  end if;

  select count(*)::integer into v_active
  from public.session_participants p
  where p.session_id = v_s.id and p.left_at is null;
  select p.* into v_seat from public.session_participants p
  where p.session_id = v_s.id and p.device_key = p_device_key
  order by p.device_number
  limit 1;
  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');

  if v_seat.id is not null then
    if v_seat.left_at is not null and v_active >= 60 then
      return query select 'full'::text, null::text, null::timestamptz, null::integer;
      return;
    end if;
    update public.session_participants
    set token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex'), left_at = null,
      last_seen_at = now()
    where id = v_seat.id;
    return query select 'ok'::text, v_token, v_s.expires_at, null::integer;
    return;
  end if;

  if v_active >= 60 or v_s.device_seq >= 120 then
    return query select 'full'::text, null::text, null::timestamptz, null::integer;
    return;
  end if;
  v_number := v_s.device_seq + 1;
  update public.class_sessions set device_seq = v_number where id = v_s.id;
  insert into public.session_participants (session_id, nickname, team, device_number, token_hash,
    device_key)
  values (v_s.id, v_number::text,
    case when v_s.mode = 'teams' and v_s.team_choice = 'random'
         then app.class_assign_team(v_s.id) end,
    v_number, encode(extensions.digest(v_token, 'sha256'), 'hex'), p_device_key);
  return query select 'ok'::text, v_token, v_s.expires_at, null::integer;
end;
$$;

-- A device's poll: `gone` (unknown token: removed, left, or the session was closed and cleaned),
-- `ended` (the session expired: it is closed now), `unchanged` ({status, serverNow}) when the
-- version it knows is current, else its view (app.class_device_state). Touches last_seen_at at
-- most every 10 s.
create function class_portal.state(p_token text, p_known_version integer default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_p public.session_participants;
  v_s public.class_sessions;
begin
  select p.* into v_p from public.session_participants p
  where p_token ~ '^[A-Za-z0-9_-]{43}$'
    and p.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  if v_p.id is null then
    return jsonb_build_object('status', 'gone');
  end if;
  select s.* into v_s from public.class_sessions s where s.id = v_p.session_id;
  if v_s.status <> 'open' then
    return jsonb_build_object('status', 'ended');
  end if;
  if v_s.expires_at <= now() then
    perform app.class_session_close(v_s.id, v_s.keep_aggregate_results);
    return jsonb_build_object('status', 'ended');
  end if;
  if v_p.last_seen_at < now() - interval '10 seconds' then
    update public.session_participants set last_seen_at = now() where id = v_p.id;
  end if;
  if p_known_version is not null and p_known_version = v_s.state_version then
    return jsonb_build_object('status', 'unchanged', 'serverNow', now());
  end if;
  return app.class_device_state(v_s, v_p);
end;
$$;

-- « Choisis ton équipe », when the teacher let students choose: in the lobby, or later for a
-- device that has no team yet. {status: 'ok', outcome: 'invalid'} for a team it may not take.
create function class_portal.set_team(p_token text, p_team text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_p public.session_participants;
  v_s public.class_sessions;
begin
  select p.* into v_p from public.session_participants p
  where p_token ~ '^[A-Za-z0-9_-]{43}$'
    and p.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  if v_p.id is null then
    return jsonb_build_object('status', 'gone');
  end if;
  select s.* into v_s from public.class_sessions s where s.id = v_p.session_id;
  if v_s.status <> 'open' then
    return jsonb_build_object('status', 'ended');
  end if;
  if v_s.expires_at <= now() then
    perform app.class_session_close(v_s.id, v_s.keep_aggregate_results);
    return jsonb_build_object('status', 'ended');
  end if;
  if v_s.mode <> 'teams' or v_s.team_choice <> 'device' or v_s.phase = 'finished'
    or (v_s.phase <> 'lobby' and v_p.team is not null)
    or p_team is null or not (p_team = any (app.class_team_keys(v_s.team_count)))
  then
    return jsonb_build_object('status', 'ok', 'outcome', 'invalid');
  end if;
  update public.session_participants set team = p_team, last_seen_at = now()
  where id = v_p.id
  returning * into v_p;
  return app.class_device_state(v_s, v_p);
end;
$$;

-- One answer to the current question, graded here (D-087): `recorded` with the device's view,
-- `already` when it answered before (a resent answer), `closed` when the question is not open
-- (another question, the reveal, the timer), `invalid` for a response that does not fit the
-- question (nothing is written). A short answer is stored as {}.
create function class_portal.answer(p_token text, p_question_index smallint, p_response jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_p public.session_participants;
  v_s public.class_sessions;
  v_q jsonb;
  v_key jsonb;
  v_grade record;
  v_count integer;
begin
  select p.* into v_p from public.session_participants p
  where p_token ~ '^[A-Za-z0-9_-]{43}$'
    and p.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  if v_p.id is null then
    return jsonb_build_object('status', 'gone');
  end if;
  -- Shared lock: the teacher's reveal waits for answers in flight, and an answer that arrives
  -- after it sees the new phase.
  select s.* into v_s from public.class_sessions s where s.id = v_p.session_id for share;
  if v_s.status <> 'open' then
    return jsonb_build_object('status', 'ended');
  end if;
  if v_s.expires_at <= now() then
    perform app.class_session_close(v_s.id, v_s.keep_aggregate_results);
    return jsonb_build_object('status', 'ended');
  end if;
  if v_s.phase <> 'question' or p_question_index is distinct from v_s.question_index
    or (v_s.question_closes_at is not null and now() >= v_s.question_closes_at)
  then
    return jsonb_build_object('status', 'ok', 'outcome', 'closed',
      'state', app.class_device_state(v_s, v_p));
  end if;
  if jsonb_typeof(p_response) is distinct from 'object' or pg_column_size(p_response) > 1024 then
    return jsonb_build_object('status', 'ok', 'outcome', 'invalid');
  end if;

  v_q := v_s.questions -> v_s.question_index;
  select k.answers -> (v_q ->> 'id') into v_key
  from public.class_session_keys k where k.session_id = v_s.id;
  select g.score, g.correct, g.stored into v_grade from app.class_grade(v_q, v_key, p_response) g;
  if not found then
    return jsonb_build_object('status', 'ok', 'outcome', 'invalid');
  end if;

  insert into public.session_responses (session_id, participant_id, question_index, question_key,
    response, score, is_correct)
  values (v_s.id, v_p.id, v_s.question_index, v_q ->> 'id', v_grade.stored, v_grade.score,
    v_grade.correct)
  on conflict (participant_id, question_index) do nothing;
  get diagnostics v_count = row_count;
  return jsonb_build_object('status', 'ok',
    'outcome', case when v_count = 1 then 'recorded' else 'already' end,
    'state', app.class_device_state(v_s, v_p));
end;
$$;

-- « Quitter »: the device's token stops working. Its answers stay until the session ends
-- (D-087: they count for its team).
create function class_portal.leave(p_token text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.session_participants p
  set left_at = now(), token_hash = null
  where p_token ~ '^[A-Za-z0-9_-]{43}$'
    and p.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 13. Permissions. The portal role executes the five portal functions and nothing else; the
--     class team gets the teacher functions; the worker the sweep. (Default privileges would
--     give PUBLIC execute on new functions, and per-schema default privileges cannot take a
--     global default away, so revoke explicitly.)
-- ---------------------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon;
revoke execute on all functions in schema class_portal from public, anon, authenticated, service_role;

grant execute on function
  public.start_class_session(uuid, uuid, uuid, text, smallint, text, smallint, boolean, boolean, boolean),
  public.class_session_control(uuid, text, integer, uuid, text),
  public.class_session_live(uuid),
  public.set_class_session_keep(uuid, boolean),
  public.end_class_session(uuid, boolean),
  public.class_mode_link(uuid, boolean),
  public.class_mode_overview(uuid)
to authenticated;

grant execute on function
  class_portal.join(text, text, text, text),
  class_portal.state(text, integer),
  class_portal.set_team(text, text),
  class_portal.answer(text, smallint, jsonb),
  class_portal.leave(text)
to lynx_class_portal;

grant execute on function app.class_sessions_maintenance() to service_role;
