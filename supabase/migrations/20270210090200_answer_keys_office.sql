-- Answer keys follow the library's screens (D-149, amending D-062 and D-065).
--
-- Until now, whoever could read an item read its answer keys: office and facilities staff, and
-- board admins who are not reviewers, read the keys of every resource shared with their school or
-- board through the API, although they have no library screens (D-078). Keys are now read by:
--   - the item's author;
--   - a reviewer designated by the item's board (content or faith), for the items she can read;
--   - a teacher, principal or vice-principal the sharing reaches: a role at the item's school for
--     an item shared with the school, anywhere in its board for one shared with the board.
-- Office and facilities staff, and board admins who are not reviewers, still read shared items
-- (D-065), without their keys.
--
-- 1. Who reads an item's keys: app.library_item_keys_readable_by (the worker and the operator)
--    and app.can_read_library_item_keys (the current user, for row level security).
-- 2. Row level security on library_item_answer_keys: the select policy uses it.
-- 3. « Adapter » (remix_library_item) copies the keys only for someone who may read them, so a
--    copy cannot bring them back.
-- 4. Permissions.
--
-- Unchanged, and why: the item page, the teacher print and PDF and « Afficher la réponse » read
-- keys as the user (row level security above). The device quiz (start_class_session) needs a
-- teacher role in the class's team (D-090); the editor, « Créer les versions manquantes » and the
-- readiness checks need an editor or a reviewer; substitute plans only learn whether a key exists
-- (app.sub_plan_library_sources, D-062); content pack exports are the operator's (D-099).
--
-- DECISIONS: D-149 (amending D-062 and D-065).
-- Tests: supabase/tests/41_answer_keys_office.test.sql

-- ---------------------------------------------------------------------------------------
-- 1. Who reads an item's keys
-- ---------------------------------------------------------------------------------------

-- Whether the user reads the item's answer keys: she reads the item, and she is its author, a
-- reviewer designated by its board, or a teacher, principal or vice-principal the sharing reaches
-- (the roles with library screens, D-078).
create function app.library_item_keys_readable_by(p_user uuid, p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.library_item_readable_by(p_user, p_item_id) and exists (
    select 1 from public.library_items i
    where i.id = p_item_id
      and (
        i.author_id = p_user
        or app.library_reviewer(p_user, i.board_id, 'content')
        or app.library_reviewer(p_user, i.board_id, 'faith')
        or exists (
          select 1 from public.user_roles ur
          where ur.user_id = p_user
            and ur.role in ('teacher', 'principal', 'vice_principal')
            and (
              (i.share_scope = 'school' and ur.school_id = i.school_id)
              or (i.share_scope = 'board' and ur.board_id = i.board_id)
            )
        )
      )
  );
$$;

create function app.can_read_library_item_keys(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.library_item_keys_readable_by(app.active_user_id(), p_item_id);
$$;

-- ---------------------------------------------------------------------------------------
-- 2. Row level security on the keys (the policy of 20260928160700_library.sql)
-- ---------------------------------------------------------------------------------------

drop policy library_item_answer_keys_select on public.library_item_answer_keys;
create policy library_item_answer_keys_select on public.library_item_answer_keys
  for select to authenticated
  using (
    app.can_read_library_item_keys(
      (select v.item_id from public.library_item_versions v where v.id = version_id)
    )
  );

-- ---------------------------------------------------------------------------------------
-- 3. « Adapter » (20261101090100_library_growth.sql, D-092): as before, except that each
--    version's key is copied only when the user may read the original's keys.
-- ---------------------------------------------------------------------------------------

create or replace function public.remix_library_item(p_item_id uuid, p_new_id uuid)
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
  v_keys boolean;
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
  -- Someone who may not read the original's keys (office or facilities staff, a board admin who
  -- is not a reviewer) gets a copy without them (D-149).
  v_keys := app.library_item_keys_readable_by(v_user, v_src.id);

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
    if v_keys then
      insert into public.library_item_answer_keys (version_id, answer_key)
      select v_version, k.answer_key from public.library_item_answer_keys k where k.version_id = r.id;
    end if;
  end loop;

  perform app.library_refresh_search(p_new_id);
  perform app.log_audit('library_item.remixed', v_src.board_id, v_school, 'library_item', p_new_id,
    jsonb_build_object('parent_item_id', v_src.id));
  return p_new_id;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 4. Permissions: the predicate that takes a user is the worker's and the operator's; row level
--    security runs the current user's form. Replacing remix_library_item keeps its grants.
-- ---------------------------------------------------------------------------------------

revoke execute on function app.library_item_keys_readable_by(uuid, uuid),
  app.can_read_library_item_keys(uuid)
from public, anon;
revoke execute on function app.library_item_keys_readable_by(uuid, uuid) from authenticated;
grant execute on function app.can_read_library_item_keys(uuid) to authenticated;
grant execute on function app.library_item_keys_readable_by(uuid, uuid) to service_role;
