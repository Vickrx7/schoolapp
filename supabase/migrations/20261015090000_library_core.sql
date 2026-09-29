-- Phase 4: library core (« Banque de ressources »). What the library needs in the database before
-- its screens: who reviews, who sees what, how items are saved and move through review, the
-- search document, and links to planning.
--
--  1. French text search without accents (the search function comes with the search screens).
--  2. New columns and rules on library items: optimistic concurrency, keywords, faith flags,
--     review state and the search document; updated_at follows content and workflow only.
--  3. Structured safety notes for experiments and STEM challenges.
--  4. Versions and answer keys: size limits; a language level in use is never deleted.
--  5. Reviewers designated by the board, for content and for faith content.
--  6. Who can use, read and edit an item (board admins lose their access to drafts).
--  7. The items trigger: the type is fixed, references stay in scope, faith review is computed.
--  8. The search document.
--  9. Content changes, readiness, and substitute plans to rebuild.
-- 10. Saving an item: the only way to write library content.
-- 11. The review workflow.
-- 12. Planning: a resource as a new lesson, and usage counts.
-- 13. Direct writes closed.
-- 14. Phase 2 saved texts: keys, schema version and search; old saved texts converted.
-- 15. Permissions.
--
-- Error codes the app translates: LXL01 not ready (`detail` names what is missing), LXL02 safety
-- notes missing, LXL03 the faith review comes first, LXL04 wrong status, LXL05 the reviewer's own
-- item, LXL06 approved items are read-only, LXL07 changed since it was opened, LXL10 versions for
-- personal levels on a shared item.
-- DECISIONS: D-062, D-063, D-064, D-065, D-066, D-067, D-068, D-073, D-076, D-079 (amending
-- D-012, D-013 and D-046).
-- Tests: supabase/tests/15_library_workflow.test.sql, supabase/tests/16_library_planning.test.sql

-- ---------------------------------------------------------------------------------------
-- 1. French text search without accents (D-068). Accents are removed before stemming: the
--    French stemmer alone turns « idée » and « idee » into different stems.
-- ---------------------------------------------------------------------------------------

create text search configuration app.french_unaccent (copy = pg_catalog.french);
alter text search configuration app.french_unaccent
  alter mapping for hword, hword_part, word with extensions.unaccent, pg_catalog.french_stem;

-- ---------------------------------------------------------------------------------------
-- 2. Columns and rules on library items
-- ---------------------------------------------------------------------------------------

alter table public.library_items
  -- Optimistic concurrency: every content change adds one (D-063).
  add column content_revision integer not null default 1,
  -- Free words chosen by the author, searched like tags (tags themselves are a curated list);
  -- seen by whoever can read the item.
  add column keywords text check (char_length(keywords) <= 300),
  -- The author's « Contient du contenu de foi », or a reviewer's flag (then kept) (D-064).
  add column faith_content boolean not null default false,
  add column faith_flagged_by uuid references public.users (id) on delete set null,
  add column faith_on_student_sheet boolean not null default false,
  add column catholic_reference_id uuid references public.catholic_references (id) on delete set null,
  add column review_requested_at timestamptz,
  add column review_requested_by uuid references public.users (id) on delete set null,
  add column approved_at timestamptz,
  add column approved_by uuid references public.users (id) on delete set null,
  add column faith_reviewed_at timestamptz,
  add column faith_reviewed_by uuid references public.users (id) on delete set null,
  -- The reviewer's note when an item is sent back or withdrawn (never audited).
  add column review_note text check (char_length(review_note) <= 1000),
  add column search_document tsvector not null default ''::tsvector,
  add constraint library_items_request_needs_review
    check (review_requested_at is null or status = 'teacher_reviewed'),
  add constraint library_items_shared_needs_review
    check (share_scope = 'private' or status in ('teacher_reviewed', 'board_approved')),
  add constraint library_items_approved_is_board
    check (status <> 'board_approved' or share_scope = 'board'),
  -- Never in a substitute plan: assessments, rubrics, guides and projects; experiments and STEM
  -- challenges only when an adult without special training can run them (D-077).
  add constraint library_items_sub_friendly_allowed check (not sub_friendly or (
    type not in ('unit_test', 'diagnostic', 'rubric', 'parent_guide', 'teacher_guide', 'project')
    and (type not in ('experiment', 'stem_challenge') or safety_notes ->> 'supervision' = 'standard')));

create index library_items_faith_flagged_by_idx on public.library_items (faith_flagged_by);
create index library_items_catholic_reference_id_idx on public.library_items (catholic_reference_id);
create index library_items_review_requested_by_idx on public.library_items (review_requested_by);
create index library_items_approved_by_idx on public.library_items (approved_by);
create index library_items_faith_reviewed_by_idx on public.library_items (faith_reviewed_by);
create index library_items_search_idx on public.library_items using gin (search_document);
create index library_items_review_queue_idx on public.library_items (board_id, review_requested_at)
  where review_requested_at is not null;
create index library_item_grades_grade_code_idx on public.library_item_grades (grade_code);

-- updated_at follows content and workflow, not usage counts or search refreshes.
drop trigger library_items_touch on public.library_items;
create trigger library_items_touch
  before update of title, summary, status, share_scope, school_id, subject_id, duration_minutes,
    materials, keywords, is_printable, is_projectable, is_interactive, sub_friendly, safety_notes,
    faith_content, faith_on_student_sheet, catholic_connection, catholic_reference_id, licence,
    content_revision, review_requested_at, approved_at, faith_reviewed_at, review_note
  on public.library_items
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------------------
-- 3. Structured safety notes (D-067). Same rule as safetyNotesSchema('final') in
--    @lynx/content, which is stricter (unknown keys, every kind of blank).
-- ---------------------------------------------------------------------------------------

create function app.library_safety_notes_valid(p_notes jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    p_notes is not null and jsonb_typeof(p_notes) = 'object'
      and jsonb_typeof(p_notes -> 'ageSuitability') = 'string'
      and char_length(btrim(p_notes ->> 'ageSuitability')) between 1 and 300
      and jsonb_typeof(p_notes -> 'allergyAwareMaterials') = 'string'
      and char_length(btrim(p_notes ->> 'allergyAwareMaterials')) between 1 and 600
      and coalesce(p_notes ->> 'supervision', '') in ('standard', 'close', 'adult_only')
      and coalesce(jsonb_typeof(p_notes -> 'hazards'), 'array') = 'array',
    false);
$$;

-- Replaces the Phase 1 check, which only asked for notes of any shape.
alter table public.library_items drop constraint library_items_check,
  add constraint library_items_safety_notes_required check (
    type not in ('experiment', 'stem_challenge') or status in ('draft', 'rejected', 'archived')
    or app.library_safety_notes_valid(safety_notes));

-- ---------------------------------------------------------------------------------------
-- 4. Versions and answer keys
-- ---------------------------------------------------------------------------------------

-- A deleted level used to turn its versions into base versions (or fail on the item's base
-- version with 23505). Deleting a level in use is now refused by the guard below, for board
-- levels too (D-046); a level removed with its owner or board (a cascade) takes its versions
-- with it instead of making them base versions.
alter table public.library_item_versions
  drop constraint library_item_versions_language_level_id_fkey,
  add constraint library_item_versions_language_level_id_fkey foreign key (language_level_id)
    references public.language_levels (id) on delete cascade,
  add constraint library_item_versions_content_size check (pg_column_size(content) <= 131072);

alter table public.library_item_answer_keys
  add constraint library_item_answer_keys_size check (pg_column_size(answer_key) <= 65536);

-- app.language_levels_guard_in_use() (Phase 2 hardening) refuses a direct delete of a level
-- that a version uses; it applied to personal levels only.
drop trigger language_levels_guard_in_use on public.language_levels;
create trigger language_levels_guard_in_use before delete on public.language_levels
  for each row execute function app.language_levels_guard_in_use();

-- ---------------------------------------------------------------------------------------
-- 5. Reviewers designated by the board (D-064). Written by the operator
--    (`pnpm admin set-library-reviewer`, service role); a board admin is not a reviewer unless
--    designated.
-- ---------------------------------------------------------------------------------------

create table public.library_reviewers (
  board_id uuid not null references public.boards (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  -- Approves resources for the whole board.
  approves_content boolean not null default true,
  -- Reviews faith content (prayer, religious text, faith links) before it reaches the board.
  reviews_faith boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (board_id, user_id),
  check (approves_content or reviews_faith)
);

create index library_reviewers_user_id_idx on public.library_reviewers (user_id);

alter table public.library_reviewers enable row level security;
revoke all on public.library_reviewers from anon, authenticated;
create policy library_reviewers_select on public.library_reviewers
  for select to authenticated
  using (user_id = (select app.active_user_id()) or board_id in (select app.my_admin_board_ids()));
grant select on public.library_reviewers to authenticated;

-- A reviewer is active staff of the board (any role but parent).
create function app.library_reviewers_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.user_roles ur
    join public.users u on u.id = ur.user_id
    where ur.user_id = new.user_id and ur.board_id = new.board_id and ur.role <> 'parent'
      and u.deactivated_at is null
  ) then
    raise exception 'a reviewer must be active staff of the board' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger library_reviewers_guard before insert or update on public.library_reviewers
  for each row execute function app.library_reviewers_guard();

create function app.library_reviewers_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.library_reviewers := case when tg_op = 'DELETE' then old else new end;
begin
  perform app.log_audit(
    case tg_op
      when 'INSERT' then 'library_reviewer.designated'
      when 'UPDATE' then 'library_reviewer.changed'
      else 'library_reviewer.removed'
    end,
    v_row.board_id, null, 'user', v_row.user_id,
    jsonb_build_object('approves_content', v_row.approves_content,
      'reviews_faith', v_row.reviews_faith));
  return null;
end;
$$;

create trigger library_reviewers_audit after insert or update or delete on public.library_reviewers
  for each row execute function app.library_reviewers_audit();

-- ---------------------------------------------------------------------------------------
-- 6. Who can use, read and edit an item (D-065). Each predicate takes the user, so the worker
--    can ask it for someone (service role only: helpers granted to the API answer only about
--    the current user); the can_* wrappers ask it for the current user.
-- ---------------------------------------------------------------------------------------

-- Whether the user designated by a board reviews its content ('content') or faith content
-- ('faith'), as active staff of that board.
create function app.library_reviewer(p_user uuid, p_board_id uuid, p_kind text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.library_reviewers r
    join public.users u on u.id = r.user_id and u.deactivated_at is null
    where r.user_id = p_user and r.board_id = p_board_id
      and case p_kind when 'faith' then r.reviews_faith when 'content' then r.approves_content
            else false end
      and exists (
        select 1 from public.user_roles ur
        where ur.user_id = p_user and ur.board_id = p_board_id and ur.role <> 'parent'
      )
  );
$$;

-- Usable: browsing, search, printing, planning and substitute plans. The author's own items,
-- and reviewed or approved items shared with a school or board where the user is staff.
create function app.library_item_usable_by(p_user uuid, p_item_id uuid)
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
      and (
        i.author_id = p_user
        or (
          i.status in ('teacher_reviewed', 'board_approved')
          and exists (
            select 1 from public.user_roles ur
            where ur.user_id = p_user and ur.role <> 'parent'
              and (
                (i.share_scope = 'school' and ur.school_id = i.school_id)
                or (i.share_scope = 'board' and ur.board_id = i.board_id)
              )
          )
        )
      )
  );
$$;

-- Readable (what row level security uses): usable, or one of the reviewers' cases. Content
-- reviewers read requested, shared or approved items and the board's own items; faith reviewers
-- read requested items that need a faith review.
create function app.library_item_readable_by(p_user uuid, p_item_id uuid)
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
          and (i.review_requested_at is not null or i.share_scope <> 'private'
            or i.source = 'board_created'))
        or (app.library_reviewer(p_user, i.board_id, 'faith')
          and i.review_requested_at is not null and i.requires_faith_review)
      )
  );
$$;

-- Editable: the author, or a content reviewer for the board's own items (no author), while the
-- item is a draft, reviewed or sent back. Approved items are read-only for everyone.
create function app.library_item_editable_by(p_user uuid, p_item_id uuid)
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
        i.author_id = p_user
        or (i.source = 'board_created' and i.author_id is null
          and app.library_reviewer(p_user, i.board_id, 'content'))
      )
  );
$$;

-- The board's own items (no author) are kept by its content reviewers; others by their author.
create function app.library_item_keeper(p_user uuid, p_item public.library_items)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null and (
    p_item.author_id = p_user
    or (p_item.source = 'board_created' and p_item.author_id is null
      and app.library_reviewer(p_user, p_item.board_id, 'content'))
  );
$$;

create or replace function app.can_read_library_item(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.library_item_readable_by(app.active_user_id(), p_item_id);
$$;

create or replace function app.can_edit_library_item(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.library_item_editable_by(app.active_user_id(), p_item_id);
$$;

create function app.can_use_library_item(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.library_item_usable_by(app.active_user_id(), p_item_id);
$$;

-- Lessons, class sessions and parent items may only point at items the user can use: a
-- reviewer cannot put a colleague's item that is waiting for approval into a lesson.
create or replace function app.assert_library_item_readable(p_item_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_item_id is not null and (select auth.uid()) is not null
    and not app.can_use_library_item(p_item_id)
  then
    raise exception 'library item not available' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 7. The items trigger: as before (the parent item must be usable), plus the type and board
--    never change, the Catholic reference is global or the board's, and whether faith review
--    applies is computed (D-064).
-- ---------------------------------------------------------------------------------------

create or replace function app.library_items_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.parent_item_id is distinct from old.parent_item_id then
    perform app.assert_library_item_readable(new.parent_item_id);
  end if;
  if tg_op = 'UPDATE' and (new.type <> old.type or new.board_id <> old.board_id) then
    raise exception 'the type and board of an item never change' using errcode = '22023';
  end if;
  if new.catholic_reference_id is not null
    and (tg_op = 'INSERT' or new.catholic_reference_id is distinct from old.catholic_reference_id)
    and not exists (
      select 1 from public.catholic_references r
      where r.id = new.catholic_reference_id and (r.board_id is null or r.board_id = new.board_id)
    )
  then
    raise exception 'Catholic reference not available for this board' using errcode = '22023';
  end if;
  new.requires_faith_review := new.type = 'catholic_reflection'
    or new.faith_content
    or nullif(btrim(new.catholic_connection), '') is not null
    or new.catholic_reference_id is not null
    or exists (select 1 from public.subjects s where s.id = new.subject_id and s.code = 'ere');
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 8. The search document (D-068). Weights: A the title; B the summary, keywords, French type
--    terms and tag labels; C the attentes (codes and texts); D the materials and the text of
--    the base version. Answer keys are never indexed.
-- ---------------------------------------------------------------------------------------

-- Every string of a version's content, without machine keys (ids, kinds, enumerated values).
create function app.library_content_text(p_content jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  with recursive walk (k, v) as (
    select null::text, p_content
    union all
    select c.k, c.v
    from walk w
    cross join lateral (
      select e.key, e.value
      from jsonb_each(case when jsonb_typeof(w.v) = 'object' then w.v else '{}'::jsonb end) e
      union all
      select w.k, a.value
      from jsonb_array_elements(case when jsonb_typeof(w.v) = 'array' then w.v else '[]'::jsonb end) a
    ) c (k, v)
  )
  select coalesce(string_agg(v #>> '{}', ' '), '')
  from walk
  where jsonb_typeof(v) = 'string'
    and coalesce(k, '') not in ('id', 'kind', 'questionId', 'category', 'space', 'stage',
      'supervision', 'wordClass', 'gender', 'schema');
$$;

-- What teachers call each type, so « billet de sortie » or « défi STIM » finds it.
create function app.library_type_terms(p_type public.library_item_type)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_type
    when 'lesson_plan' then 'plan de leçon planification déroulement'
    when 'anchor_chart' then 'référentiel affiche aide-mémoire tableau d''ancrage'
    when 'worked_example' then 'exemple résolu démarche modèle'
    when 'teacher_guide' then 'guide pédagogique enseignement idées fausses conceptions erronées'
    when 'worksheet' then 'fiche d''exercices feuille d''exercices pratique'
    when 'learning_centre' then 'centre d''apprentissage atelier'
    when 'reading_passage' then 'texte de lecture compréhension'
    when 'vocabulary_bank' then 'banque de mots vocabulaire lexique'
    when 'exit_ticket' then 'billet de sortie vérification rapide'
    when 'experiment' then 'expérience sciences enquête scientifique'
    when 'stem_challenge' then 'défi stim sciences technologie ingénierie mathématiques design'
    when 'project' then 'projet'
    when 'outdoor_activity' then 'activité extérieure plein air dehors cour'
    when 'quiz' then 'quiz questionnaire'
    when 'unit_test' then 'évaluation de fin d''unité examen sommative'
    when 'diagnostic' then 'évaluation diagnostique acquis préalables'
    when 'rubric' then 'grille d''évaluation critères grille de correction'
    when 'game' then 'jeu ludique'
    when 'brain_break' then 'pause active mouvement bouger'
    when 'song' then 'chanson comptine musique'
    when 'riddle' then 'devinettes énigmes charades'
    when 'weekly_challenge' then 'défi de la semaine problème'
    when 'catholic_reflection' then 'réflexion catholique foi prière'
    when 'culture_hook' then 'amorce culturelle francophonie culture franco-ontarienne'
    when 'parent_guide' then 'guide pour les familles parents maison'
  end;
$$;

-- Every writer calls this after changing an item, its links or its base version.
create function app.library_refresh_search(p_item_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.library_items i
  set search_document =
    setweight(to_tsvector('app.french_unaccent', i.title), 'A')
    || setweight(to_tsvector('app.french_unaccent', concat_ws(' ',
         i.summary, i.keywords, app.library_type_terms(i.type),
         (select string_agg(t.label_fr, ' ')
          from public.library_item_tags it join public.tags t on t.id = it.tag_id
          where it.item_id = i.id))), 'B')
    -- Codes as written (« B1.2 ») and split into words (« B1 2 »), as the search splits them.
    || setweight(to_tsvector('app.french_unaccent', coalesce((
         select string_agg(ce.code || ' ' || regexp_replace(ce.code, '[^[:alnum:]]+', ' ', 'g')
           || ' ' || ce.text_fr, ' ')
         from public.library_item_expectations le
         join public.curriculum_expectations ce on ce.id = le.expectation_id
         where le.item_id = i.id), '')), 'C')
    || setweight(to_tsvector('app.french_unaccent', concat_ws(' ',
         i.materials,
         (select app.library_content_text(v.content)
          from public.library_item_versions v
          where v.item_id = i.id and v.language_level_id is null))), 'D')
  where i.id = p_item_id;
$$;

-- Every item, after a curriculum import changed attente texts (service role only).
create function public.library_refresh_search_all()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  for v_id in select id from public.library_items order by id loop
    perform app.library_refresh_search(v_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 9. Content changes, readiness, and substitute plans to rebuild
-- ---------------------------------------------------------------------------------------

-- Marks the upcoming absences that may use an item (D-077): plans that still can be rebuilt
-- and name it, and the teachers of classes whose active units link it (their next lessons can
-- bring it into a plan).
create function app.flag_absences_for_library_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_teachers uuid[];
begin
  select array_agg(distinct t.teacher_id) into v_teachers
  from (
    select a.teacher_id
    from public.sub_plans p
    join public.absences a on a.id = p.absence_id
    where a.status = 'published'
      and a.ends_on >= current_date - 1
      and app.sub_plan_refreshable(p.id)
      and jsonb_path_exists(p.plan, '$.blocks[*].library.itemId ? (@ == $id)',
        jsonb_build_object('id', p_item_id::text))
    union
    select ct.user_id
    from public.unit_lessons l
    join public.units u on u.id = l.unit_id and u.status = 'active'
    join public.class_teachers ct on ct.class_id = u.class_id
    where l.library_item_id = p_item_id
  ) t;
  if v_teachers is not null then
    perform app.flag_absences(v_teachers, null, null, null);
  end if;
end;
$$;

-- After any content change (D-063): a new revision, a pending approval request and an earlier
-- faith review no longer apply, the search document follows, and plans that may use a reviewed
-- item are rebuilt.
create function app.library_content_changed(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.library_item_status;
begin
  update public.library_items i
  set content_revision = i.content_revision + 1,
      review_requested_at = null, review_requested_by = null,
      faith_reviewed_at = null, faith_reviewed_by = null
  where i.id = p_item_id
  returning i.status into v_status;
  perform app.library_refresh_search(p_item_id);
  if v_status = 'teacher_reviewed' then
    perform app.flag_absences_for_library_item(p_item_id);
  end if;
end;
$$;

-- What an item needs to be marked reviewed, or approved (D-067). The content schema and the
-- completeness of answer keys are checked by the app (@lynx/content reviewReadiness): SQL
-- cannot run them.
create function app.library_assert_ready(p_item_id uuid, p_for_approval boolean)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  i public.library_items;
  v_missing text;
begin
  select * into i from public.library_items where id = p_item_id;
  v_missing := case
    when not exists (select 1 from public.library_item_grades g where g.item_id = i.id) then 'grades'
    when i.subject_id is null then 'subject'
    when i.duration_minutes is null then 'duration'
    when nullif(btrim(i.materials), '') is null then 'materials'
    when nullif(btrim(i.keywords), '') is null
      and not exists (select 1 from public.library_item_tags t where t.item_id = i.id) then 'tags'
    when not exists (
      select 1 from public.library_item_versions v
      where v.item_id = i.id and v.language_level_id is null
    ) then 'base'
    when i.type not in ('brain_break', 'catholic_reflection', 'culture_hook', 'song')
      and not exists (select 1 from public.library_item_expectations e where e.item_id = i.id)
      then 'expectations'
    when i.type in ('quiz', 'unit_test', 'diagnostic', 'exit_ticket', 'riddle') and not exists (
      select 1
      from public.library_item_versions v
      join public.library_item_answer_keys k on k.version_id = v.id
      where v.item_id = i.id and v.language_level_id is null
    ) then 'key'
    when p_for_approval and i.type in ('reading_passage', 'worksheet', 'exit_ticket', 'quiz')
      and exists (
        select 1 from public.language_levels ll
        where ll.board_id = i.board_id and ll.owner_user_id is null and ll.active
          and not exists (
            select 1 from public.library_item_versions v
            where v.item_id = i.id and v.language_level_id = ll.id
          )
      ) then 'levels'
  end;
  if v_missing is not null then
    raise exception 'not ready' using errcode = 'LXL01', detail = v_missing;
  end if;
  if i.type in ('experiment', 'stem_challenge') and not app.library_safety_notes_valid(i.safety_notes) then
    raise exception 'safety notes required' using errcode = 'LXL02';
  end if;
end;
$$;

-- Versions for a teacher's personal levels keep an item private: colleagues cannot read those
-- levels (D-066).
create function app.library_has_personal_levels(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.library_item_versions lv
    join public.language_levels ll on ll.id = lv.language_level_id
    where lv.item_id = p_item_id and ll.owner_user_id is not null
  );
$$;

-- A JSON array, or an empty one for anything else (a missing key or a JSON null).
create function app.jsonb_array_or_empty(p_value jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p_value) = 'array' then p_value else '[]'::jsonb end;
$$;

-- ---------------------------------------------------------------------------------------
-- 10. Saving an item (D-063). The API can no longer write library content, so this checks
--     everything itself. The client picks the id of a new item and keeps it in its device
--     draft: a create sent again returns the item it made. `p_item` is
--     {boardId, schoolId, type, title, summary, licence, subjectId, durationMinutes, materials,
--      keywords, isPrintable, isProjectable, isInteractive, subFriendly, safetyNotes,
--      faithContent, faithOnStudentSheet, catholicConnection, catholicReferenceId, gradeCodes[],
--      expectationIds[], tagIds[], versions:[{languageLevelId|null, content, answerKey|null}]}.
--     Every version the item keeps is sent; versions left out are deleted.
-- ---------------------------------------------------------------------------------------

create function public.save_library_item(p_item_id uuid, p_expected_revision integer, p_item jsonb)
returns table (item_id uuid, content_revision integer)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user uuid := app.active_user_id();
  v public.library_items;
  v_new boolean := false;
  v_title text;
  v_subject uuid;
  v_ref uuid;
  v_grades text[];
  v_exps uuid[];
  v_tags uuid[];
  v_version jsonb;
  v_level uuid;
  v_version_id uuid;
begin
  if v_user is null or p_item_id is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_item is null or jsonb_typeof(p_item) <> 'object' or pg_column_size(p_item) > 1048576
    or jsonb_typeof(p_item -> 'versions') is distinct from 'array'
    or jsonb_array_length(p_item -> 'versions') not between 1 and 8
    or exists (select 1 from jsonb_array_elements(p_item -> 'versions') x
               where jsonb_typeof(x) <> 'object' or jsonb_typeof(x -> 'content') is distinct from 'object'
                 or coalesce(jsonb_typeof(x -> 'answerKey'), 'null') not in ('object', 'null'))
    -- Exactly one base version, and each level once.
    or (select count(*) from jsonb_array_elements(p_item -> 'versions') x
        where nullif(x ->> 'languageLevelId', '') is null) <> 1
    or (select count(distinct coalesce(nullif(x ->> 'languageLevelId', ''), 'base'))
        from jsonb_array_elements(p_item -> 'versions') x) <> jsonb_array_length(p_item -> 'versions')
    or coalesce(jsonb_typeof(p_item -> 'durationMinutes'), 'null') not in ('number', 'null')
    or coalesce(jsonb_typeof(p_item -> 'safetyNotes'), 'null') not in ('object', 'null')
    or exists (select 1 from unnest(array['isPrintable', 'isProjectable', 'isInteractive', 'subFriendly',
                 'faithContent', 'faithOnStudentSheet']) f
               where coalesce(jsonb_typeof(p_item -> f), 'null') not in ('boolean', 'null'))
    or exists (select 1 from unnest(array['gradeCodes', 'expectationIds', 'tagIds']) f
               where coalesce(jsonb_typeof(p_item -> f), 'null') not in ('array', 'null'))
  then
    raise exception 'invalid item' using errcode = '22023';
  end if;
  v_title := btrim(coalesce(p_item ->> 'title', ''));
  if char_length(v_title) not between 1 and 200
    or char_length(btrim(p_item ->> 'summary')) > 1000
    or char_length(btrim(p_item ->> 'licence')) > 200
    or char_length(btrim(p_item ->> 'materials')) > 4000
    or char_length(btrim(p_item ->> 'keywords')) > 300
    or char_length(btrim(p_item ->> 'catholicConnection')) > 2000
    or (p_item ->> 'durationMinutes')::numeric not between 1 and 600
    or (p_item ->> 'durationMinutes')::numeric <> trunc((p_item ->> 'durationMinutes')::numeric)
  then
    raise exception 'invalid item' using errcode = '22023';
  end if;
  v_subject := nullif(p_item ->> 'subjectId', '')::uuid;
  v_ref := nullif(p_item ->> 'catholicReferenceId', '')::uuid;
  v_grades := array(select distinct x from jsonb_array_elements_text(app.jsonb_array_or_empty(p_item -> 'gradeCodes')) x);
  v_exps := array(select distinct x::uuid from jsonb_array_elements_text(app.jsonb_array_or_empty(p_item -> 'expectationIds')) x);
  v_tags := array(select distinct x::uuid from jsonb_array_elements_text(app.jsonb_array_or_empty(p_item -> 'tagIds')) x);

  select * into v from public.library_items where id = p_item_id for update;
  if v.id is null then
    -- A new item, in one of the author's boards and, if given, one of her schools there.
    if p_expected_revision is not null
      or nullif(p_item ->> 'boardId', '') is null
      or (p_item ->> 'boardId')::uuid not in (select app.my_board_ids())
      or (nullif(p_item ->> 'schoolId', '') is not null and (
        (p_item ->> 'schoolId')::uuid not in (select app.my_staff_school_ids())
        or not exists (select 1 from public.schools s
                       where s.id = (p_item ->> 'schoolId')::uuid
                         and s.board_id = (p_item ->> 'boardId')::uuid)))
    then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    if nullif(p_item ->> 'type', '') is null then
      raise exception 'invalid item' using errcode = '22023';
    end if;
    insert into public.library_items (id, board_id, school_id, type, title, source, author_id)
    values (p_item_id, (p_item ->> 'boardId')::uuid, nullif(p_item ->> 'schoolId', '')::uuid,
      (p_item ->> 'type')::public.library_item_type, v_title, 'teacher_created', v_user)
    returning * into v;
    v_new := true;
  elsif p_expected_revision is null then
    -- The same create sent again (a retry after a lost answer): it already went through.
    if v.author_id is distinct from v_user then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    return query select v.id, v.content_revision;
    return;
  elsif not app.library_item_editable_by(v_user, v.id) then
    if v.status = 'board_approved' and app.library_item_keeper(v_user, v) then
      raise exception 'approved items are read-only' using errcode = 'LXL06';
    end if;
    raise exception 'not allowed' using errcode = '42501';
  elsif v.content_revision <> p_expected_revision then
    raise exception 'changed since it was opened' using errcode = 'LXL07';
  elsif (p_item ->> 'type') is distinct from v.type::text then
    raise exception 'the type of an item never changes' using errcode = '22023';
  end if;

  -- Links: the board's or standard subject, reference and tags; attentes of that subject and
  -- one of the item's grades.
  if (v_subject is not null and not exists (
        select 1 from public.subjects s
        where s.id = v_subject and s.active and (s.board_id is null or s.board_id = v.board_id)))
    or (v_ref is not null and not exists (
        select 1 from public.catholic_references r
        where r.id = v_ref and r.active and (r.board_id is null or r.board_id = v.board_id)))
    or cardinality(v_grades) > 4 or cardinality(v_exps) > 12 or cardinality(v_tags) > 10
    or exists (select 1 from unnest(v_grades) g where not exists (
        select 1 from public.grades where code = g))
    or exists (select 1 from unnest(v_exps) e where not exists (
        select 1 from public.curriculum_expectations ce
        where ce.id = e and ce.subject_id = v_subject and ce.grade_code = any (v_grades)))
    or exists (select 1 from unnest(v_tags) t where not exists (
        select 1 from public.tags tg
        where tg.id = t and (tg.board_id is null or tg.board_id = v.board_id)))
  then
    raise exception 'invalid links' using errcode = '22023';
  end if;
  if coalesce((p_item ->> 'subFriendly')::boolean, false) and (
    v.type in ('unit_test', 'diagnostic', 'rubric', 'parent_guide', 'teacher_guide', 'project')
    or (v.type in ('experiment', 'stem_challenge')
      and (p_item -> 'safetyNotes' ->> 'supervision') is distinct from 'standard'))
  then
    raise exception 'not sub-friendly' using errcode = '22023';
  end if;

  update public.library_items i set
    title = v_title,
    summary = nullif(btrim(p_item ->> 'summary'), ''),
    licence = nullif(btrim(p_item ->> 'licence'), ''),
    subject_id = v_subject,
    duration_minutes = (p_item ->> 'durationMinutes')::smallint,
    materials = nullif(btrim(p_item ->> 'materials'), ''),
    keywords = nullif(btrim(p_item ->> 'keywords'), ''),
    is_printable = coalesce((p_item ->> 'isPrintable')::boolean, true),
    is_projectable = coalesce((p_item ->> 'isProjectable')::boolean, false),
    is_interactive = coalesce((p_item ->> 'isInteractive')::boolean, false),
    sub_friendly = coalesce((p_item ->> 'subFriendly')::boolean, false),
    safety_notes = case when jsonb_typeof(p_item -> 'safetyNotes') = 'object' then p_item -> 'safetyNotes' end,
    -- A reviewer's flag stays: the author cannot clear it (D-064).
    faith_content = coalesce((p_item ->> 'faithContent')::boolean, false) or i.faith_flagged_by is not null,
    faith_on_student_sheet = coalesce((p_item ->> 'faithOnStudentSheet')::boolean, false),
    catholic_connection = nullif(btrim(p_item ->> 'catholicConnection'), ''),
    catholic_reference_id = v_ref
  where i.id = v.id;

  delete from public.library_item_grades g where g.item_id = v.id and g.grade_code <> all (v_grades);
  insert into public.library_item_grades (item_id, grade_code)
  select v.id, x from unnest(v_grades) x
  on conflict do nothing;
  delete from public.library_item_expectations e
  where e.item_id = v.id and e.expectation_id <> all (v_exps);
  insert into public.library_item_expectations (item_id, expectation_id)
  select v.id, x from unnest(v_exps) x
  on conflict do nothing;
  delete from public.library_item_tags t where t.item_id = v.id and t.tag_id <> all (v_tags);
  insert into public.library_item_tags (item_id, tag_id)
  select v.id, x from unnest(v_tags) x
  on conflict do nothing;

  delete from public.library_item_versions lv
  where lv.item_id = v.id
    and coalesce(lv.language_level_id::text, 'base') not in (
      select coalesce(nullif(x ->> 'languageLevelId', ''), 'base')
      from jsonb_array_elements(p_item -> 'versions') x);
  for v_version in select x from jsonb_array_elements(p_item -> 'versions') x loop
    v_level := nullif(v_version ->> 'languageLevelId', '')::uuid;
    -- A board level, or one of the saver's own levels.
    if v_level is not null and not exists (
      select 1 from public.language_levels ll
      where ll.id = v_level and ll.board_id = v.board_id
        and (ll.owner_user_id is null or ll.owner_user_id = v_user)
    ) then
      raise exception 'invalid version' using errcode = '22023';
    end if;
    v_version_id := null;
    select lv.id into v_version_id from public.library_item_versions lv
    where lv.item_id = v.id and lv.language_level_id is not distinct from v_level;
    if v_version_id is null then
      insert into public.library_item_versions (item_id, language_level_id, schema_version, content)
      values (v.id, v_level, 1, v_version -> 'content')
      returning id into v_version_id;
    else
      update public.library_item_versions
      set content = v_version -> 'content', schema_version = 1
      where id = v_version_id;
    end if;
    if jsonb_typeof(v_version -> 'answerKey') = 'object' then
      insert into public.library_item_answer_keys (version_id, answer_key)
      values (v_version_id, v_version -> 'answerKey')
      on conflict (version_id) do update set answer_key = excluded.answer_key, updated_at = now();
    else
      delete from public.library_item_answer_keys where version_id = v_version_id;
    end if;
  end loop;

  if v.share_scope <> 'private' and app.library_has_personal_levels(v.id) then
    raise exception 'personal levels on a shared item' using errcode = 'LXL10';
  end if;
  if v_new then
    perform app.library_refresh_search(v.id);
  else
    perform app.library_content_changed(v.id);
  end if;
  -- A reviewed item stays ready: « Remettez-la en brouillon pour l'enregistrer incomplète ».
  if v.status = 'teacher_reviewed' then
    perform app.library_assert_ready(v.id, false);
  end if;
  return query select i.id, i.content_revision from public.library_items i where i.id = v.id;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 11. The review workflow (D-063, D-064, D-066, D-079). Each function locks the item, then
--     raises 42501 for an unknown item or the wrong person, 22023 for a bad argument, LXL04
--     for the wrong status. Audit details and event payloads hold ids and flags only; notes,
--     titles and names are never audited.
-- ---------------------------------------------------------------------------------------

-- « J'ai révisé cette ressource »: draft or sent back → reviewed, with the originality box.
create function public.library_mark_reviewed(p_item_id uuid, p_originality_confirmed boolean)
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
  if p_originality_confirmed is not true then
    raise exception 'originality not confirmed' using errcode = '22023';
  end if;
  if v.status not in ('draft', 'rejected') then
    raise exception 'not a draft' using errcode = 'LXL04';
  end if;
  perform app.library_assert_ready(v.id, false);
  update public.library_items set status = 'teacher_reviewed', review_note = null where id = v.id;
  perform app.log_audit('library_item.reviewed', v.board_id, v.school_id, 'library_item', v.id,
    jsonb_build_object('originality_confirmed', true, 'revision', v.content_revision));
end;
$$;

-- « Remettre en brouillon »: reviewed → private draft; a pending request goes.
create function public.library_return_to_draft(p_item_id uuid)
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
  if v.status <> 'teacher_reviewed' then
    raise exception 'not reviewed' using errcode = 'LXL04';
  end if;
  update public.library_items
  set status = 'draft', share_scope = 'private', review_requested_at = null, review_requested_by = null
  where id = v.id;
  perform app.flag_absences_for_library_item(v.id);
  perform app.log_audit('library_item.returned_to_draft', v.board_id, v.school_id, 'library_item',
    v.id, jsonb_build_object('scope', v.share_scope));
end;
$$;

-- « Partager »: the author shares a reviewed item with her school or the whole board, or makes
-- it private again. Faith content reaches the whole board only once faith-reviewed; versions
-- for personal levels keep it private. `p_names_confirmed` is how many first names the author
-- confirmed as « Ce n'est pas un nom d'élève » (the web server's guard, D-066).
create function public.library_share(
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
  if v_user is null or v.id is null or v.author_id is distinct from v_user then
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

-- « Proposer au conseil »: a reviewed item that is ready for approval, without versions for
-- personal levels, goes into the reviewers' queue.
create function public.library_request_approval(p_item_id uuid)
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

-- « Retirer la demande ».
create function public.library_cancel_request(p_item_id uuid)
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
  if v.review_requested_at is null then
    raise exception 'not requested' using errcode = 'LXL04';
  end if;
  update public.library_items set review_requested_at = null, review_requested_by = null
  where id = v.id;
  perform app.log_audit('library_item.review_cancelled', v.board_id, v.school_id, 'library_item',
    v.id, '{}'::jsonb);
end;
$$;

-- A content reviewer approves a requested item for the whole board, or sends it back with a
-- note. Never their own item; refused if it changed since the reviewer opened it; faith content
-- is faith-reviewed first.
create function public.library_decide(
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
    set status = 'board_approved', share_scope = 'board', approved_at = now(), approved_by = v_user,
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

-- A faith reviewer approves the faith content of a requested item (then content approval and
-- board-wide sharing can go ahead), or sends it back with a note like library_decide.
create function public.library_faith_decide(
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
  if v_user is null or v.id is null or not app.library_reviewer(v_user, v.board_id, 'faith') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approve', 'reject')
    or coalesce(char_length(v_note), 0) > 1000
    or (p_decision = 'reject' and v_note is null)
  then
    raise exception 'invalid decision' using errcode = '22023';
  end if;
  if v.status <> 'teacher_reviewed' or v.review_requested_at is null or not v.requires_faith_review
    or (p_decision = 'approve' and v.faith_reviewed_at is not null)
  then
    raise exception 'not awaiting a faith review' using errcode = 'LXL04';
  end if;
  if v.author_id = v_user then
    raise exception 'own item' using errcode = 'LXL05';
  end if;
  if v.content_revision is distinct from p_expected_revision then
    raise exception 'changed since it was opened' using errcode = 'LXL07';
  end if;

  if p_decision = 'approve' then
    update public.library_items set faith_reviewed_at = now(), faith_reviewed_by = v_user
    where id = v.id;
    perform app.log_audit('library_item.faith_approved', v.board_id, v.school_id, 'library_item',
      v.id, jsonb_build_object('type', v.type, 'revision', v.content_revision));
  else
    update public.library_items
    set status = 'rejected', share_scope = 'private', review_requested_at = null,
        review_requested_by = null, review_note = v_note, faith_reviewed_at = null,
        faith_reviewed_by = null
    where id = v.id;
    perform app.flag_absences_for_library_item(v.id);
    perform app.log_audit('library_item.faith_rejected', v.board_id, v.school_id, 'library_item',
      v.id, jsonb_build_object('type', v.type, 'revision', v.content_revision));
    perform app.emit_event('library_item.rejected', v.board_id, v.school_id, 'library_item', v.id,
      jsonb_build_object('itemId', v.id));
  end if;
end;
$$;

-- « Signaler du contenu de foi »: a reviewer who can read the item marks it as faith content,
-- which its author can no longer clear. Shared with the whole board before any faith review, it
-- goes back to its school (or private).
create function public.library_flag_faith(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.active_user_id();
  v public.library_items;
  v_scope public.share_scope;
begin
  select * into v from public.library_items where id = p_item_id for update;
  if v_user is null or v.id is null
    or not (app.library_reviewer(v_user, v.board_id, 'content')
      or app.library_reviewer(v_user, v.board_id, 'faith'))
    or not app.library_item_readable_by(v_user, v.id)
  then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v.status in ('board_approved', 'archived') then
    raise exception 'approved or archived' using errcode = 'LXL04';
  end if;
  if v.faith_flagged_by is not null then
    return;                                                   -- already flagged
  end if;
  v_scope := case
    when v.share_scope = 'board' and v.faith_reviewed_at is null
      then case when v.school_id is not null then 'school' else 'private' end::public.share_scope
    else v.share_scope
  end;
  update public.library_items
  set faith_content = true, faith_flagged_by = v_user, share_scope = v_scope
  where id = v.id;
  if v_scope <> v.share_scope then
    perform app.flag_absences_for_library_item(v.id);
  end if;
  perform app.log_audit('library_item.faith_flagged', v.board_id, v.school_id, 'library_item', v.id,
    jsonb_build_object('scope', v_scope, 'scope_reduced', v_scope <> v.share_scope));
end;
$$;

-- « Retirer de la banque »: a content reviewer of the board withdraws a shared or approved item,
-- with a note for its author. It becomes « À retravailler » and private.
create function public.library_retract(p_item_id uuid, p_note text)
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
  if v_note is null or char_length(v_note) > 1000 then
    raise exception 'a note is required' using errcode = '22023';
  end if;
  if v.status not in ('teacher_reviewed', 'board_approved') or v.share_scope = 'private' then
    raise exception 'not shared' using errcode = 'LXL04';
  end if;
  update public.library_items
  set status = 'rejected', share_scope = 'private', review_note = v_note,
      review_requested_at = null, review_requested_by = null, approved_at = null, approved_by = null,
      faith_reviewed_at = null, faith_reviewed_by = null
  where id = v.id;
  perform app.flag_absences_for_library_item(v.id);
  perform app.log_audit('library_item.retracted', v.board_id, v.school_id, 'library_item', v.id,
    jsonb_build_object('type', v.type, 'from', v.status, 'scope', v.share_scope));
  perform app.emit_event('library_item.retracted', v.board_id, v.school_id, 'library_item', v.id,
    jsonb_build_object('itemId', v.id));
end;
$$;

-- « Archiver »: the author (a content reviewer for the board's own items) takes an item out of
-- use, whatever its status. An approved item loses its approval.
create function public.library_archive(p_item_id uuid)
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
  if v_user is null or v.id is null or not app.library_item_keeper(v_user, v) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v.status = 'archived' then
    raise exception 'already archived' using errcode = 'LXL04';
  end if;
  update public.library_items
  set status = 'archived', share_scope = 'private', review_requested_at = null,
      review_requested_by = null, approved_at = null, approved_by = null
  where id = v.id;
  if v.status in ('teacher_reviewed', 'board_approved') then
    perform app.flag_absences_for_library_item(v.id);
  end if;
  perform app.log_audit('library_item.archived', v.board_id, v.school_id, 'library_item', v.id,
    jsonb_build_object('from', v.status, 'scope', v.share_scope));
  perform app.emit_event('library_item.archived', v.board_id, v.school_id, 'library_item', v.id,
    jsonb_build_object('itemId', v.id));
end;
$$;

-- « Restaurer »: an archived item comes back as a private draft.
create function public.library_restore(p_item_id uuid)
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
  if v_user is null or v.id is null or not app.library_item_keeper(v_user, v) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v.status <> 'archived' then
    raise exception 'not archived' using errcode = 'LXL04';
  end if;
  update public.library_items set status = 'draft' where id = v.id;
  perform app.log_audit('library_item.restored', v.board_id, v.school_id, 'library_item', v.id,
    '{}'::jsonb);
end;
$$;

-- « Approbation des ressources »: requested items of the boards where the caller reviews that
-- kind. The faith queue lists only items that still need their faith review.
create function public.library_review_queue(p_kind text)
returns table (
  item_id uuid,
  title text,
  type public.library_item_type,
  content_revision integer,
  requested_at timestamptz,
  author_name text,
  school_name text,
  grade_codes text[],
  requires_faith_review boolean,
  faith_reviewed boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user uuid := app.active_user_id();
  v_boards uuid[];
begin
  if v_user is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('content', 'faith') then
    raise exception 'invalid queue' using errcode = '22023';
  end if;
  v_boards := array(
    select r.board_id from public.library_reviewers r
    where r.user_id = v_user and app.library_reviewer(v_user, r.board_id, p_kind));
  if cardinality(v_boards) = 0 then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select i.id, i.title, i.type, i.content_revision, i.review_requested_at,
      case when u.id is not null then app.formal_staff_name(u.display_name, u.honorific) end,
      s.name,
      array(select g.grade_code from public.library_item_grades g
            join public.grades gr on gr.code = g.grade_code
            where g.item_id = i.id order by gr.ordinal),
      i.requires_faith_review,
      i.faith_reviewed_at is not null
    from public.library_items i
    left join public.users u on u.id = i.author_id
    left join public.schools s on s.id = i.school_id
    where i.board_id = any (v_boards)
      and i.status = 'teacher_reviewed' and i.review_requested_at is not null
      and (p_kind = 'content' or (i.requires_faith_review and i.faith_reviewed_at is null))
    order by i.review_requested_at, i.id;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 12. Planning (D-076)
-- ---------------------------------------------------------------------------------------

-- A lesson plan or project as a new lesson of a unit, at a position (null or past the end: at
-- the end). The lesson copies an outline (`p_lesson`: {title, objectives, materials, content,
-- subNotes, durationMinutes}, built by lessonFromItem in @lynx/content) and the item's
-- attentes, and keeps the link. Security invoker: row level security on units and lessons
-- decides whose unit this is.
create function public.add_library_item_to_unit(
  p_item_id uuid,
  p_unit_id uuid,
  p_position integer,
  p_lesson jsonb
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
  v_pos integer;
  v_title text := left(btrim(coalesce(p_lesson ->> 'title', '')), 160);
  v_id uuid;
begin
  if p_item_id is null or not app.can_use_library_item(p_item_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.units where id = p_unit_id) then
    raise exception 'unit not found' using errcode = 'P0002';        -- RLS hides others' units
  end if;
  if jsonb_typeof(p_lesson) is distinct from 'object' or v_title = ''
    or coalesce(jsonb_typeof(p_lesson -> 'durationMinutes'), 'null') not in ('number', 'null')
  then
    raise exception 'invalid lesson' using errcode = '22023';
  end if;
  if (p_lesson ->> 'durationMinutes')::numeric not between 1 and 600 then
    raise exception 'invalid lesson' using errcode = '22023';
  end if;

  perform 1 from public.unit_lessons where unit_id = p_unit_id for update;
  select count(*) into v_count from public.unit_lessons where unit_id = p_unit_id;
  v_pos := case when p_position is null or p_position > v_count then v_count + 1
                else greatest(p_position, 1) end;
  set constraints public.unit_lessons_sequence_key deferred;
  update public.unit_lessons set sequence_number = sequence_number + 1
  where unit_id = p_unit_id and sequence_number >= v_pos;
  insert into public.unit_lessons (unit_id, sequence_number, title, objectives, materials, content,
    sub_notes, duration_minutes, library_item_id)
  values (p_unit_id, v_pos, v_title,
    nullif(left(btrim(p_lesson ->> 'objectives'), 4000), ''),
    nullif(left(btrim(p_lesson ->> 'materials'), 4000), ''),
    nullif(left(btrim(p_lesson ->> 'content'), 20000), ''),
    nullif(left(btrim(p_lesson ->> 'subNotes'), 4000), ''),
    round((p_lesson ->> 'durationMinutes')::numeric)::smallint,
    p_item_id)
  returning id into v_id;
  insert into public.unit_lesson_expectations (lesson_id, expectation_id)
  select v_id, le.expectation_id from public.library_item_expectations le
  where le.item_id = p_item_id
  on conflict do nothing;
  return v_id;
end;
$$;

-- usage_count = the number of distinct units whose lessons link the item (« Utilisée dans
-- 3 unités »), so adding and removing a link again never inflates it. The item row is locked
-- first, so two teachers linking it at once both count.
create function app.library_recount_usage(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform 1 from public.library_items where id = p_item_id for update;
  select count(distinct l.unit_id) into v_count
  from public.unit_lessons l where l.library_item_id = p_item_id;
  update public.library_items set usage_count = v_count
  where id = p_item_id and usage_count <> v_count;
end;
$$;

create function app.unit_lessons_library_usage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.library_item_id is not null then
    perform app.library_recount_usage(old.library_item_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.library_item_id is not null
    and (tg_op = 'INSERT' or new.library_item_id is distinct from old.library_item_id)
  then
    perform app.library_recount_usage(new.library_item_id);
  end if;
  return null;
end;
$$;

create trigger unit_lessons_library_usage
  after insert or update of library_item_id or delete on public.unit_lessons
  for each row execute function app.unit_lessons_library_usage();

-- ---------------------------------------------------------------------------------------
-- 13. Direct writes closed (D-063, amends D-012). The API keeps reading (row level security)
--     and the author's delete of drafts, sent-back and archived items; everything else goes
--     through the functions above. Tags are curated by content packs and the operator.
-- ---------------------------------------------------------------------------------------

revoke insert, update on public.library_items from authenticated;
drop policy library_items_insert on public.library_items;
drop policy library_items_update on public.library_items;

revoke insert, update, delete on public.library_item_grades, public.library_item_versions,
  public.library_item_answer_keys, public.library_item_expectations, public.library_item_tags
  from authenticated;
drop policy library_item_grades_write on public.library_item_grades;
drop policy library_item_versions_write on public.library_item_versions;
drop policy library_item_answer_keys_write on public.library_item_answer_keys;
drop policy library_item_expectations_write on public.library_item_expectations;
drop policy library_item_tags_write on public.library_item_tags;

revoke insert on public.tags from authenticated;
drop policy tags_insert on public.tags;

-- ---------------------------------------------------------------------------------------
-- 14. Phase 2 saved texts (D-073)
-- ---------------------------------------------------------------------------------------

-- As before (D-042), for « Texte différencié » results only, plus: each version may carry its
-- answer key (`answer_key`, an object), versions are written with schema version 1, and the
-- search document follows.
create or replace function public.save_ai_job_to_library(
  p_job_id uuid,
  p_type public.library_item_type,
  p_title text,
  p_versions jsonb,
  p_grade_code text default null,
  p_subject_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.active_user_id();
  v_job public.ai_jobs;
  v_gen public.ai_generations;
  v_item uuid;
  v_version jsonb;
  v_level uuid;
  v_version_id uuid;
begin
  select * into v_job from public.ai_jobs where id = p_job_id;
  if v_user is null or v_job.id is null or v_job.user_id <> v_user
     or v_job.school_id not in (select app.my_staff_school_ids()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_job.status <> 'succeeded' or v_job.feature <> 'differentiate' then
    raise exception 'job has no result' using errcode = '22023';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 200 then
    raise exception 'invalid title' using errcode = '22023';
  end if;
  if p_type is null or p_type not in ('reading_passage', 'worksheet') then
    raise exception 'unsupported item type' using errcode = '22023';
  end if;
  if p_grade_code is not null and not exists (select 1 from public.grades where code = p_grade_code) then
    raise exception 'unknown grade' using errcode = '22023';
  end if;
  if p_subject_id is not null and not exists (
    select 1 from public.subjects s
    where s.id = p_subject_id and (s.board_id is null or s.board_id = v_job.board_id)
  ) then
    raise exception 'unknown subject' using errcode = '22023';
  end if;
  if p_versions is null or jsonb_typeof(p_versions) <> 'array'
     or jsonb_array_length(p_versions) not between 1 and 8
     or pg_column_size(p_versions) > 262144 then
    raise exception 'invalid versions' using errcode = '22023';
  end if;

  select * into v_gen from public.ai_generations where id = v_job.ai_generation_id;

  insert into public.library_items (
    board_id, school_id, type, title, status, share_scope, source, author_id, subject_id,
    prompt_version, model, ai_generation_id
  ) values (
    v_job.board_id, v_job.school_id, p_type, btrim(p_title), 'draft', 'private', 'ai_generated', v_user,
    p_subject_id, v_gen.prompt_version, v_gen.model, v_gen.id
  )
  returning id into v_item;

  if p_grade_code is not null then
    insert into public.library_item_grades (item_id, grade_code) values (v_item, p_grade_code);
  end if;

  for v_version in select * from jsonb_array_elements(p_versions) loop
    if jsonb_typeof(v_version -> 'content') is distinct from 'object'
      or coalesce(jsonb_typeof(v_version -> 'answer_key'), 'null') not in ('object', 'null')
    then
      raise exception 'invalid version content' using errcode = '22023';
    end if;
    v_level := nullif(v_version ->> 'language_level_id', '')::uuid;
    if v_level is not null and not exists (
      select 1 from public.language_levels ll
      where ll.id = v_level and ll.board_id = v_job.board_id
        and (ll.owner_user_id is null or ll.owner_user_id = v_user)
    ) then
      raise exception 'unknown language level' using errcode = '22023';
    end if;
    insert into public.library_item_versions (item_id, language_level_id, schema_version, content)
    values (v_item, v_level, 1, v_version -> 'content')
    returning id into v_version_id;
    if jsonb_typeof(v_version -> 'answer_key') = 'object' then
      insert into public.library_item_answer_keys (version_id, answer_key)
      values (v_version_id, v_version -> 'answer_key');
    end if;
  end loop;

  perform app.library_refresh_search(v_item);
  perform app.log_audit('library_item.saved_from_ai', v_job.board_id, v_job.school_id,
    'library_item', v_item, jsonb_build_object('ai_job_id', v_job.id));
  return v_item;
end;
$$;

-- Texts saved in Phase 2 (`differentiated_text/v1`) become canonical reading passages and
-- worksheets (@lynx/content fromDifferentiation gives the same shape): their questions become
-- short answers with ids, with a key that waits for sample answers. Nothing is hosted yet, so
-- this runs once here; it returns how many versions it converted.
create function app.library_convert_legacy_texts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_content jsonb;
  v_count integer := 0;
begin
  for r in
    select v.id, i.type, v.content c
    from public.library_item_versions v
    join public.library_items i on i.id = v.item_id
    where v.content ->> 'schema' = 'differentiated_text/v1'
    order by v.id
  loop
    v_content := jsonb_build_object(
      'title', coalesce(r.c ->> 'title', ''),
      'objective', coalesce(r.c ->> 'objective', ''),
      'teacherNote', coalesce(r.c ->> 'teacherNote', ''),
      'text', coalesce(r.c ->> 'text', ''),
      'glossary', case when jsonb_typeof(r.c -> 'glossary') = 'array' then r.c -> 'glossary'
                  else '[]'::jsonb end,
      'visualSupports', case when jsonb_typeof(r.c -> 'visualSupports') = 'array'
                        then r.c -> 'visualSupports' else '[]'::jsonb end,
      'questions', coalesce((
        select jsonb_agg(jsonb_build_object('id', 'q' || t.n, 'kind', 'short_answer',
          'prompt', t.q #>> '{}', 'hint', '', 'points', null, 'category', null, 'lines', 3)
          order by t.n)
        from jsonb_array_elements(case when jsonb_typeof(r.c -> 'questions') = 'array'
                                  then r.c -> 'questions' else '[]'::jsonb end)
          with ordinality t (q, n)), '[]'::jsonb))
      || case when r.type = 'worksheet' then jsonb_build_object('instructions', '') else '{}'::jsonb end;
    update public.library_item_versions set content = v_content, schema_version = 1 where id = r.id;
    if jsonb_array_length(v_content -> 'questions') > 0 then
      insert into public.library_item_answer_keys (version_id, answer_key)
      values (r.id, jsonb_build_object(
        'answers', (
          select jsonb_agg(jsonb_build_object('questionId', q ->> 'id', 'kind', 'short_answer',
            'sampleAnswer', '', 'acceptableAnswers', '[]'::jsonb, 'explanation', ''))
          from jsonb_array_elements(v_content -> 'questions') q),
        'solution', ''))
      on conflict (version_id) do nothing;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

select app.library_convert_legacy_texts();

-- ---------------------------------------------------------------------------------------
-- 15. Permissions: functions are opt-in, as everywhere else.
-- ---------------------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon;

grant execute on function
  public.save_library_item(uuid, integer, jsonb),
  public.add_library_item_to_unit(uuid, uuid, integer, jsonb),
  public.library_mark_reviewed(uuid, boolean),
  public.library_return_to_draft(uuid),
  public.library_share(uuid, public.share_scope, uuid, integer),
  public.library_request_approval(uuid),
  public.library_cancel_request(uuid),
  public.library_decide(uuid, text, text, integer),
  public.library_faith_decide(uuid, text, text, integer),
  public.library_flag_faith(uuid),
  public.library_retract(uuid, text),
  public.library_archive(uuid),
  public.library_restore(uuid),
  public.library_review_queue(text)
to authenticated;

-- Used by row level security, by the planner function (security invoker) and by the safety
-- notes check; each answers only about the current user or its argument.
grant execute on function app.can_read_library_item(uuid), app.can_use_library_item(uuid),
  app.library_safety_notes_valid(jsonb) to authenticated;
grant execute on function app.library_safety_notes_valid(jsonb) to service_role;

-- Helpers that take a user, and the search refresh: the worker and the operator only.
grant execute on function public.library_refresh_search_all(), app.library_item_usable_by(uuid, uuid),
  app.library_item_readable_by(uuid, uuid), app.library_item_editable_by(uuid, uuid),
  app.library_reviewer(uuid, uuid, text), app.library_refresh_search(uuid) to service_role;
revoke execute on function public.library_refresh_search_all() from authenticated;

-- Every existing item gets its search document.
select app.library_refresh_search(id) from public.library_items;
