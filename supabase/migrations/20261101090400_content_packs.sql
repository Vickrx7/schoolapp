-- Phase 5: content packs, format v1 (« ensembles de ressources »). A board's approved resources
-- travel to another install as one JSON file, through the admin CLI only: `export-pack` reads them
-- a page at a time, `import-pack` stages the file, previews it (a real dry run: the same writes,
-- rolled back) and applies it in one transaction. Imported resources are the board's own (D-091)
-- and wait, private, in its reviewers' queue; local edits win over later versions of the pack.
--
--  1. Columns: what a pack row records (the file's SHA-256, licence, counts, approver, report),
--     and each item's place in its pack (slug, key, content hash, the revision it was written at).
--  2. Staged imports: the header and items of a file, until applied or discarded (a day at most).
--  3. Export: the board's approved items as pack items, by code, a page at a time.
--  4. Staging.
--  5. Applying, and previewing (the same function, its writes rolled back).
--  6. Discarding, listing, the board's people for the CLI's name check, the export's audit line
--     and the clean-up.
--  7. Permissions: the operator (service role) only.
--
-- Error codes the CLI prints: LXP01 this version of the pack is already applied to the board,
-- LXP02 a later version of it is, LXP03 the import is no longer staged, LXP04 the approver is not
-- one of the board's content reviewers, LXP05 the staged items differ from the file's checksum
-- (staging was cut short). LXP00 is internal: it rolls a preview back and never leaves it.
-- DECISIONS: D-099, D-100, D-101 (amending D-065 and D-071).
-- Tests: supabase/tests/25_content_packs.test.sql

-- ---------------------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------------------

alter table public.content_packs
  add column format_version smallint not null default 1 check (format_version = 1),
  -- SHA-256 of the file as it was imported (« empreinte »); null for a pack loaded by a seed.
  add column file_sha256 text check (file_sha256 ~ '^[0-9a-f]{64}$'),
  add column licence text check (char_length(licence) <= 500),
  add column item_count integer not null default 0 check (item_count >= 0),
  -- The content reviewer named with `--approve --approver`, when the operator asked for it.
  add column approved_by uuid references public.users (id) on delete set null,
  -- Counts and keys by outcome (never titles or content).
  add column report jsonb check (report is null or (jsonb_typeof(report) = 'object'
    and pg_column_size(report) <= 1048576));

create index content_packs_imported_by_idx on public.content_packs (imported_by);
create index content_packs_approved_by_idx on public.content_packs (approved_by);

alter table public.library_items
  -- The pack (by slug) and key an item was imported or seeded with: a later version of the same
  -- pack finds it again. Never copied by « Adapter ».
  add column pack_slug text check (pack_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  add column pack_item_key text check (pack_item_key ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  -- The pack item's `hash` (SHA-256 of its canonical JSON) when it was last written.
  add column pack_content_hash text check (pack_content_hash ~ '^[0-9a-f]{64}$'),
  -- `content_revision` right after the pack wrote the item: a higher revision means it was edited
  -- here since, and later versions of the pack leave it alone (D-100).
  add column pack_revision integer,
  add constraint library_items_pack_key_pair check ((pack_slug is null) = (pack_item_key is null));

create unique index library_items_pack_key on public.library_items (board_id, pack_slug, pack_item_key)
  where pack_item_key is not null;

-- ---------------------------------------------------------------------------------------
-- 2. Staged imports (D-100): written and read by the functions below only. An import is
--    `staged` until applied or discarded; every import row is deleted after a day (the applied
--    result lives in content_packs and the items).
-- ---------------------------------------------------------------------------------------

create table public.content_pack_imports (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  version text not null check (version ~ '^\d{4}\.\d{1,3}$'),
  -- The file without its items: format, pack header, levels, tags, references and checksum.
  header jsonb not null check (jsonb_typeof(header) = 'object' and pg_column_size(header) <= 65536),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'staged' check (status in ('staged', 'applied', 'discarded')),
  created_at timestamptz not null default now(),
  applied_at timestamptz
);

create index content_pack_imports_board_idx on public.content_pack_imports (board_id);
create index content_pack_imports_created_idx on public.content_pack_imports (created_at);

create table public.content_pack_import_items (
  import_id uuid not null references public.content_pack_imports (id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  item jsonb not null check (jsonb_typeof(item) = 'object' and pg_column_size(item) <= 1048576),
  -- The CLI found faith words in its text (`suggestsFaithContent`): imported as faith content.
  faith_suggested boolean not null default false,
  primary key (import_id, key)
);

alter table public.content_pack_imports enable row level security;
alter table public.content_pack_import_items enable row level security;
revoke all on public.content_pack_imports, public.content_pack_import_items from anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 3. Export (D-099). What leaves the board: approved items, by code only (subject, grades,
--    attentes with their curriculum version, level codes, tag slugs, Catholic references as
--    (type, title)); never an id of a person, a name, a school or a personal level's version.
-- ---------------------------------------------------------------------------------------

-- One item as the CLI turns it into a pack item. Its key: the item's key in the pack being
-- exported again (same slug), else its id, so two packs' keys never collide in one export.
-- Nulls stay nulls (the CLI writes empty strings); lists come in a stable order, so exporting
-- the same item twice gives the same hash.
create function app.content_pack_export_item(p_item_id uuid, p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'key', case when i.pack_slug = p_slug then i.pack_item_key else i.id::text end,
    'type', i.type,
    'title', i.title,
    'summary', i.summary,
    'gradeCodes', coalesce((
      select jsonb_agg(g.grade_code order by gr.ordinal)
      from public.library_item_grades g join public.grades gr on gr.code = g.grade_code
      where g.item_id = i.id), '[]'::jsonb),
    'subjectCode', s.code,
    'expectations', coalesce((
      select jsonb_agg(jsonb_build_object('curriculumVersion', ce.curriculum_version,
          'gradeCode', ce.grade_code, 'code', ce.code)
        order by ce.curriculum_version, ce.grade_code, ce.code)
      from public.library_item_expectations le
      join public.curriculum_expectations ce on ce.id = le.expectation_id
      where le.item_id = i.id), '[]'::jsonb),
    'durationMinutes', i.duration_minutes,
    'materials', i.materials,
    'keywords', i.keywords,
    'formats', jsonb_build_object('printable', i.is_printable, 'projectable', i.is_projectable,
      'interactive', i.is_interactive),
    'safetyNotes', i.safety_notes,
    'faith', jsonb_build_object(
      'faithContent', i.faith_content,
      'catholicConnection', i.catholic_connection,
      'reference', (select jsonb_build_object('type', r.type, 'title', r.title)
                    from public.catholic_references r where r.id = i.catholic_reference_id),
      'onStudentSheet', i.faith_on_student_sheet),
    'tags', coalesce((
      select jsonb_agg(jsonb_build_object('slug', t.slug, 'label', t.label_fr) order by t.slug)
      from public.library_item_tags it join public.tags t on t.id = it.tag_id
      where it.item_id = i.id), '[]'::jsonb),
    'licence', i.licence,
    'noDerivatives', i.no_derivatives,
    'provenance', jsonb_build_object('source', i.source, 'promptVersion', i.prompt_version,
      'model', i.model),
    -- The base version and board levels' versions; never a teacher's personal level (D-099).
    'versions', coalesce((
      select jsonb_agg(jsonb_build_object('level', ll.code, 'schemaVersion', v.schema_version,
          'content', v.content, 'answerKey', k.answer_key)
        order by ll.sort_order nulls first, ll.code)
      from public.library_item_versions v
      left join public.language_levels ll on ll.id = v.language_level_id
      left join public.library_item_answer_keys k on k.version_id = v.id
      where v.item_id = i.id and (v.language_level_id is null or ll.owner_user_id is null)),
      '[]'::jsonb))
  from public.library_items i
  join public.subjects s on s.id = i.subject_id
  where i.id = p_item_id;
$$;

-- A page of the board's exportable items, by id. Filters: `{slug, publisher, includeTeacherItems,
-- includePackItems, gradeCodes, subjectCodes}`. By default: board-approved items that are the
-- board's own and did not come from another publisher's pack (the exporter's own packs, by
-- publisher, are its own content); `includeTeacherItems` adds approved items written by
-- teachers (credited to the board only: no author travels), `includePackItems` other
-- publishers' pack items (a licensing choice). Archived items are never exported. Returns
-- `{items, next}` (at most 100 items; `next` is the `p_after` of the next page, null at the end),
-- plus the board's levels on the first page.
create function public.content_pack_export_items(
  p_board_id uuid,
  p_filters jsonb,
  p_after uuid,
  p_limit integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_limit integer := coalesce(p_limit, 100);
  v_slug text;
  v_publisher text;
  v_teacher boolean;
  v_packs boolean;
  v_grades text[];
  v_subjects text[];
  v_ids uuid[];
  v_items jsonb;
  v_levels jsonb;
begin
  if p_board_id is null or not exists (select 1 from public.boards b where b.id = p_board_id) then
    raise exception 'unknown board' using errcode = '22023';
  end if;
  if jsonb_typeof(v_filters) <> 'object' or v_limit not between 1 and 100
    or coalesce(v_filters ->> 'slug', '') !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or coalesce(jsonb_typeof(v_filters -> 'publisher'), 'null') not in ('string', 'null')
    or coalesce(jsonb_typeof(v_filters -> 'includeTeacherItems'), 'null') not in ('boolean', 'null')
    or coalesce(jsonb_typeof(v_filters -> 'includePackItems'), 'null') not in ('boolean', 'null')
    or coalesce(jsonb_typeof(v_filters -> 'gradeCodes'), 'null') not in ('array', 'null')
    or coalesce(jsonb_typeof(v_filters -> 'subjectCodes'), 'null') not in ('array', 'null')
  then
    raise exception 'invalid filters' using errcode = '22023';
  end if;
  v_slug := v_filters ->> 'slug';
  v_publisher := lower(nullif(btrim(v_filters ->> 'publisher'), ''));
  v_teacher := coalesce((v_filters ->> 'includeTeacherItems')::boolean, false);
  v_packs := coalesce((v_filters ->> 'includePackItems')::boolean, false);
  v_grades := array(select jsonb_array_elements_text(app.jsonb_array_or_empty(v_filters -> 'gradeCodes')));
  v_subjects := array(select jsonb_array_elements_text(app.jsonb_array_or_empty(v_filters -> 'subjectCodes')));

  v_ids := array(
    select i.id
    from public.library_items i
    join public.subjects s on s.id = i.subject_id
    left join public.content_packs cp on cp.id = i.content_pack_id
    where i.board_id = p_board_id
      and i.status = 'board_approved'
      and (i.board_owned or v_teacher)
      and (i.content_pack_id is null or v_packs
        or (v_publisher is not null and lower(btrim(cp.publisher)) = v_publisher))
      and (cardinality(v_grades) = 0 or exists (
        select 1 from public.library_item_grades g where g.item_id = i.id and g.grade_code = any (v_grades)))
      and (cardinality(v_subjects) = 0 or s.code = any (v_subjects))
      and (p_after is null or i.id > p_after)
    order by i.id
    limit v_limit + 1);

  select coalesce(jsonb_agg(app.content_pack_export_item(x.id, v_slug) order by x.n), '[]'::jsonb)
  into v_items
  from unnest(v_ids[1:v_limit]) with ordinality x (id, n);

  if p_after is null then
    select coalesce(jsonb_agg(jsonb_build_object('code', ll.code, 'labelFr', ll.label_fr,
        'labelEn', ll.label_en) order by ll.sort_order, ll.code), '[]'::jsonb)
    into v_levels
    from public.language_levels ll
    where ll.board_id = p_board_id and ll.owner_user_id is null;
  end if;

  return jsonb_build_object(
    'items', v_items,
    'next', case when cardinality(v_ids) > v_limit then v_ids[v_limit] end)
    || case when p_after is null then jsonb_build_object('levels', v_levels) else '{}'::jsonb end;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 4. Staging (D-100). The CLI has checked the whole file (`validatePack`); the database checks
--    what it relies on, then recomputes the checksum over the staged items before applying.
-- ---------------------------------------------------------------------------------------

-- The file without its items, as `validatePack` accepts it (the parts the database uses).
create function app.content_pack_header_valid(p_header jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(p_header) = 'object'
    and pg_column_size(p_header) <= 65536
    and not (p_header ? 'items')
    and p_header ->> 'format' = 'lynx-content-pack'
    and p_header -> 'formatVersion' = '1'::jsonb
    and jsonb_typeof(p_header -> 'pack') = 'object'
    and (p_header #>> '{pack,slug}') ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    and (p_header #>> '{pack,version}') ~ '^\d{4}\.[1-9]\d{0,2}$'
    and char_length(btrim(p_header #>> '{pack,title}')) between 1 and 160
    and char_length(btrim(p_header #>> '{pack,publisher}')) between 1 and 120
    and jsonb_typeof(p_header #> '{pack,licence}') = 'string'
    and char_length(p_header #>> '{pack,licence}') <= 500
    and jsonb_typeof(p_header #> '{pack,noDerivatives}') = 'boolean'
    and p_header #> '{pack,contentSchemaVersion}' = '1'::jsonb
    and jsonb_typeof(p_header -> 'levels') = 'array'
    and jsonb_typeof(p_header -> 'tags') = 'array'
    and jsonb_array_length(p_header -> 'tags') <= 500
    and jsonb_typeof(p_header -> 'catholicReferences') = 'array'
    and (p_header ->> 'checksum') ~ '^[0-9a-f]{64}$',
    false);
$$;

-- `YYYY.N` as one number (2026.10 → 2026010), so 2026.10 comes after 2026.9; null otherwise.
create function app.content_pack_version_rank(p_version text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when p_version ~ '^\d{4}\.\d{1,3}$'
    then split_part(p_version, '.', 1)::integer * 1000 + split_part(p_version, '.', 2)::integer end;
$$;

-- LXP01 when this version of the pack is already applied to the board, LXP02 when a later one is.
create function app.content_pack_check_version(p_board_id uuid, p_slug text, p_version text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rank integer := app.content_pack_version_rank(p_version);
begin
  if exists (
    select 1 from public.content_packs cp
    where cp.board_id = p_board_id and cp.slug = p_slug
      and (cp.version = p_version or app.content_pack_version_rank(cp.version) = v_rank)
  ) then
    raise exception 'this version of the pack is already applied' using errcode = 'LXP01';
  end if;
  if exists (
    select 1 from public.content_packs cp
    where cp.board_id = p_board_id and cp.slug = p_slug
      and app.content_pack_version_rank(cp.version) > v_rank
  ) then
    raise exception 'a later version of the pack is applied' using errcode = 'LXP02';
  end if;
end;
$$;

-- Starts an import: the file's header (without its items) and its SHA-256. Returns the import's
-- id. Imports older than a day are deleted on the way (the daily clean-up does it too).
create function public.content_pack_stage(p_board_id uuid, p_header jsonb, p_file_sha256 text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_board_id is null or not exists (select 1 from public.boards b where b.id = p_board_id) then
    raise exception 'unknown board' using errcode = '22023';
  end if;
  if not app.content_pack_header_valid(p_header)
    or coalesce(p_file_sha256, '') !~ '^[0-9a-f]{64}$'
  then
    raise exception 'invalid pack header' using errcode = '22023';
  end if;
  perform app.content_pack_check_version(p_board_id, p_header #>> '{pack,slug}',
    p_header #>> '{pack,version}');
  perform app.content_pack_maintenance();
  insert into public.content_pack_imports (board_id, slug, version, header, file_sha256)
  values (p_board_id, p_header #>> '{pack,slug}', p_header #>> '{pack,version}', p_header,
    p_file_sha256)
  returning id into v_id;
  return v_id;
end;
$$;

-- Up to 50 of the file's items per call, upserted by key; `p_faith_keys` are the keys among them
-- whose text the CLI found faith words in. Returns how many items the import now holds (at most
-- 5,000).
create function public.content_pack_stage_items(
  p_import_id uuid,
  p_items jsonb,
  p_faith_keys text[] default '{}'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_import public.content_pack_imports;
  v_count integer;
begin
  select * into v_import from public.content_pack_imports where id = p_import_id for update;
  if v_import.id is null then
    raise exception 'unknown import' using errcode = '22023';
  end if;
  if v_import.status <> 'staged' then
    raise exception 'the import is no longer staged' using errcode = 'LXP03';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array'
    or jsonb_array_length(p_items) not between 1 and 50
    or exists (
      select 1 from jsonb_array_elements(p_items) x
      where jsonb_typeof(x) <> 'object'
        or coalesce(x ->> 'key', '') !~ '^[a-z0-9][a-z0-9-]{0,79}$'
        or coalesce(x ->> 'hash', '') !~ '^[0-9a-f]{64}$')
    or (select count(distinct x ->> 'key') from jsonb_array_elements(p_items) x)
      <> jsonb_array_length(p_items)
  then
    raise exception 'invalid items' using errcode = '22023';
  end if;
  insert into public.content_pack_import_items (import_id, key, item, faith_suggested)
  select v_import.id, x ->> 'key', x, (x ->> 'key') = any (coalesce(p_faith_keys, '{}'))
  from jsonb_array_elements(p_items) x
  on conflict (import_id, key) do update
    set item = excluded.item, faith_suggested = excluded.faith_suggested;
  select count(*)::integer into v_count
  from public.content_pack_import_items ii where ii.import_id = v_import.id;
  if v_count > 5000 then
    raise exception 'at most 5000 items per pack' using errcode = '22023';
  end if;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 5. Applying (D-100), and previewing it
-- ---------------------------------------------------------------------------------------

-- Approves an imported item for the board as `library_decide` does (the same checks, update,
-- audit action and event), for the approver the operator named: audited with `via:
-- 'content_pack'`, the approver and the pack, as the operator's action (actor `service`).
create function app.content_pack_approve_item(p_item_id uuid, p_approver uuid, p_pack_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.library_items;
begin
  select * into v from public.library_items where id = p_item_id for update;
  if v.id is null or not app.library_reviewer(p_approver, v.board_id, 'content') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v.status <> 'teacher_reviewed' or v.review_requested_at is null then
    raise exception 'not awaiting approval' using errcode = 'LXL04';
  end if;
  perform app.library_assert_ready(v.id, true);
  if v.requires_faith_review and v.faith_reviewed_at is null then
    raise exception 'faith review pending' using errcode = 'LXL03';
  end if;
  update public.library_items
  set status = 'board_approved', share_scope = 'board',
      school_id = case when v.board_owned then null else v.school_id end,
      approved_at = now(), approved_by = p_approver,
      review_requested_at = null, review_requested_by = null, review_note = null
  where id = v.id;
  perform app.log_audit('library_item.approved', v.board_id, v.school_id, 'library_item', v.id,
    jsonb_build_object('type', v.type, 'revision', v.content_revision,
      'faith_reviewed', v.requires_faith_review, 'via', 'content_pack', 'approved_by', p_approver,
      'pack_id', p_pack_id),
    'service');
  perform app.emit_event('library_item.approved', v.board_id, v.school_id, 'library_item', v.id,
    jsonb_build_object('itemId', v.id));
end;
$$;

-- Applies a staged import in the caller's transaction and returns its report. Options:
-- `{levelMap: {packCode: boardCode}, approve, approverId}`.
--
-- For each staged item (by key), matched with the board's item of the same pack slug and key:
--   create                    no such item: a new board-owned, private item (source from the
--                             provenance, `teacher_created` becoming `board_created`), with
--                             `sub_friendly` off and the pack's licence choice
--   update                    an item the pack wrote, untouched since, not approved or archived:
--                             replaced, as a content change (D-063)
--   unchanged                 the same hash as when the pack last wrote it
--   changed_not_applied       an approved or archived item (or a teacher's): never replaced in v1
--   skipped_modified_locally  edited here since the pack wrote it (`content_revision` moved on)
--   skipped_unresolved        an unknown subject or type, a type that changed, no base version,
--                             or a field the database refuses
-- A created or updated item that is ready for approval (`app.library_assert_ready`) waits in the
-- reviewers' queue (`teacher_reviewed`, requested); any other stays a draft. With `approve` and a
-- content reviewer of the board as approver, queued items are approved, except faith content
-- (the pack's flag, faith words found by the CLI, a Catholic reference, Enseignement religieux or
-- a reflection: its faith review comes first), experiments, STEM challenges and outdoor
-- activities. References resolve by code: the subject (the board's own first), grades, attentes
-- by exact (subject, curriculum version, grade, code), board levels through `levelMap` (identity
-- by default; a version whose level has no board level is skipped), tags by slug (the board's,
-- else global; at most 30 new board tags per import), the Catholic reference by (type, title)
-- among the board's then the global ones (none or several: none). Warnings name each thing that
-- did not resolve. Raises LXP01/LXP02 (version), LXP03 (not staged), LXP05 (checksum), and
-- LXP04 for a wrong approver unless `p_dry_run`.
create function app.content_pack_run(p_import_id uuid, p_options jsonb, p_dry_run boolean)
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
        v_outcome := 'create';
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

-- The dry run (the CLI's default): everything `content_pack_apply` would do, in a subtransaction
-- that is then rolled back, so the report is exact and nothing is written (no pack, item, tag,
-- audit line or event, and the import stays staged). A wrong approver is reported
-- (`approverOk: false`) instead of refused.
create function public.content_pack_preview(p_import_id uuid, p_options jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report jsonb;
begin
  begin
    v_report := app.content_pack_run(p_import_id, p_options, true);
    raise exception 'dry run' using errcode = 'LXP00';
  exception when sqlstate 'LXP00' then
    null;
  end;
  return (v_report - 'packId') || jsonb_build_object('dryRun', true);
end;
$$;

-- Applies a staged import in one transaction (see app.content_pack_run).
create function public.content_pack_apply(p_import_id uuid, p_options jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.content_pack_run(p_import_id, p_options, false) || jsonb_build_object('dryRun', false);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 6. Discarding, listing, people, the export's audit line, the clean-up
-- ---------------------------------------------------------------------------------------

-- Drops a staged import's items (the CLI does it after every dry run). Discarding it again does
-- nothing; an applied import cannot be discarded (LXP03).
create function public.content_pack_discard(p_import_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_import public.content_pack_imports;
begin
  select * into v_import from public.content_pack_imports where id = p_import_id for update;
  if v_import.id is null then
    raise exception 'unknown import' using errcode = '22023';
  end if;
  if v_import.status = 'applied' then
    raise exception 'the import is applied' using errcode = 'LXP03';
  end if;
  update public.content_pack_imports set status = 'discarded' where id = v_import.id;
  delete from public.content_pack_import_items where import_id = v_import.id;
end;
$$;

-- The packs applied to a board (and seed packs), by slug and version, with each import's report
-- (counts, and the keys changed but not applied, edited here or not found): what `list-packs`
-- prints.
create function public.content_pack_list(p_board_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', cp.id, 'slug', cp.slug, 'version', cp.version, 'title', cp.title,
      'publisher', cp.publisher, 'licence', cp.licence, 'importedAt', cp.imported_at,
      'itemCount', cp.item_count, 'fileSha256', cp.file_sha256, 'approvedBy', u.email,
      'report', cp.report,
      'items', (select count(*) from public.library_items i where i.content_pack_id = cp.id))
    order by cp.slug, app.content_pack_version_rank(cp.version) nulls first, cp.imported_at), '[]'::jsonb)
  from public.content_packs cp
  left join public.users u on u.id = cp.approved_by
  where cp.board_id = p_board_id;
$$;

-- The first names of the board's students and the names of its staff, for the export's
-- first-name check (D-099): run by the CLI, never stored or sent anywhere.
create function public.content_pack_people(p_board_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'students', coalesce((
      select jsonb_agg(distinct st.first_name)
      from public.students st
      join public.classes c on c.id = st.class_id
      join public.schools s on s.id = c.school_id
      where s.board_id = p_board_id), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(distinct u.display_name)
      from public.users u
      join public.user_roles ur on ur.user_id = u.id
      where ur.board_id = p_board_id and ur.role <> 'parent'), '[]'::jsonb));
$$;

-- `content_pack.exported {slug, version, item_count}` (D-101), once the CLI has written the file.
create function public.content_pack_record_export(
  p_board_id uuid,
  p_slug text,
  p_version text,
  p_item_count integer,
  p_file_sha256 text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_board_id is null or not exists (select 1 from public.boards b where b.id = p_board_id)
    or coalesce(p_slug, '') !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or coalesce(p_version, '') !~ '^\d{4}\.[1-9]\d{0,2}$'
    or p_item_count is null or p_item_count < 1
    or coalesce(p_file_sha256, '') !~ '^[0-9a-f]{64}$'
  then
    raise exception 'invalid export' using errcode = '22023';
  end if;
  perform app.log_audit('content_pack.exported', p_board_id, null, 'board', p_board_id,
    jsonb_build_object('slug', p_slug, 'version', p_version, 'item_count', p_item_count,
      'file_sha256', p_file_sha256),
    'service');
end;
$$;

-- Staged imports last a day (D-101): deletes every import row older than that, with its items.
-- Called by content_pack_stage and by the daily `library_maintenance`. Returns how many.
create function app.content_pack_maintenance()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.content_pack_imports where created_at < now() - interval '1 day';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 7. Permissions: the operator only. `authenticated` gets these functions by default on a
--    Supabase project (new functions are exposed), so it loses them explicitly.
-- ---------------------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon;

revoke execute on function
  public.content_pack_export_items(uuid, jsonb, uuid, integer),
  public.content_pack_stage(uuid, jsonb, text),
  public.content_pack_stage_items(uuid, jsonb, text[]),
  public.content_pack_preview(uuid, jsonb),
  public.content_pack_apply(uuid, jsonb),
  public.content_pack_discard(uuid),
  public.content_pack_list(uuid),
  public.content_pack_people(uuid),
  public.content_pack_record_export(uuid, text, text, integer, text)
from authenticated;

grant execute on function
  public.content_pack_export_items(uuid, jsonb, uuid, integer),
  public.content_pack_stage(uuid, jsonb, text),
  public.content_pack_stage_items(uuid, jsonb, text[]),
  public.content_pack_preview(uuid, jsonb),
  public.content_pack_apply(uuid, jsonb),
  public.content_pack_discard(uuid),
  public.content_pack_list(uuid),
  public.content_pack_people(uuid),
  public.content_pack_record_export(uuid, text, text, integer, text),
  app.content_pack_maintenance()
to service_role;
