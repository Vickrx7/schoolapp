-- Catholic references: the operator loads a board's references from a file (DECISIONS D-146).
--
-- A new install has none (the demo's come from supabase/seed.sql), so the plans' « Moment de foi »,
-- the library's « Ajouter un lien avec la foi » and the faith moment of « Info-parents » stayed
-- empty until IP Lynx added rows with psql. `pnpm admin import-references --board <slug> --file
-- <x.json> [--apply]` now loads them (docs/catholic-references.md):
--
--  1. A natural key: a board has at most one reference per type and title. Importing a file again
--     updates its references instead of adding them twice, and a content pack's resource that
--     names a reference by type and title (D-100) finds at most one of the board's own. Shared
--     references (no board) are IP Lynx's, written by migrations only, and are not constrained.
--  2. `catholic_references_import`: the import, in one transaction, and its dry run (the same
--     writes, rolled back). An import that writes something is audited for the board's admins.
--  3. The audit catalogue and permissions: the operator (service role) only.
--
-- Errors: 22023 an unknown board, or a list the CLI never sends (not 1 to 500 references, a field
-- of the wrong kind or out of range, a type and title twice). LXQ00 is internal: it rolls a dry
-- run back and never leaves the function.
-- Tests: supabase/tests/39_catholic_references_import.test.sql

-- ---------------------------------------------------------------------------------------
-- 1. One reference per board, type and title
-- ---------------------------------------------------------------------------------------

-- References were added by hand until now: name any duplicates rather than fail on the index.
do $$
declare
  v_duplicates text;
begin
  select string_agg(format('%s %s « %s » (%s rows)', b.slug, d.type, d.title, d.n), '; '
           order by b.slug, d.type, d.title)
  into v_duplicates
  from (
    select r.board_id, r.type, r.title, count(*) as n
    from public.catholic_references r
    where r.board_id is not null
    group by r.board_id, r.type, r.title
    having count(*) > 1
  ) d
  join public.boards b on b.id = d.board_id;
  if v_duplicates is not null then
    raise exception 'several Catholic references of a board have the same type and title: %',
      v_duplicates
      using hint = 'Rename or delete the extra rows as the database owner (library resources '
        || 'point to a reference by id), then run the migrations again.';
  end if;
end;
$$;

create unique index catholic_references_board_type_title
  on public.catholic_references (board_id, type, title);

-- ---------------------------------------------------------------------------------------
-- 2. The import
-- ---------------------------------------------------------------------------------------

-- Writes a board's references from an import file and returns the report. The CLI has checked
-- the file (`referencesFileSchema` in apps/admin/src/commands/references.ts); this checks again
-- what it writes. `p_references` is an array of 1 to 500 objects:
--   {type, title, textFr, textEn, gradeMin, gradeMax, liturgicalSeason, tags, sourceNote, active}
-- with grade codes (K1, K2, 1 to 8) and every field present (null for none). Each is matched
-- with the board's reference of the same type and title:
--   create     none: a new reference of the board
--   update     another text, grade range, season, tag list, source note or state: rewritten in
--              place (same id: library resources and plans that name it keep it)
--   unchanged  the same: not written
-- The board's references the file does not name are kept as they are (`notInFile`): a file
-- retires one with `"active": false`. Shared references are never written. When something is
-- written: `catholic_references.imported {created, updated, unchanged, file_sha256}` in the
-- board's audit log, as the operator's action. One import at a time per board.
create function app.catholic_references_write(
  p_board_id uuid,
  p_references jsonb,
  p_file_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_index integer := 0;
  v_type public.catholic_reference_type;
  v_season public.liturgical_season;
  v_min smallint;
  v_max smallint;
  v_tags text[];
  v_text_en text;
  v_note text;
  v_active boolean;
  v_row public.catholic_references;
  v_changes text[];
  v_items jsonb := '[]';
  v_created integer := 0;
  v_updated integer := 0;
  v_unchanged integer := 0;
  v_not_in_file jsonb;
begin
  if p_board_id is null or not exists (select 1 from public.boards b where b.id = p_board_id) then
    raise exception 'unknown board' using errcode = '22023';
  end if;
  if jsonb_typeof(p_references) is distinct from 'array'
    or jsonb_array_length(p_references) not between 1 and 500
    or coalesce(p_file_sha256, '') !~ '^[0-9a-f]{64}$'
  then
    raise exception 'invalid references' using errcode = '22023';
  end if;
  if (select count(distinct (r ->> 'type', r ->> 'title')) from jsonb_array_elements(p_references) r)
    <> jsonb_array_length(p_references)
  then
    raise exception 'a type and title appear twice' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('catholic_references:' || p_board_id::text, 0));

  for v_item in select r from jsonb_array_elements(p_references) r loop
    v_index := v_index + 1;
    v_type := null;
    v_season := null;
    v_min := null;
    v_max := null;
    if jsonb_typeof(v_item) = 'object' then
      select t into v_type from unnest(enum_range(null::public.catholic_reference_type)) t
      where t::text = v_item ->> 'type';
      select s into v_season from unnest(enum_range(null::public.liturgical_season)) s
      where s::text = v_item ->> 'liturgicalSeason';
      select g.ordinal into v_min from public.grades g where g.code = v_item ->> 'gradeMin';
      select g.ordinal into v_max from public.grades g where g.code = v_item ->> 'gradeMax';
    end if;
    -- A missing field is invalid too (jsonb_typeof of a missing key is null).
    if jsonb_typeof(v_item) is distinct from 'object'
      or v_type is null
      or jsonb_typeof(v_item -> 'title') is distinct from 'string'
      or jsonb_typeof(v_item -> 'textFr') is distinct from 'string'
      or coalesce(jsonb_typeof(v_item -> 'textEn'), '') not in ('string', 'null')
      or v_min is null or v_max is null or v_max < v_min
      or (v_season is null and jsonb_typeof(v_item -> 'liturgicalSeason') is distinct from 'null')
      or (case when jsonb_typeof(v_item -> 'tags') = 'array' then
           jsonb_array_length(v_item -> 'tags') > 12
           or exists (select 1 from jsonb_array_elements(v_item -> 'tags') t
                      where jsonb_typeof(t) <> 'string'
                        or char_length(t #>> '{}') not between 1 and 40)
         else true end)
      or coalesce(jsonb_typeof(v_item -> 'sourceNote'), '') not in ('string', 'null')
      or jsonb_typeof(v_item -> 'active') is distinct from 'boolean'
    then
      raise exception 'invalid reference %', v_index using errcode = '22023';
    end if;
    v_tags := array(select jsonb_array_elements_text(v_item -> 'tags'));
    v_text_en := v_item ->> 'textEn';
    v_note := v_item ->> 'sourceNote';
    v_active := (v_item ->> 'active')::boolean;

    select * into v_row from public.catholic_references r
    where r.board_id = p_board_id and r.type = v_type and r.title = v_item ->> 'title'
    for update;

    if v_row.id is null then
      -- The table's checks refuse a title or text that is empty or too long.
      insert into public.catholic_references (board_id, type, title, text_fr, text_en, grade_min,
        grade_max, liturgical_season, tags, source_note, active)
      values (p_board_id, v_type, v_item ->> 'title', v_item ->> 'textFr', v_text_en, v_min, v_max,
        v_season, v_tags, v_note, v_active);
      v_created := v_created + 1;
      v_items := v_items || jsonb_build_object('type', v_type, 'title', v_item ->> 'title',
        'outcome', 'create', 'changes', '[]'::jsonb);
      continue;
    end if;

    v_changes := array_remove(array[
      case when v_row.text_fr is distinct from v_item ->> 'textFr' then 'textFr' end,
      case when v_row.text_en is distinct from v_text_en then 'textEn' end,
      case when v_row.grade_min is distinct from v_min or v_row.grade_max is distinct from v_max
        then 'grades' end,
      case when v_row.liturgical_season is distinct from v_season then 'liturgicalSeason' end,
      case when v_row.tags is distinct from v_tags then 'tags' end,
      case when v_row.source_note is distinct from v_note then 'sourceNote' end,
      case when v_row.active is distinct from v_active then 'active' end
    ], null);
    if cardinality(v_changes) = 0 then
      v_unchanged := v_unchanged + 1;
      v_items := v_items || jsonb_build_object('type', v_type, 'title', v_row.title,
        'outcome', 'unchanged', 'changes', '[]'::jsonb);
      continue;
    end if;
    update public.catholic_references
    set text_fr = v_item ->> 'textFr', text_en = v_text_en, grade_min = v_min, grade_max = v_max,
        liturgical_season = v_season, tags = v_tags, source_note = v_note, active = v_active
    where id = v_row.id;
    v_updated := v_updated + 1;
    v_items := v_items || jsonb_build_object('type', v_type, 'title', v_row.title,
      'outcome', 'update', 'changes', to_jsonb(v_changes));
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('type', r.type, 'title', r.title,
      'active', r.active) order by r.type, r.title), '[]'::jsonb)
  into v_not_in_file
  from public.catholic_references r
  where r.board_id = p_board_id
    and not exists (
      select 1 from jsonb_array_elements(p_references) f
      where f ->> 'type' = r.type::text and f ->> 'title' = r.title);

  if v_created + v_updated > 0 then
    perform app.log_audit('catholic_references.imported', p_board_id, null, 'board', p_board_id,
      jsonb_build_object('created', v_created, 'updated', v_updated, 'unchanged', v_unchanged,
        'file_sha256', p_file_sha256),
      'service');
  end if;

  return jsonb_build_object(
    'counts', jsonb_build_object('created', v_created, 'updated', v_updated,
      'unchanged', v_unchanged, 'notInFile', jsonb_array_length(v_not_in_file)),
    'references', v_items,
    'notInFile', v_not_in_file);
end;
$$;

-- The operator's import (`pnpm admin import-references`): with `p_apply`, the references are
-- written in the caller's transaction; without it (the CLI's default), the same writes run and
-- are rolled back, so the report is exact and nothing is written (no reference, no audit line).
create function public.catholic_references_import(
  p_board_id uuid,
  p_references jsonb,
  p_file_sha256 text,
  p_apply boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report jsonb;
begin
  if coalesce(p_apply, false) then
    return app.catholic_references_write(p_board_id, p_references, p_file_sha256)
      || jsonb_build_object('dryRun', false);
  end if;
  begin
    v_report := app.catholic_references_write(p_board_id, p_references, p_file_sha256);
    raise exception 'dry run' using errcode = 'LXQ00';
  exception when sqlstate 'LXQ00' then
    null;
  end;
  return v_report || jsonb_build_object('dryRun', true);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 3. The audit catalogue (D-103) and permissions
-- ---------------------------------------------------------------------------------------

-- The board's admins read it in « Journal d'audit », with the library's other imports.
insert into public.audit_action_catalog (action, category, audience) values
  ('catholic_references.imported', 'library', 'board');

revoke execute on function
  app.catholic_references_write(uuid, jsonb, text),
  public.catholic_references_import(uuid, jsonb, text, boolean)
from public, anon, authenticated;

grant execute on function public.catholic_references_import(uuid, jsonb, text, boolean)
  to service_role;
