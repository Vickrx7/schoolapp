-- Content library (Phase 4/5 features; tables and baseline access rules now).

create type public.library_bucket as enum (
  'enseigner', 'pratiquer', 'explorer', 'evaluer', 'jouer', 'relier'
);

create type public.library_item_type as enum (
  -- enseigner
  'lesson_plan', 'anchor_chart', 'worked_example', 'teacher_guide',
  -- pratiquer
  'worksheet', 'learning_centre', 'reading_passage', 'vocabulary_bank', 'exit_ticket',
  -- explorer
  'experiment', 'stem_challenge', 'project', 'outdoor_activity',
  -- evaluer
  'quiz', 'unit_test', 'diagnostic', 'rubric',
  -- jouer
  'game', 'brain_break', 'song', 'riddle', 'weekly_challenge',
  -- relier
  'catholic_reflection', 'culture_hook', 'parent_guide'
);

create type public.library_item_status as enum (
  'draft', 'teacher_reviewed', 'board_approved', 'rejected', 'archived'
);

create type public.library_source as enum ('ai_generated', 'teacher_created', 'board_created');

create type public.share_scope as enum ('private', 'school', 'board');

create function app.library_bucket_for(p_type public.library_item_type)
returns public.library_bucket
language sql
immutable
set search_path = ''
as $$
  select case
    when p_type in ('lesson_plan', 'anchor_chart', 'worked_example', 'teacher_guide')
      then 'enseigner'::public.library_bucket
    when p_type in ('worksheet', 'learning_centre', 'reading_passage', 'vocabulary_bank', 'exit_ticket')
      then 'pratiquer'::public.library_bucket
    when p_type in ('experiment', 'stem_challenge', 'project', 'outdoor_activity')
      then 'explorer'::public.library_bucket
    when p_type in ('quiz', 'unit_test', 'diagnostic', 'rubric')
      then 'evaluer'::public.library_bucket
    when p_type in ('game', 'brain_break', 'song', 'riddle', 'weekly_challenge')
      then 'jouer'::public.library_bucket
    else 'relier'::public.library_bucket
  end;
$$;

grant execute on function app.library_bucket_for(public.library_item_type) to authenticated, service_role;

create table public.content_packs (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  version text not null check (char_length(version) between 1 and 40),
  title text not null check (char_length(title) between 1 and 160),
  publisher text check (char_length(publisher) <= 120),
  manifest jsonb not null default '{}' check (jsonb_typeof(manifest) = 'object'),
  imported_at timestamptz not null default now(),
  imported_by uuid references public.users (id) on delete set null,
  unique (board_id, slug, version)
);

create table public.library_items (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  -- Author's school when shared at school scope.
  school_id uuid references public.schools (id) on delete set null,
  type public.library_item_type not null,
  bucket public.library_bucket generated always as (app.library_bucket_for(type)) stored,
  title text not null check (char_length(title) between 1 and 200),
  summary text check (char_length(summary) <= 1000),
  status public.library_item_status not null default 'draft',
  share_scope public.share_scope not null default 'private',
  source public.library_source not null,
  author_id uuid references public.users (id) on delete set null,
  licence text check (char_length(licence) <= 200),
  parent_item_id uuid references public.library_items (id) on delete set null,
  content_pack_id uuid references public.content_packs (id) on delete set null,
  subject_id uuid references public.subjects (id) on delete restrict,
  duration_minutes smallint check (duration_minutes between 1 and 600),
  materials text check (char_length(materials) <= 4000),
  is_printable boolean not null default true,
  is_projectable boolean not null default false,
  is_interactive boolean not null default false,
  sub_friendly boolean not null default false,
  -- Structured safety notes (age suitability, allergy-aware materials, supervision level).
  safety_notes jsonb check (safety_notes is null or jsonb_typeof(safety_notes) = 'object'),
  catholic_connection text check (char_length(catholic_connection) <= 2000),
  requires_faith_review boolean not null default false,
  prompt_version text check (char_length(prompt_version) <= 40),
  model text check (char_length(model) <= 80),
  ai_generation_id uuid references public.ai_generations (id) on delete set null,
  usage_count integer not null default 0 check (usage_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Experiments and STEM challenges cannot leave draft without safety notes.
  check (
    type not in ('experiment', 'stem_challenge')
    or status in ('draft', 'rejected', 'archived')
    or safety_notes is not null
  )
);

create index library_items_board_status_idx on public.library_items (board_id, status);
create index library_items_school_id_idx on public.library_items (school_id);
create index library_items_author_id_idx on public.library_items (author_id);
create index library_items_parent_item_id_idx on public.library_items (parent_item_id);
create index library_items_content_pack_id_idx on public.library_items (content_pack_id);
create index library_items_subject_id_idx on public.library_items (subject_id);
create index library_items_ai_generation_id_idx on public.library_items (ai_generation_id);

create trigger library_items_touch before update on public.library_items
  for each row execute function app.touch_updated_at();

alter table public.unit_lessons
  add constraint unit_lessons_library_item_id_fkey
  foreign key (library_item_id) references public.library_items (id) on delete set null;

create table public.library_item_grades (
  item_id uuid not null references public.library_items (id) on delete cascade,
  grade_code text not null references public.grades (code),
  primary key (item_id, grade_code)
);

-- One row per language level (null level = the base version).
create table public.library_item_versions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.library_items (id) on delete cascade,
  language_level_id uuid references public.language_levels (id) on delete set null,
  schema_version smallint not null default 1,
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (item_id, language_level_id)
);

create index library_item_versions_language_level_id_idx
  on public.library_item_versions (language_level_id);

create trigger library_item_versions_touch before update on public.library_item_versions
  for each row execute function app.touch_updated_at();

-- Answer keys live in their own table so student-facing code paths never touch them.
create table public.library_item_answer_keys (
  version_id uuid primary key references public.library_item_versions (id) on delete cascade,
  answer_key jsonb not null check (jsonb_typeof(answer_key) = 'object'),
  updated_at timestamptz not null default now()
);

create table public.library_item_expectations (
  item_id uuid not null references public.library_items (id) on delete cascade,
  expectation_id uuid not null references public.curriculum_expectations (id) on delete cascade,
  primary key (item_id, expectation_id)
);

create index library_item_expectations_expectation_id_idx
  on public.library_item_expectations (expectation_id);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  board_id uuid references public.boards (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  label_fr text not null check (char_length(label_fr) between 1 and 60)
);

create unique index tags_scope_slug_key
  on public.tags (coalesce(board_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);

create table public.library_item_tags (
  item_id uuid not null references public.library_items (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  primary key (item_id, tag_id)
);

create index library_item_tags_tag_id_idx on public.library_item_tags (tag_id);

-- Ratings are anonymous to other users: only aggregates are ever shown.
create table public.library_item_ratings (
  item_id uuid not null references public.library_items (id) on delete cascade,
  rater_id uuid not null references public.users (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  primary key (item_id, rater_id)
);

create index library_item_ratings_rater_id_idx on public.library_item_ratings (rater_id);

create table public.collections (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  school_id uuid references public.schools (id) on delete set null,
  owner_id uuid references public.users (id) on delete set null,
  title text not null check (char_length(title) between 1 and 160),
  description text check (char_length(description) <= 2000),
  share_scope public.share_scope not null default 'private',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index collections_board_id_idx on public.collections (board_id);
create index collections_school_id_idx on public.collections (school_id);
create index collections_owner_id_idx on public.collections (owner_id);

create trigger collections_touch before update on public.collections
  for each row execute function app.touch_updated_at();

create table public.collection_items (
  collection_id uuid not null references public.collections (id) on delete cascade,
  item_id uuid not null references public.library_items (id) on delete cascade,
  position integer not null default 0,
  primary key (collection_id, item_id)
);

create index collection_items_item_id_idx on public.collection_items (item_id);

-- ---------------------------------------------------------------------------------------
-- Access. Baseline rules; the review workflow (Phase 4) adds status-transition functions.
-- ---------------------------------------------------------------------------------------

create function app.can_read_library_item(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.library_items i
    where i.id = p_item_id
      and (
        i.author_id = (select auth.uid())
        or i.board_id in (select app.my_admin_board_ids())
        or (
          i.status in ('teacher_reviewed', 'board_approved')
          and (
            (i.share_scope = 'school' and i.school_id in (select app.my_staff_school_ids()))
            or (i.share_scope = 'board' and i.board_id in (select app.my_board_ids()))
          )
        )
      )
  );
$$;

create function app.can_edit_library_item(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.library_items i
    where i.id = p_item_id
      and (
        (i.author_id = (select auth.uid()) and i.status <> 'board_approved')
        or i.board_id in (select app.my_admin_board_ids())
      )
  );
$$;

grant execute on function app.can_read_library_item(uuid), app.can_edit_library_item(uuid)
  to authenticated;

alter table public.content_packs enable row level security;
alter table public.library_items enable row level security;
alter table public.library_item_grades enable row level security;
alter table public.library_item_versions enable row level security;
alter table public.library_item_answer_keys enable row level security;
alter table public.library_item_expectations enable row level security;
alter table public.tags enable row level security;
alter table public.library_item_tags enable row level security;
alter table public.library_item_ratings enable row level security;
alter table public.collections enable row level security;
alter table public.collection_items enable row level security;

create policy content_packs_select on public.content_packs
  for select to authenticated using (board_id in (select app.my_board_ids()));
grant select on public.content_packs to authenticated;

create policy library_items_select on public.library_items
  for select to authenticated using (app.can_read_library_item(id));

-- Authors can only place items in their own board and one of their own schools.
create policy library_items_insert on public.library_items
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and board_id in (select app.my_board_ids())
    and (school_id is null or school_id in (select app.my_staff_school_ids()))
    and status = 'draft'
    and source = 'teacher_created'
  );

create policy library_items_update on public.library_items
  for update to authenticated
  using (app.can_edit_library_item(id))
  with check (
    board_id in (select app.my_admin_board_ids())
    or (
      author_id = (select auth.uid())
      and (school_id is null or school_id in (select app.my_staff_school_ids()))
      and status in ('draft', 'teacher_reviewed', 'archived')
    )
  );

create policy library_items_delete on public.library_items
  for delete to authenticated
  using (author_id = (select auth.uid()) and status in ('draft', 'rejected', 'archived'));

-- Ownership and provenance columns (board, author, source, lineage, AI metadata, usage) are
-- set at creation or by server code, never edited through the API.
grant select, delete on public.library_items to authenticated;
grant insert (id, board_id, school_id, type, title, summary, status, share_scope, source, author_id, licence,
  parent_item_id, subject_id, duration_minutes, materials, is_printable, is_projectable,
  is_interactive, sub_friendly, safety_notes, catholic_connection, requires_faith_review)
  on public.library_items to authenticated;
grant update (school_id, title, summary, status, share_scope, licence, subject_id, duration_minutes,
  materials, is_printable, is_projectable, is_interactive, sub_friendly, safety_notes,
  catholic_connection, requires_faith_review)
  on public.library_items to authenticated;

create policy library_item_grades_select on public.library_item_grades
  for select to authenticated using (app.can_read_library_item(item_id));
create policy library_item_grades_write on public.library_item_grades
  for all to authenticated
  using (app.can_edit_library_item(item_id))
  with check (app.can_edit_library_item(item_id));
grant select, insert, delete on public.library_item_grades to authenticated;

create policy library_item_versions_select on public.library_item_versions
  for select to authenticated using (app.can_read_library_item(item_id));
create policy library_item_versions_write on public.library_item_versions
  for all to authenticated
  using (app.can_edit_library_item(item_id))
  with check (app.can_edit_library_item(item_id));
grant select, insert, update, delete on public.library_item_versions to authenticated;

create policy library_item_answer_keys_select on public.library_item_answer_keys
  for select to authenticated
  using (
    app.can_read_library_item(
      (select v.item_id from public.library_item_versions v where v.id = version_id)
    )
  );
create policy library_item_answer_keys_write on public.library_item_answer_keys
  for all to authenticated
  using (
    app.can_edit_library_item(
      (select v.item_id from public.library_item_versions v where v.id = version_id)
    )
  )
  with check (
    app.can_edit_library_item(
      (select v.item_id from public.library_item_versions v where v.id = version_id)
    )
  );
grant select, insert, update, delete on public.library_item_answer_keys to authenticated;

create policy library_item_expectations_select on public.library_item_expectations
  for select to authenticated using (app.can_read_library_item(item_id));
create policy library_item_expectations_write on public.library_item_expectations
  for all to authenticated
  using (app.can_edit_library_item(item_id))
  with check (app.can_edit_library_item(item_id));
grant select, insert, delete on public.library_item_expectations to authenticated;

create policy tags_select on public.tags
  for select to authenticated
  using (board_id is null or board_id in (select app.my_board_ids()));
create policy tags_insert on public.tags
  for insert to authenticated
  with check (board_id in (select app.my_board_ids()));
grant select, insert on public.tags to authenticated;

create policy library_item_tags_select on public.library_item_tags
  for select to authenticated using (app.can_read_library_item(item_id));
create policy library_item_tags_write on public.library_item_tags
  for all to authenticated
  using (app.can_edit_library_item(item_id))
  with check (app.can_edit_library_item(item_id));
grant select, insert, delete on public.library_item_tags to authenticated;

create policy library_item_ratings_own on public.library_item_ratings
  for all to authenticated
  using (rater_id = (select auth.uid()))
  with check (rater_id = (select auth.uid()) and app.can_read_library_item(item_id));
grant select, insert, update, delete on public.library_item_ratings to authenticated;

create policy collections_select on public.collections
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    or (share_scope = 'school' and school_id in (select app.my_staff_school_ids()))
    or (share_scope = 'board' and board_id in (select app.my_board_ids()))
  );
create policy collections_write on public.collections
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and board_id in (select app.my_board_ids())
    and (school_id is null or school_id in (select app.my_staff_school_ids()))
  );
grant select, delete on public.collections to authenticated;
grant insert (id, board_id, school_id, owner_id, title, description, share_scope) on public.collections to authenticated;
grant update (school_id, title, description, share_scope) on public.collections to authenticated;

create policy collection_items_select on public.collection_items
  for select to authenticated
  using (collection_id in (select c.id from public.collections c));
create policy collection_items_write on public.collection_items
  for all to authenticated
  using (
    collection_id in (select c.id from public.collections c where c.owner_id = (select auth.uid()))
  )
  with check (
    collection_id in (select c.id from public.collections c where c.owner_id = (select auth.uid()))
    and app.can_read_library_item(item_id)
  );
grant select, insert, update, delete on public.collection_items to authenticated;
