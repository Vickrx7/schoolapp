-- Phase 4 hardening (library): fixes from the review of the Phase 4 build.
--
-- 1. Faith content reaches the whole board only once faith-reviewed, whatever the path (D-064):
--    an edit ends the earlier faith review, so a reviewed item shared with the whole board that
--    needs one goes back to its school (or private) at the edit, not only when it is next shared.
--    The save and « Créer les versions manquantes avec l'IA » both go through
--    app.library_content_changed, which now does it.
-- 2. AI output is a draft its author reads (D-072, D-073, SPEC 9.3): versions the AI adds to a
--    reviewed resource return it to a private draft, so its author reads them, marks it reviewed
--    and shares it again (the first-name guard and the faith gate run again).
-- 3. Authors act on their items only while they are staff of the item's board: someone who left
--    the board (every role removed, account still active) can still read her items but no longer
--    edit them, propose them or widen their sharing (D-065).
-- 4. Search: numbers written with thousands separators (« 1 000 », with a space, a no-break
--    space or a narrow no-break space) are one word in documents and queries, so « 1000 » finds
--    « 1 000 »; a curriculum code typed as written (« B1.2 ») matches that code only, not its
--    siblings (D-068). Every search document is rebuilt.
--
-- DECISIONS: D-064, D-065, D-068, D-073, D-079.
-- Tests: supabase/tests/15_library_workflow.test.sql, supabase/tests/17_library_search.test.sql,
-- supabase/tests/18_library_ai.test.sql

-- ---------------------------------------------------------------------------------------
-- 1. Faith content and the whole board (D-064)
-- ---------------------------------------------------------------------------------------

-- After any content change (D-063): a new revision, a pending approval request and an earlier
-- faith review no longer apply, the search document follows, and plans that may use a reviewed
-- item are rebuilt. A reviewed item shared with the whole board that needs a faith review (now
-- that the earlier one no longer counts, or because the change added faith content) goes back to
-- its school, or private without one, as « Signaler du contenu de foi » does. Whether it needs
-- one is read after the update: the items trigger computes it.
create or replace function app.library_content_changed(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.library_items;
  v_scope public.share_scope;
begin
  update public.library_items i
  set content_revision = i.content_revision + 1,
      review_requested_at = null, review_requested_by = null,
      faith_reviewed_at = null, faith_reviewed_by = null
  where i.id = p_item_id
  returning i.* into v;
  if v.id is null then
    return;
  end if;
  if v.status = 'teacher_reviewed' and v.share_scope = 'board' and v.requires_faith_review then
    v_scope := case when v.school_id is not null then 'school' else 'private' end;
    update public.library_items set share_scope = v_scope where id = v.id;
    perform app.log_audit('library_item.scope_reduced', v.board_id, v.school_id, 'library_item',
      v.id, jsonb_build_object('scope', v_scope, 'reason', 'faith_review'));
  end if;
  perform app.library_refresh_search(p_item_id);
  if v.status = 'teacher_reviewed' then
    perform app.flag_absences_for_library_item(p_item_id);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 3. Authors are staff of the item's board (D-065). Defined before section 2, which uses it.
-- ---------------------------------------------------------------------------------------

-- Whether the user holds any role but parent in the board.
create function app.library_board_staff(p_user uuid, p_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = p_user and ur.board_id = p_board_id and ur.role <> 'parent'
  );
$$;

-- Editable: the author while she is staff of the item's board, or a content reviewer for the
-- board's own items (no author), while the item is a draft, reviewed or sent back. Approved items
-- are read-only for everyone.
create or replace function app.library_item_editable_by(p_user uuid, p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.library_items i
    join public.users u on u.id = p_user and u.deactivated_at is null
    where i.id = p_item_id
      and i.status in ('draft', 'teacher_reviewed', 'rejected')
      and (
        (i.author_id = p_user and app.library_board_staff(p_user, i.board_id))
        or (i.source = 'board_created' and i.author_id is null
          and app.library_reviewer(p_user, i.board_id, 'content'))
      )
  );
$$;

-- « Partager »: the author shares a reviewed item with her school or the whole board, or makes
-- it private again. Faith content reaches the whole board only once faith-reviewed; versions
-- for personal levels keep it private; sharing beyond herself needs her to be staff of the
-- item's board (making it private never does). `p_names_confirmed` is how many first names the
-- author confirmed as « Ce n'est pas un nom d'élève » (the web server's guard, D-066).
create or replace function public.library_share(
  p_item_id uuid,
  p_scope public.share_scope,
  p_school_id uuid default null,
  p_names_confirmed integer default 0
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.active_user_id();
  v public.library_items;
  v_school uuid;
begin
  select * into v from public.library_items where id = p_item_id for update;
  if v_user is null or v.id is null or v.author_id is distinct from v_user
    or (p_scope is distinct from 'private' and not app.library_board_staff(v_user, v.board_id))
  then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_scope is null or p_names_confirmed is null or p_names_confirmed not between 0 and 1000 then
    raise exception 'invalid sharing' using errcode = '22023';
  end if;
  if v.status <> 'teacher_reviewed' then
    raise exception 'only reviewed items are shared' using errcode = 'LXL04';
  end if;
  v_school := case when p_scope = 'school' then coalesce(p_school_id, v.school_id) else v.school_id end;
  if p_scope = 'school' then
    if v_school is null then
      raise exception 'a school is required' using errcode = '22023';
    end if;
    if v_school not in (select app.my_staff_school_ids())
      or not exists (select 1 from public.schools s where s.id = v_school and s.board_id = v.board_id)
    then
      raise exception 'not allowed' using errcode = '42501';
    end if;
  end if;
  if p_scope = 'board' and v.requires_faith_review and v.faith_reviewed_at is null then
    raise exception 'faith review pending' using errcode = 'LXL03';
  end if;
  if p_scope <> 'private' and app.library_has_personal_levels(v.id) then
    raise exception 'personal levels on a shared item' using errcode = 'LXL10';
  end if;

  update public.library_items set share_scope = p_scope, school_id = v_school where id = v.id;
  -- Fewer people can use it now: plans that did are rebuilt.
  if (v.share_scope = 'board' and p_scope <> 'board')
    or (v.share_scope = 'school' and (p_scope = 'private' or v_school is distinct from v.school_id))
  then
    perform app.flag_absences_for_library_item(v.id);
  end if;
  perform app.log_audit('library_item.shared', v.board_id, v_school, 'library_item', v.id,
    jsonb_build_object('scope', p_scope, 'names_confirmed', p_names_confirmed));
  perform app.emit_event('library_item.shared', v.board_id, v_school, 'library_item', v.id,
    jsonb_build_object('itemId', v.id, 'scope', p_scope));
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 2. Versions from the AI return a reviewed resource to a private draft (D-073)
-- ---------------------------------------------------------------------------------------

-- The versions of « Créer les versions manquantes avec l'IA »: only while the requester may
-- still edit the resource and it has not changed since the request (its revision); levels it
-- has since received are skipped, and so are personal levels once it is shared. A reviewed
-- resource that gains versions becomes a private draft again (audited as returned to draft):
-- nobody else uses what the AI wrote before its author has read it. Returns how many versions
-- were added, or null when the resource changed; raises when the answer cannot be stored.
create or replace function app.library_levels_from_job(p_job public.ai_jobs)
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

  if v_count > 0 and v_item.status = 'teacher_reviewed' then
    update public.library_items
    set status = 'draft', share_scope = 'private', review_requested_at = null,
        review_requested_by = null
    where id = v_item.id;
    perform app.flag_absences_for_library_item(v_item.id);
    perform app.log_audit('library_item.returned_to_draft', v_item.board_id, v_item.school_id,
      'library_item', v_item.id,
      jsonb_build_object('scope', v_item.share_scope, 'reason', 'ai_levels'));
  end if;
  if v_count > 0 then
    perform app.library_content_changed(v_item.id);
  end if;
  perform app.log_audit('library_item.levels_generated', v_item.board_id, p_job.school_id,
    'library_item', v_item.id, jsonb_build_object('ai_job_id', p_job.id, 'count', v_count));
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 4. Search: numbers and curriculum codes (D-068)
-- ---------------------------------------------------------------------------------------

-- The text as it is searched: digit groups written with a space, a no-break space or a narrow
-- no-break space (« 1 000 000 ») become one number (« 1000000 »), in documents and queries
-- alike. The parser would otherwise see « 1 » and « 000 ».
create function app.library_search_text(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(coalesce(p_text, ''),
    '([0-9])[[:space:]  ]+(?=[0-9]{3}(?![0-9]))', '\1', 'g');
$$;

-- Every writer calls this after changing an item, its links or its base version. Weights: A the
-- title; B the summary, keywords, French type terms and tag labels; C the attentes (codes and
-- texts); D the materials and the text of the base version. Answer keys are never indexed.
create or replace function app.library_refresh_search(p_item_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.library_items i
  set search_document =
    setweight(to_tsvector('app.french_unaccent', app.library_search_text(i.title)), 'A')
    || setweight(to_tsvector('app.french_unaccent', app.library_search_text(concat_ws(' ',
         i.summary, i.keywords, app.library_type_terms(i.type),
         (select string_agg(t.label_fr, ' ')
          from public.library_item_tags it join public.tags t on t.id = it.tag_id
          where it.item_id = i.id)))), 'B')
    -- Codes as written (« B1.2 », one word that only this code has) and split into words
    -- (« B1 2 »), so an overall attente's code also finds its specific ones.
    || setweight(to_tsvector('app.french_unaccent', app.library_search_text(coalesce((
         select string_agg(ce.code || ' ' || regexp_replace(ce.code, '[^[:alnum:]]+', ' ', 'g')
           || ' ' || ce.text_fr, ' ')
         from public.library_item_expectations le
         join public.curriculum_expectations ce on ce.id = le.expectation_id
         where le.item_id = i.id), ''))), 'C')
    || setweight(to_tsvector('app.french_unaccent', app.library_search_text(concat_ws(' ',
         i.materials,
         (select app.library_content_text(v.content)
          from public.library_item_versions v
          where v.item_id = i.id and v.language_level_id is null)))), 'D')
  where i.id = p_item_id;
$$;

-- The text query (D-068). Digit groups are joined as in documents. A curriculum code typed as
-- written (« B1.2 », « c1.12 ») is one exact word, matched as the document has it, never as a
-- prefix (« B1.1 » must not find « B1.10 »). Everything else keeps letters and digits only, so
-- operators, quotes, apostrophes and hyphens become spaces: « défi-STIM » is two words, as the
-- search document has them, and nothing a teacher types can break the query. Every word is
-- required, up to 8; the last one also matches as a prefix (« hua » finds « huard »), unless it
-- is a code. Null when nothing is left to search for (empty, or stop words only).
create or replace function app.library_tsquery(p_text text)
returns tsquery
language plpgsql
stable
set search_path = ''
as $$
declare
  v_token text;
  v_word text;
  v_words text[] := '{}';
  v_codes boolean[] := '{}';
  v_query tsquery;
begin
  for v_token in
    select t.token
    from regexp_split_to_table(app.library_search_text(left(coalesce(p_text, ''), 200)),
      '[[:space:]  ]+') with ordinality as t (token, n)
    order by t.n
  loop
    exit when cardinality(v_words) >= 8;
    v_token := regexp_replace(v_token, '^[^[:alnum:]]+|[^[:alnum:]]+$', '', 'g');
    if v_token ~ '^[[:alpha:]][0-9]+(\.[0-9]+)+$' then
      v_words := v_words || lower(v_token);
      v_codes := v_codes || true;
    else
      for v_word in
        select w.word
        from regexp_split_to_table(btrim(regexp_replace(v_token, '[^[:alnum:]]+', ' ', 'g')), ' ')
          with ordinality as w (word, n)
        where w.word <> ''
        order by w.n
      loop
        v_words := v_words || v_word;
        v_codes := v_codes || false;
      end loop;
    end if;
  end loop;
  v_words := v_words[1:8];
  v_codes := v_codes[1:8];
  if coalesce(cardinality(v_words), 0) = 0 then
    return null;
  end if;
  select to_tsquery('app.french_unaccent', string_agg(
      quote_literal(t.word)
        || case when t.n = cardinality(v_words) and not t.code then ':*' else '' end,
      ' & ' order by t.n))
  into v_query
  from unnest(v_words, v_codes) with ordinality as t (word, code, n);
  -- Stop words only (« le la ») leave an empty query.
  return case when numnode(v_query) = 0 then null else v_query end;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 5. Permissions: functions are opt-in, as everywhere else.
-- ---------------------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon;

-- Takes a user: the worker and the operator only, like the other predicates.
grant execute on function app.library_board_staff(uuid, uuid) to service_role;

-- Every existing item gets its search document again.
select app.library_refresh_search(id) from public.library_items;
