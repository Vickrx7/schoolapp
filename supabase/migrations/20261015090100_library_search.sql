-- Phase 4: searching and browsing the library (« Banque de ressources »). Full-text search in
-- French without accents over the search document that every writer refreshes
-- (app.library_refresh_search, 20261015090000_library_core.sql), facets, and the number of
-- resources per attente for « Parcourir le curriculum ».
--
--  1. The text query: letters and digits only, up to 8 words, the last one as a prefix.
--  2. Duration bands, shared by the filter and its facet.
--  3. search_library: the usable rule written in, the filters, the facets and the order.
--  4. library_expectation_counts: resources per attente, with the same matching rule.
--  5. Permissions.
--
-- DECISIONS: D-065, D-068, D-069.
-- Tests: supabase/tests/17_library_search.test.sql

-- ---------------------------------------------------------------------------------------
-- 1. The text query (D-068). Only letters and digits are kept, so operators, quotes,
--    apostrophes and hyphens become spaces: « défi-STIM » is two words, as the search
--    document has them, and nothing a teacher types can break the query. Every word is
--    required; the last one also matches as a prefix (« hua » finds « huard »). Null when
--    nothing is left to search for (empty, or stop words only): no text filter then.
-- ---------------------------------------------------------------------------------------

create function app.library_tsquery(p_text text)
returns tsquery
language plpgsql
stable
set search_path = ''
as $$
declare
  v_words text[];
  v_query tsquery;
begin
  v_words := array(
    select w.word
    from regexp_split_to_table(
      btrim(regexp_replace(left(coalesce(p_text, ''), 200), '[^[:alnum:]]+', ' ', 'g')), ' ')
      with ordinality as w (word, n)
    where w.word <> ''
    order by w.n
    limit 8);
  if coalesce(cardinality(v_words), 0) = 0 then
    return null;
  end if;
  select to_tsquery('app.french_unaccent', string_agg(
      quote_literal(t.word) || case when t.n = cardinality(v_words) then ':*' else '' end,
      ' & ' order by t.n))
  into v_query
  from unnest(v_words) with ordinality as t (word, n);
  -- Stop words only (« le la ») leave an empty query.
  return case when numnode(v_query) = 0 then null else v_query end;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 2. Duration bands (« Durée » : 15 min ou moins, 16 à 30, 31 à 60, plus de 60).
-- ---------------------------------------------------------------------------------------

create function app.library_duration_band(p_minutes smallint)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_minutes is null then null
    when p_minutes <= 15 then 'le15'
    when p_minutes <= 30 then 'le30'
    when p_minutes <= 60 then 'le60'
    else 'gt60'
  end;
$$;

-- ---------------------------------------------------------------------------------------
-- 3. Search (D-065, D-068, D-069). One definer function: the usable rule
--    (app.library_item_usable_by) is written into the query, with the caller's schools and
--    boards computed once, so the search never calls a predicate per row; a database test
--    pins the two together. Archived items never appear, and a rejected item (« À
--    retravailler », always private) only to its author. Items waiting for review are not
--    usable by reviewers, so they never appear in a reviewer's search.
--
--    p_filters: {q, gradeCode, subjectId, strandId, expectationId, types[], buckets[],
--      duration (le15|le30|le60|gt60), formats[] (printable|projectable|interactive),
--      subFriendly, approvedOnly, languageLevelId, mine}; every key is optional and a JSON
--      null means no filter. Unknown keys and values of the wrong kind are refused (22023),
--      and so are unknown durations or formats; an unknown type or category, or a malformed
--      id, fails its cast (22P02).
--    - Text, grade, subject, domaine and attente narrow everything, facets included. An
--      attente matches items linked to it, to its specific attentes (an overall attente) or
--      to its overall attente (a specific one), as the counts per attente do.
--    - Types, categories and formats accept several values (any of them matches); a level
--      matches items with a version for it. Levels are the board's and the caller's own:
--      another teacher's personal level never matches, and never shows in the level facet.
--    - Each facet counts with every filter but its own, so choosing « Quiz » still shows how
--      many worksheets there are.
--
--    Returns {total, items:[{id, type, bucket, title, summary (at most 200 characters),
--      status, source, durationMinutes, subFriendly, printable, projectable, interactive,
--      requiresFaithReview, mine, requested (the caller's own items only), gradeCodes[],
--      levelIds[], updatedAt}], facets:{type:{t:n}, bucket:{b:n}, duration:{le15, le30,
--      le60, gt60}, format:{printable, projectable, interactive}, subFriendly:n, approved:n,
--      level:{id:n}}}.
--    Order: board-approved first, then relevance, then the title in French order, then id.
--    p_limit is 1 to 50 (24 by default).
-- ---------------------------------------------------------------------------------------

create function public.search_library(
  p_filters jsonb,
  p_limit integer default 24,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.active_user_id();
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_limit integer := least(greatest(coalesce(p_limit, 24), 1), 50);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 100000);
  v_schools uuid[];
  v_boards uuid[];
  v_levels uuid[];
  v_query tsquery;
  v_grade text;
  v_subject uuid;
  v_strand uuid;
  v_expectation uuid;
  v_expectations uuid[];
  v_types public.library_item_type[];
  v_buckets public.library_bucket[];
  v_duration text;
  v_formats text[];
  v_sub boolean;
  v_approved boolean;
  v_level uuid;
  v_mine boolean;
  v_result jsonb;
begin
  if v_user is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(v_filters) <> 'object' or exists (
    select 1 from jsonb_each(v_filters) e
    where jsonb_typeof(e.value) <> 'null'
      and case
        when e.key in ('q', 'gradeCode', 'subjectId', 'strandId', 'expectationId', 'duration',
          'languageLevelId') then jsonb_typeof(e.value) <> 'string'
        when e.key in ('types', 'buckets', 'formats') then jsonb_typeof(e.value) <> 'array'
        when e.key in ('subFriendly', 'approvedOnly', 'mine') then jsonb_typeof(e.value) <> 'boolean'
        else true
      end
  ) then
    raise exception 'invalid filters' using errcode = '22023';
  end if;

  v_query := app.library_tsquery(v_filters ->> 'q');
  v_grade := nullif(btrim(v_filters ->> 'gradeCode'), '');
  v_subject := nullif(v_filters ->> 'subjectId', '')::uuid;
  v_strand := nullif(v_filters ->> 'strandId', '')::uuid;
  v_expectation := nullif(v_filters ->> 'expectationId', '')::uuid;
  v_types := array(
    select distinct x::public.library_item_type
    from jsonb_array_elements_text(app.jsonb_array_or_empty(v_filters -> 'types')) x);
  v_buckets := array(
    select distinct x::public.library_bucket
    from jsonb_array_elements_text(app.jsonb_array_or_empty(v_filters -> 'buckets')) x);
  v_duration := nullif(v_filters ->> 'duration', '');
  v_formats := array(
    select distinct x from jsonb_array_elements_text(app.jsonb_array_or_empty(v_filters -> 'formats')) x);
  v_sub := coalesce((v_filters ->> 'subFriendly')::boolean, false);
  v_approved := coalesce((v_filters ->> 'approvedOnly')::boolean, false);
  v_level := nullif(v_filters ->> 'languageLevelId', '')::uuid;
  v_mine := coalesce((v_filters ->> 'mine')::boolean, false);
  if (v_duration is not null and v_duration not in ('le15', 'le30', 'le60', 'gt60'))
    or exists (select 1 from unnest(v_formats) f
               where f not in ('printable', 'projectable', 'interactive'))
  then
    raise exception 'invalid filters' using errcode = '22023';
  end if;
  if cardinality(v_types) = 0 then v_types := null; end if;
  if cardinality(v_buckets) = 0 then v_buckets := null; end if;
  if cardinality(v_formats) = 0 then v_formats := null; end if;

  -- An attente, its specific attentes and its overall attente (D-069). An unknown id matches
  -- nothing.
  if v_expectation is not null then
    v_expectations := array(
      select ce.id from public.curriculum_expectations ce
      where ce.id = v_expectation or ce.parent_id = v_expectation
      union
      select ce.parent_id from public.curriculum_expectations ce
      where ce.id = v_expectation and ce.parent_id is not null);
  end if;

  -- The caller's schools and boards as staff (never as a parent), once for the whole query.
  v_schools := array(select app.my_staff_school_ids());
  v_boards := array(select app.my_board_ids());
  -- Levels the caller may see: the boards' levels and the caller's own (language_levels_select).
  v_levels := array(
    select ll.id from public.language_levels ll
    where ll.board_id = any (v_boards) and (ll.owner_user_id is null or ll.owner_user_id = v_user));

  with visible as (
    select i.id, i.type, i.bucket, i.title, i.summary, i.status, i.source, i.author_id,
      i.duration_minutes, i.sub_friendly, i.is_printable, i.is_projectable, i.is_interactive,
      i.requires_faith_review, i.review_requested_at, i.updated_at,
      case when v_query is null then 0::real else ts_rank_cd(i.search_document, v_query) end
        as rank
    from public.library_items i
    where
      -- Usable (app.library_item_usable_by): the caller's own items, and reviewed or approved
      -- items shared with a school or board where the caller is staff.
      (i.author_id = v_user
        or (i.status in ('teacher_reviewed', 'board_approved')
          and ((i.share_scope = 'school' and i.school_id = any (v_schools))
            or (i.share_scope = 'board' and i.board_id = any (v_boards)))))
      and i.status <> 'archived'
      and (i.status <> 'rejected' or i.author_id = v_user)
      and (not v_mine or i.author_id = v_user)
      -- Filters every count follows: text, grade, subject, domaine and attente.
      and (v_query is null or i.search_document @@ v_query)
      and (v_grade is null or exists (
        select 1 from public.library_item_grades g where g.item_id = i.id and g.grade_code = v_grade))
      and (v_subject is null or i.subject_id = v_subject)
      and (v_strand is null or exists (
        select 1 from public.library_item_expectations le
        join public.curriculum_expectations ce on ce.id = le.expectation_id
        where le.item_id = i.id and ce.strand_id = v_strand))
      and (v_expectations is null or exists (
        select 1 from public.library_item_expectations le
        where le.item_id = i.id and le.expectation_id = any (v_expectations)))
  ),
  scored as (
    select v.*, f.level_ids, f.band,
      v_types is null or v.type = any (v_types) as f_type,
      v_buckets is null or v.bucket = any (v_buckets) as f_bucket,
      v_duration is null or f.band = v_duration as f_duration,
      v_formats is null
        or ('printable' = any (v_formats) and v.is_printable)
        or ('projectable' = any (v_formats) and v.is_projectable)
        or ('interactive' = any (v_formats) and v.is_interactive) as f_format,
      not v_sub or v.sub_friendly as f_sub,
      not v_approved or v.status = 'board_approved' as f_approved,
      v_level is null or v_level = any (f.level_ids) as f_level
    from visible v
    cross join lateral (
      -- Once per item: SQL functions with a pinned search_path are never inlined.
      select app.library_duration_band(v.duration_minutes) as band,
        array(
          select lv.language_level_id from public.library_item_versions lv
          where lv.item_id = v.id and lv.language_level_id = any (v_levels)
          order by lv.language_level_id) as level_ids
    ) f
  ),
  page as (
    select s.*, row_number() over (
        order by s.status = 'board_approved' desc, s.rank desc, s.title collate "fr-CA-x-icu", s.id
      ) as position
    from scored s
    where s.f_type and s.f_bucket and s.f_duration and s.f_format and s.f_sub and s.f_approved
      and s.f_level
    order by position
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'total', (
      select count(*) from scored s
      where s.f_type and s.f_bucket and s.f_duration and s.f_format and s.f_sub and s.f_approved
        and s.f_level),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', p.id, 'type', p.type, 'bucket', p.bucket, 'title', p.title,
          'summary', case when char_length(p.summary) > 200 then left(p.summary, 199) || '…'
            else p.summary end,
          'status', p.status, 'source', p.source, 'durationMinutes', p.duration_minutes,
          'subFriendly', p.sub_friendly, 'printable', p.is_printable,
          'projectable', p.is_projectable, 'interactive', p.is_interactive,
          'requiresFaithReview', p.requires_faith_review,
          'mine', p.author_id is not distinct from v_user,
          'requested', p.author_id is not distinct from v_user and p.review_requested_at is not null,
          'gradeCodes', to_jsonb(array(
            select g.grade_code from public.library_item_grades g
            join public.grades gr on gr.code = g.grade_code
            where g.item_id = p.id order by gr.ordinal)),
          'levelIds', to_jsonb(p.level_ids),
          'updatedAt', p.updated_at)
        order by p.position)
      from page p), '[]'::jsonb),
    'facets', jsonb_build_object(
      'type', coalesce((
        select jsonb_object_agg(t.type, t.n) from (
          select s.type::text as type, count(*) as n from scored s
          where s.f_bucket and s.f_duration and s.f_format and s.f_sub and s.f_approved and s.f_level
          group by s.type) t), '{}'::jsonb),
      'bucket', coalesce((
        select jsonb_object_agg(b.bucket, b.n) from (
          select s.bucket::text as bucket, count(*) as n from scored s
          where s.f_type and s.f_duration and s.f_format and s.f_sub and s.f_approved and s.f_level
          group by s.bucket) b), '{}'::jsonb),
      'duration', (
        select jsonb_build_object(
          'le15', count(*) filter (where s.band = 'le15'),
          'le30', count(*) filter (where s.band = 'le30'),
          'le60', count(*) filter (where s.band = 'le60'),
          'gt60', count(*) filter (where s.band = 'gt60'))
        from scored s
        where s.f_type and s.f_bucket and s.f_format and s.f_sub and s.f_approved and s.f_level),
      'format', (
        select jsonb_build_object(
          'printable', count(*) filter (where s.is_printable),
          'projectable', count(*) filter (where s.is_projectable),
          'interactive', count(*) filter (where s.is_interactive))
        from scored s
        where s.f_type and s.f_bucket and s.f_duration and s.f_sub and s.f_approved and s.f_level),
      'subFriendly', (
        select count(*) filter (where s.sub_friendly) from scored s
        where s.f_type and s.f_bucket and s.f_duration and s.f_format and s.f_approved and s.f_level),
      'approved', (
        select count(*) filter (where s.status = 'board_approved') from scored s
        where s.f_type and s.f_bucket and s.f_duration and s.f_format and s.f_sub and s.f_level),
      'level', coalesce((
        select jsonb_object_agg(l.level_id, l.n) from (
          select x.level_id::text as level_id, count(*) as n
          from scored s cross join unnest(s.level_ids) as x (level_id)
          where s.f_type and s.f_bucket and s.f_duration and s.f_format and s.f_sub and s.f_approved
          group by x.level_id) l), '{}'::jsonb)))
  into v_result;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 4. Resources per attente, for « Parcourir le curriculum » (« 3 ressources · 1 approuvée »,
--    D-069): every attente of a grade and subject, with the number of resources the caller
--    can use and how many of them are board-approved. Counted like the results its link
--    opens (`?grade&subject&exp`): the same usable rule as search_library, items of that grade
--    and subject, linked to the attente, to its specific attentes (an overall attente) or to
--    its overall attente (a specific one).
-- ---------------------------------------------------------------------------------------

create function public.library_expectation_counts(p_grade_code text, p_subject_id uuid)
returns table (expectation_id uuid, item_count integer, approved_count integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user uuid := app.active_user_id();
  v_schools uuid[];
  v_boards uuid[];
begin
  if v_user is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_grade_code is null or p_subject_id is null then
    raise exception 'grade and subject required' using errcode = '22023';
  end if;
  v_schools := array(select app.my_staff_school_ids());
  v_boards := array(select app.my_board_ids());
  return query
    with visible as (
      select i.id, i.status = 'board_approved' as approved
      from public.library_items i
      where (i.author_id = v_user
          or (i.status in ('teacher_reviewed', 'board_approved')
            and ((i.share_scope = 'school' and i.school_id = any (v_schools))
              or (i.share_scope = 'board' and i.board_id = any (v_boards)))))
        and i.status <> 'archived'
        and (i.status <> 'rejected' or i.author_id = v_user)
        and i.subject_id = p_subject_id
        and exists (select 1 from public.library_item_grades g
                    where g.item_id = i.id and g.grade_code = p_grade_code)
    ),
    expectations as (
      select ce.id, ce.parent_id from public.curriculum_expectations ce
      where ce.grade_code = p_grade_code and ce.subject_id = p_subject_id
    ),
    -- Which linked attentes count for each attente: itself, its overall attente, its specific
    -- attentes.
    matches (expectation_id, linked_id) as (
      select e.id, e.id from expectations e
      union
      select e.id, e.parent_id from expectations e where e.parent_id is not null
      union
      select e.id, c.id from expectations e
      join public.curriculum_expectations c on c.parent_id = e.id
    )
    select m.expectation_id,
      count(distinct v.id)::integer,
      (count(distinct v.id) filter (where v.approved))::integer
    from matches m
    left join public.library_item_expectations le on le.expectation_id = m.linked_id
    left join visible v on v.id = le.item_id
    group by m.expectation_id;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 5. Permissions: functions are opt-in, as everywhere else. The query and band helpers stay
--    internal (the definer functions call them as their owner).
-- ---------------------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon;

grant execute on function
  public.search_library(jsonb, integer, integer),
  public.library_expectation_counts(text, uuid)
to authenticated;
