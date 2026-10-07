-- Phase 5: library growth. The board's own items, adaptations (« Adapter ») with their lineage and
-- credit, and opinions (« Votre avis ») with the usage counts the cards show.
--
--  1. Board items: `board_owned` replaces « board_created with no author » (D-091). Adaptations:
--     the original's title at copy time, the sharing cap, and the licence's « no derivatives ».
--  2. The predicates and workflow functions of Phase 4 that named board items, rewritten on
--     `board_owned` (same signatures); approving a board item makes it board-wide; an adaptation
--     that may not go beyond one school cannot be proposed to the board.
--  3. The sharing cap, enforced by a trigger on every write path (D-092).
--  4. Deleting board drafts: the board's content reviewers (D-091).
--  5. Opinions: written through rate_library_item only; a rating is readable by its rater only.
--  6. « Adapter »: remix_library_item.
--  7. The credit line: library_item_lineage (the direct parent only, names read live).
--  8. Opinions and usage: rate_library_item and library_item_stats.
--  9. Permissions.
--
-- Error codes the app translates: LXM01 an archived item cannot be adapted, LXM02 the licence
-- forbids adapting it, LXM03 sharing wider than the original allows (from the trigger: any path),
-- LXR01 an opinion on one's own item, LXR02 an opinion on an item that is not board-approved.
-- DECISIONS: D-091, D-092, D-093 (amending D-063 and D-065).
-- Tests: supabase/tests/22_library_growth.test.sql

-- ---------------------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------------------

alter table public.library_items
  -- The board's own item (seed, bulk drafts, pack imports): no author, kept by the board's
  -- content reviewers (D-091). Set at creation; never changes.
  add column board_owned boolean not null default false,
  -- An adaptation: the original's title when it was adapted, so the credit line can still name
  -- it when the original is gone or no longer shared with the reader (D-092).
  add column parent_title text check (char_length(parent_title) <= 200),
  -- The widest sharing an adaptation may have: an adaptation of an item shared with one school
  -- stays within that school (D-092). No foreign key on purpose: it only records the cap.
  add column share_cap public.share_scope check (share_cap is null or share_cap = 'school'),
  add column share_cap_school_id uuid,
  -- The licence forbids derivatives (a content pack's choice): « Adapter » is refused.
  add column no_derivatives boolean not null default false,
  add constraint library_items_board_owned_no_author check (not board_owned or author_id is null),
  add constraint library_items_share_cap_school
    check ((share_cap is null) = (share_cap_school_id is null));

-- The board's items so far: the seed's and tests' board items. An item whose author was deleted
-- (teacher_created, author set null) stays a teacher's item that nobody reads (D-065).
update public.library_items set board_owned = true
where source = 'board_created' and author_id is null;

-- Whether the current user reviews the board's content or faith content (for policies; the
-- predicate taking a user stays service-role only).
create function app.am_library_reviewer(p_board_id uuid, p_kind text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.library_reviewer(app.active_user_id(), p_board_id, p_kind);
$$;

-- ---------------------------------------------------------------------------------------
-- 2. Board items in the Phase 4 predicates and workflow (D-091)
-- ---------------------------------------------------------------------------------------

-- Readable (what row level security uses): usable, or one of the reviewers' cases. Content
-- reviewers read requested, shared or approved items and the board's own items at any status;
-- faith reviewers read requested items that need a faith review.
create or replace function app.library_item_readable_by(p_user uuid, p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.library_item_usable_by(p_user, p_item_id) or exists (
    select 1 from public.library_items i
    where i.id = p_item_id
      and (
        (app.library_reviewer(p_user, i.board_id, 'content')
          and (i.review_requested_at is not null or i.share_scope <> 'private' or i.board_owned))
        or (app.library_reviewer(p_user, i.board_id, 'faith')
          and i.review_requested_at is not null and i.requires_faith_review)
      )
  );
$$;

-- Editable: the author while she is staff of the item's board, or a content reviewer for the
-- board's own items, while the item is a draft, reviewed or sent back. Approved items are
-- read-only for everyone.
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
        or (i.board_owned and app.library_reviewer(p_user, i.board_id, 'content'))
      )
  );
$$;

-- The board's own items are kept (archived, restored) by its content reviewers; others by their
-- author.
create or replace function app.library_item_keeper(p_user uuid, p_item public.library_items)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null and (
    p_item.author_id = p_user
    or (p_item.board_owned and app.library_reviewer(p_user, p_item.board_id, 'content'))
  );
$$;

-- « Proposer au conseil »: a reviewed item that is ready for approval, without versions for
-- personal levels, goes into the reviewers' queue. An adaptation that may be shared at most with
-- one school (D-092) cannot be proposed: approval makes an item board-wide.
create or replace function public.library_request_approval(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.active_user_id();
  v public.library_items;
begin
  select * into v from public.library_items where id = p_item_id for update;
  if v_user is null or v.id is null or not app.library_item_editable_by(v_user, v.id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v.status <> 'teacher_reviewed' or v.review_requested_at is not null then
    raise exception 'not reviewed, or already requested' using errcode = 'LXL04';
  end if;
  if v.share_cap is not null then
    raise exception 'sharing wider than the original' using errcode = 'LXM03';
  end if;
  perform app.library_assert_ready(v.id, true);
  if app.library_has_personal_levels(v.id) then
    raise exception 'personal levels on a shared item' using errcode = 'LXL10';
  end if;
  update public.library_items
  set review_requested_at = now(), review_requested_by = v_user
  where id = v.id;
  perform app.log_audit('library_item.review_requested', v.board_id, v.school_id, 'library_item',
    v.id, jsonb_build_object('revision', v.content_revision));
  perform app.emit_event('library_item.review_requested', v.board_id, v.school_id, 'library_item',
    v.id, jsonb_build_object('itemId', v.id));
end;
$$;

-- A content reviewer approves a requested item for the whole board, or sends it back with a
-- note. Never their own item; refused if it changed since the reviewer opened it; faith content
-- is faith-reviewed first. Approval makes an item board-wide; the board's own items, private
-- until then, lose any school (D-091).
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
declare
  v_user uuid := app.active_user_id();
  v public.library_items;
  v_note text := nullif(btrim(p_note), '');
begin
  select * into v from public.library_items where id = p_item_id for update;
  if v_user is null or v.id is null or not app.library_reviewer(v_user, v.board_id, 'content') then
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
  if v.author_id = v_user then
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
        approved_at = now(), approved_by = v_user,
        review_requested_at = null, review_requested_by = null, review_note = null
    where id = v.id;
    perform app.log_audit('library_item.approved', v.board_id, v.school_id, 'library_item', v.id,
      jsonb_build_object('type', v.type, 'revision', v.content_revision,
        'faith_reviewed', v.requires_faith_review));
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

-- (library_restore and library_archive follow app.library_item_keeper; the review queue already
-- names no author for the board's items.)

-- ---------------------------------------------------------------------------------------
-- 3. The sharing cap (D-092): an adaptation never goes wider than its original, whatever writes
--    it (sharing, approval, a faith flag, a content change). Also: a board item stays one, and
--    the lineage and licence columns are never written through the API. Security invoker on
--    purpose: `current_user` is the API role for a direct write, and the functions' owner inside
--    the workflow functions.
-- ---------------------------------------------------------------------------------------

create function app.library_items_share_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.board_owned is distinct from old.board_owned then
      raise exception 'board ownership never changes' using errcode = '22023';
    end if;
    if (new.share_cap, new.share_cap_school_id, new.no_derivatives, new.parent_title)
        is distinct from (old.share_cap, old.share_cap_school_id, old.no_derivatives, old.parent_title)
      and current_user in ('authenticated', 'anon')
    then
      raise exception 'not allowed' using errcode = '42501';
    end if;
  end if;
  if new.share_cap = 'school' and not (
    new.share_scope = 'private'
    or (new.share_scope = 'school' and new.school_id is not distinct from new.share_cap_school_id)
  ) then
    raise exception 'sharing wider than the original' using errcode = 'LXM03';
  end if;
  return new;
end;
$$;

create trigger library_items_share_cap before insert or update on public.library_items
  for each row execute function app.library_items_share_cap();

-- ---------------------------------------------------------------------------------------
-- 4. Deleting: the author's drafts, sent-back and archived items, and the board's own drafts
--    for its content reviewers (D-091).
-- ---------------------------------------------------------------------------------------

drop policy library_items_delete on public.library_items;
create policy library_items_delete on public.library_items
  for delete to authenticated
  using (
    status in ('draft', 'rejected', 'archived')
    and (author_id = (select app.active_user_id())
      or (board_owned and app.am_library_reviewer(board_id, 'content')))
  );

-- ---------------------------------------------------------------------------------------
-- 5. Opinions (D-093): written through rate_library_item only; a rating is readable by its rater
--    only and never audited.
-- ---------------------------------------------------------------------------------------

alter table public.library_item_ratings add column updated_at timestamptz not null default now();

drop policy library_item_ratings_own on public.library_item_ratings;
revoke insert, update, delete on public.library_item_ratings from authenticated;
create policy library_item_ratings_select on public.library_item_ratings
  for select to authenticated
  using (rater_id = (select app.active_user_id()));

-- ---------------------------------------------------------------------------------------
-- 6. « Adapter » (D-092): a private copy of an item the user can use, with lineage and credit.
--    The client chooses the copy's id once per dialog: the same request sent again returns the
--    same copy. Copied: grades, attentes, tags, keywords, materials, duration, formats, safety
--    notes, the faith fields (the faith review applies again) and the licence, and each version
--    for the base, a board level or the user's own personal level, with its key. Not copied:
--    `sub_friendly`, AI provenance, the pack link, who flagged faith content, opinions and usage.
-- ---------------------------------------------------------------------------------------

create function public.remix_library_item(p_item_id uuid, p_new_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.active_user_id();
  v_src public.library_items;
  v_existing public.library_items;
  v_cap public.share_scope;
  v_cap_school uuid;
  v_school uuid;
  r record;
  v_version uuid;
begin
  if v_user is null or p_item_id is null or p_new_id is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_existing from public.library_items where id = p_new_id;
  if v_existing.id is not null then
    -- A retried request: its first sending went through.
    if v_existing.author_id = v_user and v_existing.parent_item_id = p_item_id then
      return p_new_id;
    end if;
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select * into v_src from public.library_items where id = p_item_id for share;
  if v_src.id is null or not app.library_item_usable_by(v_user, v_src.id)
    -- A new item belongs to a board where the user works (as save_library_item requires).
    or not app.library_board_staff(v_user, v_src.board_id)
  then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_src.status = 'archived' then
    raise exception 'archived' using errcode = 'LXM01';
  end if;
  if v_src.no_derivatives then
    raise exception 'licence' using errcode = 'LXM02';
  end if;

  -- The cap: the original's audience, unless the user owns it or it reaches the whole board; a
  -- copy of a capped item keeps the cap.
  if v_src.share_cap is not null then
    v_cap := v_src.share_cap;
    v_cap_school := v_src.share_cap_school_id;
  elsif v_src.author_id is distinct from v_user and v_src.status <> 'board_approved'
    and v_src.share_scope = 'school'
  then
    v_cap := 'school';
    v_cap_school := v_src.school_id;
  end if;

  -- The copy's school: the cap's, else the original's when the user works there, else the
  -- user's only school in the board (none when she has several: she picks one when sharing).
  v_school := case
    when v_cap is not null then v_cap_school
    when v_src.school_id in (select app.my_staff_school_ids()) then v_src.school_id
  end;
  if v_school is null and v_cap is null then
    select case when count(*) = 1 then (array_agg(s.id))[1] end into v_school
    from public.schools s
    where s.board_id = v_src.board_id and s.id in (select app.my_staff_school_ids());
  end if;

  insert into public.library_items (id, board_id, school_id, type, title, summary, status,
    share_scope, source, author_id, licence, parent_item_id, parent_title, share_cap,
    share_cap_school_id, subject_id, duration_minutes, materials, keywords, is_printable,
    is_projectable, is_interactive, sub_friendly, safety_notes, faith_content,
    faith_on_student_sheet, catholic_connection, catholic_reference_id)
  values (p_new_id, v_src.board_id, v_school, v_src.type, v_src.title, v_src.summary, 'draft',
    'private', 'teacher_created', v_user, v_src.licence, v_src.id, left(v_src.title, 200), v_cap,
    v_cap_school, v_src.subject_id, v_src.duration_minutes, v_src.materials, v_src.keywords,
    v_src.is_printable, v_src.is_projectable, v_src.is_interactive, false, v_src.safety_notes,
    v_src.faith_content, v_src.faith_on_student_sheet, v_src.catholic_connection,
    v_src.catholic_reference_id);

  insert into public.library_item_grades (item_id, grade_code)
  select p_new_id, g.grade_code from public.library_item_grades g where g.item_id = v_src.id;
  insert into public.library_item_expectations (item_id, expectation_id)
  select p_new_id, e.expectation_id from public.library_item_expectations e where e.item_id = v_src.id;
  insert into public.library_item_tags (item_id, tag_id)
  select p_new_id, t.tag_id from public.library_item_tags t where t.item_id = v_src.id;

  -- The base version, board levels and the user's own levels (a colleague's personal level is
  -- never copied: she cannot read it).
  for r in
    select v.id, v.language_level_id, v.schema_version, v.content
    from public.library_item_versions v
    left join public.language_levels ll on ll.id = v.language_level_id
    where v.item_id = v_src.id
      and (v.language_level_id is null or ll.owner_user_id is null or ll.owner_user_id = v_user)
    order by v.language_level_id nulls first
  loop
    insert into public.library_item_versions (item_id, language_level_id, schema_version, content)
    values (p_new_id, r.language_level_id, r.schema_version, r.content)
    returning id into v_version;
    insert into public.library_item_answer_keys (version_id, answer_key)
    select v_version, k.answer_key from public.library_item_answer_keys k where k.version_id = r.id;
  end loop;

  perform app.library_refresh_search(p_new_id);
  perform app.log_audit('library_item.remixed', v_src.board_id, v_school, 'library_item', p_new_id,
    jsonb_build_object('parent_item_id', v_src.id));
  return p_new_id;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 7. The credit line (D-092): the direct parent of an item the user can read. When the user can
--    use the original: its id and title, and who made it (`pack`: the content pack's title;
--    `board`: the board's own item; `author`: « Mme Tremblay », with the school's short name when
--    the original is shared with its school only). Otherwise only the title copied at adaptation
--    time, with no id and no name. No row for an item that is not an adaptation.
-- ---------------------------------------------------------------------------------------

create function public.library_item_lineage(p_item_id uuid)
returns table (
  parent_id uuid,
  title text,
  available boolean,
  credit_kind text,
  credit_name text,
  school_name text,
  pack_title text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user uuid := app.active_user_id();
  v public.library_items;
  p public.library_items;
begin
  if v_user is null or p_item_id is null or not app.library_item_readable_by(v_user, p_item_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v from public.library_items i where i.id = p_item_id;
  if v.parent_item_id is null and v.parent_title is null then
    return;
  end if;
  if v.parent_item_id is not null and app.library_item_usable_by(v_user, v.parent_item_id) then
    select * into p from public.library_items i where i.id = v.parent_item_id;
    return query
      select p.id, p.title, true,
        case
          when p.content_pack_id is not null then 'pack'
          when p.board_owned then 'board'
          when p.author_id is not null then 'author'
        end,
        case when p.content_pack_id is null and not p.board_owned then (
          select app.formal_staff_name(u.display_name, u.honorific)
          from public.users u where u.id = p.author_id) end,
        case when p.content_pack_id is null and not p.board_owned and p.share_scope = 'school' then (
          select coalesce(nullif(btrim(s.short_name), ''), s.name)
          from public.schools s where s.id = p.school_id) end,
        case when p.content_pack_id is not null then (
          select cp.title from public.content_packs cp where cp.id = p.content_pack_id) end;
  else
    return query
      select null::uuid, v.parent_title, false, null::text, null::text, null::text, null::text;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 8. Opinions and usage (D-093)
-- ---------------------------------------------------------------------------------------

-- « Votre avis »: 1 to 5 stars on a board-approved item the user can use and did not write; null
-- takes the user's opinion back.
create function public.rate_library_item(p_item_id uuid, p_rating smallint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.active_user_id();
  v public.library_items;
begin
  select * into v from public.library_items where id = p_item_id;
  if v_user is null or v.id is null or not app.library_item_usable_by(v_user, v.id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v.author_id = v_user then
    raise exception 'own item' using errcode = 'LXR01';
  end if;
  if v.status <> 'board_approved' then
    raise exception 'not board-approved' using errcode = 'LXR02';
  end if;
  if p_rating is null then
    delete from public.library_item_ratings where item_id = v.id and rater_id = v_user;
    return;
  end if;
  if p_rating not between 1 and 5 then
    raise exception 'invalid rating' using errcode = '22023';
  end if;
  insert into public.library_item_ratings (item_id, rater_id, rating)
  values (v.id, v_user, p_rating)
  on conflict (item_id, rater_id) do update set rating = excluded.rating, updated_at = now();
end;
$$;

-- Opinions and usage of up to 50 items (a page of results, or one item page), for the items the
-- user can use: the average, rounded to the half star, from 5 opinions (null below); the number
-- of opinions and the user's own, for board-approved items only (null otherwise); the number of
-- units whose lessons link the item.
create function public.library_item_stats(p_item_ids uuid[])
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
      from public.library_item_ratings x where x.item_id = i.id
    ) r
    where i.id = any (coalesce(p_item_ids, '{}'::uuid[]))
      and app.library_item_usable_by(v_user, i.id)
    order by i.id;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 9. Permissions: functions are opt-in, as everywhere else.
-- ---------------------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon;

grant execute on function
  public.remix_library_item(uuid, uuid),
  public.library_item_lineage(uuid),
  public.rate_library_item(uuid, smallint),
  public.library_item_stats(uuid[]),
  app.am_library_reviewer(uuid, text)
to authenticated;
